import { create } from 'zustand';
import { langFromPath } from './languages';

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
  queued: [],
  currentChatId: null,
  chats: [],
  usedAgent: false,
  composerFocusSeq: 0,
  attachedFiles: [],
  automations: [],

  /* --------------------------------- layout --------------------------------- */
  theme: 'light',
  mainView: 'agent', // 'agent' | 'editor' | 'search' | 'automations' | 'customize'
  settingsOpen: false,
  settingsTab: 'models',
  status: '',
  appInfo: null,
  navHistory: [],
  navFwd: [],
  sidebarVisible: true,
  chatVisible: false,
  terminalOpen: false,

  /* --------------------------------- search --------------------------------- */
  searchQuery: '',
  searchResults: null,
  searchRunning: false,

  /* --------------------------------- settings --------------------------------- */
  agentSettings: { ...DEFAULT_AGENT_SETTINGS },
  browserSettings: { headless: true },

  /* --------------------------- customization / mcp --------------------------- */
  workspaceFiles: [],
  skills: null,
  mcpInfo: null,
  addons: null,
  google: null,

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
  patchBrowserSettings: (patch) => set({ browserSettings: { ...get().browserSettings, ...patch } }),

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

  addAutomation({ name, prompt }) {
    const p = String(prompt || '').trim();
    if (!p) return;
    const a = {
      id: uuid(),
      name: String(name || '').trim() || 'Automation',
      prompt: p,
      createdAt: Date.now(),
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

  async runAutomation(id) {
    const a = get().automations.find((x) => x.id === id);
    if (!a) return;
    get().newAgentChat();
    get().setStatus(`Running automation: ${a.name}`);
    await get().agentSend(a.prompt);
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

  async toggleAddon(id, enable) {
    try {
      const r = await api().addonsToggle(id, enable);
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

  /* ------------------------------ google sign-in (Vertex AI) ------------------------------ */

  async loadGoogle() {
    try {
      set({ google: await api().googleStatus() });
    } catch (e) {
      set({ google: { error: String(e.message || e) } });
    }
  },

  async saveGoogle(patch) {
    try {
      const st = await api().googleSave(patch);
      set({ google: st });
      get().setStatus('Google settings saved.');
      return st;
    } catch (e) {
      get().setStatus(`Save failed: ${e.message}`);
      return null;
    }
  },

  async googleSignIn() {
    get().setStatus('Browser me Google sign-in complete karo…');
    try {
      const r = await api().googleLogin();
      if (!r || !r.ok) {
        get().setStatus(`Google sign-in failed: ${(r && r.error) || 'unknown error'}`);
        return false;
      }
      set({ google: r.status });
      get().setStatus(`Google account connected${r.status.email ? `: ${r.status.email}` : ''}.`);
      return true;
    } catch (e) {
      get().setStatus(`Google sign-in failed: ${e.message}`);
      return false;
    }
  },

  async googleSignOut() {
    try {
      const r = await api().googleLogout();
      set({ google: r.status });
      get().setStatus('Google account disconnected.');
    } catch (e) {
      get().setStatus(`Sign-out failed: ${e.message}`);
    }
  },

  addVertexModel() {
    const g = get().google;
    if (!g || !g.connected || !g.projectId) {
      get().setStatus('Pehle Google account connect karo aur Project ID save karo.');
      return;
    }
    const loc = g.location || 'us-central1';
    const baseUrl = `https://${loc}-aiplatform.googleapis.com/v1/projects/${g.projectId}/locations/${loc}/endpoints/openapi`;
    const models = get().models || [];
    const existing = models.find((m) => m.auth === 'google');
    const id = existing ? existing.id : crypto.randomUUID();
    const entry = {
      id,
      label: 'Gemini 4 (Vertex)',
      baseUrl,
      model: 'google/gemini-4-argon',
      apiKey: '',
      auth: 'google',
    };
    const next = existing ? models.map((m) => (m.auth === 'google' ? { ...m, baseUrl, model: entry.model } : m)) : [...models, entry];
    get().setModels(next, id);
    get().saveSettings();
    get().setStatus('Gemini 4 (Vertex, Google account) add ho gaya aur active bhi — chat try karo!');
  },

  /* ------------------------------- checkpoints ------------------------------- */

  async restoreCheckpoint() {
    try {
      const r = await api().restoreCheckpoint(get().agentId);
      if (!r.restored || !r.restored.length) {
        get().setStatus('Nothing to restore — no agent edits recorded for this chat.');
      } else {
        get().setStatus(
          `Restored ${r.restored.length} file${r.restored.length > 1 ? 's' : ''} from before the agent\u2019s edits.`
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
      theme: s.theme === 'dark' ? 'dark' : 'light',
      chats: Array.isArray(s.chats) ? s.chats.slice(0, MAX_CHATS) : [],
      automations: Array.isArray(s.automations) ? s.automations.slice(0, 50) : [],
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
    const { models, activeModelId, rootFolder, agentSettings, browserSettings, theme, chats, automations, usedAgent, keyVault } =
      get();
    try {
      await api().setSettings({
        models,
        activeModelId,
        lastFolder: rootFolder,
        agentSettings,
        browserSettings,
        theme,
        usedAgent,
        keyVault,
        automations: (automations || []).slice(0, 50),
        chats: (chats || []).slice(0, MAX_CHATS),
      });
    } catch (e) {
      get().setStatus(`Settings save failed: ${e.message}`);
    }
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
      case 'turn_start':
        set({ agentBusy: true, agentStep: 0 });
        break;
      case 'step':
        set({ agentStep: e.step });
        break;
      case 'assistant_delta':
        if (
          s.agentItems.length &&
          s.agentItems[s.agentItems.length - 1].kind === 'assistant' &&
          s.agentItems[s.agentItems.length - 1].streaming
        ) {
          s.agentPatchLast((it) => it.kind === 'assistant' && it.streaming, {
            text: s.agentItems[s.agentItems.length - 1].text + e.text,
          });
        } else {
          s.agentAppend({ kind: 'assistant', text: e.text, streaming: true });
        }
        break;
      case 'assistant_message':
        s.agentPatchLast((it) => it.kind === 'assistant' && it.streaming, {
          text: e.text,
          streaming: false,
        });
        break;
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
        pumpQueue();
        break;
      case 'done':
        set({ agentBusy: false });
        s.agentPatchLast((it) => it.kind === 'assistant' && it.streaming, { streaming: false });
        s.updateCurrentChatEntry();
        s.saveSettings();
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

// Dev/debug + automation hook (used by scripts/test-flow.mjs / test-agent.mjs)
if (typeof window !== 'undefined') {
  window.__novaStore = useStore;
}
