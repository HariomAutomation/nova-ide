import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';
import { basename } from '../timeAgo';
import ToolCard from './ToolCard';
import RepoMenu from './RepoMenu';

marked.setOptions({ gfm: true, breaks: true });

function Markdown({ text }) {
  const html = DOMPurify.sanitize(marked.parse(text || ''));
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

const SUGGESTIONS = [
  {
    icon: '\u{1F3A8}',
    title: 'Build from a design',
    desc: 'Turn a screenshot or mockup into working UI in this repo',
    text: 'Build the UI from this design: ',
  },
  {
    icon: '\u{1F5FA}\uFE0F',
    title: 'Start with a plan',
    desc: 'Align on the implementation before writing code',
    text: 'Plan this feature before coding: ',
  },
  {
    icon: '\u{1F41E}',
    title: 'Debug an issue',
    desc: 'Find root causes and fix tricky bugs',
    text: 'Debug this issue: ',
  },
  {
    icon: '\u{1F9EA}',
    title: 'Write tests',
    desc: 'Cover the risky paths with real tests',
    text: 'Write tests for ',
  },
  {
    icon: '\u{1F310}',
    title: 'Research on the web',
    desc: 'Look up docs and APIs without leaving the chat',
    text: 'Search the web for ',
  },
];

const SPECIAL_MENTIONS = [
  { name: '@git', label: '@git', desc: 'Include git diff / status context', icon: '\u{1F500}' },
  { name: '@terminal', label: '@terminal', desc: 'Include recent terminal output', icon: '>_' },
  { name: '@web', label: '@web', desc: 'Search the web for docs and APIs', icon: '\u{1F310}' },
  { name: '@codebase', label: '@codebase', desc: 'Scan and explore the entire codebase', icon: '\u{1F4E6}' },
];

const COMMANDS = [
  {
    cmd: 'review',
    desc: 'Find bugs, regressions, security issues and missing tests',
    text: 'Review my current changes: find bugs, regressions, security issues, and missing tests. Read the relevant files first.',
  },
  {
    cmd: 'explain',
    desc: 'Explain the active file and how it fits the project',
    text: 'Explain the active file: what it does, how it fits the project, and the tricky parts. ',
  },
  {
    cmd: 'fix',
    desc: 'Find and fix a bug',
    text: 'Find and fix this bug: ',
  },
  {
    cmd: 'tests',
    desc: 'Write tests for the active file',
    text: 'Write tests for the active file. Match the existing test setup. ',
  },
  {
    cmd: 'plan',
    desc: 'Make a step-by-step implementation plan',
    text: 'Make a step-by-step implementation plan for: ',
  },
];

function diagnoseError(text) {
  const t = String(text || '');
  const low = t.toLowerCase();
  if (/freetiererror|only be used from within/i.test(t)) {
    return {
      headline: 'Ye free model sirf OpenCode app ke andar chalta hai',
      detail: 'OpenCode ne apne free-tier models ko apne app tak limit kar diya hai — Nova se nahi chalenge. Niche kisi working model pe switch karo (Gemini free models aapki key se chalte hain), ya Settings me Zen ki apni paid key daalo.',
      kind: 'switch',
    };
  }
  if (/429|resource_exhausted|quota|rate.?limit/i.test(t)) {
    const retryIn = /retry in ([\dhm.0-9]+)/i.exec(t);
    return {
      headline: 'Is model ka quota khatam ho gaya',
      detail: `Free tier limits per-model hote hain${retryIn ? ` — ${retryIn[1]} me reset hoga` : ''}. Doosre model pe switch karke same message dobara bhejo.`,
      kind: 'switch',
    };
  }
  if (/401|403|invalid api key|unauthorized|api key not valid/i.test(t)) {
    return {
      headline: 'API key galat ya khali hai',
      detail: 'Settings → Models me is provider ki sahi key daalo. Key hamesha aapke apne device pe rehti hai.',
      kind: 'settings',
    };
  }
  if (/not signed in|sign.?in|no webcontents|gemini.*(web|editor)/i.test(low) && /gemini/i.test(low)) {
    return {
      headline: 'Gemini Web me sign-in nahi hai',
      detail: 'Sidebar me 🌐 Gemini tab kholo, Google account se sign in karo, phir dobara bhejo. Ya upar model picker se Gemini API model chuno.',
      kind: 'settings',
    };
  }
  if (/fetch failed|enotfound|econnrefused|etimedout|network/i.test(low)) {
    return {
      headline: 'Model endpoint tak pahunch nahi paaye',
      detail: 'Internet/VPN/firewall check karo, ya Settings me baseUrl dekho. Offline local models (Ollama) bhi option hain.',
      kind: 'settings',
    };
  }
  if (/no base url/i.test(low)) {
    return {
      headline: 'Is model ka baseUrl set nahi hai',
      detail: 'Settings → Models me is model ka API address bhara, ya doosra model chuno.',
      kind: 'settings',
    };
  }
  return null;
}

function ErrorCard({ item }) {
  const models = useStore((s) => s.models);
  const activeModelId = useStore((s) => s.activeModelId);
  const agentItems = useStore((s) => s.agentItems);
  const [showRaw, setShowRaw] = useState(false);
  const d = diagnoseError(item.text);

  const fallbacks = models
    .filter((m) => m.apiKey && m.auth !== 'gemini-web' && m.id !== activeModelId && !m.baseUrl?.includes('localhost'))
    .slice(0, 3);

  const lastUserText = [...agentItems].reverse().find((it) => it.kind === 'user')?.text || '';

  const switchAndRetry = (id) => {
    const m = models.find((x) => x.id === id);
    if (!m) return;
    useStore.setState({ activeModelId: id });
    useStore.getState().saveSettings();
    useStore.getState().setStatus(`Model switched: ${m.label}`);
    if (lastUserText) useStore.getState().agentSend(lastUserText);
  };

  return (
    <div className="chat-msg error-card err-card">
      <div className="err-head">
        <span className="err-ico">⚠️</span>
        <div className="err-body">
          <div className="err-headline">{d ? d.headline : 'Agent ruk gaya'}</div>
          {d && <div className="err-detail">{d.detail}</div>}
        </div>
      </div>
      {d?.kind === 'switch' && fallbacks.length > 0 && (
        <div className="err-actions">
          <span className="err-try">Try:</span>
          {fallbacks.map((m) => (
            <button key={m.id} className="chip err-model-chip" onClick={() => switchAndRetry(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      )}
      <div className="err-actions">
        <button className="chip" onClick={() => useStore.getState().setSettingsOpen(true, 'models')}>
          ⚙️ Models/Settings
        </button>
        {lastUserText && (
          <button className="chip" onClick={() => useStore.getState().agentSend(lastUserText)}>
            ↻ Retry
          </button>
        )}
        <button className="chip subtle" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? 'Hide detail' : 'Detail'}
        </button>
      </div>
      {showRaw && <div className="err-raw">{item.text}</div>}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="14" y1="4" x2="14" y2="20" />
    </svg>
  );
}

function RepoChips({ docked }) {
  const rootFolder = useStore((s) => s.rootFolder);
  const gitBranch = useStore((s) => s.gitBranch);
  const appInfo = useStore((s) => s.appInfo);
  const runOn = useStore((s) => s.runOn);
  const drive = useStore((s) => s.drive);
  const git = useStore((s) => s.git);
  const [menu, setMenu] = useState(null); // null | 'runon' | 'repo'
  const [wtName, setWtName] = useState('');
  const wrapRef = useRef(null);
  const repoRef = useRef(null);

  // Prefer the GitHub repo (from the origin remote); fall back to the folder name.
  const remoteRepo = (() => {
    const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(String((git && git.remote) || ''));
    return m ? m[1] : null;
  })();
  const repoLabel = remoteRepo || (rootFolder ? basename(rootFolder) : 'Open folder');

  useEffect(() => {
    if (menu !== 'repo') return;
    const onDown = (e) => {
      if (repoRef.current && !repoRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  useEffect(() => {
    if (menu !== 'runon') return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const choose = (t) => {
    useStore.getState().setRunOn(t);
    setMenu(null);
  };
  const createWorktree = async () => {
    const n = wtName.trim();
    if (!n) return;
    setMenu(null);
    setWtName('');
    await useStore.getState().newWorktree(n);
  };

  return (
    <div className="home-chips">
      <div className="menu-anchor" ref={repoRef}>
        <button
          className="repo-chip"
          title={remoteRepo ? `GitHub: ${remoteRepo}` : rootFolder || 'Open a repository'}
          onClick={() => setMenu((m) => (m === 'repo' ? null : 'repo'))}
        >
          <span className="chip-ico">{'\u{1F4C1}'}</span>
          <span className="chip-text">{repoLabel}</span>
          <span className="chip-caret">{'\u2304'}</span>
        </button>
        {menu === 'repo' && (
          <div className={'dropdown repo-picker' + (docked ? ' up' : '')}>
            <RepoMenu onClose={() => setMenu(null)} />
          </div>
        )}
      </div>
      <button
        className="repo-chip"
        title={gitBranch ? `Branch: ${gitBranch}` : 'No git branch'}
        onClick={() =>
          useStore.getState().setStatus(gitBranch ? `On branch ${gitBranch}` : 'No git repository here')
        }
      >
        <span className="chip-ico">{'\u2387'}</span>
        {gitBranch || 'main'}
        <span className="chip-caret">{'\u2304'}</span>
      </button>
      <div className="menu-anchor" ref={wrapRef}>
        <button
          className={'repo-chip' + (runOn === 'cloud' ? ' cloud on' : '')}
          title="Choose where agents run"
          onClick={() => setMenu((m) => (m === 'runon' ? null : 'runon'))}
        >
          <span className="chip-ico">{runOn === 'cloud' ? '\u2601\uFE0F' : '\u{1F5A5}\uFE0F'}</span>
          {runOn === 'cloud' ? 'Cloud' : 'This Computer'}
          <span className="chip-caret">{'\u2304'}</span>
        </button>
        {menu === 'runon' && (
          <div className="dropdown runon-menu">
            <div className="runon-head">Run on</div>
            <button
              className="plus-row"
              onClick={() => {
                setMenu(null);
                if (drive && drive.connected) {
                  useStore.getState().setRunOn('cloud');
                  useStore.getState().setStatus('Run target: Cloud — your cloud files are in the Cloud tab.');
                } else {
                  useStore.getState().setStatus('Connect Google Drive to use the cloud (Settings → Cloud).');
                  useStore.getState().setSettingsOpen(true, 'cloud');
                }
              }}
            >
              <span className="plus-ico">{'\u2601\uFE0F'}</span>
              <span className="plus-text">
                <span className="plus-title">Cloud</span>
                <span className="plus-desc muted">
                  {drive && drive.connected ? drive.email || 'Connected' : 'Connect Google Drive'}
                </span>
              </span>
              {runOn === 'cloud' && <span className="runon-check">{'\u2713'}</span>}
            </button>
            <button className="plus-row" onClick={() => choose('local')}>
              <span className="plus-ico">{'\u{1F5A5}\uFE0F'}</span>
              <span className="plus-text">
                <span className="plus-title">This Computer</span>
                <span className="plus-desc muted">{appInfo ? `${appInfo.username}@${appInfo.hostname}` : 'Local machine'}</span>
              </span>
              {runOn === 'local' && <span className="runon-check">{'\u2713'}</span>}
            </button>
            <div className="runon-sep" />
            <div className="runon-new">
              <input
                className="input"
                placeholder="worktree name"
                value={wtName}
                onChange={(e) => setWtName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createWorktree();
                }}
              />
              <button className="btn small primary" disabled={!wtName.trim()} onClick={createWorktree}>
                {'\uFF0B'} New Worktree
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentMain() {
  const agentItems = useStore((s) => s.agentItems);
  const agentBusy = useStore((s) => s.agentBusy);
  const agentStep = useStore((s) => s.agentStep);
  const agentSettings = useStore((s) => s.agentSettings);
  const models = useStore((s) => s.models);
  const activeModelId = useStore((s) => s.activeModelId);
  const rootFolder = useStore((s) => s.rootFolder);
  const gitBranch = useStore((s) => s.gitBranch);
  const appInfo = useStore((s) => s.appInfo);
  const composerFocusSeq = useStore((s) => s.composerFocusSeq);
  const attachedFiles = useStore((s) => s.attachedFiles);
  const workspaceFiles = useStore((s) => s.workspaceFiles);
  const queued = useStore((s) => s.queued);
  const agentTodos = useStore((s) => s.agentTodos);
  const skills = useStore((s) => s.skills);

  const [input, setInput] = useState('');
  const [popup, setPopup] = useState(null); // { type: 'file'|'cmd', start, query, index }
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusQuery, setPlusQuery] = useState('');
  const taRef = useRef(null);
  const listRef = useRef(null);
  const menuRef = useRef(null);
  const modelMenuRef = useRef(null);
  const plusRef = useRef(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const voiceBaseRef = useRef('');

  const activeModel = models.find((m) => m.id === activeModelId) || null;
  // Only models that can actually run: one with an API key, the session-based
  // Gemini Web, or whatever is currently active.
  const usableModels = models.filter(
    (m) => m.id === activeModelId || m.auth === 'gemini-web' || String(m.apiKey || '').trim().length > 0
  );
  const hiddenModelCount = models.length - usableModels.length;
  const inConversation = agentItems.length > 0 || agentBusy || queued.length > 0;

  /** Voice input: Web Speech API, live transcript into the composer. */
  function toggleVoice() {
    const store = useStore.getState();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      store.setStatus(
        'Voice input is build me available nahi hai — Electron me Google ka speech key bundled nahi hota. Type karke use karo.'
      );
      return;
    }
    if (listening && recRef.current) {
      try {
        recRef.current.stop();
      } catch {}
      setListening(false);
      return;
    }
    let rec;
    try {
      rec = new SR();
    } catch (e) {
      store.setStatus(`Voice input start nahi hua: ${e.message}`);
      return;
    }
    rec.lang = navigator.language || 'en-IN';
    rec.continuous = false;
    rec.interimResults = true;
    voiceBaseRef.current = input ? input.replace(/\s+$/, '') + ' ' : '';
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      setInput((voiceBaseRef.current + finalText + interim).replace(/\s+/g, ' '));
    };
    rec.onerror = (e) => {
      setListening(false);
      const code = (e && e.error) || 'error';
      store.setStatus(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Mic permission deny ho gaya — system settings me Nova ko microphone allow karo.'
          : code === 'network'
            ? 'Speech service reach nahi hua (Electron build me Google speech key nahi hoti).'
            : code === 'no-speech'
              ? 'Kuch suna nahi — dobara try karo.'
              : `Voice input error: ${code}`
      );
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
      store.setStatus('Sun raha hoon… bolna shuru karo.');
    } catch (e) {
      setListening(false);
      store.setStatus(`Voice input start nahi hua: ${e.message}`);
    }
  }

  useEffect(() => {
    if (!modelMenuOpen) return;
    const onClick = (e) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (composerFocusSeq) taRef.current?.focus();
  }, [composerFocusSeq]);

  // Auto-scroll while the agent works, unless the user scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const sticky = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (sticky) el.scrollTop = el.scrollHeight;
  }, [agentItems, agentBusy, queued]);

  // Load the file list lazily the first time the user types "@".
  useEffect(() => {
    if (popup && popup.type === 'file' && workspaceFiles.length === 0) {
      useStore.getState().loadWorkspaceFiles().catch(() => {});
    }
  }, [popup, workspaceFiles.length]);

  // Ctrl+Tab / Cmd+Tab prefills the plan prompt (matches the "Plan New Idea" chip).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        e.preventDefault();
        prefill('Plan how to: ');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Close the "..." menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Close the "+" menu on outside click.
  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e) => {
      if (plusRef.current && !plusRef.current.contains(e.target)) setPlusOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [plusOpen]);

  // Rows for the Cursor-style "+" menu: actions, then the user's skills, all
  // filtered by the little search box.
  const plusRows = useMemo(() => {
    const q = plusQuery.trim().toLowerCase();
    const actions = [
      { id: 'plan', icon: '\u{1F9ED}', title: 'Plan', desc: 'Generate an implementation plan', run: () => { prefill('Plan this before coding: '); setPlusOpen(false); } },
      { id: 'debug', icon: '\u{1F41E}', title: 'Debug', desc: 'Pinpoint the root cause of an issue', run: () => { prefill('Debug this issue: '); setPlusOpen(false); } },
      { id: 'ask', icon: '\u{1F4AC}', title: 'Ask', desc: 'Answer questions without making edits', run: () => { prefill('Answer this without changing any files: '); setPlusOpen(false); } },
      { id: 'multitask', icon: '\u26A1', title: 'Multitask', desc: 'Orchestrate multiple subagents in parallel', run: () => { useStore.getState().setStatus('Multitask is coming soon in Nova'); setPlusOpen(false); } },
    ];
    const skillRows = (skills || []).map((sk) => ({
      id: 'skill-' + (sk.id || sk.name),
      icon: '\u{1F9E9}',
      title: sk.name,
      desc: sk.description || 'Skill',
      run: () => { prefill(`Use the "${sk.name}" skill: `); setPlusOpen(false); },
    }));
    const all = [...actions, ...skillRows];
    return q ? all.filter((r) => (r.title + ' ' + r.desc).toLowerCase().includes(q)) : all;
  }, [plusQuery, skills]);

  const fileMatches = useMemo(() => {
    if (!popup || popup.type !== 'file') return [];
    const q = popup.query.toLowerCase();
    const specials = SPECIAL_MENTIONS.filter((s) => !q || s.name.slice(1).startsWith(q)).map((s) => ({
      path: s.name,
      name: s.label,
      desc: s.desc,
      icon: s.icon,
      isSpecial: true,
    }));
    const files = workspaceFiles
      .filter((p) => {
        if (!q) return true;
        return p.toLowerCase().includes(q);
      })
      .map((p) => ({
        path: p,
        name: basename(p),
        desc: rootFolder && p.startsWith(rootFolder) ? p.slice(rootFolder.length + 1) : p,
        icon: '\u{1F4C4}',
        isSpecial: false,
      }));
    return [...specials, ...files].slice(0, 10);
  }, [popup, workspaceFiles, rootFolder]);

  const cmdMatches = useMemo(() => {
    if (!popup || popup.type !== 'cmd') return [];
    const q = popup.query.toLowerCase();
    return COMMANDS.filter((c) => c.cmd.startsWith(q));
  }, [popup]);

  const popupOptions = popup ? (popup.type === 'file' ? fileMatches : cmdMatches) : [];

  function updatePopupFor(value, caret) {
    const before = value.slice(0, caret);
    const mAt = /(^|[\s(])@([\w./~-]*)$/.exec(before);
    if (mAt) {
      setPopup({ type: 'file', start: caret - mAt[2].length - 1, query: mAt[2], index: 0 });
      return;
    }
    const mSlash = /^([\s]*)\/([a-z-]*)$/.exec(before);
    if (mSlash) {
      setPopup({ type: 'cmd', start: caret - mSlash[2].length - 1, query: mSlash[2], index: 0 });
      return;
    }
    setPopup(null);
  }

  function applyFile(itemOrPath) {
    const el = taRef.current;
    const caret = el ? el.selectionStart : input.length;
    const p = typeof itemOrPath === 'string' ? itemOrPath : itemOrPath.path;
    let token = p;
    if (p.startsWith('@')) {
      token = p;
    } else {
      const rel = rootFolder && p.startsWith(rootFolder) ? p.slice(rootFolder.length + 1) : p;
      token = '@' + rel;
    }
    const nextValue = input.slice(0, popup.start) + token + ' ' + input.slice(caret);
    setInput(nextValue);
    setPopup(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = popup.start + token.length + 1;
      el.setSelectionRange(pos, pos);
    });
  }

  function applyCommand(c) {
    setInput(c.text);
    setPopup(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  function applyOption(opt) {
    if (!popup) return;
    if (popup.type === 'file') applyFile(opt);
    else applyCommand(opt);
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    if (!activeModel) {
      useStore.getState().setSettingsOpen(true, 'models');
      return;
    }
    // Resolve @mentions to absolute paths and special tags
    const mentions = [];
    const specialTags = [];
    const re = /@([\w./~-]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const raw = m[1].toLowerCase();
      if (['git', 'terminal', 'web', 'codebase'].includes(raw)) {
        if (!specialTags.includes(raw)) specialTags.push(raw);
      } else {
        const abs = m[1].startsWith('/') ? m[1] : rootFolder ? `${rootFolder.replace(/\/$/, '')}/${m[1]}` : m[1];
        if (!mentions.includes(abs)) mentions.push(abs);
      }
    }
    const contextParts = [];
    if (mentions.length) {
      contextParts.push(`Files referenced with @ by the user: ${mentions.slice(0, 20).join(', ')}`);
      // Cursor parity: an @-mention actually attaches the file's contents, so the
      // agent starts from the real code instead of having to read it first.
      const picked = mentions.slice(0, 8);
      const parts = [];
      for (const p of picked) {
        try {
          const r = await window.nova.readFile(p);
          if (r && typeof r.content === 'string' && !r.binary && !r.truncated) {
            parts.push(`--- ${p} ---\n${r.content.slice(0, 6000)}`);
          } else {
            const why = r && r.binary ? 'binary file' : r && r.truncated ? 'too large to attach' : 'unreadable';
            parts.push(`--- ${p} --- (not attached: ${why})`);
          }
        } catch {
          parts.push(`--- ${p} --- (could not read)`);
        }
      }
      if (parts.length) {
        contextParts.push('Contents of @-mentioned files (already attached for you):\n\n' + parts.join('\n\n'));
      }
    }
    if (specialTags.includes('git')) {
      contextParts.push('User tagged @git: inspect git status / diff commands if needed.');
    }
    if (specialTags.includes('terminal')) {
      contextParts.push('User tagged @terminal: inspect terminal output if needed.');
    }
    if (specialTags.includes('web')) {
      contextParts.push('User tagged @web: use web_search or web_fetch for online documentation.');
    }
    if (specialTags.includes('codebase')) {
      contextParts.push('User tagged @codebase: explore the repository with list_dir and grep_search.');
    }
    const extraContext = contextParts.length ? contextParts.join('\n') : undefined;
    setInput('');
    setPopup(null);
    useStore.getState().agentSend(text, extraContext);
  }

  function prefill(text) {
    setInput(text);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  function onKeyDown(e) {
    if (popup && popupOptions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPopup((p) => ({ ...p, index: (p.index + 1) % popupOptions.length }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPopup((p) => ({ ...p, index: (p.index - 1 + popupOptions.length) % popupOptions.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyOption(popupOptions[popup.index] || popupOptions[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPopup(null);
        return;
      }
    }
    const submitCtrl = !!agentSettings.submitWithCtrlEnter;
    if (e.key === 'Enter') {
      if (submitCtrl ? e.ctrlKey || e.metaKey : !e.shiftKey) {
        e.preventDefault();
        send();
      }
    }
  }

  async function attach() {
    try {
      const paths = await window.nova.pickFiles();
      if (paths && paths.length) useStore.getState().attachFiles(paths);
    } catch (e) {
      useStore.getState().setStatus(`Attach failed: ${e.message}`);
    }
  }

  async function copyTranscript() {
    const text = agentItems
      .map((it) =>
        it.kind === 'user'
          ? `You: ${it.text}`
          : it.kind === 'assistant'
            ? `Nova: ${it.text}`
            : it.kind === 'tool'
              ? `[tool ${it.name}] ${it.output || ''}`
              : `[error] ${it.text}`
      )
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      useStore.getState().setStatus('Transcript copied to clipboard');
    } catch {
      useStore.getState().setStatus('Copy failed');
    }
    setMenuOpen(false);
  }

  const composer = (docked) => (
    <div className={'agent-composer' + (docked ? ' docked' : '')}>
      {attachedFiles.length > 0 && (
        <div className="attach-chips">
          {attachedFiles.map((p) => (
            <span key={p} className="attach-chip" title={p}>
              <span className="attach-ico">{'\u{1F4CE}'}</span>
              {basename(p)}
              <button
                className="attach-x"
                title="Remove"
                onClick={() => useStore.getState().removeAttached(p)}
              >
                {'\u00D7'}
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        className="agent-input"
        rows={docked ? 2 : 3}
        placeholder={'Plan, Build, / for skills, @ for context'}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          updatePopupFor(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => updatePopupFor(e.target.value, e.target.selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setPopup(null), 150)}
      />
      {popup && popupOptions.length > 0 && (
        <div className="mention-pop">
          <div className="mention-head">{popup.type === 'file' ? 'Context & Files (@)' : 'Commands (/)'}</div>
          {popup.type === 'file' &&
            fileMatches.map((item, i) => (
              <button
                key={item.path}
                className={'mention-row' + (i === popup.index ? ' active' : '')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFile(item);
                }}
              >
                <span className="mention-ico">{item.icon}</span>
                <span className="mention-name">{item.name}</span>
                <span className="mention-path muted">{item.desc}</span>
              </button>
            ))}
          {popup.type === 'cmd' &&
            cmdMatches.map((c, i) => (
              <button
                key={c.cmd}
                className={'mention-row' + (i === popup.index ? ' active' : '')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyCommand(c);
                }}
              >
                <span className="mention-ico">{'\u2318'}</span>
                <span className="mention-name">/{c.cmd}</span>
                <span className="mention-path muted">{c.desc}</span>
              </button>
            ))}
        </div>
      )}
      <div className="agent-composer-bar">
        <div className="menu-anchor" ref={plusRef}>
        <button
          className={'icon-chip' + (plusOpen ? ' on' : '')}
          title="Add context, skills or files"
          onClick={() => setPlusOpen((v) => !v)}
        >
          {'\uFF0B'}
        </button>
        {plusOpen && (
          <div className={'plus-menu dropdown ' + (docked ? 'up' : 'down')}>
            <input
              className="plus-search"
              placeholder="Search skills, context, chats\u2026"
              value={plusQuery}
              onChange={(e) => setPlusQuery(e.target.value)}
              autoFocus
            />
            <div className="plus-list">
              {plusRows.map((r) => (
                <button
                  key={r.id}
                  className="plus-row"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    r.run();
                  }}
                >
                  <span className="plus-ico">{r.icon}</span>
                  <span className="plus-text">
                    <span className="plus-title">{r.title}</span>
                    <span className="plus-desc muted">{r.desc}</span>
                  </span>
                </button>
              ))}
              {plusRows.length === 0 && <div className="plus-empty muted small">No matches</div>}
            </div>
            <div className="plus-footer">
              <button
                className="plus-row"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setPlusOpen(false);
                  attach();
                }}
              >
                <span className="plus-ico">{'\u{1F4CE}'}</span>
                <span className="plus-text">
                  <span className="plus-title">Files</span>
                  <span className="plus-desc muted">Attach files from disk</span>
                </span>
                <span className="plus-chev">{'\u203A'}</span>
              </button>
              <button
                className="plus-row"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setPlusOpen(false);
                  useStore.getState().setSettingsOpen(true, 'mcp');
                }}
              >
                <span className="plus-ico">{'\u{1F50C}'}</span>
                <span className="plus-text">
                  <span className="plus-title">MCP</span>
                  <span className="plus-desc muted">Connected MCP servers</span>
                </span>
                <span className="plus-chev">{'\u203A'}</span>
              </button>
            </div>
          </div>
        )}
        </div>
        <div className="menu-anchor" ref={modelMenuRef} style={{ position: 'relative' }}>
          <button
            className={`model-chip ${modelMenuOpen ? 'on' : ''}`}
            title="Switch AI model (Click to select)"
            onClick={() => setModelMenuOpen(!modelMenuOpen)}
          >
            <span style={{ fontSize: 13, marginRight: 2 }}>⚡</span>
            {activeModel ? activeModel.label : 'Select Model\u2026'}
            <span className="chip-caret">▾</span>
          </button>

          {modelMenuOpen && (
            <div
              className="dropdown"
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: 0,
                right: 'auto',
                top: 'auto',
                minWidth: 320,
                maxWidth: 400,
                maxHeight: 460,
                overflowY: 'auto',
                padding: '6px',
                zIndex: 150,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  Choose Model
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{usableModels.length} ready</span>
              </div>

              {hiddenModelCount > 0 && (
                <div style={{ padding: '6px 10px 2px', fontSize: 11, color: 'var(--muted)' }}>
                  {hiddenModelCount} model{hiddenModelCount > 1 ? 's' : ''} hidden (no key) —{' '}
                  <button
                    className="linklike"
                    onClick={() => {
                      setModelMenuOpen(false);
                      useStore.getState().setSettingsOpen(true, 'models');
                    }}
                  >
                    manage models
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {usableModels.length === 0 && (
                  <div style={{ padding: '8px 10px 12px', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                    No working model yet. Add an API key or sign in with Google (Gemini tab) — Settings → Models.
                  </div>
                )}
                {usableModels.map((m) => {
                  const isSel = m.id === activeModelId;
                  return (
                    <button
                      key={m.id}
                      className="dropdown-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '7px 10px',
                        background: isSel ? 'var(--bg-active, rgba(255,255,255,0.08))' : 'transparent',
                        fontWeight: isSel ? 600 : 400,
                      }}
                      onClick={() => {
                        useStore.getState().setModels(models, m.id);
                        useStore.getState().saveSettings();
                        setModelMenuOpen(false);
                        useStore.getState().setStatus(`Active model: ${m.label}`);
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{ color: isSel ? 'var(--accent, #3d7eff)' : 'transparent', width: 14 }}>✓</span>
                        <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {m.label}
                        </span>
                      </div>
                      {m.tag && (
                        <span
                          style={{
                            fontSize: 9.5,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: m.tag.includes('FREE') ? '#134e2f' : '#2b303c',
                            color: m.tag.includes('FREE') ? '#4ade80' : '#9ca3af',
                            fontWeight: 600,
                            letterSpacing: 0.3,
                            flexShrink: 0,
                          }}
                        >
                          {m.tag}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4, marginTop: 4 }}>
                <button
                  className="dropdown-item"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent, #3d7eff)', fontWeight: 500 }}
                  onClick={() => {
                    setModelMenuOpen(false);
                    useStore.getState().setSettingsOpen(true, 'models');
                  }}
                >
                  <span>⚙️</span>
                  <span>Manage Models &amp; API Keys…</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="spacer" />
        {agentBusy ? (
          <button className="run-btn stop" title="Stop" onClick={() => useStore.getState().agentStop()}>
            {'\u25A0'}
          </button>
        ) : input.trim() ? (
          <button className="run-btn" title="Send (Enter)" onClick={send}>
            {'\u2191'}
          </button>
        ) : (
          <button
            className={'run-btn' + (listening ? ' listening' : '')}
            title={listening ? 'Stop listening' : 'Voice input'}
            onClick={toggleVoice}
          >
            <MicIcon />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="agent-main">
      <div className={'agent-topbar' + (inConversation ? '' : ' home')}>
        <button
          className="repo-chip"
          title={rootFolder || 'Open a folder'}
          onClick={() => useStore.getState().openFolder()}
        >
          <span className="chip-ico">{'\u{1F4C1}'}</span>
          <span className="chip-text">{rootFolder ? basename(rootFolder) : 'Open folder'}</span>
        </button>
        {gitBranch && (
          <button
            className="repo-chip"
            title={`Branch: ${gitBranch}`}
            onClick={() => useStore.getState().setStatus(`On branch ${gitBranch}`)}
          >
            <span className="chip-ico">{'\u2387'}</span>
            {gitBranch}
            <span className="chip-caret">{'\u2304'}</span>
          </button>
        )}
        <button
          className="repo-chip"
          title={appInfo ? `${appInfo.username}@${appInfo.hostname}` : 'This computer'}
          onClick={() =>
            useStore
              .getState()
              .setStatus(appInfo ? `Running on ${appInfo.username}@${appInfo.hostname} (${appInfo.os})` : 'This computer')
          }
        >
          <span className="chip-ico">{'\u{1F5A5}\uFE0F'}</span>
          This Computer
          <span className="chip-caret">{'\u2304'}</span>
        </button>
        <div className="spacer" />
        {inConversation && (
          <button
            className="pill"
            title="Start a new chat"
            onClick={() => useStore.getState().newAgentChat()}
          >
            + New
          </button>
        )}
        <button
          className="pill"
          title="Open the code editor (Ctrl+Shift+A)"
          onClick={() => useStore.getState().setMainView('editor')}
        >
          {'IDE \u2197'}
        </button>
        <div className="menu-anchor" ref={menuRef}>
          <button className="btn-icon" title="More" onClick={() => setMenuOpen((v) => !v)}>
            {'\u2026'}
          </button>
          {menuOpen && (
            <div className="dropdown">
              <button
                className="dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  useStore.getState().restoreCheckpoint();
                }}
              >
                {'\u21BA'} Restore files (undo agent edits)
              </button>
              <button className="dropdown-item" onClick={copyTranscript}>
                {'\u29C9'} Copy transcript
              </button>
              <button
                className="dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  useStore.getState().setTerminalOpen(!useStore.getState().terminalOpen);
                }}
              >
                {'\u2318'} Toggle terminal
              </button>
            </div>
          )}
        </div>
        <button
          className="btn-icon"
          title="Toggle sidebar"
          onClick={() => useStore.getState().setSidebarVisible(!useStore.getState().sidebarVisible)}
        >
          <SplitIcon />
        </button>
      </div>

      <div className="agent-body">
        {inConversation ? (
          <>
            <div className="chat-messages agent-thread" ref={listRef}>
              {agentItems.map((item) => {
                if (item.kind === 'user') {
                  return (
                    <div key={item.id} className="chat-msg user">
                      <div className="chat-role">You</div>
                      <div className="chat-plain">{item.text}</div>
                    </div>
                  );
                }
                if (item.kind === 'assistant') {
                  return (
                    <div key={item.id} className="chat-msg assistant">
                      <div className="chat-role">Nova</div>
                      <Markdown text={item.text + (item.streaming ? ' \u258D' : '')} />
                    </div>
                  );
                }
                if (item.kind === 'tool') {
                  return <ToolCard key={item.id} item={item} />;
                }
                return <ErrorCard key={item.id} item={item} />;
              })}
              {queued.map((q) => (
                <div key={q.id} className="chat-msg user queued-msg">
                  <div className="chat-role">
                    You <span className="queued-tag">queued</span>
                  </div>
                  <div className="chat-plain">{q.text}</div>
                </div>
              ))}
              {agentBusy && (
                <div className="agent-status">
                  <span className="spin" /> step {agentStep}/{agentSettings.maxSteps}
                </div>
              )}
            </div>
            <div className="agent-dock">
              {agentTodos.length > 0 && (
                <div className="agent-todos">
                  <div className="agent-todos-head">
                    Tasks{' '}
                    <span className="muted">
                      {agentTodos.filter((t) => t.status === 'done').length}/{agentTodos.length}
                    </span>
                  </div>
                  {agentTodos.map((t, i) => (
                    <div key={i} className={'todo-row ' + (t.status || 'pending')}>
                      <span className="todo-mark">
                        {t.status === 'done' ? '✓' : t.status === 'in_progress' ? '◐' : '○'}
                      </span>
                      <span className="todo-text">{t.text}</span>
                    </div>
                  ))}
                </div>
              )}
              <RepoChips docked />
              {composer(true)}
              <div className="composer-hint muted small">
                {agentSettings.submitWithCtrlEnter
                  ? 'Ctrl+Enter to send \u00B7 Enter for a new line'
                  : 'Shift+Enter for a new line'}{' '}
                {'\u00B7'} use /review to review code
              </div>
            </div>
          </>
        ) : (
          <div className="agent-home">
            <div className="agent-home-inner">
              <h1 className="agent-greet">
                {appInfo?.username ? `Hey ${appInfo.username}` : 'Welcome'} — what can I do for you?
              </h1>
              <p className="agent-sub">
                I can read your code, run commands, browse the web and control this machine — every step needs your
                approval.
              </p>
              <RepoChips />
              {composer(false)}
              <div className="agent-chips">
                <button className="chip" onClick={() => prefill('Plan how to: ')}>
                  <span className="chip-ico">{'\u{1F9ED}'}</span> Plan New Idea
                  <kbd className="keycap">{'\u2318'}Tab</kbd>
                </button>
                <button
                  className="chip"
                  onClick={() => useStore.getState().setStatus('Multitask is coming soon in Nova')}
                >
                  <span className="chip-ico">{'\u26A1'}</span> Multitask
                </button>
                <button
                  className="chip"
                  onClick={() => useStore.getState().setStatus('Run in Cloud is coming soon in Nova')}
                >
                  <span className="chip-ico">{'\u2601\uFE0F'}</span> Run in Cloud
                </button>
              </div>
              <div className="sugg-list">
                {SUGGESTIONS.map((sg) => (
                  <button key={sg.title} className="sugg-row" onClick={() => prefill(sg.text)}>
                    <span className="sugg-ico">{sg.icon}</span>
                    <span className="sugg-text">
                      <span className="sugg-title">{sg.title}</span>
                      <span className="sugg-desc">{sg.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="home-footer muted small">
                Use /review to have Nova find bugs, regressions, security issues, and missing tests
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
