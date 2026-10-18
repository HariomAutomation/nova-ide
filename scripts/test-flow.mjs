// Functional smoke test: drives the running Nova IDE via CDP + __novaStore debug hook.
// Usage: node scripts/test-flow.mjs [port]
const port = process.argv[2] ?? '9222';
const fs = await import('node:fs');
const APP = decodeURIComponent(new URL('..', import.meta.url).pathname);

let page = null;
try {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
  if (res.ok) {
    const list = await res.json();
    page = list.find((t) => t.type === 'page');
  }
} catch {}

if (!page) {
  console.error(`\n[Nova Test Preflight] Nova IDE is not running on CDP port ${port}.`);
  console.error('To run GUI smoke tests, launch Nova IDE with remote debugging enabled:');
  console.error(`  npm start -- --remote-debugging-port=${port}`);
  console.error('\nIn headless environments without a display, run the headless test suite instead:');
  console.error('  npm run test:headless\n');
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

async function evaljs(expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (r.result?.exceptionDetails) {
    return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  }
  return r.result?.result?.value;
}

const path = await import('node:path');

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const dir = '/tmp/opencode';
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = `${dir}/${name}.png`;
  await fs.promises.writeFile(filePath, Buffer.from(r.result.data, 'base64'));
  return filePath;
}

const steps = {};

// 1. open the nova-ide folder itself
steps.openFolder = await evaljs(`window.__novaStore.getState().openFolder(${JSON.stringify(APP)}).then(() => 'ok')`);
steps.rootFolder = await evaljs(`window.__novaStore.getState().rootFolder`);
steps.rootChildren = await evaljs(
  `(window.__novaStore.getState().childrenByDir[window.__novaStore.getState().rootFolder]||[]).map(e => e.name)`
);

// 2. open README.md
steps.openFile = await evaljs(
  `window.__novaStore.getState().openFile(${JSON.stringify(path.join(APP, 'README.md'))}).then(() => 'ok')`
);
steps.tabs = await evaljs(`window.__novaStore.getState().tabs.map(t => ({name: t.name, lang: t.language, len: t.content.length}))`);
steps.shot1 = await shot('nova-open-file');

// 3. type into the file (simulate edit) -> dirty flag
await evaljs(
  `(() => { const st = window.__novaStore.getState(); st.updateActiveContent(st.tabs[0].content + '\\n<!-- edited by smoke test -->'); return 'ok'; })()`,
  false
);
steps.dirty = await evaljs(`window.__novaStore.getState().tabs[0].dirty`);

// 4. open settings modal & add a preset model (DeepSeek) without saving
steps.settings = await evaljs(`(window.__novaStore.getState().setSettingsOpen(true), 'ok')`, false);
await new Promise((r) => setTimeout(r, 300));
steps.shot2 = await shot('nova-settings');

// 5. close modal
await evaljs(`(window.__novaStore.getState().setSettingsOpen(false), 'ok')`, false);

// 6. AI error path: invalid base URL must produce an ai:error without crashing
steps.aiErrorPath = await evaljs(
  `new Promise((resolve) => {
     const off = window.nova.onError((d) => { off(); resolve({ chatId: d.chatId, message: String(d.message).slice(0, 140) }); });
     window.nova.chat({ chatId: 'smoke_' + Date.now(), config: { baseUrl: 'http://127.0.0.1:9/v1', model: 'nope' }, messages: [{ role: 'user', content: 'ping' }] });
     setTimeout(() => resolve({ timeout: true }), 8000);
   })`
);

const pass =
  steps.openFolder === 'ok' &&
  Array.isArray(steps.tabs) &&
  steps.tabs.length > 0 &&
  steps.dirty === true &&
  steps.aiErrorPath &&
  !steps.aiErrorPath.timeout;

console.log(JSON.stringify({ pass, steps }, null, 2));
ws.close();
process.exit(pass ? 0 : 1);
