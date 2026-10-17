// Ask-panel e2e: drives the running Nova IDE (CDP :9222) against the bundled
// mock LLM, typing into the right-hand Ask panel like a real user would.
//
// Usage: node scripts/test-ask.mjs [cdpPort] [mockPort]
import { spawn } from 'node:child_process';
import path from 'node:path';

const CDP_PORT = process.argv[2] ?? '9222';
const MOCK_PORT = Number(process.argv[3] ?? 9978);
const APP = decodeURIComponent(new URL('..', import.meta.url).pathname);

const mock = spawn(process.execPath, [path.join(APP, 'scripts', 'mock-llm.mjs'), '/tmp/opencode/nova-ask-test', String(MOCK_PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('mock llm did not start')), 8000);
  mock.stdout.on('data', (d) => {
    if (String(d).includes('mock-llm-ready')) {
      clearTimeout(to);
      resolve();
    }
  });
  mock.on('error', reject);
});

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('no page target on', CDP_PORT);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).res(m);
    pending.delete(m.id);
  }
};
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

function send(method, params = {}) {
  return new Promise((res) => {
    const mid = ++id;
    pending.set(mid, { res });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evaljs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) {
    return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  }
  return r.result?.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const original = await evaljs(
  `({ models: window.__novaStore.getState().models, activeModelId: window.__novaStore.getState().activeModelId })`
);

await evaljs(`(() => {
  const st = window.__novaStore.getState();
  st.setChatVisible(true);
  st.newAskChat();
  window.__novaStore.setState({
    models: [{ id: 'mock', label: 'Mock LLM', baseUrl: 'http://127.0.0.1:${MOCK_PORT}/v1', model: 'mock-model', apiKey: 'mock' }],
    activeModelId: 'mock',
  });
  return 'ok';
})()`);
await sleep(300);

// Type into the Ask panel textarea exactly like a user (native setter + input event).
const typed = await evaljs(`(() => {
  const el = document.querySelector('.chat-panel .chat-input');
  if (!el) return { __error: 'Ask panel textarea not found' };
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  setter.call(el, 'hello from the ask test');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return { value: el.value };
})()`);

// Click the Send button.
const clicked = await evaljs(`(() => {
  const btn = document.querySelector('.chat-panel .chat-actions .btn.primary');
  if (!btn) return { __error: 'Send button not found' };
  btn.click();
  return { clicked: true };
})()`);

// Wait for the streamed reply to arrive.
let reply = null;
const started = Date.now();
while (Date.now() - started < 20000) {
  await sleep(400);
  const state = await evaljs(
    `({ msgs: window.__novaStore.getState().messages.map((m) => ({ role: m.role, content: m.content })), busy: window.__novaStore.getState().chatBusy })`
  );
  const asst = [...(state.msgs || [])].reverse().find((m) => m.role === 'assistant' && m.content);
  if (asst) {
    reply = { count: state.msgs.length, last: asst.content, busy: state.busy };
    if (!state.busy) break;
  }
}

const uiVisible = await evaljs(`(() => {
  const panel = document.querySelector('.chat-panel');
  return { open: !!panel, rendered: panel ? panel.innerText.slice(0, 300) : '' };
})()`);

/* --------------------------------- restore --------------------------------- */

await evaljs(`(() => {
  const st = window.__novaStore.getState();
  window.__novaStore.setState({ models: ${JSON.stringify(original.models)}, activeModelId: ${JSON.stringify(original.activeModelId)} });
  st.newAskChat();
  st.setChatVisible(false);
  return 'ok';
})()`);
await evaljs(`window.__novaStore.getState().saveSettings()`, true);

const checks = {
  typed: typed?.value === 'hello from the ask test',
  clicked: !!clicked?.clicked,
  got_reply: !!reply && /ASK-MODE-OK/.test(reply.last || ''),
  not_busy_after: reply ? reply.busy === false : false,
  panel_rendered: !!uiVisible?.open && /hello from the ask test/.test(uiVisible.rendered || ''),
};
const pass = Object.values(checks).every(Boolean);

console.log(JSON.stringify({ pass, checks, typed, clicked, reply, uiVisible }, null, 2));

ws.close();
mock.kill();
process.exit(pass ? 0 : 1);
