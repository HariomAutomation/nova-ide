// End-to-end agent test: drives the running Nova IDE (CDP :9222) against the
// mock LLM. Verifies fs tools, terminal tool with approval flow, browser tool,
// grep search, terminal panel and search UI.
//
// Usage: node scripts/test-agent.mjs [cdpPort] [mockPort]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CDP_PORT = process.argv[2] ?? '9222';
const MOCK_PORT = Number(process.argv[3] ?? 9977);
const APP = decodeURIComponent(new URL('..', import.meta.url).pathname);
const TEST_DIR = '/tmp/opencode/nova-agent-test';

/* ---------------------------------- Preflight CDP Check ---------------------------------- */

let page = null;
try {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
  if (res.ok) {
    const list = await res.json();
    page = list.find((t) => t.type === 'page');
  }
} catch {}

if (!page) {
  console.error(`\n[Nova Test Preflight] Nova IDE is not running on CDP port ${CDP_PORT}.`);
  console.error('To run GUI tests, launch Nova IDE with remote debugging enabled:');
  console.error(`  npm start -- --remote-debugging-port=${CDP_PORT}`);
  console.error('\nIn headless environments without a display, run the headless test suite instead:');
  console.error('  npm run test:headless\n');
  process.exit(1);
}

/* ---------------------------- start mock server ---------------------------- */

fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });

const mock = spawn(process.execPath, [path.join(APP, 'scripts', 'mock-llm.mjs'), TEST_DIR, String(MOCK_PORT)], {
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

/* ---------------------------------- CDP ---------------------------------- */

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
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) {
    return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  }
  return r.result?.result?.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = `/tmp/opencode/${name}.png`;
  await fs.promises.writeFile(p, Buffer.from(r.result.data, 'base64'));
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------- configure the store --------------------------- */

const original = await evaljs(
  `({ models: window.__novaStore.getState().models, activeModelId: window.__novaStore.getState().activeModelId, rootFolder: window.__novaStore.getState().rootFolder, agentSettings: window.__novaStore.getState().agentSettings })`
);

await evaljs(
  `(() => {
     const st = window.__novaStore.getState();
     st.setTerminalOpen(true);
     st.newAgentChat();
     window.__novaStore.setState({
       models: [{ id: 'mock', label: 'Mock LLM', baseUrl: 'http://127.0.0.1:${MOCK_PORT}/v1', model: 'mock-model', apiKey: 'mock' }],
       activeModelId: 'mock',
     });
     st.patchAgentSettings({ autoApproveEdit: true, autoApproveTerminal: false, autoApproveBrowser: true, autoApproveComputer: false, maxSteps: 25 });
     return 'ok';
   })()`,
  false
);

// open the test workspace via the normal flow
await evaljs(`window.__novaStore.getState().openFolder(${JSON.stringify(TEST_DIR)}).then(() => 'ok')`);
await sleep(300);

/* ------------------------------- run the agent ------------------------------- */

const runId = Date.now();
await evaljs(`window.__novaStore.getState().agentSend('run the full tool test')`, false);

let sawApproval = false;
let approvedOnce = false;
let done = false;
const startedAt = Date.now();

while (Date.now() - startedAt < 120000) {
  await sleep(700);
  const state = await evaljs(
    `(() => {
       const s = window.__novaStore.getState();
       return {
         busy: s.agentBusy,
         items: s.agentItems.map((it) => ({ kind: it.kind, name: it.name, status: it.status, category: it.category, callId: it.callId, hasImage: !!(it.image && it.image.length > 1000), output: String(it.output || '').slice(0, 300), text: String(it.text || '').slice(-200) })),
       };
     })()`
  );
  if (state.__error) {
    console.error('eval error:', state.__error);
    break;
  }
  const awaiting = state.items.find((it) => it.status === 'awaiting');
  if (awaiting) {
    sawApproval = true;
    if (!approvedOnce) {
      approvedOnce = true;
      await evaljs(
        `window.__novaStore.getState().agentApprove(${JSON.stringify(awaiting.callId)}, true, false)`,
        false
      );
    }
  }
  const final = [...state.items].reverse().find((it) => it.kind === 'assistant' && it.text.includes('MOCK-DONE'));
  if (!state.busy && (final || state.items.some((it) => it.kind === 'error'))) {
    done = true;
    break;
  }
}
const elapsedMs = Date.now() - startedAt;

const items = await evaljs(
  `window.__novaStore.getState().agentItems.map((it) => ({ kind: it.kind, name: it.name, status: it.status, output: String(it.output || '').slice(0, 400), hasImage: !!(it.image && it.image.length > 1000), text: String(it.text || '').slice(-260) }))`
);

// scroll chat to bottom so the screenshot shows the full agent transcript
await evaljs(
  `(() => { const el = document.querySelector('.chat-messages'); if (el) el.scrollTop = el.scrollHeight; return 'ok'; })()`,
  false
);
await sleep(400);

const shot1 = await shot(`nova-agent-${runId}`);

/* --------------------------- terminal panel + search --------------------------- */

await evaljs(`window.__novaStore.getState().termRun('echo TERM-OK && pwd')`, false);
await sleep(2500);
const termState = await evaljs(
  `({ text: window.__novaStore.getState().termLines.map((l) => l.text).join('\\n').slice(-400), busy: window.__novaStore.getState().termBusy })`
);

await evaljs(`(window.__novaStore.getState().setSearchQuery('hello'), window.__novaStore.getState().runSearch())`, true);
await sleep(1500);
const searchState = await evaljs(
  `({ count: (window.__novaStore.getState().searchResults?.results || []).length, error: window.__novaStore.getState().searchResults?.error || null })`
);

/* ------------------------------- file checks ------------------------------- */

const helloPath = path.join(TEST_DIR, 'hello.txt');
const helloContent = fs.existsSync(helloPath) ? fs.readFileSync(helloPath, 'utf8') : null;
const artifactDir = path.join(os.homedir(), '.nova-ide', 'artifacts');
const artifacts = fs.existsSync(artifactDir) ? fs.readdirSync(artifactDir) : [];

/* --------------------------------- verdict --------------------------------- */

const checks = {
  saw_approval_request: sawApproval,
  wrote_hello_file: helloContent === 'hello from nova agent\nline2',
  ran_command: items.some((it) => it.name === 'run_terminal_cmd' && /MOCK-OK/.test(it.output || '')),
  browser_opened: items.some((it) => it.name === 'browser' && /Nova Test Page/.test(it.output || '')),
  browser_screenshot_image: items.some((it) => it.name === 'browser' && it.hasImage),
  grep_worked: items.some((it) => it.name === 'grep_search' && /hello\.txt/.test(it.output || '')),
  final_mock_done: items.some((it) => it.kind === 'assistant' && (it.text || '').includes('MOCK-DONE')),
  terminal_panel: /TERM-OK/.test(termState.text || ''),
  search_ui: (searchState.count || 0) >= 1,
  no_agent_errors: !items.some((it) => it.kind === 'error'),
};

/* --------------------------------- restore --------------------------------- */

await evaljs(
  `(() => {
     window.__novaStore.setState({ models: ${JSON.stringify(original.models)}, activeModelId: ${JSON.stringify(original.activeModelId)} });
     window.__novaStore.getState().patchAgentSettings(${JSON.stringify(original.agentSettings || {})});
     return window.__novaStore.getState().openFolder(${JSON.stringify(original.rootFolder)}, { silent: true }).then(() => 'ok');
   })()`
);
await evaljs(
  `(() => {
     const st = window.__novaStore.getState();
     st.chats.filter((c) => c.title === 'run the full tool test').forEach((c) => st.removeChat(c.id));
     st.newAgentChat();
     return 'ok';
   })()`,
  false
);
await evaljs(`window.__novaStore.getState().saveSettings()`, true);

const pass = Object.values(checks).every(Boolean);

console.log(
  JSON.stringify(
    {
      pass,
      elapsedMs,
      checks,
      helloContent,
      artifactsTail: artifacts.slice(-5),
      terminalTail: termState.text,
      search: searchState,
      items,
      screenshot: shot1,
    },
    null,
    2
  )
);

ws.close();
mock.kill();
process.exit(pass ? 0 : 1);
