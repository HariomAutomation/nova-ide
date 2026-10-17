import { useEffect, useState } from 'react';
import { useStore } from '../store';

/* --------------------------------- shared UI --------------------------------- */

function Switch({ on, onChange, title }) {
  return (
    <button
      type="button"
      className={'switch' + (on ? ' on' : '')}
      role="switch"
      aria-checked={!!on}
      title={title}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}

function Row({ label, desc, control }) {
  return (
    <div className="srow">
      <div className="srow-text">
        <div className="srow-label">{label}</div>
        {desc && <div className="srow-desc">{desc}</div>}
      </div>
      <div className="srow-control">{control}</div>
    </div>
  );
}

function Group({ title, children }) {
  // Cursor allows a card with no section label (e.g. the first group); only
  // render the label when there is one.
  return (
    <div className="sgroup">
      {title ? <div className="sgroup-title">{title}</div> : null}
      <div className="sgroup-body">{children}</div>
    </div>
  );
}

/* ---------------------------------- tabs ---------------------------------- */

function GeneralTab() {
  const theme = useStore((s) => s.theme);
  return (
    <div className="settings-body">
      <Group title="Appearance">
        <Row
          label="Theme"
          desc="Light matches Cursor's default; dark is easier at night."
          control={
            <Select
              value={theme}
              onChange={(v) => useStore.getState().setTheme(v)}
              options={[
                { v: 'light', l: 'Light' },
                { v: 'dark', l: 'Dark' },
              ]}
            />
          }
        />
      </Group>
      <Group title="Workspace">
        <Row
          label="Open a folder"
          desc="The agent works inside this folder."
          control={
            <button className="btn small" onClick={() => useStore.getState().openFolder()}>
              Open Folder…
            </button>
          }
        />
        <Row
          label="Terminal"
          desc="Run commands and watch output."
          control={
            <button className="btn small" onClick={() => useStore.getState().setTerminalOpen(true)}>
              Open Terminal
            </button>
          }
        />
      </Group>
    </div>
  );
}

const PRESETS = [
  {
    id: 'gemini',
    label: 'Gemini 4',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-4-argon',
    hint: 'Google Gemini 4 (Argon) via your AI Studio key. Argon paid-tier only hai. Free tier ke liye preset: Gemini 3.7 Flash (niche) — quota per-model hota hai, ek khatam ho to doosra chalta hai. Model field me "Fetch" dabao to live list aayegi.',
  },
  {
    id: 'gemini-flash-free',
    label: 'Gemini Flash (free)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.7-flash',
    hint: 'Free AI Studio key pe chalne wala fast Flash model — verified working. Quota khatam ho to gemini-3.1-flash-lite / gemini-3.5-flash try karo.',
  },
  {
    id: 'gemini-web',
    label: 'Gemini Web (subscription)',
    baseUrl: '',
    model: 'gemini-web',
    auth: 'gemini-web',
    hint: 'Jugaad provider: Nova ke 🌐 Gemini tab ka web app automate karta hai — aapka Google account / Pro subscription brain banta hai, aur agent Nova ke saare tools (files, terminal, browser, MCP) chala sakta hai. Pehle sidebar me Gemini kholke sign in karo. ⚠️ Web UI automation — Google ToS gray area, rate-limit/CAPTCHA possible.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-4-argon',
    hint: 'Gemini 4 Argon through OpenRouter — Fetch to browse every model (free ones too).',
  },
  {
    id: 'opencode',
    label: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'beam-free',
    hint: 'Apni opencode.ai console ki paid API key daalo → "Test connection" dabao → Zen ke andar ke saare models list hoke pills me dikh jayenge, ek click me pick karo. Zen ka free tier sirf OpenCode app ke andar chalta hai, isliye Nova me key zaroori hai.',
  },
  {
    id: 'omniroute',
    label: 'OmniRoute (self-host)',
    baseUrl: 'http://localhost:20128/v1',
    model: 'auto',
    hint: 'Your self-hosted OmniRoute gateway (port 20128). Model "auto" routes across all connected providers.',
  },
  {
    id: 'sarvam',
    label: 'Sarvam AI',
    baseUrl: 'https://api.sarvam.ai/v1',
    model: 'sarvam-105b',
    hint: 'Sarvam-105B for deep Indic-language reasoning — Bearer auth supported.',
  },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
];

function ModelsTab() {
  const models = useStore((s) => s.models);
  const activeModelId = useStore((s) => s.activeModelId);
  const [draft, setDraft] = useState(() => models.map((m) => ({ ...m })));
  const [active, setActive] = useState(activeModelId);
  const [custom, setCustom] = useState({ label: 'Custom', baseUrl: '', model: '', apiKey: '' });
  const [modelOpts, setModelOpts] = useState({}); // cardId -> [model ids] fetched from the endpoint
  const [tests, setTests] = useState({}); // cardId -> {state:'testing'|'ok'|'fail', msg, count}
  const [showList, setShowList] = useState({}); // cardId -> bool (show all fetched versions)

  function update(id, patch) {
    setDraft((d) => d.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }
  function remove(id) {
    setDraft((d) => d.filter((m) => m.id !== id));
    if (active === id) setActive(null);
  }
  function addPreset(preset) {
    const entry = {
      id: crypto.randomUUID(),
      label: preset.label,
      baseUrl: preset.baseUrl,
      model: preset.model,
      apiKey: '',
      ...(preset.auth ? { auth: preset.auth } : {}),
    };
    setDraft((d) => [...d, entry]);
    setActive((a) => a ?? entry.id);
  }
  function addCustom() {
    if (!custom.baseUrl.trim() || !custom.model.trim()) return;
    const entry = {
      id: crypto.randomUUID(),
      label: custom.label.trim() || 'Custom',
      baseUrl: custom.baseUrl.trim(),
      model: custom.model.trim(),
      apiKey: custom.apiKey || '',
    };
    setDraft((d) => [...d, entry]);
    setActive((a) => a ?? entry.id);
    setCustom({ label: 'Custom', baseUrl: '', model: '', apiKey: '' });
  }

  function modelInput(id, value, onChange, placeholder) {
    return (
      <div className="input-row">
        <input className="input" list={`modelopts-${id}`} value={value} onChange={onChange} placeholder={placeholder} />
        <datalist id={`modelopts-${id}`}>
          {(modelOpts[id] || []).map((mid) => (
            <option key={mid} value={mid} />
          ))}
        </datalist>
      </div>
    );
  }

  async function save() {
    const cleaned = draft.map((m) => ({
      id: m.id,
      label: m.label || m.model || 'Model',
      baseUrl: m.baseUrl.trim().replace(/\/+$/, ''),
      model: m.model.trim(),
      apiKey: m.apiKey || '',
      ...(m.auth ? { auth: m.auth } : {}),
    }));
    const activeId = active && cleaned.some((m) => m.id === active) ? active : cleaned[0]?.id ?? null;
    useStore.getState().setModels(cleaned, activeId);
    await useStore.getState().saveSettings();
  }

  return (
    <div className="settings-body">
      <p className="muted small">
        Any OpenAI-compatible provider works. Keys are stored locally in Nova's user data and are only sent to the
        provider you configure. Agent mode needs a model that supports tool calling (Gemini 3.x, DeepSeek, GPT-4o, Llama 3.x…).
      </p>

      <Group title="Google Gemini (free)">
        <Row
          label="Sign in with Google"
          desc="Use Gemini free with your own Google account — no API key, no Cloud project. Nova drives the Gemini web app with your signed-in session, and the agent keeps all of Nova's tools (files, terminal, browser)."
          control={
            <button
              className="btn primary"
              onClick={() => {
                useStore.getState().setMainView('gemini');
                useStore.getState().setSettingsOpen(false);
              }}
            >
              Open Gemini tab
            </button>
          }
        />
      </Group>

      <Group title="Add a model">
        <Row
          label="Label"
          desc="A short name shown in the model picker."
          control={
            <input
              className="input"
              style={{ width: 260 }}
              value={custom.label}
              onChange={(e) => setCustom({ ...custom, label: e.target.value })}
              placeholder="My model"
            />
          }
        />
        <Row
          label="Base URL"
          desc="Any OpenAI-compatible endpoint, e.g. https://api.deepseek.com/v1"
          control={
            <input
              className="input"
              style={{ width: 360 }}
              value={custom.baseUrl}
              onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          }
        />
        <Row
          label="Model"
          desc="Model id. Use Test to list what the endpoint offers."
          control={modelInput('custom', custom.model, (e) => setCustom({ ...custom, model: e.target.value }), 'model-id')}
        />
        <Row
          label="API key"
          desc="Stored locally, only ever sent to this provider."
          control={
            <input
              className="input"
              style={{ width: 300 }}
              type="password"
              value={custom.apiKey}
              onChange={(e) => setCustom({ ...custom, apiKey: e.target.value })}
              placeholder="sk-… (optional)"
            />
          }
        />
        <Row
          label=""
          desc=""
          control={
            <div className="input-row">
              <button className="btn primary small" disabled={!custom.baseUrl.trim() || !custom.model.trim()} onClick={addCustom}>
                Add model
              </button>
              <TestLine id="custom" />
            </div>
          }
        />
      </Group>

      <div className="quickadd-label">Or quick-add a provider</div>
      <div className="preset-row">
        {PRESETS.map((p) => (
          <button key={p.id} className="btn small" title={p.hint} onClick={() => addPreset(p)}>
            + {p.label}
          </button>
        ))}
      </div>

      {draft.length === 0 && <p className="muted">No models yet — add one above, or quick-add a provider.</p>}

      {draft.map((m) => (
        <div key={m.id} className={'model-card' + (active === m.id ? ' active' : '')}>
          <div className="model-card-head">
            <label className="radio">
              <input type="radio" name="activeModel" checked={active === m.id} onChange={() => setActive(m.id)} />
              active
            </label>
            <input className="input" value={m.label} onChange={(e) => update(m.id, { label: e.target.value })} placeholder="Label" />
            <button className="btn-icon" title="Remove" onClick={() => remove(m.id)}>
              &#128465;
            </button>
          </div>
          {m.auth === 'gemini-web' ? (
            <div className="model-grid">
              <div className="muted small" style={{ paddingTop: 2 }}>
                🌐 Built-in provider — Nova ka <b>Gemini</b> tab (koi URL/key nahi). Pehle sidebar me “Gemini” kholke apne
                Google account se sign in karo; chat + agent usi session se chalenge.
              </div>
              <div className="muted small" style={{ paddingTop: 2 }}>
                Model: <b>gemini-web</b> — web UI automation. Agent mode me tools JSON-protocol se chalte hain (files,
                terminal, browser, MCP sab available).
              </div>
            </div>
          ) : (
          <div className="model-grid">
            <label>
              Base URL
              <input className="input" value={m.baseUrl} onChange={(e) => update(m.id, { baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
            </label>
            <label>
              Model
              {modelInput(m.id, m.model, (e) => update(m.id, { model: e.target.value }), 'model-id')}
            </label>
            <label>
              API Key
              <input className="input" type="password" value={m.apiKey} onChange={(e) => update(m.id, { apiKey: e.target.value })} placeholder="sk-…" />
            </label>
          </div>
          )}
          <TestLine id={m.id} />
        </div>
      ))}

      <div className="modal-footer-inline">
        <button className="btn primary" onClick={save}>
          Save models
        </button>
      </div>
    </div>
  );
}

function AgentsTab() {
  const agentSettings = useStore((s) => s.agentSettings);
  const models = useStore((s) => s.models);
  const activeModelId = useStore((s) => s.activeModelId);

  const patch = (p) => {
    useStore.getState().patchAgentSettings(p);
    useStore.getState().saveSettings();
  };

  return (
    <div className="settings-body">
      <Group title="Conversation">
        <Row
          label="Submit with Ctrl + Enter"
          desc="When off, Enter sends and Shift+Enter adds a new line."
          control={<Switch on={agentSettings.submitWithCtrlEnter} onChange={(v) => patch({ submitWithCtrlEnter: v })} />}
        />
        <Row
          label="Default Model"
          desc="Used for new chats. Agents need tool calling."
          control={
            <Select
              value={activeModelId || '__default__'}
              onChange={(v) => {
                useStore.getState().setModels(models, v === '__default__' ? models[0]?.id ?? null : v);
                useStore.getState().saveSettings();
              }}
              options={[
                { v: '__default__', l: 'Nova Default' },
                ...models.map((m) => ({ v: m.id, l: m.label })),
              ]}
            />
          }
        />
        <Row
          label="New Messages"
          desc="What happens when you send while the agent is working."
          control={
            <Select
              value={agentSettings.newMessages}
              onChange={(v) => patch({ newMessages: v })}
              options={[
                { v: 'queue', l: 'Queue' },
                { v: 'interrupt', l: 'Interrupt' },
              ]}
            />
          }
        />
        <Row
          label="Manually Sent Messages from Queue"
          desc="What a queued message does when you send it by hand."
          control={
            <Select
              value={agentSettings.manualQueueBehavior}
              onChange={(v) => patch({ manualQueueBehavior: v })}
              options={[
                { v: 'interrupt', l: 'Interrupt' },
                { v: 'queue', l: 'Queue' },
              ]}
            />
          }
        />
        <Row
          label="Agent Autocomplete"
          desc="Inline completions while you type."
          control={
            <Switch
              on={agentSettings.agentAutocomplete}
              onChange={(v) => {
                patch({ agentAutocomplete: v });
                useStore.getState().setStatus(v ? 'Agent autocomplete enabled (Tab to accept)' : 'Agent autocomplete disabled');
              }}
            />
          }
        />
        <Row
          label="Auto-Approve Mode Transitions"
          desc="Let the agent switch between plan/debug modes on its own."
          control={
            <Switch
              on={agentSettings.approveModeTransitions}
              onChange={(v) => {
                patch({ approveModeTransitions: v });
                useStore.getState().setStatus('Plan/Debug modes are coming soon in Nova');
              }}
            />
          }
        />
      </Group>

      <Group title="Context and Tools">
        <Row
          label="Web Search Tool"
          desc="web_search — DuckDuckGo, no API key needed."
          control={<Switch on={agentSettings.webSearch} onChange={(v) => patch({ webSearch: v })} />}
        />
        <Row
          label="Auto-Accept Web Search"
          desc="Run web searches without asking."
          control={<Switch on={agentSettings.autoAcceptWebSearch} onChange={(v) => patch({ autoAcceptWebSearch: v })} />}
        />
        <Row
          label="Web Fetch Tool"
          desc="web_fetch — read docs and pages as text."
          control={<Switch on={agentSettings.webFetch} onChange={(v) => patch({ webFetch: v })} />}
        />
      </Group>

      <Group title="Execution and Approvals">
        <Row
          label="Run Mode"
          desc="Auto-Review approves file edits and the browser, and asks for terminal, desktop and MCP."
          control={
            <Select
              value={agentSettings.runMode}
              onChange={(v) => useStore.getState().applyRunMode(v)}
              options={[
                { v: 'auto-review', l: 'Auto-Review' },
                { v: 'allowlist', l: 'Allowlist (ask first)' },
                { v: 'full-auto', l: 'Full Auto' },
              ]}
            />
          }
        />
        <Row
          label="Read Access"
          desc="Workspace restricts reads to files inside the open folder."
          control={
            <Select
              value={agentSettings.readAccess}
              onChange={(v) => patch({ readAccess: v })}
              options={[
                { v: 'system', l: 'System' },
                { v: 'workspace', l: 'Workspace' },
              ]}
            />
          }
        />
        <Row
          label="File-Deletion Protection"
          desc="Always ask before delete_file, even when edits are auto-approved."
          control={<Switch on={agentSettings.fileDeletionProtection} onChange={(v) => patch({ fileDeletionProtection: v })} />}
        />
        <Row
          label="External-File Protection"
          desc="Ask before creating or modifying files outside the workspace."
          control={<Switch on={agentSettings.externalFileProtection} onChange={(v) => patch({ externalFileProtection: v })} />}
        />
        <details className="sdetails">
          <summary>Allowlist Options</summary>
          <Row
            label="Allow file edits"
            desc="write_file, edit_file"
            control={<Switch on={agentSettings.autoApproveEdit} onChange={(v) => patch({ autoApproveEdit: v })} />}
          />
          <Row
            label="Allow terminal commands"
            desc="run_terminal_cmd — use with care."
            control={<Switch on={agentSettings.autoApproveTerminal} onChange={(v) => patch({ autoApproveTerminal: v })} />}
          />
          <Row
            label="Allow browser actions"
            desc="Playwright Chromium: open/click/fill/screenshot."
            control={<Switch on={agentSettings.autoApproveBrowser} onChange={(v) => patch({ autoApproveBrowser: v })} />}
          />
          <Row
            label="Allow desktop control"
            desc="computer_use — needs xdotool/ydotool."
            control={<Switch on={agentSettings.autoApproveComputer} onChange={(v) => patch({ autoApproveComputer: v })} />}
          />
          <Row
            label="Allow MCP tools"
            desc="Tools from ~/.nova-ide/mcp.json servers."
            control={<Switch on={agentSettings.autoApproveMcp} onChange={(v) => patch({ autoApproveMcp: v })} />}
          />
        </details>
      </Group>

      <Group title="Advanced">
        <Row
          label="Max steps per turn"
          desc="How many tool-calling rounds the agent may take."
          control={
            <input
              className="input narrow"
              type="number"
              min={1}
              max={100}
              value={agentSettings.maxSteps}
              onChange={(e) => patch({ maxSteps: Math.max(1, Math.min(100, Number(e.target.value) || 25)) })}
            />
          }
        />
        <Row
          label="Extra agent instructions"
          desc="Always included in the system prompt."
          control={
            <textarea
              className="input"
              rows={3}
              style={{ width: 320 }}
              value={agentSettings.extraInstructions}
              onChange={(e) => useStore.getState().patchAgentSettings({ extraInstructions: e.target.value })}
              onBlur={() => useStore.getState().saveSettings()}
              placeholder="e.g. Always use 2-space indentation. Prefer pnpm."
            />
          }
        />
      </Group>
    </div>
  );
}

function BrowserTab() {
  const headless = useStore((s) => s.browserSettings.headless);
  const patch = useStore((s) => s.patchBrowserSettings);
  const [status, setStatus] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  async function refresh() {
    try {
      setStatus(await window.nova.browserStatus());
    } catch (e) {
      setStatus({ error: String(e.message || e) });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await window.nova.browserTest();
      setTest(r);
      refresh();
    } catch (e) {
      setTest({ ok: false, error: String(e.message || e) });
    }
    setTesting(false);
  }

  async function reset() {
    await window.nova.browserReset();
    refresh();
  }

  return (
    <div className="settings-body">
      <Group title="Browser">
        <Row
          label="Headless browser"
          desc="Turn off to watch the agent browse."
          control={
            <Switch
              on={headless}
              onChange={(v) => {
                patch({ headless: v });
                useStore.getState().saveSettings();
              }}
            />
          }
        />
        <Row
          label="Diagnostics"
          desc="Launch Playwright, load a test page and capture a screenshot."
          control={
            <div className="input-row">
              <button className="btn small" disabled={testing} onClick={runTest}>
                {testing ? 'Testing…' : 'Test browser'}
              </button>
              <button className="btn small" onClick={reset}>
                Reset
              </button>
            </div>
          }
        />
      </Group>

      {status && (
        <div className="status-box">
          {status.error ? (
            <span className="search-error">{status.error}</span>
          ) : (
            <>
              <div>
                Playwright: <b>{status.playwrightVersion || 'not installed'}</b>
              </div>
              <div>Launched: {String(status.launched)}</div>
              <div>Current URL: {status.url || '—'}</div>
            </>
          )}
        </div>
      )}

      {test && !test.ok && <p className="search-error">{test.error}</p>}
      {test && test.ok && (
        <div className="status-box">
          <div>
            Loaded: <b>{test.title}</b>
          </div>
          <img className="tool-image" src={test.image} alt="browser test" />
        </div>
      )}
    </div>
  );
}

function McpTab() {
  const mcpInfo = useStore((s) => s.mcpInfo);
  const agentSettings = useStore((s) => s.agentSettings);

  useEffect(() => {
    useStore.getState().loadMcpStatus();
  }, []);

  const servers = (mcpInfo && mcpInfo.servers) || [];

  return (
    <div className="settings-body">
      <p className="muted small">
        MCP (Model Context Protocol) connects external tool servers. Add them in{' '}
        <code>{mcpInfo?.configPath || '~/.nova-ide/mcp.json'}</code> — Cursor charges for this; Nova includes it free.
      </p>
      <Group title="Servers">
        {servers.length === 0 && (
          <div className="muted small" style={{ padding: '8px 0' }}>
            {mcpInfo && mcpInfo.hasConfig
              ? 'No servers configured yet.'
              : `No config file yet — create ${mcpInfo?.configPath || '~/.nova-ide/mcp.json'} with { "mcpServers": { … } }.`}
          </div>
        )}
        {servers.map((sv) => (
          <Row
            key={sv.name}
            label={
              <span>
                <span className={'cz-dot ' + (sv.state === 'running' ? 'ok' : sv.state === 'error' ? 'err' : '')} />{' '}
                {sv.name}
              </span>
            }
            desc={
              sv.error
                ? sv.error
                : sv.state === 'running'
                  ? `${sv.tools ? sv.tools.length : 0} tools: ${(sv.tools || [])
                      .map((t) => t.name)
                      .slice(0, 6)
                      .join(', ')}${sv.tools && sv.tools.length > 6 ? '…' : ''}`
                  : sv.state
            }
            control={
              <button className="btn small" onClick={() => useStore.getState().reloadMcp()}>
                Reload
              </button>
            }
          />
        ))}
      </Group>
      <Group title="Approvals">
        <Row
          label="Auto-approve MCP tools"
          desc="Skip the approval prompt for MCP tool calls."
          control={
            <Switch
              on={agentSettings.autoApproveMcp}
              onChange={(v) => {
                useStore.getState().patchAgentSettings({ autoApproveMcp: v });
                useStore.getState().saveSettings();
              }}
            />
          }
        />
      </Group>
    </div>
  );
}

function ComputerTab() {
  const [status, setStatus] = useState(null);
  const [shot, setShot] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.nova
      .computerStatus()
      .then(setStatus)
      .catch((e) => setStatus({ error: String(e.message || e) }));
  }, []);

  async function testShot() {
    setBusy(true);
    setShot(null);
    try {
      setShot(await window.nova.computerScreenshot());
    } catch (e) {
      setShot({ ok: false, error: String(e.message || e) });
    }
    setBusy(false);
  }

  return (
    <div className="settings-body">
      <p className="muted small">
        Desktop control (computer_use) screenshots your screen and injects mouse/keyboard input. On Wayland sessions,
        input needs <b>ydotool</b> (with the ydotoold daemon) or <b>xdotool</b> for X11 apps.
      </p>

      {status && (
        <div className="status-box">
          {status.error ? (
            <span className="search-error">{status.error}</span>
          ) : (
            <>
              <div>
                Session: <b>{status.session}</b> {status.wayland ? `(${status.wayland})` : status.display ? `(${status.display})` : ''}
              </div>
              <div>
                Screenshot method: <b>{status.screenshotMethod || 'none found'}</b>
              </div>
              <div>
                Input method: <b>{status.inputMethod || 'none found'}</b>
              </div>
              {!status.inputMethod && (
                <div className="muted small">
                  Setup hint: <code>sudo apt install ydotool</code> then enable the ydotool user service, or{' '}
                  <code>sudo apt install xdotool</code> on X11.
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="preset-row">
        <button className="btn" disabled={busy} onClick={testShot}>
          {busy ? 'Capturing…' : 'Test screenshot'}
        </button>
      </div>

      {shot && !shot.ok && <p className="search-error">{shot.error}</p>}
      {shot && shot.ok && (
        <div className="status-box">
          <div>
            Method: <b>{shot.method}</b>
          </div>
          <img className="tool-image" src={shot.image} alt="desktop test" />
        </div>
      )}
    </div>
  );
}

function AboutTab() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    window.nova.appInfo().then(setInfo).catch(() => {});
  }, []);
  return (
    <div className="settings-body">
      <div className="status-box">
        <div>
          <b>Nova IDE</b> — a Cursor-like AI IDE with agent tools and your own models.
        </div>
        {info && (
          <>
            <div>Nova: {info.nova}</div>
            <div>Electron: {info.electron} · Chromium: {info.chrome} · Node: {info.node}</div>
            <div>OS: {info.os}</div>
          </>
        )}
        <div className="muted small">
          Agent tools: list_dir, read_file, write_file, edit_file, delete_file, grep_search, run_terminal_cmd,
          web_search, web_fetch, browser (Playwright), computer_use, plus MCP tools. Approvals in Settings → Agents.
        </div>
      </div>
    </div>
  );
}

function CloudTab() {
  const drive = useStore((s) => s.drive);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [url, setUrl] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const [adv, setAdv] = useState(false);

  useEffect(() => {
    useStore.getState().loadDrive();
  }, []);

  useEffect(() => {
    if (drive && !seeded) {
      setClientId(drive.clientId || '');
      setSeeded(true);
    }
  }, [drive, seeded]);

  async function save() {
    await useStore.getState().saveDriveClient({ clientId, clientSecret: clientSecret || undefined });
    setMsg({ type: 'ok', text: 'Saved.' });
  }

  async function signIn() {
    // A built-in client means no fields are needed; only ask when there is none.
    if (drive.hasClientId === false && !clientId.trim()) {
      setMsg({
        type: 'err',
        text: 'Sign-in ke liye Google client ID chahiye — neeche "Advanced" khol ke paste karo.',
      });
      return;
    }
    if (clientId.trim()) {
      await useStore.getState().saveDriveClient({ clientId, clientSecret: clientSecret || undefined });
    }
    setBusy(true);
    setMsg({ type: 'info', text: 'Browser me Google sign-in khulega… consent ke baad yahan status update hoga.' });
    try {
      const r = await window.nova.gdriveLogin();
      if (r && r.ok) {
        const st = r.status || {};
        setMsg({ type: 'ok', text: `Connected \u2713 ${st.name || st.email || ''}` });
      } else {
        const lu = await window.nova.gdriveLastUrl().catch(() => null);
        setUrl((lu && lu.url) || null);
        setMsg({ type: 'err', text: `Sign-in failed: ${(r && r.error) || 'unknown error'}` });
      }
    } catch (e) {
      setMsg({ type: 'err', text: `Sign-in failed: ${e.message}` });
    } finally {
      setBusy(false);
      await useStore.getState().loadDrive();
    }
  }

  return (
    <div className="settings-body">
      <p className="muted small">
        Sign in with Google once (read-only Drive access) and Nova can list and open your cloud files any time. Nova can
        read cloud files, never modify them.
      </p>

      <Group title="Google Drive">
        <Row
          label="Status"
          desc={
            drive.connected
              ? `Connected${drive.name ? ` as ${drive.name}` : ''}${drive.email ? ` \u00B7 ${drive.email}` : ''}`
              : 'Not connected'
          }
          control={
            drive.connected && drive.picture ? (
              <img className="avatar sm" src={drive.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className={'cz-dot ' + (drive.connected ? 'ok' : '')} />
            )
          }
        />
        <Row
          label="Sign in"
          desc={
            drive.connected
              ? 'Signed in. Nova can list and open your cloud files, and sync your memory — read-only.'
              : drive.builtin
                ? 'One click — no setup needed.'
                : 'Sign in with Google (read-only Drive). Nova can read cloud files, never change them.'
          }
          control={
            <div className="input-row">
              {drive.connected ? (
                <button className="btn small danger" onClick={() => useStore.getState().driveSignOut()}>
                  Sign out
                </button>
              ) : (
                <button className="btn primary" disabled={busy} onClick={signIn}>
                  {busy ? '↻ Opening browser…' : 'Sign in with Google'}
                </button>
              )}
              {url && (
                <button
                  className="btn small"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(url)
                      .then(() => useStore.getState().setStatus('Sign-in URL copied'))
                  }
                >
                  Copy sign-in URL
                </button>
              )}
            </div>
          }
        />
        {!drive.connected && !drive.builtin && (
          <Row
            label="Advanced"
            desc="Only if this build has no built-in Google client. Google Cloud Console → Credentials → OAuth client ID → type: Desktop app."
            control={
              <button className="btn small" onClick={() => setAdv((v) => !v)}>
                {adv ? 'Hide' : 'Set up'}
              </button>
            }
          />
        )}
        {adv && !drive.builtin && (
          <>
            <Row
              label="OAuth Client ID"
              desc="Paste your own client ID (…apps.googleusercontent.com)."
              control={
                <input
                  className="input"
                  style={{ width: 320 }}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1234-abc.apps.googleusercontent.com"
                />
              }
            />
            <Row
              label="Client secret"
              desc="Optional for Desktop app clients — Nova uses PKCE."
              control={
                <input
                  className="input"
                  style={{ width: 260 }}
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="GOCSPX-…"
                />
              }
            />
            <Row
              label=""
              desc="Client ID banao → Console kholo → APIs & Services → Credentials → Create credentials → OAuth client ID → Desktop app."
              control={
                <div className="input-row">
                  <button className="btn small" onClick={save}>
                    Save client ID
                  </button>
                  <button
                    className="btn small"
                    onClick={() => window.nova.openExternal('https://console.cloud.google.com/apis/credentials')}
                  >
                    Create credentials ↗
                  </button>
                </div>
              }
            />
          </>
        )}
        {msg && <div className={'g-inline g-' + msg.type}>{msg.text}</div>}
      </Group>

      {drive.connected && (
        <div className="preset-row">
          <button className="btn primary" onClick={() => useStore.getState().openCloud()}>
            Browse cloud files
          </button>
        </div>
      )}
    </div>
  );
}

const NAV = [
  ['general', 'General', '\u2699\uFE0F'],
  ['agents', 'Agents', '\u{1F916}'],
  ['models', 'Models', '\u{1F9E0}'],
  ['cloud', 'Cloud', '\u2601\uFE0F'],
  ['mcp', 'MCP', '\u{1F50C}'],
  ['browser', 'Browser & Network', '\u{1F310}'],
  ['computer', 'Computer', '\u{1F5A5}\uFE0F'],
  ['about', 'About', '\u2139\uFE0F'],
];

export default function SettingsModal() {
  const tab = useStore((s) => s.settingsTab);
  const setTab = useStore((s) => s.setSettingsTab);
  const [query, setQuery] = useState('');

  const active = tab === 'agent' ? 'agents' : tab === 'models' ? 'models' : tab;
  const current = NAV.find(([id]) => id === active) || NAV[0];
  const filt = query.trim().toLowerCase();
  const navItems = NAV.filter(([, label]) => !filt || label.toLowerCase().includes(filt));

  function close() {
    useStore.getState().saveSettings();
    useStore.getState().setSettingsOpen(false);
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="settings-overlay">
      <div className="settings-nav">
        <button className="back-btn" onClick={close}>
          {'\u2190'} Back
        </button>
        <input
          className="input settings-search"
          placeholder="Search Settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="settings-nav-list">
          {navItems.map(([id, label, icon]) => (
            <button
              key={id}
              className={'settings-nav-item' + (id === current[0] ? ' active' : '')}
              onClick={() => setTab(id)}
            >
              <span className="settings-nav-ico">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-content">
        <div className="settings-content-head">
          <h1>{current[1]}</h1>
          <div className="spacer" />
          <button className="btn-icon" title="Close (Esc)" onClick={close}>
            {'\u00D7'}
          </button>
        </div>
        <div className="settings-scroll">
          {current[0] === 'general' && <GeneralTab />}
          {current[0] === 'agents' && <AgentsTab />}
          {current[0] === 'models' && <ModelsTab />}
          {current[0] === 'cloud' && <CloudTab />}
          {current[0] === 'mcp' && <McpTab />}
          {current[0] === 'browser' && <BrowserTab />}
          {current[0] === 'computer' && <ComputerTab />}
          {current[0] === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
