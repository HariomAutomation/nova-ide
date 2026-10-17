const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const http = require('node:http');

const fsTools = require('./tools/fsTools');
const { runCommand } = require('./tools/terminal');
const browserTool = require('./tools/browser');
const computerTool = require('./tools/computer');
const checkpoints = require('./tools/checkpoints');
const gitTool = require('./tools/git');
const gdrive = require('./tools/gdrive');
const memory = require('./tools/memory');
const ghTool = require('./tools/github');
const { describeHttpError } = require('./tools/errors');
const { isWithin } = require('./tools/paths');
const mcp = require('./mcp');
const geminiWeb = require('./gemini-web');
const agent = require('./agent');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_SERVER = process.env.NOVA_DEV_SERVER || null;

const chromeVer = process.versions.chrome || '152.0.7977.167';
const plat = process.platform === 'win32'
  ? 'Windows NT 10.0; Win64; x64'
  : process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : 'X11; Linux x86_64';
const cleanUA = `Mozilla/5.0 (${plat}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
app.userAgentFallback = cleanUA;

if (process.env.CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.CDP_PORT));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

let win = null;
const aiControllers = new Map();

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#18191b',
    title: 'Nova IDE',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  // Gemini web tab lives in a <webview>; keep it locked down.
  win.webContents.on('will-attach-webview', (_e, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  win.on('closed', () => {
    win = null;
  });

  if (DEV_SERVER) {
    win.loadURL(DEV_SERVER);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadURL('app://nova/index.html');
  }
}

/* ------------------------------ automation webhook ------------------------------ */
// A tiny local HTTP listener so external tools can trigger an automation — the
// local equivalent of Cursor's /automations/webhook/. Bound to 127.0.0.1 only.
let webhookServer = null;
let webhookPort = null;

function startWebhookServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (req.method === 'GET' && url.pathname === '/automations/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
          return;
        }
        const m = /^\/automations\/webhook\/([A-Za-z0-9_-]{6,64})$/.exec(url.pathname);
        if (req.method !== 'POST' || !m) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end('{"error":"not found"}');
          return;
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 100000) req.destroy();
        });
        req.on('end', () => {
          send('automation:webhook', { token: m[1], body: body.slice(0, 10000) });
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        });
      } catch {
        try {
          res.writeHead(500);
          res.end();
        } catch {}
      }
    });
    server.on('error', () => resolve(null));
    server.listen(4599, '127.0.0.1', () => {
      webhookServer = server;
      webhookPort = server.address().port;
      resolve(webhookPort);
    });
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  startWebhookServer();

  try {
    const gemSession = session.fromPartition('persist:gemini');
    const chromeVer = process.versions.chrome || '152.0.0.0';
    const plat = process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64';
    const cleanUA = `Mozilla/5.0 (${plat}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';
    gemSession.setUserAgent(cleanUA);

    // Strip Chromium client hints and spoof Firefox for Google Accounts to bypass security block
    gemSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      if (/accounts\.google\.com|accounts\.youtube\.com/i.test(details.url)) {
        headers['User-Agent'] = FIREFOX_UA;
        delete headers['sec-ch-ua'];
        delete headers['sec-ch-ua-mobile'];
        delete headers['sec-ch-ua-platform'];
        delete headers['sec-ch-ua-full-version-list'];
        delete headers['sec-ch-ua-arch'];
        delete headers['sec-ch-ua-bitness'];
        delete headers['sec-ch-ua-model'];
      }
      callback({ cancel: false, requestHeaders: headers });
    });
  } catch {}

  protocol.handle('app', async (req) => {
    let rel = decodeURIComponent(new URL(req.url).pathname);
    if (!rel || rel === '/') rel = '/index.html';
    const abs = path.normalize(path.join(DIST, rel));
    // Component-boundary containment: a naive `startsWith(DIST)` would also
    // accept a sibling like `/…/dist-evil`.
    if (!isWithin(DIST, abs)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      await fs.access(abs);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(abs).toString());
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    mcp.shutdown();
  } catch {}
  try {
    if (webhookServer) webhookServer.close();
  } catch {}
});

const send = (channel, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
};

/* ------------------------------ settings ------------------------------ */

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function writeSettings(obj) {
  await fs.writeFile(settingsPath(), JSON.stringify(obj, null, 2), 'utf8');
}

ipcMain.handle('settings:get', async () => readSettings());

ipcMain.handle('settings:set', async (_e, obj) => {
  const current = await readSettings();
  await writeSettings({ ...current, ...obj });
  return true;
});

/**
 * List models from any OpenAI-compatible endpoint (`GET {baseUrl}/models`).
 * Lets the user paste an API key, hit Fetch, and pick a model ID instead of
 * typing slugs by hand (Gemini 4, OpenCode Zen, OmniRoute, Sarvam, OpenRouter…).
 */
ipcMain.handle('models:list', async (_e, payload) => {
  const { baseUrl, apiKey, auth } = payload || {};
  const url = String(baseUrl || '').trim().replace(/\/+$/, '') + '/models';
  if (!/^https?:\/\//.test(url)) return { error: 'Enter a valid http(s) base URL first.' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}` };
    }
    const j = await res.json();
    const arr = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
    const raw = arr
      .map((m) => (typeof m === 'string' ? m : m && (m.id || m.name) ? String(m.id || m.name) : ''))
      .filter(Boolean)
      .map((s) => s.replace(/^models\//, '')); // Gemini-style "models/x" -> "x" (chat endpoint ka format)
    const models = [...new Set(raw)].slice(0, 400);
    return { models };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
});

// Chat-only ping used by the per-model connection test. The UI lists models via
// models:list instantly; this separate call verifies the key can actually chat.
// (Some endpoints list models without a usable key, e.g. Zen free tier; and
// Gemini free tier pings can take 20s+ server-side, so one combined call made
// the UI look stuck.)
ipcMain.handle('models:ping', async (_e, payload) => {
  const { baseUrl, apiKey, auth, model } = payload || {};
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return { error: 'Sahi http(s) base URL daalo pehle.' };
  const authHeaders = {};
  if (apiKey) authHeaders.Authorization = `Bearer ${apiKey}`;

  const chatModel = String(model || '').trim();
  if (!chatModel) return { error: 'Pehle model id daalo (ya list se pick karo).' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ model: chatModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) return { chatOk: true, chatModel };
    const body = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(body);
      msg += ` — ${j.error?.message || j.message || j.error || body.slice(0, 160)}`;
    } catch {
      msg += body ? ` — ${body.slice(0, 160)}` : '';
    }
    // OpenCode Zen FreeTierError ka friendly version
    if (/FreeTierError|only be used from within/i.test(body)) {
      msg = 'FreeTierError — Zen free tier sirf OpenCode app ke andar chalta hai. Nova me chalne ke liye opencode.ai se paid key lo.';
    }
    return { chatOk: false, chatError: msg };
  } catch (e) {
    return { models, chatOk: false, chatError: String(e.message || e) };
  }
});

/* ------------------------------ Gemini Web (jugaad provider) ------------------------------ */

ipcMain.on('gemini:wc-id', (_e, id) => geminiWeb.setWebContentsId(id));

ipcMain.handle('gemini:newChat', async () => {
  try {
    return { ok: true, status: await geminiWeb.newChat() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('gemini:status', async () => geminiWeb.status());

let geminiLoginWin = null;
function openGeminiLoginWindow(targetUrl) {
  if (geminiLoginWin && !geminiLoginWin.isDestroyed()) {
    geminiLoginWin.focus();
    return;
  }
  const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';
  const startUrl = targetUrl || 'https://accounts.google.com/ServiceLogin?service=wise&continue=https://gemini.google.com/app';

  geminiLoginWin = new BrowserWindow({
    width: 540,
    height: 720,
    parent: win && !win.isDestroyed() ? win : undefined,
    title: 'Sign in to Google — Nova IDE',
    autoHideMenuBar: true,
    webPreferences: {
      session: session.fromPartition('persist:gemini'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  let signedIn = false;

  geminiLoginWin.webContents.setUserAgent(FIREFOX_UA);
  geminiLoginWin.loadURL(startUrl);

  const checkRedirect = (_e, url) => {
    // Match on the HOST, not a substring. The sign-in URL itself carries
    // `continue=https://gemini.google.com/app`, so a substring test matched the
    // very first navigation and closed the window immediately — the popup
    // flashed and vanished before the user could log in.
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    if (host === 'gemini.google.com' || host.endsWith('.gemini.google.com')) {
      signedIn = true;
      setTimeout(() => {
        try {
          if (geminiLoginWin && !geminiLoginWin.isDestroyed()) {
            geminiLoginWin.close();
            geminiLoginWin = null;
          }
          send('gemini:signedIn', { ok: true, url });
        } catch {}
      }, 1200);
    }
  };

  geminiLoginWin.webContents.on('did-navigate', checkRedirect);
  geminiLoginWin.webContents.on('did-navigate-in-page', checkRedirect);

  geminiLoginWin.on('closed', () => {
    geminiLoginWin = null;
    // Only report success if we actually landed on the Gemini app; closing the
    // window (cancel) must not look like a successful sign-in.
    if (!signedIn) send('gemini:signedIn', { ok: false, cancelled: true });
  });
}

ipcMain.handle('gemini:openLoginWindow', async (_e, url) => {
  openGeminiLoginWindow(url);
  return { ok: true };
});

/* ------------------------------ filesystem ------------------------------ */

ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_e, defaultName) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName || 'untitled.txt' });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('fs:list', async (_e, dir) => fsTools.listDir(dir));

const MAX_READ = 5 * 1024 * 1024;

ipcMain.handle('fs:read', async (_e, file) => {
  const stat = await fs.stat(file);
  if (stat.size > MAX_READ) {
    return { content: '', truncated: true, size: stat.size };
  }
  const buf = await fs.readFile(file);
  if (buf.subarray(0, 4096).includes(0)) {
    return { content: '', binary: true, size: stat.size };
  }
  return { content: buf.toString('utf8'), size: stat.size };
});

ipcMain.handle('fs:write', async (_e, file, content) => {
  await fs.writeFile(file, content, 'utf8');
  return true;
});

ipcMain.handle('search:run', async (_e, payload) => {
  return fsTools.searchFiles({
    pattern: payload.pattern,
    dir: payload.dir,
    caseSensitive: !!payload.caseSensitive,
    maxResults: Math.min(payload.maxResults || 200, 500),
  });
});

/* ------------------------------ context & customization ------------------------------ */

ipcMain.handle('dialog:pickFiles', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

async function walkFiles(root, limit = 2000) {
  const out = [];
  const queue = [root];
  while (queue.length && out.length < limit) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (fsTools.IGNORE_DIRS.has(e.name)) continue;
        queue.push(p);
      } else if (e.isFile()) {
        out.push(p);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

ipcMain.handle('workspace:files', async (_e, root) => {
  if (!root || typeof root !== 'string') return [];
  return walkFiles(root);
});

const SKILLS_DIR = path.join(os.homedir(), '.nova-ide', 'skills');

async function listSkills() {
  let names = [];
  try {
    names = await fs.readdir(SKILLS_DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const file = path.join(SKILLS_DIR, n, 'SKILL.md');
    try {
      const txt = await fs.readFile(file, 'utf8');
      const nameM = /^name:\s*(.+)$/m.exec(txt);
      const descM = /^description:\s*(.+)$/m.exec(txt);
      const st = await fs.stat(file);
      out.push({
        id: n,
        name: nameM ? nameM[1].trim() : n,
        description: descM ? descM[1].trim() : '',
        path: file,
        updatedAt: st.mtimeMs,
      });
    } catch {}
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

ipcMain.handle('skills:list', async () => listSkills());

ipcMain.handle('skills:new', async (_e, rawName) => {
  const safe =
    String(rawName || 'my-skill')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'my-skill';
  const dir = path.join(SKILLS_DIR, safe);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(
      file,
      `---\nname: ${safe}\ndescription: Describe when the agent should use this skill.\n---\n\n# ${safe}\n\nWrite your instructions here. Nova shows this skill's name and description to the agent,\nand the agent reads this file when a task matches.\n`,
      'utf8'
    );
  }
  return { id: safe, name: safe, path: file };
});

/* ------------------------------ MCP ------------------------------ */

ipcMain.handle('mcp:status', async () => mcp.status());
ipcMain.handle('mcp:reload', async () => mcp.reload());

/* ------------------------------ addons (REA, LeanToken) ------------------------------ */

const MCP_CONFIG = mcp.CONFIG_PATH;

// --- Portability helpers -----------------------------------------------------
// These used to be hard-coded to one developer's machine (Debian's npx path,
// a fixed Ghidra dir and JDK). Resolve them instead: honour an env override,
// then fall back to a known location only if it actually exists. That keeps the
// original machine working while letting everyone else run the addons too.
const nodeFs = require('node:fs');

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && nodeFs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function resolveNpxCli() {
  if (process.env.NOVA_NPX_CLI) return process.env.NOVA_NPX_CLI;
  return firstExisting([
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    '/usr/share/nodejs/npm/bin/npx-cli.js',
    '/usr/lib/node_modules/npm/bin/npx-cli.js',
    '/usr/local/lib/node_modules/npm/bin/npx-cli.js',
  ]);
}

function resolveEnvPath(key, fallbacks = []) {
  if (process.env[key]) return process.env[key];
  return firstExisting(fallbacks);
}

const NPX_CLI = resolveNpxCli();

const ADDONS = {
  rea: {
    name: 'REA — Reverse Engineer Anything',
    description:
      'Native, managed, Electron, firmware and browser targets: Ghidra, Frida sessions, strings, decompile, memory analysis — 200+ tools.',
    site: 'https://github.com/morluto/rea',
    server: {
      command: 'npx',
      args: ['-y', 'rea-agents@6.5.0', 'mcp'],
      env: {
        GHIDRA_INSTALL_DIR: resolveEnvPath('GHIDRA_INSTALL_DIR', [
          '/home/hariom/tools/ghidra_12.1.4_PUBLIC',
          path.join(os.homedir(), 'tools', 'ghidra_12.1.4_PUBLIC'),
        ]),
        JAVA_HOME: resolveEnvPath('JAVA_HOME', ['/usr/lib/jvm/java-21-openjdk-amd64']),
      },
      exposeTools: 'auto',
    },
  },
  leantoken: {
    name: 'LeanToken',
    description:
      'Token-bounded repo exploration: outlines, exact reads, search, history — keeps the agent context small so token use stays low.',
    site: 'https://github.com/morluto/leantoken',
    server: {
      command: process.execPath,
      args: NPX_CLI
        ? [NPX_CLI, '--yes', '--prefer-offline', '--package=leantoken@0.1.28', '--', 'leantoken', '--managed-by-setup', 'mcp']
        : ['--yes', '--prefer-offline', '--package=leantoken@0.1.28', '--', 'leantoken', '--managed-by-setup', 'mcp'],
      // Fall back to the `npx` shim when we could not locate npx-cli.js.
      ...(NPX_CLI ? {} : { command: 'npx' }),
      cwd: os.homedir(),
      exposeTools: 'auto',
    },
  },
  penpot: {
    name: 'Penpot \u2014 design \u2194 code',
    description:
      'Free & open-source design tool (no paywall). Reads the Penpot page you have focused so the agent can turn designs into code. Remote MCP: paste the URL from Penpot \u2192 Your account \u2192 Integrations \u2192 MCP Server. Local MCP: run `npx @penpot/mcp@latest` and load the plugin, then use the default URL.',
    site: 'https://penpot.app/penpot-vs-figma',
    needsUrl: true,
    defaultUrl: 'http://localhost:4401/mcp',
    server: {
      command: 'npx',
      args: ['-y', 'mcp-remote', 'http://localhost:4401/mcp', '--allow-http'],
      exposeTools: 'auto',
    },
  },
};

async function readMcpConfig() {
  try {
    const raw = await fs.readFile(MCP_CONFIG, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch {
    return {};
  }
}

async function writeMcpConfig(cfg) {
  await fs.mkdir(path.dirname(MCP_CONFIG), { recursive: true });
  await fs.writeFile(MCP_CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
}

async function addonsStatus() {
  const cfg = await readMcpConfig();
  const servers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
  let live = { servers: [] };
  try {
    live = await mcp.status();
  } catch {}
  const liveByName = new Map((live.servers || []).map((s) => [s.name, s]));
  return {
    configPath: MCP_CONFIG,
    addons: Object.entries(ADDONS).map(([id, a]) => {
      const enabled = !!servers[id] && servers[id].enabled !== false;
      const lv = liveByName.get(id);
      return {
        id,
        name: a.name,
        description: a.description,
        site: a.site,
        enabled,
        state: enabled ? (lv ? lv.state : 'stopped') : 'disabled',
        toolCount: enabled && lv && lv.tools ? lv.tools.length : 0,
        bridge: enabled && lv ? !!lv.bridge : false,
        error: enabled && lv ? lv.error : null,
        needsUrl: !!a.needsUrl,
        defaultUrl: a.defaultUrl || null,
        url: (servers[id] && servers[id].penpotUrl) || null,
      };
    }),
  };
}

ipcMain.handle('addons:status', async () => addonsStatus());

ipcMain.handle('addons:toggle', async (_e, { id, enable, url }) => {
  const addon = ADDONS[id];
  if (!addon) return { error: 'Unknown addon' };
  const cfg = await readMcpConfig();
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
  if (enable) {
    const server = JSON.parse(JSON.stringify(addon.server));
    if (addon.needsUrl) {
      const u = String(url || addon.defaultUrl || '').trim();
      if (!u) {
        return { error: 'Is addon ke liye MCP server URL chahiye (Penpot -> Your account -> Integrations -> MCP Server se copy karo).' };
      }
      // Nova's MCP client speaks stdio; mcp-remote proxies stdio -> HTTP/SSE.
      server.args = ['-y', 'mcp-remote', u, '--allow-http'];
      server.penpotUrl = u;
    }
    cfg.mcpServers[id] = server;
  } else {
    delete cfg.mcpServers[id];
  }
  await writeMcpConfig(cfg);
  try {
    await mcp.reload();
  } catch {}
  return addonsStatus();
});

/* ------------------------------ source control (git) ------------------------------ */

ipcMain.handle('git:status', async (_e, { cwd }) => gitTool.status(cwd));
ipcMain.handle('git:diff', async (_e, { cwd, path, staged }) => gitTool.diff(cwd, path, staged));
ipcMain.handle('git:stage', async (_e, { cwd, paths }) => gitTool.stage(cwd, paths));
ipcMain.handle('git:unstage', async (_e, { cwd, paths }) => gitTool.unstage(cwd, paths));
ipcMain.handle('git:commit', async (_e, { cwd, message }) => gitTool.commit(cwd, message));
ipcMain.handle('git:branches', async (_e, { cwd }) => gitTool.branches(cwd));
ipcMain.handle('git:checkout', async (_e, { cwd, branch }) => gitTool.checkout(cwd, branch));
ipcMain.handle('git:push', async (_e, { cwd }) => gitTool.push(cwd));
ipcMain.handle('git:pull', async (_e, { cwd }) => gitTool.pull(cwd));
ipcMain.handle('git:log', async (_e, { cwd, limit }) => gitTool.log(cwd, limit));
ipcMain.handle('git:worktreeAdd', async (_e, { cwd, path: dir, branch }) => gitTool.worktreeAdd(cwd, dir, branch));
ipcMain.handle('git:worktreeList', async (_e, { cwd }) => gitTool.worktreeList(cwd));

/* ------------------------------ github ------------------------------ */

ipcMain.handle('github:status', async () => ghTool.status());
ipcMain.handle('github:save', async (_e, { token }) => ghTool.save(token));
ipcMain.handle('github:logout', async () => ghTool.logout());
ipcMain.handle('github:repos', async (_e, { query }) => {
  try {
    return await ghTool.listRepos(query);
  } catch (e) {
    return { error: String((e && e.message) || e), repos: [] };
  }
});
ipcMain.handle('github:clone', async (_e, { cloneUrl, name }) => ghTool.clone(cloneUrl, name));

/* ------------------------------ memory ------------------------------ */

ipcMain.handle('memory:list', async () => memory.list());
ipcMain.handle('memory:add', async (_e, { text, source }) => memory.add(text, source));
ipcMain.handle('memory:update', async (_e, { id, patch }) => memory.update(id, patch));
ipcMain.handle('memory:remove', async (_e, { id }) => memory.remove(id));
ipcMain.handle('memory:set', async (_e, { notes }) => memory.setNotes(notes));
ipcMain.handle('memory:setAccount', async (_e, { account }) => memory.setAccount(account));
ipcMain.handle('memory:clear', async () => memory.clear());

/* ------------------------------ cloud (google drive) ------------------------------ */

ipcMain.handle('gdrive:status', async () => gdrive.status());
ipcMain.handle('gdrive:save', async (_e, patch) => gdrive.save(patch || {}));
ipcMain.handle('gdrive:login', async () => {
  try {
    return { ok: true, status: await gdrive.login() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle('gdrive:logout', async () => ({ ok: true, status: await gdrive.logout() }));
ipcMain.handle('gdrive:last-url', () => ({ url: gdrive.getLastAuthUrl() }));
ipcMain.handle('gdrive:list', async (_e, { query }) => {
  try {
    return await gdrive.listFiles(query);
  } catch (e) {
    return { error: String((e && e.message) || e), files: [] };
  }
});
ipcMain.handle('gdrive:read', async (_e, { id }) => {
  try {
    return await gdrive.readFile(id);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
});
ipcMain.handle('gdrive:memoryPull', async () => {
  try {
    return await gdrive.readMemory();
  } catch (e) {
    return { error: String((e && e.message) || e), notes: [] };
  }
});
ipcMain.handle('gdrive:memoryPush', async (_e, { notes }) => {
  try {
    return await gdrive.writeMemory(notes);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
});
ipcMain.handle('gdrive:download', async (_e, { id, dest }) => {
  try {
    return await gdrive.downloadFile(id, dest);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
});

/* ------------------------------ checkpoints ------------------------------ */

ipcMain.handle('checkpoint:restore', async (_e, { agentId }) => {
  const r = await checkpoints.restore(agentId);
  for (const item of r.restored) {
    if (item.action === 'restored' || item.action === 'deleted') send('fs:changed', { path: item.path });
  }
  return r;
});

/* ------------------------------ user terminal ------------------------------ */

const termSeq = { n: 0 };

ipcMain.handle('term:run', async (_e, { command, cwd }) => {
  const termId = `term_${++termSeq.n}`;
  send('term:start', { termId, command, cwd });
  runCommand({
    command,
    cwd,
    timeoutMs: 600000,
    onData: ({ stream, text }) => send('term:data', { termId, stream, text }),
  })
    .then((r) => {
      send('term:exit', { termId, code: r.code, timedOut: r.timedOut, signal: r.signal });
    })
    .catch((err) => {
      send('term:exit', { termId, code: -1, error: String(err.message || err) });
    });
  return { termId };
});

/* ------------------------------ agent ------------------------------ */

ipcMain.handle('agent:start', async (_e, payload) => {
  agent
    .runAgent({
      agentId: payload.agentId,
      config: payload.config,
      workspaceRoot: payload.workspaceRoot,
      userText: payload.userText,
      settings: payload.settings || {},
      contextNote: payload.contextNote,
      history: payload.history,
      send: (event) => send('agent:event', event),
      notifyFsChanged: (p) => send('fs:changed', { path: p }),
    })
    .catch((e) => {
      send('agent:event', {
        agentId: payload.agentId,
        type: 'error',
        message: String(e.message || e),
      });
    });
  return { started: true };
});

ipcMain.handle('agent:stop', async (_e, { agentId }) => {
  agent.stopAgent(agentId);
  return true;
});

ipcMain.handle('agent:approve', async (_e, { agentId, callId, allow }) => {
  return agent.resolveApproval(agentId, callId, !!allow);
});

ipcMain.handle('agent:new', async (_e, { agentId }) => {
  agent.resetAgent(agentId);
  return true;
});

/* ------------------------------ browser ------------------------------ */

ipcMain.handle('browser:status', async () => browserTool.status());

ipcMain.handle('browser:reset', async () => {
  await browserTool.closeAll();
  return browserTool.status();
});

ipcMain.handle('browser:test', async () => {
  try {
    const r = await browserTool.act('open', {
      url: 'data:text/html,<title>Nova Browser</title><body style="background:%2318191b;color:%23d6d7d9;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><h1>Nova browser works</h1><p>Playwright Chromium is running.</p></body>',
    }, { headless: true, artifactsDir: path.join(os.homedir(), '.nova-ide', 'artifacts') });
    const shot = await browserTool.act('screenshot', {}, { headless: true, artifactsDir: path.join(os.homedir(), '.nova-ide', 'artifacts') });
    const buf = await fs.readFile(shot.file);
    return { ok: true, title: r.title, image: 'data:image/png;base64,' + buf.toString('base64') };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

/* ------------------------------ computer ------------------------------ */

ipcMain.handle('computer:status', async () => computerTool.detect());

ipcMain.handle('computer:screenshot', async () => {
  try {
    const dir = path.join(os.homedir(), '.nova-ide', 'artifacts');
    const r = await computerTool.screenshotToFile(dir);
    const buf = await fs.readFile(r.file);
    return { ok: true, method: r.method, image: 'data:image/png;base64,' + buf.toString('base64') };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

/* ------------------------------ misc ------------------------------ */

ipcMain.handle('app:info', async () => ({
  nova: '0.2.0',
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  os: `${os.type()} ${os.release()}`,
  home: os.homedir(),
  platform: process.platform,
  username: (() => {
    try {
      return os.userInfo().username;
    } catch {
      return 'user';
    }
  })(),
  hostname: os.hostname(),
  webhook: { port: webhookPort, base: webhookPort ? `http://127.0.0.1:${webhookPort}` : '' },
}));

ipcMain.handle('app:openExternal', async (_e, url) => {
  if (/^https?:\/\//.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('app:openPath', async (_e, p) => {
  if (typeof p !== 'string' || !p) return { ok: false };
  const err = await shell.openPath(p);
  return { ok: !err, error: err || null };
});

/* ------------------------------ AI streaming (ask mode) ------------------------------ */

ipcMain.handle('ai:chat', async (_e, payload) => {
  const { chatId, config, messages } = payload;
  const ac = new AbortController();
  aiControllers.set(chatId, ac);

  try {
    // Gemini Web provider: drive the signed-in gemini.google.com tab instead
    // of an HTTP endpoint. Same chat surface as any other model.
    if (config.auth === 'gemini-web') {
      const sys = messages.find((m) => m && m.role === 'system');
      const text = await geminiWeb.prompt({
        threadKey: `chat:${chatId}`,
        system: sys && typeof sys.content === 'string' ? sys.content : '',
        messages,
        onDelta: (d) => send('ai:chunk', { chatId, delta: d }),
        signal: ac.signal,
      });
      if (!text) throw new Error('Gemini ne khali jawab diya — dobara try karo.');
      send('ai:done', { chatId });
      return;
    }

    const base = String(config.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('No base URL configured for this model.');
    const url = base + '/chat/completions';

    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    if (/openrouter\.ai/.test(base)) {
      headers['HTTP-Referer'] = 'https://nova-ide.local';
      headers['X-Title'] = 'Nova IDE';
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: ac.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: config.temperature ?? 0.2,
      }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(describeHttpError(url, res.status, res.statusText, text));
    }

    const decoder = new TextDecoder();
    let buf = '';

    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          send('ai:done', { chatId });
          return;
        }
        try {
          const j = JSON.parse(data);
          if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
          const delta = j.choices?.[0]?.delta?.content ?? '';
          if (delta) send('ai:chunk', { chatId, delta });
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }
    send('ai:done', { chatId });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      send('ai:done', { chatId, aborted: true });
    } else {
      send('ai:error', { chatId, message: String((err && err.message) || err) });
    }
  } finally {
    aiControllers.delete(chatId);
  }
});

ipcMain.handle('ai:abort', async (_e, chatId) => {
  const ac = aiControllers.get(chatId);
  if (ac) ac.abort();
  return true;
});
