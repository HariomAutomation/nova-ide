/**
 * Gemini Web "jugaad" provider.
 *
 * Drives the gemini.google.com web app that lives inside Nova's 🌐 Gemini tab
 * (a <webview> with its own persistent session) so the user's Google account /
 * Pro subscription can power Nova's chat AND the agent — no API billing.
 *
 * How it works: the renderer reports the webview's webContents id; this module
 * attaches Electron's CDP debugger to that webContents and drives the page
 * (type -> send -> read the streaming answer from the DOM). Nothing leaves the
 * machine beyond the normal Gemini web traffic — the browser session is the
 * same one the user signs into.
 *
 * Agent mode: the web model can't do function calling, so we inject a small
 * text protocol (see protocolBlock) telling it to answer with a JSON
 * `{"tool_calls": [...]}` object when it wants tools. agent.js parses that and
 * feeds results back as "Tool result (...)" messages — so the agent keeps its
 * full tool surface (files, terminal, browser, web, computer, MCP addons).
 *
 * Caveats (surfaced in the UI): automates a consumer web app (Google ToS gray
 * area), selectors drift when Google ships UI changes, rate limits / CAPTCHAs
 * are possible. Errors fall back with friendly messages.
 */
const { webContents, shell } = require('electron');

let wcId = null;
let chain = Promise.resolve();
const threads = new Map(); // threadKey -> { cursor: messages.length already sent }

const MAX_PROMPT = 24000;
const ANSWER_TIMEOUT_MS = 5 * 60 * 1000;

/* ------------------------------- plumbing ------------------------------- */

function wcOrThrow() {
  const wc = wcId != null ? webContents.fromId(wcId) : null;
  if (!wc || wc.isDestroyed()) {
    throw new Error('Gemini tab abhi ready nahi hai — Nova ke left sidebar se "Gemini" kholo, page load hone do, phir try karo.');
  }
  return wc;
}

/** Renderer reports the <webview>'s webContents id after dom-ready. */
function setWebContentsId(id) {
  wcId = Number(id) || null;
  try {
    const wc = wcId != null ? webContents.fromId(wcId) : null;
    if (wc) {
      // Popups (share links, external pages) go to system browser,
      // but Google accounts sign-in popups stay inside this partition.
      wc.setWindowOpenHandler(({ url }) => {
        if (/accounts\.google\.com|google\.com\/accounts/i.test(url)) {
          return { action: 'allow' };
        }
        if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
        return { action: 'deny' };
      });
    }
  } catch {}
}

function clearWebContents() {
  wcId = null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function evaluate(wc, expression) {
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  const res = await wc.debugger.sendCommand('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res && res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error('Gemini page error: ' + ((d.exception && d.exception.description) || d.text || 'unknown'));
  }
  return res ? res.result && res.result.value : undefined;
}

async function waitFor(fn, timeoutMs, intervalMs = 400) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

/* --------------------------- page-side snippets --------------------------- */

const EDITOR_SELECTORS = [
  'rich-textarea .ql-editor',
  'rich-textarea [contenteditable="true"]',
  '.text-input-field [contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  '[contenteditable="true"]',
  'textarea[aria-label*="prompt" i]',
  'textarea',
];

const SEND_SELECTORS = [
  'button.send-button',
  'button[aria-label="Send message" i]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="submit" i]',
  '.send-button-container button',
];
const STOP_SELECTORS = [
  'button.send-button.stop',
  'button[aria-label*="Stop" i]',
  'button[aria-label*="stop" i]',
  '.stop-button',
];

const jsPick = (sels) => `(() => { for (const s of ${JSON.stringify(sels)}) { try { const el = document.querySelector(s); if (el) return el; } catch {} } return null; })()`;

const JS_STATE = `(() => {
  const pick = (sels) => { for (const s of sels) { try { const el = document.querySelector(s); if (el) return el; } catch {} } return null; };
  const editor = pick(${JSON.stringify(EDITOR_SELECTORS)});
  const sendBtn = pick(${JSON.stringify(SEND_SELECTORS)});
  const stopBtn = pick(${JSON.stringify(STOP_SELECTORS)});
  let last = null;
  const textSels = [
    'model-response .markdown.markdown-main-panel',
    'model-response .markdown',
    '.model-response-text .markdown',
    '.model-response-text',
    'message-content',
    'model-response',
    '[data-test-id="model-response-text"]',
  ];
  for (const s of textSels) {
    const els = document.querySelectorAll(s);
    if (els.length) { last = els[els.length - 1]; break; }
  }
  return {
    url: location.href,
    title: document.title,
    hasEditor: !!editor,
    hasSendBtn: !!sendBtn,
    sendEnabled: !!sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true',
    busy: !!stopBtn,
    editorText: editor ? (editor.innerText || '') : '',
    text: last ? (last.innerText || '') : '',
    body: document.body ? document.body.innerText.slice(0, 400) : '',
  };
})()`;

const JS_FOCUS = `(() => {
  const ed = ${jsPick(EDITOR_SELECTORS)};
  if (!ed) return { ok: false };
  ed.focus();
  try {
    const sel = window.getSelection();
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(ed);
    sel.addRange(r);
  } catch {}
  return { ok: true };
})()`;

const JS_EDITOR_TEXT = `(() => { const ed = ${jsPick(EDITOR_SELECTORS)}; return ed ? (ed.innerText || '') : ''; })()`;

const JS_CLICK_SEND = `(() => {
  const btn = ${jsPick(SEND_SELECTORS)};
  if (!btn) return { clicked: false };
  btn.click();
  return { clicked: true };
})()`;

const JS_SEND_RECT = `(() => {
  const btn = ${jsPick(SEND_SELECTORS)};
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`;

const JS_NEW_CHAT = `(() => {
  const btn = ${jsPick(['button[aria-label="New chat"]', 'button[aria-label*="New chat"]'])};
  if (btn) { btn.click(); return { clicked: true }; }
  return { clicked: false };
})()`;

const JS_CLICK_STOP = `(() => { const btn = ${jsPick(STOP_SELECTORS)}; if (btn) { btn.click(); return true; } return false; })()`;

/* ------------------------------ core helpers ------------------------------ */

async function pageState(wc) {
  return (await evaluate(wc, JS_STATE)) || {};
}

function signinError() {
  return new Error(
    'Gemini me sign in nahi hai. Nova ke sidebar se 🌐 Gemini tab kholo, apne Google account se sign in karo, phir message dobara bhejo.'
  );
}

async function ensureReady() {
  const wc = wcOrThrow();
  for (let i = 0; i < 80; i++) {
    let url = '';
    try {
      url = wc.getURL() || '';
    } catch {}
    if (/accounts\.google\.com|\/signin/i.test(url)) throw signinError();
    if (/gemini\.google\.com/.test(url)) {
      const st = await pageState(wc).catch(() => null);
      if (st && st.hasEditor) return st;
      if (st && st.url && /accounts\.google\.com|\/signin/i.test(st.url)) throw signinError();
    } else if (i === 0) {
      wc.loadURL('https://gemini.google.com/app').catch(() => {});
    }
    await sleep(500);
  }
  const st = await pageState(wc).catch(() => ({}));
  throw new Error(
    'Gemini page load nahi ho paya (timeout). Abhi ka URL: ' + (st.url || 'unknown') + ' — tab khol ke dekho aur Reload karo.'
  );
}

async function newChatInternal(wc) {
  const r = await evaluate(wc, JS_NEW_CHAT).catch(() => null);
  if (!r || !r.clicked) wc.loadURL('https://gemini.google.com/app').catch(() => {});
  await waitFor(async () => {
    const st = await pageState(wc).catch(() => null);
    return st && st.hasEditor ? true : null;
  }, 20000);
  await sleep(700);
}

async function typePrompt(wc, text) {
  const f = await evaluate(wc, JS_FOCUS);
  if (!f || !f.ok) {
    throw new Error('Gemini ka input box nahi mila — page poori tarah load hone do (Gemini tab me Reload karo), phir try karo.');
  }
  let typed = false;
  try {
    await wc.debugger.sendCommand('Input.insertText', { text });
    typed = true;
  } catch {
    typed = false;
  }
  let cur = await evaluate(wc, JS_EDITOR_TEXT).catch(() => '');
  if (!typed || !String(cur).trim()) {
    const fallback = `(() => {
      const ed = ${jsPick(EDITOR_SELECTORS)};
      if (!ed) return false;
      ed.focus();
      try { document.execCommand('insertText', false, ${JSON.stringify(text)}); } catch {}
      return true;
    })()`;
    await evaluate(wc, fallback).catch(() => {});
    cur = await evaluate(wc, JS_EDITOR_TEXT).catch(() => '');
  }
  const probe = text.split('\n')[0].trim().slice(0, 24);
  if (probe && !String(cur).includes(probe.slice(0, 12))) {
    throw new Error('Gemini input me text set nahi hua (UI badla lagta hai). Gemini tab me Reload karke dobara try karo.');
  }
}

async function clickSend(wc) {
  const ready = await waitFor(async () => {
    const st = await pageState(wc).catch(() => ({}));
    return st.sendEnabled ? true : null;
  }, 8000, 300);
  if (!ready) throw new Error('Gemini ka Send button enable nahi hua — input set hua tha? Reload karke try karo.');

  const r = await evaluate(wc, JS_CLICK_SEND).catch(() => null);
  if (!r || !r.clicked) throw new Error('Gemini ka Send button nahi mila (UI badla lagta hai).');

  // Confirm the send really started; fall back to a real mouse click.
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    await sleep(400);
    const st = await pageState(wc).catch(() => ({}));
    if (st.busy) return;
    if (!String(st.editorText || '').trim()) return;
  }
  const rect = await evaluate(wc, JS_SEND_RECT).catch(() => null);
  if (rect) {
    const args = { x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 };
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...args }).catch(() => {});
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...args }).catch(() => {});
  }
}

/* --------------------------- prompt composition --------------------------- */

function composeDelta(messages, cursor) {
  const nameById = {};
  for (const m of messages) {
    if (m && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc && tc.id && tc.function) nameById[tc.id] = tc.function.name;
      }
    }
  }
  const parts = [];
  for (let i = cursor; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== 'object' || m.role === 'system') continue;
    let content = m.content;
    if (Array.isArray(content)) content = content.map((c) => (c && c.text) || '').join('\n');
    content = typeof content === 'string' ? content : content == null ? '' : JSON.stringify(content);
    if (m.role === 'user') parts.push('User:\n' + content);
    else if (m.role === 'assistant') {
      if (String(content).trim()) parts.push('Assistant:\n' + content);
      // empty assistant messages that only carried tool calls are skipped
    } else if (m.role === 'tool') {
      const nm = nameById[m.tool_call_id] || '';
      parts.push('Tool result' + (nm ? ' (' + nm + ')' : '') + ':\n' + String(content).slice(0, 6000));
    }
  }
  return parts.join('\n\n');
}

function compactTools(tools) {
  if (!Array.isArray(tools) || !tools.length) return '';
  const lines = [];
  for (const t of tools) {
    const f = (t && t.function) || t || {};
    if (!f.name) continue;
    const props = (f.parameters && f.parameters.properties) || {};
    const req = new Set((f.parameters && f.parameters.required) || []);
    const sig = Object.keys(props)
      .map((k) => (req.has(k) ? k : k + '?'))
      .join(', ');
    const desc = String(f.description || '').replace(/\s+/g, ' ').slice(0, 110);
    lines.push('- ' + f.name + '(' + sig + '): ' + desc);
  }
  return lines.join('\n');
}

function protocolBlock(tools) {
  const list = compactTools(tools);
  if (!list) return '';
  return [
    '[Nova Agent Protocol — follow exactly]',
    'You are the brain of Nova IDE, a coding agent running on this computer. Tools available:',
    list,
    '',
    'Rules:',
    '1. To use tools, reply with ONLY one JSON object:',
    '{"tool_calls":[{"name":"<tool>","arguments":{...}}]}',
    'No prose, no markdown fences, nothing else.',
    '2. You may batch multiple calls in the array; they run in order.',
    '3. When no tools are needed, reply with your normal answer text.',
    '4. Tool results arrive as "Tool result (...)" messages — continue from there.',
    '5. Arguments must match the parameter names above exactly.',
  ].join('\n');
}

/* ------------------------------ JSON parsing ------------------------------ */

/** Parse a web reply that may contain a {"tool_calls": [...]} JSON object. */
function parseWebToolCalls(text) {
  if (!text) return null;
  const t = String(text).trim();
  const tries = [t];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) tries.push(t.slice(start, end + 1));

  for (const cand of tries) {
    try {
      const j = JSON.parse(cand);
      const arr = Array.isArray(j) ? j : j && (j.tool_calls || j.toolCalls || (j.name || j.tool ? [j] : null));
      if (!Array.isArray(arr) || !arr.length) continue;
      const calls = [];
      for (const c of arr) {
        const name = c && (c.name || c.tool || (c.function && c.function.name));
        let args = c && (c.arguments !== undefined ? c.arguments : c.args !== undefined ? c.args : c.params !== undefined ? c.params : c.function && c.function.arguments);
        if (args === undefined || args === null) args = {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = { raw: args };
          }
        }
        if (name) calls.push({ id: `web_${Date.now()}_${calls.length}`, name, argsRaw: JSON.stringify(args) });
      }
      if (calls.length) return calls;
    } catch {}
  }
  return null;
}

/* ------------------------------- main flow ------------------------------- */

async function runPrompt({ threadKey, system, messages, tools, onDelta, signal }) {
  const wc = wcOrThrow();
  const msgs = Array.isArray(messages) ? messages : [];
  const key = threadKey || 'default';

  await ensureReady();

  const fresh = !threads.has(key);
  const cursor = fresh ? 0 : Math.min(threads.get(key).cursor, msgs.length);
  let delta = composeDelta(msgs, cursor);
  if (!delta.trim()) {
    const lastUser = [...msgs].reverse().find((m) => m && m.role === 'user');
    delta = 'User:\n' + String((lastUser && lastUser.content) || '').slice(0, MAX_PROMPT);
  }

  if (fresh) await newChatInternal(wc);

  const chunks = [];
  if (fresh && system) chunks.push('[Instructions]\n' + String(system).slice(0, 6000));
  chunks.push(delta);
  const proto = protocolBlock(tools);
  if (proto) chunks.push(proto);
  let promptText = chunks.join('\n\n');
  if (promptText.length > MAX_PROMPT) promptText = promptText.slice(-MAX_PROMPT);

  await typePrompt(wc, promptText);
  await clickSend(wc);

  let lastText = '';
  let stable = 0;
  const t0 = Date.now();
  for (;;) {
    if (signal && signal.aborted) {
      await evaluate(wc, JS_CLICK_STOP).catch(() => {});
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    await sleep(450);
    const st = await pageState(wc).catch(() => null);
    if (!st) continue;
    if (st.text && st.text !== lastText) {
      if (st.text.startsWith(lastText)) {
        const d = st.text.slice(lastText.length);
        if (d && onDelta) onDelta(d);
      } else if (onDelta) {
        // Response regenerated/replaced — can't retract what we already sent.
        onDelta('\n' + st.text);
      }
      lastText = st.text;
      stable = 0;
    } else if (lastText && !st.busy) {
      stable += 1;
    }
    if (lastText && !st.busy && stable >= 3) break; // ~1.3s unchanged = done
    if (Date.now() - t0 > ANSWER_TIMEOUT_MS) {
      throw new Error(
        'Gemini se jawab nahi aaya (5 min timeout). Page check karo — shayad sign-in ya CAPTCHA maang raha hai.' +
          (st.body ? ' Page: ' + st.body.slice(0, 200) : '')
      );
    }
  }

  threads.set(key, { cursor: msgs.length });
  return lastText.trim();
}

/** Serialize prompts — the web page can only do one at a time. */
function prompt(args) {
  const run = () => runPrompt(args);
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/* --------------------------------- api --------------------------------- */

function resetThreads() {
  threads.clear();
}

async function newChat() {
  const wc = wcOrThrow();
  resetThreads();
  await newChatInternal(wc);
  return status();
}

async function status() {
  const out = { webContentsId: wcId, ok: false, url: null, hasEditor: false, busy: false, threads: threads.size };
  try {
    const wc = wcOrThrow();
    out.url = wc.getURL();
    const st = await pageState(wc);
    out.ok = true;
    out.url = st.url || out.url;
    out.hasEditor = !!st.hasEditor;
    out.busy = !!st.busy;
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}

module.exports = {
  setWebContentsId,
  clearWebContents,
  prompt,
  newChat,
  resetThreads,
  status,
  parseWebToolCalls,
  protocolBlock,
};
