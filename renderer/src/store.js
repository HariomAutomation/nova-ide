import { create } from 'zustand';
import { langFromPath } from './languages';
import { dueAutomations, normalizeTrigger } from './automation-schedule';

// Automation scheduler state (module-level: not part of the render tree).
let autoTimer = null;
let pendingAutomationId = null;

const api = () => window.nova;

const DEFAULT_AGENT_SETTINGS = {
  // approvals
  autoApproveEdit: true,
  autoApproveTerminal: false,
  autoApproveBrowser: true,
  autoApproveComputer: false,
  autoApproveMcp: false,
  autoAcceptWebSearch: false,
  fileDeletionProtection: false,
  externalFileProtection: true,
  readAccess: 'system', // 'system' | 'workspace'
  runMode: 'auto-review', // 'auto-review' | 'allowlist' | 'full-auto'
  // conversation
  submitWithCtrlEnter: false,
  newMessages: 'queue', // 'queue' | 'interrupt'
  manualQueueBehavior: 'interrupt',
  agentAutocomplete: true,
  approveModeTransitions: false,
  // tools
  webSearch: true,
  webFetch: true,
  maxSteps: 25,
  extraInstructions: '',
  composerMode: 'auto', // 'auto' | 'agent' | 'chat'
};

// Nova ships NO models by default. The user adds their own (custom endpoint or a
// quick-add preset). This keeps the model picker empty and uncluttered on first run.
export const DEFAULT_INTEGRATED_MODELS = [];

const MAX_CHATS = 25;

function uuid() {
  return (crypto && crypto.randomUUID && crypto.randomUUID()) || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// Strip heavy fields (base64 images) before persisting chat transcripts.
function sanitizeItems(items) {
  return (items || [])
    .filter((it) => ['user', 'assistant', 'tool', 'error'].includes(it.kind))
    .map((it, i) => ({
      id: it.id || `it_${i}`,
      kind: it.kind,
      mode: it.mode || undefined,
      text: it.text != null ? String(it.text).slice(0, 4000) : undefined,
      name: it.name,
      callId: it.callId,
      args: it.name ? it.args : undefined,
      category: it.category,
      status: it.status === 'running' || it.status === 'awaiting' ? 'done' : it.status,
      output: it.output != null ? String(it.output).slice(0, 600) : undefined,
    }));
}

export const useStore = create((set, get) => ({
  /* ------------------------------ workspace ------------------------------ */
  rootFolder: null,
  gitBranch: null,
  childrenByDir: {},
  expanded: {},
  tabs: [],
  activePath: null,
  untitledSeq: 0,
  pendingReveal: null,

  /* -------------------------------- models -------------------------------- */
  models: [],
  keyVault: {},
  activeModelId: null,

  /* ------------------------------- ask chat ------------------------------- */
  messages: [],
  chatBusy: false,
  includeActiveFile: true,

  /* ------------------------------- agent chat ------------------------------- */
  agentId: uuid(),
  agentItems: [],
  agentTodos: [],
  agentBusy: false,
  agentStep: 0,
  activeTurnMode: null,
  queued: [],
  currentChatId: null,
  chats: [],
  usedAgent: false,
  composerFocusSeq: 0,
  attachedFiles: [],
  automations: [],

  /* --------------------------------- layout --------------------------------- */
  theme: 'light',
  mainView: 'agent', // 'agent' | 'editor' | 'search' | 'automations' | 'customize' | 'git' | 'cloud' | 'memory'
  settingsOpen: false,
  settingsTab: 'models',
  status: '',
  appInfo: null,
  navHistory: [],
  navFwd: [],
  sidebarVisible: true,
  chatVisible: false,
  terminalOpen: false,

  /* ---------------------------------- git ---------------------------------- */
  git: { repo: false, branch: null, upstream: null, ahead: 0, behind: 0, remote: null, files: [], loading: false, error: null },
  gitMessage: '',
  gitBusy: false,
  runOn: 'local', // 'local' | 'cloud' — where agent turns are meant to run

  /* -------------------------------- github -------------------------------- */
  github: { connected: false, login: null, repos: [], loading: false, error: null },

  /* -------------------------------- memory -------------------------------- */
  memory: { notes: [], path: null, account: 'local', loading: false },

  /* --------------------------------- cloud --------------------------------- */
  drive: { connected: false, email: null, hasClient: false, loading: false, files: [], error: null, query: '' },

  /* --------------------------------- search --------------------------------- */
  searchQuery: '',
  searchResults: null,
  searchRunning: false,

  /* --------------------------------- settings --------------------------------- */
  agentSettings: { ...DEFAULT_AGENT_SETTINGS },
  browserSettings: { headless: true },
  voiceSettings: { provider: 'auto', baseUrl: '', apiKey: '', model: '' },

  /* --------------------------- customization / mcp --------------------------- */
  workspaceFiles: [],
  skills: null,
  mcpInfo: null,
  addons: null,

  /* --------------------------------- terminal --------------------------------- */
  termLines: [],
  termBusy: false,
  termId: null,

  /* --------------------------------- basics --------------------------------- */

  setStatus: (s) => set({ status: s }),
  setSettingsOpen: (v, tab) => set({ settingsOpen: v, settingsTab: tab || get().settingsTab }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setIncludeActiveFile: (v) => set({ includeActiveFile: v }),
  setChatVisible: (v) => set({ chatVisible: v }),
  setTerminalOpen: (v) => set({ terminalOpen: v }),
  patchAgentSettings: (patch) => set({ agentSettings: { ...get().agentSettings, ...patch } }),
  setComposerMode: (mode) => {
    set({ agentSettings: { ...get().agentSettings, composerMode: mode } });
    get().saveSettings();
  },
  patchBrowserSettings: (patch) => set({ browserSettings: { ...get().browserSettings, ...patch } }),
  patchVoiceSettings: (patch) => set({ voiceSettings: { ...get().voiceSettings, ...patch } }),

  applyRunMode(mode) {
    const presets = {
      'auto-review': {
        autoApproveEdit: true,
        autoApproveTerminal: false,
        autoApproveBrowser: true,
        autoApproveComputer: false,
        autoAcceptWebSearch: false,
      },
      allowlist: {
        autoApproveEdit: false,
        autoApproveTerminal: false,
        autoApproveBrowser: false,
        autoApproveComputer: false,
        autoAcceptWebSearch: false,
      },
      'full-auto': {
        autoApproveEdit: true,
        autoApproveTerminal: true,
        autoApproveBrowser: true,
        autoApproveComputer: true,
        autoAcceptWebSearch: true,
      },
    };
    set({
      agentSettings: { ...get().agentSettings, ...(presets[mode] || presets['auto-review']), runMode: mode },
    });
    get().saveSettings();
  },

  attachFiles(paths) {
    const next = [...get().attachedFiles];
    for (const p of paths || []) if (p && !next.includes(p)) next.push(p);
    set({ attachedFiles: next });
  },

  removeAttached(path) {
    set({ attachedFiles: get().attachedFiles.filter((p) => p !== path) });
  },

  clearAttached() {
    set({ attachedFiles: [] });
  },

  /* ------------------------------ automations ------------------------------ */

  addAutomation({ name, prompt, trigger, enabled }) {
    const p = String(prompt || '').trim();
    if (!p) return;
    const a = {
      id: uuid(),
      name: String(name || '').trim() || 'Automation',
      prompt: p,
      trigger: normalizeTrigger(trigger),
      enabled: enabled !== false,
      webhookToken: uuid().replace(/-/g, '').slice(0, 16),
      createdAt: Date.now(),
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
    };
    set({ automations: [a, ...get().automations].slice(0, 50) });
    get().saveSettings();
    return a;
  },

  updateAutomation(id, patch) {
    set({ automations: get().automations.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
    get().saveSettings();
  },

  removeAutomation(id) {
    set({ automations: get().automations.filter((a) => a.id !== id) });
    get().saveSettings();
  },

  async runAutomation(id, source) {
    const a = get().automations.find((x) => x.id === id);
    if (!a) return false;
    if (!get().models.find((m) => m.id === get().activeModelId)) {
      get().setStatus('Automation needs a model — add one in Settings → Models first.');
      get().updateAutomation(id, { lastRunAt: Date.now(), lastStatus: 'error', lastError: 'No model configured' });
      return false;
    }
    if (get().agentBusy) {
      get().setStatus('Automation skipped — the agent is busy. It will try again shortly.');
      return false;
    }
    // Stamp the run before dispatching so interval/daily triggers don't re-fire.
    get().updateAutomation(id, { lastRunAt: Date.now(), lastStatus: 'running', lastError: null });
    pendingAutomationId = id;
    get().newAgentChat();
    get().setStatus(`Running automation: ${a.name}${source ? ` (${source})` : ''}`);
    await get().agentSend(a.prompt);
    return true;
  },

  /** Fire automations whose trigger is due. One agent turn at a time. */
  startAutomationScheduler() {
    if (autoTimer) return;
    const tick = () => {
      const s = get();
      if (s.agentBusy || pendingAutomationId) return;
      const due = dueAutomations(s.automations, Date.now());
      if (due.length) s.runAutomation(due[0].id, 'schedule');
    };
    autoTimer = setInterval(tick, 30000);
    setTimeout(tick, 5000);
  },

  stopAutomationScheduler() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  },

  /** A local webhook hit (POST /automations/webhook/<token>) runs its automation. */
  handleAutomationWebhook(token) {
    const a = get().automations.find((x) => x.webhookToken && x.webhookToken === token);
    if (!a) {
      get().setStatus('Webhook received for an unknown automation.');
      return false;
    }
    get().runAutomation(a.id, 'webhook');
    return true;
  },

  /* -------------------------- workspace file list (@) -------------------------- */

  async loadWorkspaceFiles() {
    const { rootFolder } = get();
    if (!rootFolder) return;
    try {
      const files = await api().workspaceFiles(rootFolder);
      set({ workspaceFiles: files });
    } catch {}
  },

  /* --------------------------------- skills --------------------------------- */

  async loadSkills() {
    try {
      set({ skills: await api().listSkills() });
    } catch {
      set({ skills: [] });
    }
  },

  async newSkill(name) {
    try {
      const sk = await api().newSkill(name);
      await get().loadSkills();
      get().setStatus(`Skill created: ${sk.name}`);
      return sk;
    } catch (e) {
      get().setStatus(`Could not create skill: ${e.message}`);
      return null;
    }
  },

  /* ---------------------------------- mcp ---------------------------------- */

  async loadMcpStatus() {
    try {
      set({ mcpInfo: await api().mcpStatus() });
    } catch (e) {
      set({ mcpInfo: { error: String(e.message || e) } });
    }
  },

  async reloadMcp() {
    try {
      set({ mcpInfo: await api().mcpReload() });
      get().setStatus('MCP servers reloaded');
    } catch (e) {
      get().setStatus(`MCP reload failed: ${e.message}`);
    }
  },

  /* ------------------------------ addons (REA / LeanToken) ------------------------------ */

  async loadAddons() {
    try {
      const r = await api().addonsStatus();
      set({ addons: r });
    } catch (e) {
      set({ addons: { error: String(e.message || e) } });
    }
  },

  async toggleAddon(id, enable, url) {
    try {
      const r = await api().addonsToggle(id, enable, url);
      if (r && r.error) {
        get().setStatus(r.error);
        return;
      }
      set({ addons: r });
      get().loadMcpStatus().catch(() => {});
      const addon = r && r.addons ? r.addons.find((a) => a.id === id) : null;
      if (addon) {
        get().setStatus(
          enable
            ? `${addon.name} enabled${addon.toolCount ? ` — ${addon.toolCount} tools` : ''}. New agent turns can use it.`
            : `${addon.name} disabled.`
        );
      }
    } catch (e) {
      get().setStatus(`Addon toggle failed: ${e.message}`);
    }
  },

  /* ------------------------------- checkpoints ------------------------------- */

  async restoreCheckpoint() {
    try {
      const r = await api().restoreCheckpoint(get().agentId);
      if (!r.restored || !r.restored.length) {
        get().setStatus('Nothing to restore — no agent edits recorded for this chat.');
      } else {
        get().setStatus(
          `Restored ${r.restored.length} file${r.restored.length > 1 ? 's' : ''} from before the agent’s edits.`
        );
      }
      return r;
    } catch (e) {
      get().setStatus(`Restore failed: ${e.message}`);
      return null;
    }
  },

  setTheme(theme) {
    set({ theme });
    get().saveSettings();
  },

  setMainView(v) {
    const s = get();
    if (s.mainView === v) return;
    s.navPush();
    set({ mainView: v });
  },

  /* ----------------------------- center pages ----------------------------- */

  navPush() {
    const s = get();
    set({
      navHistory: [...s.navHistory.slice(-30), { view: s.mainView, chatId: s.currentChatId }],
      navFwd: [],
    });
  },

  openSearchPage() {
    get().navPush();
    set({ mainView: 'search' });
  },

  openAutomations() {
    get().navPush();
    set({ mainView: 'automations' });
  },

  openCustomize() {
    get().navPush();
    set({ mainView: 'customize' });
  },

  /* ----------------------------- source control ----------------------------- */

  openSourceControl() {
    get().navPush();
    set({ mainView: 'git' });
    get().loadGit().catch(() => {});
  },

  /* ------------------------------ github ------------------------------ */

  async loadGithub() {
    try {
      const st = (await api().githubStatus()) || {};
      set({ github: { ...get().github, ...st, error: null } });
    } catch (e) {
      set({ github: { ...get().github, error: String(e.message || e) } });
    }
  },

  async saveGithubToken(token) {
    const r = await api().githubSave(token);
    if (r && r.error) {
      set({ github: { ...get().github, error: r.error } });
      get().setStatus(`GitHub: ${r.error}`);
      return false;
    }
    set({ github: { ...get().github, ...r, error: null } });
    get().setStatus(`GitHub connected${r.login ? `: ${r.login}` : ''}.`);
    await get().loadGithubRepos('');
    return true;
  },

  /** Start GitHub device-flow sign-in; returns the code to show the user. */
  async githubSignIn() {
    const r = await api().githubDeviceStart();
    if (!r || r.error) {
      get().setStatus(`GitHub: ${(r && r.error) || 'unknown error'}`);
      return null;
    }
    get().setStatus(`GitHub sign-in: browser me code ${r.userCode} daalo…`);
    return r;
  },

  /** Wait for the user to approve in the browser, then store the token. */
  async githubPollSignIn(deviceCode) {
    const r = await api().githubDevicePoll(deviceCode);
    if (r && r.ok) {
      set({ github: { ...get().github, ...r.status, error: null } });
      get().setStatus(`GitHub connected${r.status.login ? `: ${r.status.login}` : ''}.`);
      await get().loadGithubRepos('');
      return true;
    }
    get().setStatus(`GitHub sign-in failed: ${(r && r.error) || 'unknown'}`);
    return false;
  },

  async saveGithubClientId(clientId) {
    const st = await api().githubSaveClientId(clientId);
    set({ github: { ...get().github, ...st } });
    return st;
  },

  async githubLogout() {
    const r = await api().githubLogout();
    set({ github: { ...get().github, ...r, repos: [], error: null } });
    get().setStatus('GitHub disconnected.');
  },

  async loadGithubRepos(query) {
    set({ github: { ...get().github, loading: true, error: null } });
    try {
      const r = (await api().githubRepos(query)) || {};
      set({ github: { ...get().github, loading: false, repos: r.repos || [], error: r.error || null } });
    } catch (e) {
      set({ github: { ...get().github, loading: false, error: String(e.message || e) } });
    }
  },

  /** Clone a GitHub repo into ~/nova-repos and open it as the workspace. */
  async cloneRepo(repo) {
    if (!repo || !repo.cloneUrl) return;
    get().setStatus(`Opening ${repo.fullName}…`);
    const r = await api().githubClone({ cloneUrl: repo.cloneUrl, name: repo.name });
    if (r && r.ok) {
      get().setStatus(r.existed ? `Opened ${repo.fullName} → ${r.path}` : `Cloned ${repo.fullName} → ${r.path}`);
      await get().openFolder(r.path);
    } else {
      get().setStatus(`Clone failed: ${(r && r.error) || 'unknown error'}`);
    }
  },

  /* ------------------------------- memory ------------------------------- */

  openMemory() {
    get().navPush();
    set({ mainView: 'memory' });
    get().loadMemory().catch(() => {});
  },

  async loadMemory() {
    set({ memory: { ...get().memory, loading: true } });
    try {
      const r = (await api().memoryList()) || {};
      set({ memory: { notes: r.notes || [], path: r.path || null, account: r.account || 'local', loading: false } });
    } catch (e) {
      set({ memory: { ...get().memory, loading: false } });
      get().setStatus(`Memory load failed: ${e.message}`);
    }
  },

  async addMemory(text) {
    const body = String(text || '').trim();
    if (!body) return;
    try {
      const r = await api().memoryAdd({ text: body, source: 'user' });
      if (r && r.notes) set({ memory: { ...get().memory, notes: r.notes, path: r.path || get().memory.path } });
      get().setStatus('Saved to memory.');
      get().pushMemoryToCloud().catch(() => {});
    } catch (e) {
      get().setStatus(`Memory save failed: ${e.message}`);
    }
  },

  async removeMemory(id) {
    try {
      const r = await api().memoryRemove(id);
      if (r && r.notes) set({ memory: { ...get().memory, notes: r.notes } });
      get().pushMemoryToCloud().catch(() => {});
    } catch (e) {
      get().setStatus(`Memory delete failed: ${e.message}`);
    }
  },

  async clearMemory() {
    try {
      const r = await api().memoryClear();
      if (r && r.notes) set({ memory: { ...get().memory, notes: r.notes } });
      get().setStatus('Memory cleared.');
      get().pushMemoryToCloud().catch(() => {});
    } catch (e) {
      get().setStatus(`Memory clear failed: ${e.message}`);
    }
  },

  /** Point memory at the signed-in account (email) or the local namespace. */
  async applyMemoryAccount() {
    const st = get().drive || {};
    const account = st.connected && st.email ? st.email : 'local';
    try {
      const r = await api().memorySetAccount(account);
      if (r && r.notes) {
        set({
          memory: { notes: r.notes, path: r.path || null, account: r.account || account, loading: false },
        });
      }
    } catch (e) {
      get().setStatus(`Memory account switch failed: ${e.message}`);
    }
  },

  /** Merge the Drive memory into local memory, then push the union back. */
  async pullMemoryFromCloud() {
    const { drive } = get();
    if (!drive || !drive.connected) return { ok: false, reason: 'not-connected' };
    const r = await api().gdriveMemoryPull();
    if (!r || r.error) {
      get().setStatus(`Memory sync failed: ${(r && r.error) || 'unknown'}`);
      return { ok: false, error: (r && r.error) || 'unknown' };
    }
    const cloud = Array.isArray(r.notes) ? r.notes : [];
    const local = get().memory.notes || [];
    if (!r.found && !cloud.length) {
      // First sign-in on this account — seed Drive from whatever is local.
      await get().pushMemoryToCloud();
      return { ok: true, seeded: true };
    }
    const seen = new Set(local.map((n) => n.id));
    const merged = [...local, ...cloud.filter((n) => n && n.id && !seen.has(n.id))];
    const res = await api().memorySet(merged);
    if (res && res.notes) {
      set({ memory: { ...get().memory, notes: res.notes, path: res.path || get().memory.path } });
    }
    await get().pushMemoryToCloud();
    return { ok: true, merged: merged.length };
  },

  /** Push local memory to the signed-in account's Drive (app-data folder). */
  async pushMemoryToCloud() {
    const { drive, memory } = get();
    if (!drive || !drive.connected) return { ok: false, reason: 'not-connected' };
    const r = await api().gdriveMemoryPush(memory.notes || []);
    if (r && r.error) {
      get().setStatus(`Memory sync failed: ${r.error}`);
      return { ok: false, error: r.error };
    }
    set({ drive: { ...get().drive, memorySyncedAt: Date.now() } });
    return { ok: true };
  },

  /* ---------------------------- cloud (drive) ---------------------------- */

  openCloud() {
    get().navPush();
    set({ mainView: 'cloud' });
    get().loadDrive().catch(() => {});
  },

  async loadDrive() {
    try {
      const st = (await api().gdriveStatus()) || {};
      set({ drive: { ...get().drive, ...st, error: null } });
      // Memory is per user: switch namespace when the account changes.
      const key = st.connected && st.email ? st.email : 'local';
      if (key !== get().memory.account) await get().applyMemoryAccount();
    } catch (e) {
      set({ drive: { ...get().drive, error: String(e.message || e) } });
    }
  },

  async saveDriveClient(patch) {
    const st = await api().gdriveSave(patch || {});
    set({ drive: { ...get().drive, ...st } });
    return st;
  },

  async driveSignIn() {
    get().setStatus('Browser me Google sign-in complete karo…');
    try {
      const r = await api().gdriveLogin();
      if (!r || !r.ok) {
        get().setStatus(`Cloud sign-in failed: ${(r && r.error) || 'unknown error'}`);
        return { ok: false, error: (r && r.error) || 'unknown error' };
      }
      set({ drive: { ...get().drive, ...r.status } });
      get().setStatus(`Cloud connected${r.status.email ? `: ${r.status.email}` : ''}.`);
      // Switch to this user's memory namespace, then pull it down.
      await get().applyMemoryAccount();
      await get().pullMemoryFromCloud().catch(() => {});
      await get().loadDriveFiles();
      return { ok: true };
    } catch (e) {
      get().setStatus(`Cloud sign-in failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  },

  async driveSignOut() {
    const r = await api().gdriveLogout();
    set({ drive: { ...get().drive, ...r.status, files: [] } });
    // Back to the local namespace so this user's memory is not left showing.
    await get().applyMemoryAccount();
    get().setStatus('Cloud disconnected.');
  },

  async loadDriveFiles(query) {
    const q = query !== undefined ? query : get().drive.query;
    set({ drive: { ...get().drive, loading: true, query: q, error: null } });
    try {
      const r = (await api().gdriveList(q)) || {};
      set({ drive: { ...get().drive, loading: false, files: r.files || [], error: r.error || null } });
    } catch (e) {
      set({ drive: { ...get().drive, loading: false, error: String(e.message || e) } });
    }
  },

  /** Read a cloud file into an editor tab (text) — no local copy needed. */
  async openCloudFile(file) {
    if (!file || !file.id) return;
    try {
      const r = await api().gdriveRead(file.id);
      if (!r || r.error) {
        get().setStatus(`Cloud read failed: ${(r && r.error) || 'unknown'}`);
        return;
      }
      if (r.binary) {
        get().setStatus(`"${file.name}" is a binary file — use Download instead.`);
        return;
      }
      const name = file.name || r.name || 'cloud-file';
      const path = `cloud://${file.id}`;
      const existing = get().tabs.find((t) => t.path === path);
      if (existing) {
        set({ activePath: path, mainView: 'editor' });
        return;
      }
      const text = r.text || '';
      const tab = {
        path,
        name,
        language: langFromPath(name),
        content: text,
        savedContent: text,
        dirty: false,
        truncated: false,
        untitled: true,
        cloud: true,
      };
      set({ tabs: [...get().tabs, tab], activePath: path, mainView: 'editor', status: `Opened cloud file ${name}` });
    } catch (e) {
      get().setStatus(`Cloud read failed: ${e.message}`);
    }
  },

  /** Download a cloud file into <workspace>/.nova-cloud and open it. */
  async downloadCloudFile(file) {
    const { rootFolder } = get();
    if (!rootFolder) {
      get().setStatus('Open a folder first, then download from the cloud.');
      return;
    }
    const dest = `${rootFolder.replace(/\/+$/, '')}/.nova-cloud/${file.name || 'cloud-file'}`;
    try {
      const r = await api().gdriveDownload({ id: file.id, dest });
      if (r && r.ok) {
        get().setStatus(`Downloaded to ${r.path}`);
        await get().openFile(r.path);
      } else {
        get().setStatus(`Download failed: ${(r && r.error) || 'unknown'}`);
      }
    } catch (e) {
      get().setStatus(`Download failed: ${e.message}`);
    }
  },

  setGitMessage: (v) => set({ gitMessage: v }),

  async loadGit() {
    const { rootFolder } = get();
    if (!rootFolder) {
      set({ git: { ...get().git, repo: false, files: [], loading: false, error: null } });
      return;
    }
    set({ git: { ...get().git, loading: true, error: null } });
    try {
      const st = (await api().gitStatus(rootFolder)) || {};
      set({ git: { ...st, loading: false, error: st.error || null } });
      if (st.repo && st.branch) set({ gitBranch: st.branch });
    } catch (e) {
      set({ git: { ...get().git, loading: false, error: String(e.message || e) } });
    }
  },

  async gitStage(paths) {
    const { rootFolder } = get();
    if (!rootFolder) return;
    await api().gitStage({ cwd: rootFolder, paths: Array.isArray(paths) ? paths : [paths] });
    await get().loadGit();
  },

  async gitUnstage(paths) {
    const { rootFolder } = get();
    if (!rootFolder) return;
    await api().gitUnstage({ cwd: rootFolder, paths: Array.isArray(paths) ? paths : [paths] });
    await get().loadGit();
  },

  async gitCommit() {
    const { rootFolder, gitMessage } = get();
    if (!rootFolder) return;
    const msg = String(gitMessage || '').trim();
    if (!msg) {
      get().setStatus('Write a commit message first.');
      return;
    }
    set({ gitBusy: true });
    try {
      const r = await api().gitCommit({ cwd: rootFolder, message: msg });
      if (r && r.ok) {
        set({ gitMessage: '' });
        get().setStatus('Committed.');
      } else {
        get().setStatus(`Commit failed: ${(r && r.error) || 'unknown error'}`);
      }
    } finally {
      set({ gitBusy: false });
      await get().loadGit();
    }
  },

  async gitSwitchBranch(branch) {
    const { rootFolder } = get();
    if (!rootFolder || !branch) return;
    set({ gitBusy: true });
    try {
      const r = await api().gitCheckout({ cwd: rootFolder, branch });
      get().setStatus(r && r.ok ? `Switched to ${branch}` : `Checkout failed: ${(r && r.error) || 'unknown'}`);
    } finally {
      set({ gitBusy: false });
      await get().loadGit();
    }
  },

  async gitPush() {
    const { rootFolder } = get();
    if (!rootFolder) return;
    set({ gitBusy: true });
    try {
      const r = await api().gitPush(rootFolder);
      get().setStatus(r && r.ok ? 'Pushed.' : `Push failed: ${(r && r.error) || 'unknown'}`);
    } finally {
      set({ gitBusy: false });
      await get().loadGit();
    }
  },

  setRunOn(target) {
    set({ runOn: target === 'cloud' ? 'cloud' : 'local' });
    get().saveSettings();
  },

  /** Create a git worktree (fresh branch in a sibling folder) and open it. */
  async newWorktree(name) {
    const { rootFolder } = get();
    if (!rootFolder) {
      get().setStatus('Open a folder first.');
      return;
    }
    const safe =
      String(name || 'worktree')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'worktree';
    const target = `${rootFolder.replace(/\/+$/, '')}-${safe}`;
    const r = await api().gitWorktreeAdd({ cwd: rootFolder, path: target, branch: safe });
    if (r && r.ok) {
      get().setStatus(`Worktree created: ${target}`);
      await get().openFolder(target);
    } else {
      get().setStatus(`Worktree failed: ${(r && r.error) || 'unknown error'}`);
    }
  },

  async gitPull() {
    const { rootFolder } = get();
    if (!rootFolder) return;
    set({ gitBusy: true });
    try {
      const r = await api().gitPull(rootFolder);
      get().setStatus(r && r.ok ? 'Pulled.' : `Pull failed: ${(r && r.error) || 'unknown'}`);
    } finally {
      set({ gitBusy: false });
      await get().loadGit();
    }
  },

  navBack() {
    const s = get();
    const prev = s.navHistory[s.navHistory.length - 1];
    if (!prev) return;
    s._applyNav(prev, {
      navHistory: s.navHistory.slice(0, -1),
      navFwd: [{ view: s.mainView, chatId: s.currentChatId }, ...s.navFwd].slice(0, 30),
    });
  },

  navForward() {
    const s = get();
    const next = s.navFwd[0];
    if (!next) return;
    s._applyNav(next, {
      navFwd: s.navFwd.slice(1),
      navHistory: [...s.navHistory.slice(-30), { view: s.mainView, chatId: s.currentChatId }],
    });
  },

  _applyNav(entry, patch) {
    set({ ...patch, mainView: entry.view });
    if (entry.view === 'agent') {
      const s = get();
      if (entry.chatId !== s.currentChatId) {
        if (entry.chatId) s._applyChat(entry.chatId);
        else set({ currentChatId: null, agentItems: [], agentTodos: [], agentBusy: false, queued: [] });
      }
    }
  },

  openFolderDialogForRepo() {
    get().openFolder();
  },

  focusComposer() {
    get().navPush();
    set({ composerFocusSeq: get().composerFocusSeq + 1, mainView: 'agent' });
  },

  setSidebarVisible: (v) => set({ sidebarVisible: v }),

  /* ------------------------------- settings ------------------------------- */

  async loadSettings() {
    let s = {};
    try {
      s = (await api().getSettings()) || {};
    } catch {
      s = {};
    }
    const existing = Array.isArray(s.models) ? s.models : [];
    const googleKey = existing.find((m) => m.baseUrl?.includes('googleapis.com') && m.apiKey)?.apiKey || '';
    const openrouterKey = existing.find((m) => m.baseUrl?.includes('openrouter.ai') && m.apiKey)?.apiKey || '';
    const openaiKey = existing.find((m) => m.baseUrl?.includes('openai.com') && m.apiKey)?.apiKey || '';
    const deepseekKey = existing.find((m) => m.baseUrl?.includes('deepseek.com') && m.apiKey)?.apiKey || '';
    const groqKey = existing.find((m) => m.baseUrl?.includes('groq.com') && m.apiKey)?.apiKey || '';

    const keyVault = { ...(s.keyVault || {}) };
    const hostOf = (url) => {
      try {
        return new URL(url).host;
      } catch {
        return '';
      }
    };

    const models = DEFAULT_INTEGRATED_MODELS.map((dm) => {
      const found = existing.find((m) => m.id === dm.id || (m.model === dm.model && m.baseUrl === dm.baseUrl));
      if (found) {
        // label migration: stale default labels (e.g. "OpenCode Zen (paid key)")
        // get refreshed to the current default wording
        const STALE_LABELS = { 'opencode-zen': ['OpenCode Zen (paid key)'] };
        const stale = (STALE_LABELS[dm.id] || []).includes(found.label);
        // Recover a key parked in keyVault under this host — otherwise a saved
        // entry with an empty apiKey silently sends unauthenticated requests
        // ("errors out before replying").
        const vaulted = dm.baseUrl ? keyVault[hostOf(dm.baseUrl)] : '';
        const apiKey = found.apiKey || vaulted || dm.apiKey || '';
        return { ...dm, ...found, apiKey, label: stale ? dm.label : (found.label || dm.label), tag: dm.tag };
      }
      let k = dm.apiKey;
      if (dm.baseUrl && keyVault[hostOf(dm.baseUrl)]) k = keyVault[hostOf(dm.baseUrl)];
      if (dm.baseUrl?.includes('googleapis.com')) k = googleKey || k;
      if (dm.baseUrl?.includes('openrouter.ai')) k = openrouterKey || k;
      if (dm.baseUrl?.includes('openai.com')) k = openaiKey || k;
      if (dm.baseUrl?.includes('deepseek.com')) k = deepseekKey || k;
      if (dm.baseUrl?.includes('groq.com')) k = groqKey || k;
      return { ...dm, apiKey: k };
    });

    for (const em of existing) {
      if (!models.some((m) => m.id === em.id || (m.model === em.model && m.baseUrl === em.baseUrl))) {
        models.push(em);
      }
    }

    const filtered = models;

    const activeModelId = s.activeModelId && filtered.some((m) => m.id === s.activeModelId)
      ? s.activeModelId
      : (filtered.find((m) => m.apiKey && m.auth !== 'gemini-web')?.id ?? filtered[0]?.id ?? null);

    set({
      keyVault,
      models: filtered,
      activeModelId,
      agentSettings: { ...DEFAULT_AGENT_SETTINGS, ...(s.agentSettings || {}) },
      browserSettings: { headless: true, ...(s.browserSettings || {}) },
      voiceSettings: { provider: 'auto', baseUrl: '', apiKey: '', model: '', ...(s.voiceSettings || {}) },
      theme: ['light', 'dark', 'anime'].includes(s.theme) ? s.theme : 'anime',
      runOn: s.runOn === 'cloud' ? 'cloud' : 'local',
      chats: Array.isArray(s.chats) ? s.chats.slice(0, MAX_CHATS) : [],
      automations: (Array.isArray(s.automations) ? s.automations : []).slice(0, 50).map((a) => ({
        ...a,
        trigger: normalizeTrigger(a.trigger),
        enabled: a.enabled !== false,
        webhookToken: a.webhookToken || uuid().replace(/-/g, '').slice(0, 16),
      })),
      usedAgent: !!s.usedAgent,
    });
    api()
      .appInfo()
      .then((info) => set({ appInfo: info }))
      .catch(() => {});
    get().loadSkills().catch(() => {});
    get().loadMcpStatus().catch(() => {});
    if (s.lastFolder) {
      await get().openFolder(s.lastFolder, { silent: true });
    }
  },

  async saveSettings() {
    const { models, activeModelId, rootFolder, agentSettings, browserSettings, voiceSettings, theme, chats, automations, usedAgent, keyVault, runOn } =
      get();
    try {
      await api().setSettings({
        models,
        activeModelId,
        lastFolder: rootFolder,
        agentSettings,
        browserSettings,
        voiceSettings,
        theme,
        usedAgent,
        keyVault,
        runOn,
        automations: (automations || []).slice(0, 50),
        chats: (chats || []).slice(0, MAX_CHATS),
      });
    } catch (e) {
      get().setStatus(`Settings save failed: ${e.message}`);
    }
  },

  /**
   * After a Google sign-in (Gemini Web), make Gemini models available without
   * any manual setup: add a gemini-web model if none exists, and make it active.
   */
  ensureGeminiWebModel() {
    const models = get().models || [];
    const existing = models.find((m) => m.auth === 'gemini-web');
    if (existing) {
      if (get().activeModelId !== existing.id) get().setModels(models, existing.id);
      get().saveSettings();
      get().setStatus('Google account connected — Gemini (free) is active.');
      return existing.id;
    }
    const id = crypto.randomUUID();
    const entry = {
      id,
      label: 'Gemini (Google account)',
      baseUrl: '',
      model: 'gemini-web',
      apiKey: '',
      auth: 'gemini-web',
      tag: 'FREE',
      category: 'Google Gemini',
    };
    get().setModels([...models, entry], id);
    get().saveSettings();
    get().setStatus('Google account connected — Gemini (free) added and active.');
    return id;
  },

  setModels: (models, activeModelId) =>
    set((s) => ({
      models,
      activeModelId: activeModelId !== undefined ? activeModelId : s.activeModelId,
    })),

  /* ------------------------------- workspace ------------------------------- */

  async openFolder(folderArg, opts = {}) {
    let folder = folderArg;
    if (!folder) {
      try {
        folder = await api().openFolder();
      } catch (e) {
        get().setStatus(`Open folder failed: ${e.message}`);
        return;
      }
    }
    if (!folder) return;

    let entries;
    try {
      entries = await api().listDir(folder);
    } catch (e) {
      get().setStatus(`Open folder failed: ${e.message}`);
      return;
    }

    let gitBranch = null;
    try {
      const head = await api().readFile(folder.replace(/\/$/, '') + '/.git/HEAD');
      const m = /ref:\s*refs\/heads\/(.+)/.exec(head.content || '');
      if (m) gitBranch = m[1].trim();
    } catch {}

    set({
      rootFolder: folder,
      gitBranch,
      childrenByDir: { [folder]: entries },
      expanded: { [folder]: true },
      tabs: [],
      activePath: null,
      mainView: 'agent',
      workspaceFiles: [],
      status: `Opened ${folder}`,
    });
    if (!opts.silent) get().saveSettings();
    get().loadWorkspaceFiles().catch(() => {});
    // Fetch git info (incl. the origin remote) so the repo chip can show the GitHub repo.
    get().loadGit().catch(() => {});
  },

  async toggleDir(dirPath) {
    const { expanded, childrenByDir } = get();
    if (expanded[dirPath]) {
      set({ expanded: { ...expanded, [dirPath]: false } });
      return;
    }
    if (!childrenByDir[dirPath]) {
      try {
        const entries = await api().listDir(dirPath);
        set({ childrenByDir: { ...get().childrenByDir, [dirPath]: entries } });
      } catch (e) {
        get().setStatus(`List failed: ${e.message}`);
        return;
      }
    }
    set({ expanded: { ...get().expanded, [dirPath]: true } });
  },

  async openFile(filePath, line) {
    const { tabs } = get();
    if (tabs.some((t) => t.path === filePath)) {
      set({ activePath: filePath });
      get().setMainView('editor');
      if (line) set({ pendingReveal: { path: filePath, line } });
      return;
    }
    let r;
    try {
      r = await api().readFile(filePath);
    } catch (e) {
      get().setStatus(`Read failed: ${e.message}`);
      return;
    }
    if (r.binary) {
      get().setStatus(`Binary file, not opened: ${filePath}`);
      return;
    }
    get().setMainView('editor');
    const name = filePath.split('/').pop();
    const tab = {
      path: filePath,
      name,
      language: langFromPath(filePath),
      content: r.content,
      savedContent: r.content,
      dirty: false,
      truncated: !!r.truncated,
      untitled: false,
    };
    set({
      tabs: [...get().tabs, tab],
      activePath: filePath,
      mainView: 'editor',
      pendingReveal: line ? { path: filePath, line } : get().pendingReveal,
      status: r.truncated ? `${name} is too large to edit fully (read-only preview)` : '',
    });
  },

  updateActiveContent(content) {
    const { tabs, activePath } = get();
    set({
      tabs: tabs.map((t) =>
        t.path === activePath ? { ...t, content, dirty: content !== t.savedContent } : t
      ),
    });
  },

  closeTab(path) {
    const { tabs, activePath } = get();
    const idx = tabs.findIndex((t) => t.path === path);
    const remaining = tabs.filter((t) => t.path !== path);
    let nextActive = activePath;
    if (activePath === path) {
      nextActive = remaining[Math.min(idx, remaining.length - 1)]?.path ?? null;
    }
    const patch = { tabs: remaining, activePath: nextActive };
    if (!remaining.length) patch.mainView = 'agent';
    set(patch);
  },

  newFile() {
    const n = (get().untitledSeq || 0) + 1;
    const path = `untitled://${n}`;
    const tab = {
      path,
      name: `Untitled-${n}`,
      language: 'plaintext',
      content: '',
      savedContent: '',
      dirty: true,
      truncated: false,
      untitled: true,
    };
    set({ untitledSeq: n, tabs: [...get().tabs, tab], activePath: path, mainView: 'editor' });
  },

  async saveActive() {
    const { tabs, activePath } = get();
    const tab = tabs.find((t) => t.path === activePath);
    if (!tab) return;
    if (tab.truncated) {
      get().setStatus('File too large to save from Nova (opened truncated).');
      return;
    }

    let target = tab.path;
    if (tab.untitled) {
      try {
        const chosen = await api().saveFileDialog(tab.name);
        if (!chosen) return;
        target = chosen;
      } catch (e) {
        get().setStatus(`Save failed: ${e.message}`);
        return;
      }
    }

    try {
      await api().writeFile(target, tab.content);
    } catch (e) {
      get().setStatus(`Save failed: ${e.message}`);
      return;
    }

    const name = target.split('/').pop();
    set({
      tabs: get().tabs.map((t) =>
        t.path === tab.path
          ? {
              ...t,
              path: target,
              name,
              language: langFromPath(target),
              savedContent: t.content,
              dirty: false,
              untitled: false,
            }
          : t
      ),
      activePath: target,
      status: `Saved ${name}`,
    });
  },

  onFsChanged(path) {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab || tab.dirty) return;
    api()
      .readFile(path)
      .then((r) => {
        if (r.binary || r.truncated) return;
        set({
          tabs: get().tabs.map((t) =>
            t.path === path ? { ...t, content: r.content, savedContent: r.content } : t
          ),
        });
      })
      .catch(() => {});
  },

  /* --------------------------------- search --------------------------------- */

  setSearchQuery: (q) => set({ searchQuery: q }),

  async runSearch() {
    const { searchQuery, rootFolder } = get();
    const q = searchQuery.trim();
    if (!q) return;
    set({ searchRunning: true, searchResults: null });
    try {
      const r = await api().search({ pattern: q, dir: rootFolder || undefined, maxResults: 200 });
      set({ searchResults: r, searchRunning: false });
    } catch (e) {
      set({ searchResults: { error: String(e.message || e) }, searchRunning: false });
    }
  },

  async openSearchResult(path, line) {
    await get().openFile(path, line);
  },

  /* ------------------------------- ask chat ------------------------------- */

  newAskChat: () => set({ messages: [] }),

  /* ------------------------------- agent + chats ------------------------------- */

  newAgentChat() {
    const s = get();
    const atHome = s.mainView === 'agent' && !s.currentChatId && s.agentItems.length === 0;
    if (s.agentItems.length) s.updateCurrentChatEntry();
    api().agentNew(s.agentId).catch(() => {});
    if (!atHome) s.navPush();
    set({
      agentId: uuid(),
      agentItems: [],
      agentTodos: [],
      agentBusy: false,
      agentStep: 0,
      currentChatId: null,
      queued: [],
      attachedFiles: [],
      mainView: 'agent',
    });
    get().saveSettings();
  },

  _applyChat(chatId) {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return;
    set({
      currentChatId: chat.id,
      agentId: chat.agentId || uuid(),
      agentItems: (chat.items || []).map((it, i) => ({ ...it, id: it.id || `${chat.id}_${i}` })),
      agentTodos: [],
      agentBusy: false,
      agentStep: 0,
      queued: [],
    });
  },

  loadChat(chatId) {
    const s = get();
    if (s.currentChatId === chatId && s.mainView === 'agent') return;
    s.navPush();
    set({ mainView: 'agent' });
    s._applyChat(chatId);
  },

  pinChat(chatId, pinned) {
    const on = pinned !== false;
    set({
      chats: get().chats.map((c) =>
        c.id === chatId ? { ...c, pinned: on, pinnedAt: on ? Date.now() : null } : c,
      ),
    });
    get().saveSettings();
  },

  renameChat(chatId, title) {
    const t = String(title || '').trim();
    if (!t) return;
    set({ chats: get().chats.map((c) => (c.id === chatId ? { ...c, title: t.slice(0, 120) } : c)) });
    get().saveSettings();
  },

  removeChat(chatId) {
    const s = get();
    set({
      chats: s.chats.filter((c) => c.id !== chatId),
      currentChatId: s.currentChatId === chatId ? null : s.currentChatId,
    });
    s.saveSettings();
  },

  updateCurrentChatEntry() {
    const { chats, currentChatId, agentItems } = get();
    if (!currentChatId) return;
    const items = sanitizeItems(agentItems);
    const firstUser = agentItems.find((it) => it.kind === 'user');
    set({
      chats: chats.map((c) =>
        c.id === currentChatId
          ? {
              ...c,
              title: c.title || (firstUser ? String(firstUser.text).slice(0, 70) : 'New chat'),
              updatedAt: Date.now(),
              items,
            }
          : c
      ),
    });
  },

  agentAppend(item) {
    set({ agentItems: [...get().agentItems, { ...item, id: item.callId || item.id || uuid() }] });
  },

  agentPatchItem(id, patch) {
    set({
      agentItems: get().agentItems.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    });
  },

  agentPatchLast(pred, patch) {
    const items = [...get().agentItems];
    for (let i = items.length - 1; i >= 0; i--) {
      if (pred(items[i])) {
        items[i] = { ...items[i], ...patch };
        break;
      }
    }
    set({ agentItems: items });
  },

  agentHandleEvent(e) {
    const s = get();
    const pumpQueue = () => {
      const cur = get();
      if (!cur.queued.length) return;
      const [next, ...rest] = cur.queued;
      set({ queued: rest });
      cur._dispatch(next.text, next.extraContext);
    };
    switch (e.type) {
      case 'mode':
        set({ activeTurnMode: e.mode });
        break;
      case 'turn_start':
        set({ agentBusy: true, agentStep: 0 });
        break;
      case 'step':
        set({ agentStep: e.step });
        break;
      case 'assistant_delta': {
        const turnMode = get().activeTurnMode || null;
        if (
          s.agentItems.length &&
          s.agentItems[s.agentItems.length - 1].kind === 'assistant' &&
          s.agentItems[s.agentItems.length - 1].streaming
        ) {
          s.agentPatchLast((it) => it.kind === 'assistant' && it.streaming, {
            text: s.agentItems[s.agentItems.length - 1].text + e.text,
            ...(turnMode ? { mode: turnMode } : {}),
          });
        } else {
          s.agentAppend({ kind: 'assistant', text: e.text, streaming: true, ...(turnMode ? { mode: turnMode } : {}) });
        }
        break;
      }
      case 'assistant_message': {
        const turnMode = get().activeTurnMode || null;
        s.agentPatchLast((it) => it.kind === 'assistant' && it.streaming, {
          text: e.text,
          streaming: false,
          ...(turnMode ? { mode: turnMode } : {}),
        });
        break;
      }
      case 'tool_start':
        s.agentAppend({
          kind: 'tool',
          callId: e.callId,
          name: e.name,
          args: e.args,
          category: e.category,
          reason: e.reason || null,
          status: e.requiresApproval ? 'awaiting' : 'running',
          output: null,
          image: null,
        });
        break;
      case 'approval_request':
        s.agentPatchItem(e.callId, { status: 'awaiting' });
        break;
      case 'approval_resolved':
        s.agentPatchItem(e.callId, { status: e.allowed ? 'running' : 'denied' });
        break;
      case 'tool_end':
        s.agentPatchItem(e.callId, {
          status: e.denied ? 'denied' : e.ok ? 'done' : 'error',
          output: e.output,
          image: e.image || null,
        });
        break;
      case 'todos':
        set({ agentTodos: Array.isArray(e.todos) ? e.todos : [] });
        break;
      case 'error':
        s.agentAppend({ kind: 'error', text: e.message });
        set({ agentBusy: false });
        finishAutomationRun('error', e.message);
        pumpQueue();
        break;
      case 'done':
        set({ agentBusy: false });
        s.agentPatchLast((it) => it.kind === 'assistant' && it.streaming, { streaming: false });
        s.updateCurrentChatEntry();
        s.saveSettings();
        finishAutomationRun('ok', null);
        pumpQueue();
        break;
      default:
        break;
    }
  },

  async agentSend(text, extraContext) {
    const s = get();
    const model = s.models.find((m) => m.id === s.activeModelId);
    if (!model) {
      s.setSettingsOpen(true, 'models');
      return;
    }
    if (s.agentBusy) {
      if (s.agentSettings.newMessages === 'interrupt') {
        s.agentStop();
      } else {
        // Queue (Cursor default): the message waits and is sent when the
        // current turn finishes.
        set({ queued: [...s.queued, { id: uuid(), text, extraContext }] });
        return;
      }
    }
    await get()._dispatch(text, extraContext);
  },

  async _dispatch(text, extraContext) {
    set({ activeTurnMode: null });
    const s = get();
    const model = s.models.find((m) => m.id === s.activeModelId);
    if (!model) {
      s.setSettingsOpen(true, 'models');
      return;
    }

    if (!s.currentChatId) {
      const id = uuid();
      set({
        currentChatId: id,
        chats: [
          {
            id,
            agentId: s.agentId,
            title: text.slice(0, 70),
            folder: s.rootFolder || null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            items: [],
          },
          ...s.chats,
        ].slice(0, MAX_CHATS),
      });
    }

    // If this chat came from history (session not alive in main), send the
    // visible transcript along; agent.js only uses it when its session is
    // empty. Computed from the pre-send items so the current message is not
    // duplicated (it travels as userText instead).
    // History computed before appending the current user message, so it doesn't
    // duplicate the last user turn in the seed context.
    const history = s.agentItems
      .filter((it) => it.kind === 'user' || (it.kind === 'assistant' && it.text))
      .slice(-30)
      .map((it) => ({
        role: it.kind === 'user' ? 'user' : 'assistant',
        content: String(it.text).slice(0, 3000),
      }));

    s.agentAppend({ kind: 'user', text });
    if (!s.usedAgent) set({ usedAgent: true });

    const tab = get().tabs.find((t) => t.path === get().activePath);
    const noteParts = [];
    if (extraContext) noteParts.push(extraContext);
    if (tab && !tab.truncated) noteParts.push(`User's active file: ${tab.path}`);
    const attached = get().attachedFiles;
    if (attached.length) noteParts.push(`Files the user attached: ${attached.slice(0, 20).join(', ')}`);
    const contextNote = noteParts.join('\n') || undefined;

    await api().agentStart({
      agentId: get().agentId,
      config: {
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        model: model.model,
        auth: model.auth,
      },
      workspaceRoot: get().rootFolder,
      userText: text,
      settings: { ...get().agentSettings, browserHeadless: get().browserSettings.headless },
      contextNote,
      history,
    });
  },

  agentStop() {
    api().agentStop(get().agentId).catch(() => {});
    set({ agentBusy: false, queued: [] });
  },

  agentApprove(callId, allow, always) {
    const s = get();
    const item = s.agentItems.find((it) => it.callId === callId);
    api().agentApprove(s.agentId, callId, allow).catch(() => {});
    if (allow && always && item) {
      const map = {
        edit: 'autoApproveEdit',
        terminal: 'autoApproveTerminal',
        browser: 'autoApproveBrowser',
        computer: 'autoApproveComputer',
        web: 'autoAcceptWebSearch',
        mcp: 'autoApproveMcp',
      };
      const key = map[item.category];
      if (key) {
        s.patchAgentSettings({ [key]: true });
        s.saveSettings();
      }
    }
  },

  /* ------------------------------- terminal ------------------------------- */

  async termRun(command) {
    const cmd = command.trim();
    if (!cmd) return;
    const { rootFolder } = get();
    set({
      termLines: [...get().termLines, { kind: 'cmd', text: `$ ${cmd}` }],
      termBusy: true,
      termId: null,
    });
    try {
      const r = await api().termRun({ command: cmd, cwd: rootFolder || undefined });
      set({ termId: r.termId });
    } catch (e) {
      set({
        termLines: [...get().termLines, { kind: 'err', text: String(e.message || e) }],
        termBusy: false,
      });
    }
  },

  termData(payload) {
    const lines = get().termLines;
    const last = lines[lines.length - 1];
    const text = payload.text;
    const kind = payload.stream === 'stderr' ? 'err' : 'out';
    // Build a new array and a new last object instead of mutating state in place.
    if (last && last.kind === kind && !last.closed) {
      set({ termLines: [...lines.slice(0, -1), { ...last, text: last.text + text }] });
    } else {
      set({ termLines: [...lines, { kind, text }] });
    }
  },

  termExit(payload) {
    set({
      termLines: [
        ...get().termLines,
        {
          kind: 'exit',
          text: `── exit ${payload.code}${payload.timedOut ? ' (timed out)' : ''}${payload.error ? ' — ' + payload.error : ''} ──`,
        },
      ],
      termBusy: false,
    });
  },

  clearTerminal: () => set({ termLines: [] }),
}));

// Record how an automation run ended (called from the agent 'done'/'error' handlers).
function finishAutomationRun(status, error) {
  if (!pendingAutomationId) return;
  const id = pendingAutomationId;
  pendingAutomationId = null;
  try {
    useStore.getState().updateAutomation(id, { lastStatus: status, lastError: error || null, lastRunAt: Date.now() });
  } catch {}
}

// Dev/debug + automation hook (used by scripts/test-flow.mjs / test-agent.mjs)
if (typeof window !== 'undefined') {
  window.__novaStore = useStore;
}
