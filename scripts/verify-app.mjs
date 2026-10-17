// Passive verification of the running Nova IDE window through CDP.
// Usage: node scripts/verify-app.mjs [port]
const port = process.argv[2] ?? '9222';
const fs = await import('node:fs');

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && !String(t.url).includes('devtools'));
if (!page) {
  console.error('NO PAGE TARGET at', port, JSON.stringify(list.map((t) => ({ type: t.type, url: t.url }))));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const exceptions = [];

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).res(m.result);
    pending.delete(m.id);
  } else if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(
      m.params?.exceptionDetails?.exception?.description ||
        m.params?.exceptionDetails?.text ||
        'unknown exception'
    );
  }
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

await send('Runtime.enable');
await send('Page.enable');
await new Promise((r) => setTimeout(r, 700));

const title = await send('Runtime.evaluate', { expression: 'document.title' });
const rootText = await send('Runtime.evaluate', {
  expression: "(document.querySelector('#root') || {}).innerText || ''",
});
const errors = await send('Runtime.evaluate', { expression: 'window.__novaErrors || []' });

let shot = null;
try {
  shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.promises.writeFile('/tmp/opencode/nova-screenshot.png', Buffer.from(shot.data, 'base64'));
} catch (e) {
  // ignore screenshot failure
}

console.log(
  JSON.stringify(
    {
      title: title.result?.value,
      rootPreview: String(rootText.result?.value || '').slice(0, 600),
      windowErrors: errors.result?.value,
      runtimeExceptions: exceptions,
      screenshot: shot ? '/tmp/opencode/nova-screenshot.png' : null,
    },
    null,
    2
  )
);
ws.close();
