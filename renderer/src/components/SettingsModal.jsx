import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { chatModels, preferredChatModel } from '../model-family';

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
            <button
              className="btn small"
              onClick={() => {
                // Close Settings first - its overlay covers the terminal panel,
                // so opening it behind the modal looked like nothing happened.
                useStore.getState().setSettingsOpen(false);
                useStore.getState().setTerminalOpen(true);
              }}
            >
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
    id: 'gemini-flash',
    label: 'Gemini 3.8 Flash (Free & Fast)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    modelIds: ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-flash-latest', 'gemini-2.5-flash-lite'],
    hint: 'Google Gemini 3.8 Flash (Recommended free model) — ultra fast with tool calling. Model field me "Fetch" dabao to live list aayegi.',
  },
  {
    id: 'gemini-flash-latest',
    label: 'Gemini Flash Latest',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-flash-latest',
    modelIds: ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    hint: 'Always points to the newest stable Gemini Flash model on your free AI Studio key.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.7-sonnet',
    modelIds: ['anthropic/claude-3.7-sonnet', 'deepseek/deepseek-r1', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],
    hint: 'OpenRouter — access Claude 3.7 Sonnet, DeepSeek R1, Llama 3.3 and hundreds of models.',
  },
  {
    id: 'opencode',
    label: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'beam-free',
    hint: 'Apni opencode.ai console ki paid API key daalo → "Test connection" dabao → Zen ke andar ke saare models list hoke pills me dikh jayenge, ek click me pick karo.',
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
    modelIds: ['sarvam-105b', 'sarvam-30b'],
    hint: 'Sarvam-105B for deep Indic-language reasoning — Bearer auth supported.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    modelIds: ['deepseek-chat', 'deepseek-reasoner'],
    hint: 'DeepSeek V3 (chat) and R1 (reasoning) — extremely affordable and capable.',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    modelIds: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'llama-3.1-8b-instant', 'qwen-2.5-coder-32b', 'mixtral-8x7b-32768'],
    hint: 'Groq ultra-fast Llama 3.3 70B & DeepSeek R1 Distill inference.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    modelIds: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1', 'o1-mini'],
    hint: 'OpenAI GPT-4o, GPT-4o-mini, and o-series reasoning models.',
  },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b', modelIds: ['qwen2.5-coder:7b', 'llama3.3:latest', 'deepseek-r1:latest'] },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
];

/**
 * Free Gemini API: paste a key, fetch the models, pick one.
 *
 * Defined at module level on purpose. A component declared inside ModelsTab is a
 * NEW component type on every parent render, so React remounts it and throws
 * away its state mid-request - which made "Fetch models" look like it did
 * nothing.
 */
function GeminiApiLine({ draft, active, setDraft, setActive, commit }) {
  const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
  const isGeminiModel = (m) => /generativelanguage\.googleapis\.com/i.test(String(m.baseUrl || ''));
  const gEntry = draft.find(isGeminiModel);
  const [key, setKey] = useState(gEntry ? gEntry.apiKey || '' : '');
  const [list, setList] = useState(() =>
    gEntry && Array.isArray(gEntry.modelIds) ? gEntry.modelIds : []
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  /** Find (or create) the Gemini entry; returns the updated draft + entry. */
  function ensureEntry(currentDraft, nextKey) {
    let entry = currentDraft.find(isGeminiModel);
    let next;
    if (!entry) {
      entry = {
        id: crypto.randomUUID(),
        label: 'Gemini',
        baseUrl: GEMINI_BASE,
        model: 'gemini-flash-latest',
        apiKey: nextKey || '',
      };
      next = [...currentDraft, entry];
    } else {
      next = currentDraft.map((m) => (m.id === entry.id ? { ...m, apiKey: nextKey ?? m.apiKey } : m));
    }
    return { next, entry };
  }

  async function fetchModels() {
    setBusy(true);
    setMsg('');
    // Do the network call FIRST: committing to the store re-renders the parent,
    // and we want the result in hand before that happens.
    try {
      const probe = ensureEntry(draft, key);
      const r = await window.nova.listModels({ baseUrl: probe.entry.baseUrl, apiKey: key, auth: 'gemini' });
      const { next, entry } = ensureEntry(draft, key);
      if (r && Array.isArray(r.models) && r.models.length) {
        const usable = chatModels(r.models); // drop tts/embedding/image models
        const chosen = preferredChatModel(usable, entry.model);
        const withIds = next.map((m) =>
          m.id === entry.id ? { ...m, modelIds: usable.slice(0, 500), model: chosen } : m
        );
        setDraft(withIds);
        setActive(entry.id);
        commit(withIds, entry.id);
        setList(usable);
        setMsg(
          `${usable.length} chat models mile — save ho gaye, picker me bhi dikhenge. Ek click me pick karo.` +
            (r.models.length > usable.length ? ` (${r.models.length - usable.length} non-chat skip kiye)` : '')
        );
      } else {
        setDraft(next);
        setActive(entry.id);
        commit(next, entry.id);
        setMsg(`Error: ${(r && r.error) || 'koi model nahi mila'}`);
      }
    } catch (e) {
      setMsg(`Error: ${String((e && e.message) || e)}`);
    }
    setBusy(false);
  }

  function pick(id) {
    const { next, entry } = ensureEntry(draft, key);
    const withModel = next.map((m) => (m.id === entry.id ? { ...m, model: id } : m));
    setDraft(withModel);
    setActive(entry.id);
    commit(withModel, entry.id);
    setMsg(`Model set: ${id} (active)`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', minWidth: 0 }}>
      <div className="input-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input
          className="input"
          style={{ width: 280, maxWidth: '100%' }}
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="AIza… (AI Studio key)"
        />
        <button className="btn small primary" disabled={busy} onClick={fetchModels}>
          {busy ? 'Fetching…' : 'Fetch models'}
        </button>
      </div>
      {list.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <span className="muted small" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            Selected Model:
          </span>
          <select
            className="select"
            style={{
              flex: 1,
              minWidth: 180,
              maxWidth: 320,
              padding: '5px 10px',
              borderRadius: 6,
              fontSize: 12.5,
              background: 'var(--panel-2, #18181b)',
              color: 'var(--fg)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
            }}
            value={(gEntry && gEntry.model) || list[0] || ''}
            onChange={(e) => pick(e.target.value)}
          >
            {list.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <span className="model-variant-count" style={{ whiteSpace: 'nowrap' }}>
            ✓ {list.length} models ready
          </span>
        </div>
      ) : (
        gEntry && gEntry.model && (
          <div className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span>Active model:</span>
            <span className="model-chip-badge">{gEntry.model}</span>
          </div>
        )
      )}
      {msg && <span className="muted small" style={{ color: msg.startsWith('Error') ? 'var(--danger, #ef4444)' : 'var(--muted)' }}>{msg}</span>}
    </div>
  );
}

function ModelsTab() {
  const models = useStore((s) => s.models);
  const activeModelId = useStore((s) => s.activeModelId);
  const [draft, setDraft] = useState(() => models.map((m) => ({ ...m })));
  const [active, setActive] = useState(activeModelId);
  const [custom, setCustom] = useState({ label: 'Custom', baseUrl: '', model: '', apiKey: '' });
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [expandedCards, setExpandedCards] = useState({});
  const [modelOpts, setModelOpts] = useState({}); // cardId -> [model ids] fetched from the endpoint
  const [tests, setTests] = useState({}); // cardId -> {state:'testing'|'ok'|'fail', msg, count}

  const toggleCard = (id) => setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));

  /** Test / Fetch control shown under each model card. */
  function TestLine({ id }) {
    const t = tests[id];
    const entry = id === 'custom' ? custom : draft.find((m) => m.id === id);
    const busy = !!t && t.state === 'testing';

    async function run() {
      if (!entry) return;
      const baseUrl = String(entry.baseUrl || '').trim();
      if (!baseUrl) {
        setTests((st) => ({ ...st, [id]: { state: 'fail', msg: 'Base URL daalo pehle.' } }));
        return;
      }
      setTests((st) => ({ ...st, [id]: { state: 'testing' } }));

      let modelToTest = String(entry.model || '').trim();
      // Model khali ho toh pehle endpoint se models auto-fetch karke pehla model pick karo
      if (!modelToTest) {
        try {
          const lr = await window.nova.listModels({
            baseUrl,
            apiKey: entry.apiKey || '',
          });
          const list = (lr && (lr.models || lr.data)) || [];
          const ids = list.map((m) => (typeof m === 'string' ? m : m && (m.id || m.name))).filter(Boolean);
          const usable = chatModels(ids);
          if (usable.length > 0) {
            modelToTest = usable[0];
            setModelOpts((o) => ({ ...o, [id]: usable }));
            if (id === 'custom') {
              setCustom((c) => ({ ...c, model: modelToTest }));
            } else {
              update(id, { model: modelToTest, modelIds: usable.slice(0, 500) });
            }
          }
        } catch {}
      }

      if (!modelToTest) {
        setTests((st) => ({ ...st, [id]: { state: 'fail', msg: 'Pehle Model box me model name daalo (ya Fetch models dabao).' } }));
        return;
      }

      try {
        const r = await window.nova.testModel({
          baseUrl,
          apiKey: entry.apiKey || '',
          model: modelToTest,
          auth: entry.auth,
        });
        if (r && r.chatOk) {
          setTests((st) => ({ ...st, [id]: { state: 'ok', msg: `works \u00B7 ${r.chatModel || modelToTest}` } }));
        } else {
          setTests((st) => ({ ...st, [id]: { state: 'fail', msg: (r && (r.error || r.chatError)) || 'connection failed' } }));
        }
      } catch (e) {
        setTests((st) => ({ ...st, [id]: { state: 'fail', msg: String(e.message || e) } }));
      }
    }

    async function fetchList() {
      if (!entry) return;
      try {
        const r = await window.nova.listModels({
          baseUrl: String(entry.baseUrl || '').trim(),
          apiKey: entry.apiKey || '',
        });
        const list = (r && (r.models || r.data)) || [];
        const ids = list.map((m) => (typeof m === 'string' ? m : m && (m.id || m.name))).filter(Boolean);
        const usable = chatModels(ids);
        setModelOpts((o) => ({ ...o, [id]: usable }));
        if (id === 'custom') {
          if (usable.length > 0) {
            const chosen = preferredChatModel(usable, custom.model) || usable[0] || '';
            setCustom((c) => ({ ...c, model: chosen }));
          }
        } else if (usable.length > 0) {
          const curEntry = draft.find((m) => m.id === id);
          const chosen = preferredChatModel(usable, curEntry?.model) || usable[0] || '';
          update(id, {
            modelIds: usable.slice(0, 500),
            ...((!curEntry?.model || curEntry.model === 'default' || !usable.includes(curEntry.model)) ? { model: chosen } : {}),
          });
        }
        setTests((st) => ({
          ...st,
          [id]: ids.length ? { state: 'ok', msg: `${ids.length} models found` } : { state: 'fail', msg: (r && (r.error || r.chatError)) || 'no models returned' },
        }));
      } catch (e) {
        setTests((st) => ({ ...st, [id]: { state: 'fail', msg: String(e.message || e) } }));
      }
    }

    return (
      <div className="testline">
        <button className="btn small" disabled={busy} onClick={run}>
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        <button className="btn small" onClick={fetchList} title="Fetch the model ids this endpoint offers">
          Fetch models
        </button>
        {t && t.state === 'ok' && <span className="testline-ok">{t.msg}</span>}
        {t && t.state === 'fail' && <span className="search-error small">{t.msg}</span>}
      </div>
    );
  }

  const saveTimer = useRef(null);

  function cleanModel(m) {
    return {
      id: m.id,
      label: m.label || m.model || 'Model',
      baseUrl: String(m.baseUrl || '').trim().replace(/\/+$/, ''),
      model: String(m.model || '').trim(),
      apiKey: m.apiKey || '',
      ...(m.auth ? { auth: m.auth } : {}),
      // Fetched model ids are remembered so the list survives a restart and the
      // agent's picker can offer every one of them.
      ...(Array.isArray(m.modelIds) && m.modelIds.length ? { modelIds: m.modelIds.slice(0, 500) } : {}),
    };
  }

  /**
   * Write through to the store (and, debounced, to disk) on every change.
   */
  function commit(nextDraft, nextActive) {
    const cleaned = nextDraft.map(cleanModel);
    const activeId = nextActive && cleaned.some((m) => m.id === nextActive) ? nextActive : (cleaned[0] && cleaned[0].id) || null;
    useStore.getState().setModels(cleaned, activeId);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => useStore.getState().saveSettings(), 400);
  }

  function update(id, patch) {
    const next = draft.map((m) => (m.id === id ? { ...m, ...patch } : m));
    setDraft(next);
    commit(next, active);
  }

  function remove(id) {
    const next = draft.filter((m) => m.id !== id);
    const nextActive = active === id ? null : active;
    setDraft(next);
    setActive(nextActive);
    commit(next, nextActive);
  }

  function addPreset(preset) {
    const entry = {
      id: crypto.randomUUID(),
      label: preset.label,
      baseUrl: preset.baseUrl,
      model: preset.model,
      ...(preset.modelIds ? { modelIds: [...preset.modelIds] } : {}),
      apiKey: '',
      ...(preset.auth ? { auth: preset.auth } : {}),
    };
    const next = [...draft, entry];
    setDraft(next);
    const nextActive = active ?? entry.id;
    setActive(nextActive);
    setExpandedCards((prev) => ({ ...prev, [entry.id]: true }));
    commit(next, nextActive);
  }

  async function addCustom() {
    const baseUrl = String(custom.baseUrl || '').trim();
    if (!baseUrl) return;

    let chosenModel = String(custom.model || '').trim();
    let fetchedIds = modelOpts['custom'] || [];

    // If model name is not entered, automatically fetch models from the API endpoint!
    if (!chosenModel) {
      if (fetchedIds.length === 0) {
        try {
          const r = await window.nova.listModels({
            baseUrl,
            apiKey: custom.apiKey || '',
          });
          const list = (r && (r.models || r.data)) || [];
          const ids = list.map((m) => (typeof m === 'string' ? m : m && (m.id || m.name))).filter(Boolean);
          const usable = chatModels(ids);
          if (usable.length) {
            fetchedIds = usable;
            chosenModel = preferredChatModel(usable) || usable[0] || '';
          }
        } catch {}
      } else {
        chosenModel = preferredChatModel(fetchedIds) || fetchedIds[0] || '';
      }
    }

    if (!chosenModel) {
      chosenModel = 'default';
    }

    // Auto-detect a friendly label if user left it blank or 'Custom'
    let label = custom.label.trim();
    if (!label || label === 'Custom') {
      const lower = baseUrl.toLowerCase();
      if (lower.includes('deepseek')) label = 'DeepSeek';
      else if (lower.includes('groq')) label = 'Groq';
      else if (lower.includes('openrouter')) label = 'OpenRouter';
      else if (lower.includes('ollama') || lower.includes('11434')) label = 'Ollama';
      else if (lower.includes('lmstudio') || lower.includes('1234')) label = 'LM Studio';
      else if (chosenModel && chosenModel !== 'default') label = chosenModel;
      else label = 'Custom';
    }

    const entry = {
      id: crypto.randomUUID(),
      label,
      baseUrl,
      model: chosenModel,
      apiKey: custom.apiKey || '',
      ...(fetchedIds.length ? { modelIds: fetchedIds.slice(0, 500) } : {}),
    };
    const next = [...draft, entry];
    setDraft(next);
    const nextActive = active ?? entry.id;
    setActive(nextActive);
    setExpandedCards((prev) => ({ ...prev, [entry.id]: true }));
    commit(next, nextActive);
    setCustom({ label: 'Custom', baseUrl: '', model: '', apiKey: '' });
    setShowAddCustom(false);
  }

  function modelInput(id, value, onChange, placeholder, existingModelIds) {
    const opts = (modelOpts[id] && modelOpts[id].length ? modelOpts[id] : existingModelIds) || [];
    if (opts.length > 0) {
      return (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
          <select
            className="select"
            style={{ flex: 1, minWidth: 0, padding: '5px 8px', fontSize: 12.5 }}
            value={value}
            onChange={onChange}
          >
            {!opts.includes(value) && value && <option value={value}>{value} (custom)</option>}
            {opts.map((mid) => (
              <option key={mid} value={mid}>
                {mid}
              </option>
            ))}
          </select>
          <span className="model-variant-count" style={{ whiteSpace: 'nowrap' }}>
            ✓ {opts.length}
          </span>
        </div>
      );
    }
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
    const cleaned = draft.map(cleanModel);
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

      <Group title="Gemini — free API (recommended)">
        <Row
          label="1. Get a free key"
          desc="AI Studio se free API key lo. Google-supported native tool-calling agent ke liye zaroori hai."
          control={
            <button className="btn small" onClick={() => window.nova.openExternal('https://aistudio.google.com/apikey')}>
              Get AI Studio key ↗
            </button>
          }
        />
        <Row
          label="2. Fetch &amp; pick a model"
          desc="Key daalkar Fetch models dabao — live available models me se aapka model clean dropdown me pick ho jayega."
          control={<GeminiApiLine draft={draft} active={active} setDraft={setDraft} setActive={setActive} commit={commit} />}
        />
      </Group>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '14px 0 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Quick-add a provider</span>
          <button
            className="btn small"
            style={{ fontSize: 11.5, padding: '3px 10px' }}
            onClick={() => setShowAddCustom(!showAddCustom)}
          >
            {showAddCustom ? '✕ Close Custom Form' : '+ Custom Endpoint'}
          </button>
        </div>
        <div className="preset-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESETS.map((p) => (
            <button key={p.id} className="preset-chip" title={p.hint} onClick={() => addPreset(p)}>
              + {p.label}
            </button>
          ))}
        </div>
      </div>

      {showAddCustom && (
        <div className="model-card" style={{ marginBottom: 14, background: 'var(--panel-2, #18181b)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Add Custom Model / Endpoint</span>
            <button className="btn-icon" onClick={() => setShowAddCustom(false)}>✕</button>
          </div>
          <div className="model-grid">
            <label>
              Label
              <input
                className="input"
                value={custom.label}
                onChange={(e) => setCustom({ ...custom, label: e.target.value })}
                placeholder="My model (optional)"
              />
            </label>
            <label>
              Base URL
              <input
                className="input"
                value={custom.baseUrl}
                onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </label>
            <label>
              Model {modelOpts['custom']?.length > 0 && <span style={{ color: '#4ade80', fontSize: 11 }}>(auto-fetched)</span>}
              {modelInput(
                'custom',
                custom.model,
                (e) => setCustom({ ...custom, model: e.target.value }),
                'Auto-fetches from API if blank',
                modelOpts['custom']
              )}
            </label>
            <label>
              API key
              <input
                className="input"
                type="password"
                value={custom.apiKey}
                onChange={(e) => setCustom({ ...custom, apiKey: e.target.value })}
                placeholder="sk-… (optional)"
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <TestLine id="custom" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn small" onClick={() => setShowAddCustom(false)}>Cancel</button>
              <button
                className="btn primary small"
                disabled={!custom.baseUrl.trim()}
                onClick={addCustom}
              >
                Add model
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 8px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)' }}>
          Configured Providers ({draft.length})
        </span>
        <span className="muted small">
          Active: <b>{draft.find((m) => m.id === active)?.label || 'None'}</b>
        </span>
      </div>

      {draft.length === 0 && <p className="muted">No models yet — add one above, or quick-add a provider.</p>}

      {draft.map((m) => {
        const isExpanded = !!expandedCards[m.id];
        const isActive = active === m.id;
        const hasVariants = Array.isArray(m.modelIds) && m.modelIds.length > 0;
        const t = tests[m.id];

        return (
          <div key={m.id} className={'model-card' + (isActive ? ' active' : '')} style={{ marginBottom: 8 }}>
            <div className={'model-card-head' + (isExpanded ? ' has-body' : '')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, flexWrap: 'wrap' }}>
                <label className="radio" style={{ cursor: 'pointer', margin: 0 }}>
                  <input
                    type="radio"
                    name="activeModel"
                    checked={isActive}
                    onChange={() => {
                      setActive(m.id);
                      commit(draft, m.id);
                    }}
                  />
                  <span style={{ fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--accent, #3d7eff)' : 'inherit' }}>
                    {m.label}
                  </span>
                </label>

                <span className="model-chip-badge" title={m.model}>
                  {m.model}
                </span>

                {isActive && <span className="model-active-badge">ACTIVE</span>}

                {hasVariants && (
                  <span className="model-variant-count" title={`${m.modelIds.length} models fetched from endpoint`}>
                    ✓ {m.modelIds.length} models
                  </span>
                )}

                {t && t.state === 'ok' && !isExpanded && (
                  <span className="testline-ok small" style={{ fontSize: 11 }}>
                    {t.msg}
                  </span>
                )}
                {t && t.state === 'fail' && !isExpanded && (
                  <span className="search-error small" style={{ fontSize: 11 }}>
                    {t.msg}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {!m.auth && !isExpanded && (
                  <button
                    className="btn small"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => toggleCard(m.id)}
                  >
                    Test / Config
                  </button>
                )}
                <button
                  className="btn small"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={() => toggleCard(m.id)}
                  title={isExpanded ? 'Collapse settings' : 'Configure endpoint, key and model'}
                >
                  {isExpanded ? '▴ Close' : '⚙ Edit'}
                </button>
                <button className="btn-icon" title="Remove model" onClick={() => remove(m.id)}>
                  &#128465;
                </button>
              </div>
            </div>

            {isExpanded && (
              <div style={{ marginTop: 10 }}>
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
                      Provider Label
                      <input
                        className="input"
                        value={m.label}
                        onChange={(e) => update(m.id, { label: e.target.value })}
                        placeholder="Label"
                      />
                    </label>
                    <label>
                      Base URL
                      <input
                        className="input"
                        value={m.baseUrl}
                        onChange={(e) => update(m.id, { baseUrl: e.target.value })}
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                    <label>
                      Model
                      {modelInput(m.id, m.model, (e) => update(m.id, { model: e.target.value }), 'model-id', m.modelIds)}
                    </label>
                    <label>
                      API Key
                      <input
                        className="input"
                        type="password"
                        value={m.apiKey}
                        onChange={(e) => update(m.id, { apiKey: e.target.value })}
                        placeholder="sk-…"
                      />
                    </label>
                  </div>
                )}
                {!m.auth && (
                  <div style={{ marginTop: 10 }}>
                    <TestLine id={m.id} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

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
  const vs = useStore((s) => s.voiceSettings);
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

      <Group title="Voice input">
        <Row
          label="How it works"
          desc="Mic pehle Chromium ka built-in recognition try karta hai. Agar wo network error de (Electron me Google speech key nahi hoti), Nova clip record karke neeche wale provider se transcribe karta hai."
          control={<span className="cz-dot" />}
        />
        <Row
          label="Provider"
          desc="Auto = Whisper endpoint (agar base URL diya ho), warna Gemini."
          control={
            <select
              className="select"
              value={vs.provider || 'auto'}
              onChange={(e) => {
                useStore.getState().patchVoiceSettings({ provider: e.target.value });
                useStore.getState().saveSettings();
              }}
            >
              <option value="auto">Auto</option>
              <option value="gemini">Gemini (AI Studio key)</option>
              <option value="openai">Whisper endpoint (OpenAI / Groq / …)</option>
            </select>
          }
        />
        <Row
          label="Base URL"
          desc="Whisper provider ke liye, e.g. https://api.groq.com/openai/v1"
          control={
            <input
              className="input"
              style={{ width: 320 }}
              value={vs.baseUrl || ''}
              onChange={(e) => useStore.getState().patchVoiceSettings({ baseUrl: e.target.value })}
              onBlur={() => useStore.getState().saveSettings()}
              placeholder="https://api.groq.com/openai/v1"
            />
          }
        />
        <Row
          label="API key"
          desc="Gemini (AI Studio) ya aapke Whisper provider ki key. Locally store hoti hai."
          control={
            <input
              className="input"
              style={{ width: 300 }}
              type="password"
              value={vs.apiKey || ''}
              onChange={(e) => useStore.getState().patchVoiceSettings({ apiKey: e.target.value })}
              onBlur={() => useStore.getState().saveSettings()}
              placeholder="…"
            />
          }
        />
        <Row
          label="Model"
          desc="e.g. gemini-3.7-flash · whisper-large-v3 · whisper-1"
          control={
            <input
              className="input"
              style={{ width: 240 }}
              value={vs.model || ''}
              onChange={(e) => useStore.getState().patchVoiceSettings({ model: e.target.value })}
              onBlur={() => useStore.getState().saveSettings()}
              placeholder="whisper-large-v3"
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

function CloudUserAvatar({ picture, name, email }) {
  const [imgError, setImgError] = useState(false);
  const initials = (name || email || 'U')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (picture && !imgError) {
    return (
      <img
        className="avatar sm"
        src={picture}
        alt={name || ''}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }}
      />
    );
  }

  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--accent, #3b82f6), #8b5cf6)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 600,
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
        flexShrink: 0,
      }}
    >
      {initials}
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
      <Group title="Google Drive Cloud">
        {drive.connected ? (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <CloudUserAvatar picture={drive.picture} name={drive.name} email={drive.email} />
                <div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {drive.name || 'Google Account'}
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 7px',
                        borderRadius: 10,
                        background: 'rgba(34, 197, 94, 0.15)',
                        color: '#16a34a',
                        fontWeight: 600,
                      }}
                    >
                      ● Connected
                    </span>
                  </div>
                  <div className="muted small">{drive.email}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn small primary" onClick={() => useStore.getState().openCloud()}>
                  Browse cloud files ↗
                </button>
                <button className="btn small danger" onClick={() => useStore.getState().driveSignOut()}>
                  Sign out
                </button>
              </div>
            </div>

            <Row
              label="Privacy & Isolation"
              desc={
                drive.needsReconsent
                  ? 'Access level updated: Token has legacy broad drive.readonly access. Re-consent with drive.file is recommended to enforce strict folder isolation.'
                  : 'Nova Drive access uses drive.file and is strictly isolated to the "Nova IDE" folder. Personal files and documents are never touched.'
              }
              control={
                <div style={{ display: 'flex', gap: 8 }}>
                  {drive.needsReconsent && (
                    <button
                      className="btn small primary"
                      onClick={async () => {
                        await useStore.getState().driveSignOut();
                        await useStore.getState().driveSignIn();
                      }}
                    >
                      Re-connect
                    </button>
                  )}
                  <button
                    className="btn small"
                    onClick={() =>
                      window.nova?.openExternal
                        ? window.nova.openExternal('https://drive.google.com/drive/my-drive')
                        : window.open('https://drive.google.com/drive/my-drive', '_blank')
                    }
                  >
                    Open Drive ↗
                  </button>
                </div>
              }
            />
            <Row
              label="Agent Memory Sync"
              desc="Agent's long-term memory (memory.json) automatically syncs to Google Drive hidden appData across your devices."
              control={<span className="cz-dot ok" title="Memory Sync Active" />}
            />
          </>
        ) : (
          <>
            <Row
              label="Status"
              desc="Not connected. Sign in once to read cloud files in the IDE and sync agent memory across devices."
              control={<span className="cz-dot" />}
            />
            <Row
              label="Sign in"
              desc={
                drive.builtin
                  ? 'One click sign-in with your Google account.'
                  : 'Sign in with Google (read-only Drive). Nova can read cloud files, never change them.'
              }
              control={
                <div className="input-row">
                  <button className="btn primary" disabled={busy} onClick={signIn}>
                    {busy ? '↻ Opening browser…' : 'Sign in with Google'}
                  </button>
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

            {!drive.builtin && (
              <Row
                label="Advanced"
                desc="Custom OAuth Client ID setup (Google Cloud Console → Credentials → OAuth client ID → Desktop app)."
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
                  desc="Desktop app client secret if required by your project."
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
                  desc="Save client credentials to local Nova config."
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
          </>
        )}

        {msg && <div className={'g-inline g-' + msg.type}>{msg.text}</div>}
        {msg && msg.type === 'err' && /access_denied|verif/i.test(msg.text || '') && (
          <Row
            label="Blocked by Google?"
            desc="OAuth app 'Testing' me hai to aapka account 'Test users' me hona chahiye."
            control={
              <button
                className="btn small"
                onClick={() => window.nova.openExternal('https://console.cloud.google.com/apis/credentials/consent')}
              >
                Open OAuth consent screen ↗
              </button>
            }
          />
        )}
      </Group>

      <div
        style={{
          marginTop: 16,
          padding: '12px 16px',
          borderRadius: 8,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>
            💡 Looking for Gemini AI Models?
          </div>
          <div className="muted small">
            Google Drive is for cloud storage & memory sync only. For Gemini 2.5 Flash / Pro AI models, add your free AI Studio API key in Models.
          </div>
        </div>
        <button className="btn small" onClick={() => useStore.getState().setSettingsTab('models')}>
          Open Models →
        </button>
      </div>
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
