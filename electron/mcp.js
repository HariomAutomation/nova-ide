'use strict';

/**
 * Minimal MCP (Model Context Protocol) client for Nova.
 * Reads server definitions from ~/.nova-ide/mcp.json:
 *   { "mcpServers": { "name": { "command": "npx", "args": ["-y", "..."], "env": {} } } }
 * Speaks newline-delimited JSON-RPC 2.0 over stdio.
 */

const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const CONFIG_PATH = path.join(os.homedir(), '.nova-ide', 'mcp.json');
const sessions = new Map();

async function readConfig() {
  try {
    const raw = await fsp.readFile(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' && cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
  } catch {
    return {};
  }
}

function write(proc, msg) {
  try {
    proc.stdin.write(JSON.stringify(msg) + '\n');
  } catch {}
}

function handleMessage(session, msg) {
  if (msg && msg.id !== undefined && session.pending.has(msg.id)) {
    const p = session.pending.get(msg.id);
    session.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }
}

function request(session, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = session.nextId++;
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`MCP request "${method}" timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    session.pending.set(id, { resolve, reject, timer, method });
    write(session.proc, { jsonrpc: '2.0', id, method, params: params || {} });
  });
}

function startServer(name, cfg) {
  const proc = spawn(cfg.command, Array.isArray(cfg.args) ? cfg.args : [], {
    cwd: cfg.cwd || os.homedir(),
    env: { ...process.env, ...(cfg.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session = {
    name,
    proc,
    nextId: 1,
    pending: new Map(),
    buf: '',
    tools: [],
    state: 'starting',
    error: null,
    stderr: '',
    serverInfo: null,
    cfg: cfg || {},
    lastAttempt: Date.now(),
  };
  sessions.set(name, session);

  proc.stdout.on('data', (chunk) => {
    session.buf += chunk.toString('utf8');
    let idx;
    while ((idx = session.buf.indexOf('\n')) >= 0) {
      const line = session.buf.slice(0, idx).trim();
      session.buf = session.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // servers sometimes print non-JSON logs on stdout — ignore
      }
      handleMessage(session, msg);
    }
  });
  proc.stderr.on('data', (chunk) => {
    session.stderr = (session.stderr + chunk.toString('utf8')).slice(-2000);
  });
  const failPending = (message) => {
    for (const [, p] of session.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    session.pending.clear();
  };
  proc.on('exit', (code, signal) => {
    if (session.state !== 'error') session.state = 'stopped';
    const msg = `MCP server "${name}" exited (${code ?? signal})`;
    session.error = session.error || msg;
    failPending(session.error);
  });
  proc.on('error', (err) => {
    session.state = 'error';
    session.error = `MCP server "${name}": ${err.message}`;
    failPending(session.error);
  });

  session.ready = (async () => {
    try {
      const res = await request(
        session,
        'initialize',
        { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'nova-ide', version: '0.2.0' } },
        20000
      );
      session.serverInfo = (res && res.serverInfo) || null;
      write(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      const toolsRes = await request(session, 'tools/list', {}, 20000);
      session.tools = Array.isArray(toolsRes && toolsRes.tools) ? toolsRes.tools : [];
      session.state = 'running';
      session.error = null;
    } catch (e) {
      session.state = 'error';
      session.error = String(e.message || e);
    }
  })();
  return session;
}

async function ensureServers() {
  const cfg = await readConfig();

  for (const name of [...sessions.keys()]) {
    if (!cfg[name]) {
      const s = sessions.get(name);
      try {
        s.proc.kill();
      } catch {}
      sessions.delete(name);
    }
  }

  const now = Date.now();
  for (const [name, c] of Object.entries(cfg)) {
    if (!c || !c.command || c.enabled === false) continue;
    const existing = sessions.get(name);
    if (existing) {
      if (existing.state !== 'stopped' && existing.state !== 'error') continue;
      // Do not continuously restart failing servers on every prompt turn (60s cooldown)
      if (existing.state === 'error' && now - (existing.lastAttempt || 0) < 60000) continue;
      try {
        existing.proc.kill();
      } catch {}
      sessions.delete(name);
    }
    startServer(name, c);
  }

  await Promise.all([...sessions.values()].map((s) => s.ready));
  return sessions;
}

let cachedTools = null;
let lastToolsFetch = 0;

/**
 * All tools across running servers.
 * `exposed` tells the agent whether the tool schema should be sent to the
 * model directly. Big servers (40+ tools, e.g. REA with 200+) use bridge
 * mode: their tools are hidden from the schema and discovered through the
 * mcp_list_tools tool, which keeps every request small (token friendly).
 */
async function tools(force = false) {
  const now = Date.now();
  if (!force && cachedTools && now - lastToolsFetch < 20000) {
    return cachedTools;
  }
  await ensureServers();
  const out = [];
  for (const s of sessions.values()) {
    if (s.state !== 'running') continue;
    const mode = (s.cfg && s.cfg.exposeTools) || 'auto';
    const exposed = mode === 'all' || (mode === 'auto' && s.tools.length <= 40);
    for (const t of s.tools) {
      out.push({
        server: s.name,
        name: t.name,
        description: t.description || '',
        schema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
        exposed,
      });
    }
  }
  cachedTools = out;
  lastToolsFetch = now;
  return out;
}

async function call(server, tool, args) {
  await ensureServers();
  const s = sessions.get(server);
  if (!s || s.state !== 'running') {
    return { ok: false, text: `MCP server "${server}" is not running${s && s.error ? `: ${s.error}` : '.'}` };
  }
  try {
    const res = await request(s, 'tools/call', { name: tool, arguments: args || {} }, 120000);
    const content = Array.isArray(res && res.content) ? res.content : [];
    const text = content.map((c) => (c && c.type === 'text' ? c.text : `[${(c && c.type) || 'unknown'}]`)).join('\n');
    return { ok: !(res && res.isError), text: text || JSON.stringify(res || {}).slice(0, 4000) };
  } catch (e) {
    return { ok: false, text: `MCP call failed (${server}/${tool}): ${e.message}` };
  }
}

async function status() {
  await ensureServers();
  let hasConfig = false;
  try {
    await fsp.access(CONFIG_PATH);
    hasConfig = true;
  } catch {}
  const servers = [...sessions.values()].map((s) => ({
    name: s.name,
    state: s.state,
    error: s.error || null,
    serverInfo: s.serverInfo,
    stderr: s.state === 'error' ? s.stderr.slice(-600) : undefined,
    bridge: ((s.cfg && s.cfg.exposeTools) || 'auto') === 'auto' && s.tools.length > 40,
    tools: (s.tools || []).map((t) => ({ name: t.name, description: (t.description || '').slice(0, 250) })),
  }));
  return { configPath: CONFIG_PATH, hasConfig, servers };
}

async function reload() {
  cachedTools = null;
  lastToolsFetch = 0;
  for (const s of sessions.values()) {
    try {
      s.proc.kill();
    } catch {}
  }
  sessions.clear();
  return status();
}

function shutdown() {
  cachedTools = null;
  lastToolsFetch = 0;
  for (const s of sessions.values()) {
    try {
      s.proc.kill();
    } catch {}
  }
  sessions.clear();
}

module.exports = { tools, call, status, reload, shutdown, CONFIG_PATH };
