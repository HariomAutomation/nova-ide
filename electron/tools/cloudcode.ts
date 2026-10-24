'use strict';

/**
 * Cloud Code provider — Gemini through the same backend Google Antigravity and
 * the Antigravity CLI use, authenticated with your own Google account.
 *
 * EXPERIMENTAL. This talks to an *undocumented* Google endpoint
 * (cloudcode-pa.googleapis.com). It is not a public API, it can change or stop
 * working at any time, and using it from a third-party client is a grey area in
 * Google's terms. A normal API key (AI Studio / OpenRouter) is the supported,
 * reliable route; this exists because it needs no key and uses your Google AI
 * Pro quota with real function calling and a large context window.
 *
 * Flow: Google OAuth (cloud-platform scope) -> loadCodeAssist to discover the
 * Cloud Code project -> generateContent with Gemini function declarations.
 */

const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const { configRoot } = require('./paths');

const CLIENT_ID =
  process.env.NOVA_GOOGLE_CLIENT_ID ||
  '695004570637-16f2oo3s60a0m93p7dt8hld3et8fqunp.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.NOVA_GOOGLE_CLIENT_SECRET || '';

/**
 * Desktop-app OAuth clients must send a client_secret at the token endpoint
 * ("client_secret is missing" otherwise). Reuse the one already saved for the
 * Drive/Cloud sign-in so it only has to be entered once.
 */
async function sharedClientSecret() {
  if (CLIENT_SECRET) return CLIENT_SECRET;
  for (const file of ['gdrive.json', 'cloudcode.json']) {
    try {
      const j = JSON.parse(await fsp.readFile(path.join(configDir(), file), 'utf8'));
      if (j && j.clientSecret) return j.clientSecret;
    } catch {}
  }
  return '';
}

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const API = 'https://cloudcode-pa.googleapis.com/v1internal';
const META = { pluginType: 'GEMINI' };

const DEFAULT_MODEL = 'gemini-3-pro-preview';

function configDir() {
  return configRoot();
}
function configPath() {
  return path.join(configDir(), 'cloudcode.json');
}

async function readCfg() {
  try {
    const j = JSON.parse(await fsp.readFile(configPath(), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}
async function writeCfg(c) {
  await fsp.mkdir(configDir(), { recursive: true });
  await fsp.writeFile(configPath(), JSON.stringify(c, null, 2), 'utf8');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let cache = { token: null, exp: 0 };
let lastAuthUrl = null;
function getLastAuthUrl() {
  return lastAuthUrl;
}

async function status() {
  const c = await readCfg();
  return {
    connected: !!c.refreshToken,
    email: c.email || null,
    name: c.name || null,
    picture: c.picture || null,
    project: c.project || null,
    model: c.model || DEFAULT_MODEL,
    // The OAuth client id embeds the project number, so the "enable this API"
    // link can always point at the right project.
    projectNumber: (CLIENT_ID.split('-')[0] || '').trim() || null,
    hasClient: !!CLIENT_ID,
    configPath: configPath(),
  };
}

async function saveModel(model) {
  const c = await readCfg();
  if (model) c.model = String(model).trim();
  await writeCfg(c);
  return status();
}

async function getAccessToken() {
  if (cache.token && Date.now() < cache.exp) return cache.token;
  const c = await readCfg();
  if (!c.refreshToken) throw new Error('Cloud Code connected nahi hai — pehle sign in karo.');
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    refresh_token: c.refreshToken,
    grant_type: 'refresh_token',
  });
  const secret = await sharedClientSecret();
  if (secret) body.set('client_secret', secret);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(j.error_description || j.error || `token refresh failed (HTTP ${res.status})`);
  }
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000 };
  return cache.token;
}

async function apiCall(method, body) {
  const token = await getAccessToken();
  const res = await fetch(`${API}:${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'nove-ide/1.0 (cloudcode)',
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const msg = (json && (json.error?.message || json.error)) || text.slice(0, 300) || `HTTP ${res.status}`;
    const err = new Error(`Cloud Code ${method} failed: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json || {};
}

/** Discover (and if needed create) the Cloud Code project for this account. */
async function ensureProject() {
  const c = await readCfg();
  if (c.project) return c.project;

  const load = await apiCall('loadCodeAssist', {
    metadata: META,
    ...(c.project ? { cloudaicompanionProject: c.project } : {}),
  }).catch(async (e) => {
    // Some deployments reject "metadata"; retry with the bare body.
    if (/Unknown name "metadata"|Cannot find field/i.test(String(e.message || ''))) {
      return apiCall('loadCodeAssist', c.project ? { cloudaicompanionProject: c.project } : {});
    }
    throw e;
  });
  let project = load.cloudaicompanionProject || null;

  if (!project) {
    const tiers = Array.isArray(load.allowedTiers) ? load.allowedTiers : [];
    const tier =
      (load.currentTier && load.currentTier.id) ||
      (tiers.find((t) => t && t.isDefault) || tiers[0] || {}).id ||
      'free-tier';
    const op = await apiCall('onboardUser', { tierId: tier, metadata: META }).catch(async (e) => {
      if (/Unknown name "metadata"|Cannot find field/i.test(String(e.message || ''))) {
        return apiCall('onboardUser', { tierId: tier });
      }
      throw e;
    });
    // Long-running operation: poll until done.
    let opName = op && op.name;
    for (let i = 0; i < 30 && opName; i += 1) {
      if (op && op.done) break;
      await new Promise((r) => setTimeout(r, 2000));
      const polled = await apiCall(`operations/${String(opName).split('/').pop()}`, {}).catch(() => null);
      if (polled && polled.done) {
        project =
          (polled.response && (polled.response.cloudaicompanionProject || polled.response.project)) || project;
        break;
      }
      op = polled || op;
    }
    project =
      project ||
      (op && op.response && (op.response.cloudaicompanionProject || op.response.project)) ||
      null;
  }

  if (project) {
    const next = { ...(await readCfg()), project };
    await writeCfg(next);
  }
  return project;
}

/**
 * Available model ids (best effort - the endpoint is undocumented, so try a few
 * shapes and report the real reason if all fail).
 */
async function listModels() {
  const project = await ensureProject().catch(() => null);
  // This endpoint rejects unknown fields ("Unknown name metadata"), so send the
  // bare body shapes only - and it is the only method that exists (listModels
  // is a 404).
  const attempts = [
    { method: 'fetchAvailableModels', body: {} },
    { method: 'fetchAvailableModels', body: project ? { project } : {} },
  ];
  const errors = [];
  for (const a of attempts) {
    try {
      const j = await apiCall(a.method, a.body);
      const m = j && j.models;
      const out = [];
      if (Array.isArray(m)) {
        for (const x of m) out.push(typeof x === 'string' ? x : x && (x.name || x.id || x.model));
      } else if (m && typeof m === 'object') {
        for (const k of Object.keys(m)) {
          const v = m[k];
          out.push(v && (v.name || v.id) ? v.name || v.id : k);
        }
      }
      const list = out.filter(Boolean);
      if (list.length) return { models: list };
      errors.push(`${a.method}: reply me koi model nahi mila`);
    } catch (e) {
      errors.push(`${a.method}: ${String(e.message || e)}`);
    }
  }
  return { error: errors.join('  |  ') };
}

/* ------------------------------ message mapping ------------------------------ */

function toGeminiContents(messages) {
  const contents = [];
  const nameById = new Map();
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.role === 'system') continue;
    if (m.role === 'assistant') {
      const parts = [];
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const fn = tc && tc.function ? tc.function : {};
          if (tc && tc.id) nameById.set(tc.id, fn.name);
          let args = {};
          try {
            args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : fn.arguments || {};
          } catch {}
          parts.push({ functionCall: { name: fn.name, args } });
        }
      }
      if (typeof m.content === 'string' && m.content.trim()) parts.push({ text: m.content });
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }
    if (m.role === 'tool') {
      const name = nameById.get(m.tool_call_id) || 'tool';
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: { result: String(m.content || '').slice(0, 20000) } } }],
      });
      continue;
    }
    // user
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    if (text) contents.push({ role: 'user', parts: [{ text }] });
  }
  return contents;
}

function toFunctionDeclarations(tools) {
  const list = Array.isArray(tools) ? tools : [];
  const decls = [];
  for (const t of list) {
    if (!t || !t.name) continue;
    let params = t.parameters || { type: 'object', properties: {} };
    try {
      params = JSON.parse(JSON.stringify(params));
    } catch {}
    delete params.$schema;
    delete params.additionalProperties;
    decls.push({ name: t.name, description: String(t.description || '').slice(0, 1000), parameters: params });
  }
  return decls.length ? [{ functionDeclarations: decls }] : undefined;
}

/* ---------------------------------- generate ---------------------------------- */

async function generate({ model, system, messages, tools, onDelta, signal }) {
  if (signal && signal.aborted) {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  }
  const project = await ensureProject();
  const useModel = String(model || (await readCfg()).model || DEFAULT_MODEL).trim();

  const request = {
    contents: toGeminiContents(messages),
    ...(system ? { systemInstruction: { parts: [{ text: String(system).slice(0, 200000) }] } } : {}),
  };
  const fns = toFunctionDeclarations(tools);
  if (fns) request.tools = fns;

  const body = { model: useModel, request };
  if (project) body.project = project;

  const j = await apiCall('generateContent', body);
  const cand = (j.candidates && j.candidates[0]) || null;
  const parts = (cand && cand.content && cand.content.parts) || [];

  let content = '';
  const toolCalls = [];
  for (const p of parts) {
    if (p && typeof p.text === 'string') content += p.text;
    if (p && p.functionCall && p.functionCall.name) {
      toolCalls.push({
        id: `cc_${Date.now()}_${toolCalls.length}`,
        name: p.functionCall.name,
        argsRaw: JSON.stringify(p.functionCall.args || {}),
      });
    }
  }

  if (content && onDelta) onDelta(content);
  return { content, toolCalls };
}

/* ----------------------------------- login ----------------------------------- */

async function login() {
  if (!CLIENT_ID) throw new Error('Google client ID chahiye (Settings → Cloud → Advanced me paste karo).');
  const secret = await sharedClientSecret();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close(() => {});
      } catch {}
      fn(arg);
    };

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/oauth2callback') {
          res.writeHead(404).end('not found');
          return;
        }
        const q = url.searchParams;
        if (q.get('error')) {
          const code = String(q.get('error'));
          const friendly =
            code === 'access_denied'
              ? 'Google ne block kiya (access_denied). OAuth app "Testing" me ho to apna email Test users me add karo, aur consent screen me cloud-platform scope bhi add karo.'
              : q.get('error_description') || code;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<h2>Nova: ${code}</h2><p>${friendly}</p>`);
          finish(reject, new Error(friendly));
          return;
        }
        if (q.get('state') !== state) {
          res.writeHead(400).end('state mismatch');
          finish(reject, new Error('OAuth state mismatch — dobara try karo.'));
          return;
        }
        const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
        const tokenBody = new URLSearchParams({
          client_id: CLIENT_ID,
          code: String(q.get('code') || ''),
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        });
        if (secret) tokenBody.set('client_secret', secret);
        const tr = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenBody,
        });
        const tokens = await tr.json().catch(() => ({}));
        if (!tr.ok || !tokens.access_token) {
          throw new Error(tokens.error_description || tokens.error || `token exchange failed (HTTP ${tr.status})`);
        }

        let profile = {};
        try {
          const ui = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
          if (ui.ok) {
            const p = await ui.json();
            profile = { email: p.email || null, name: p.name || null, picture: p.picture || null };
          }
        } catch {}

        const prev = await readCfg();
        await writeCfg({
          ...prev,
          refreshToken: tokens.refresh_token || prev.refreshToken,
          email: profile.email || prev.email || null,
          name: profile.name || prev.name || null,
          picture: profile.picture || prev.picture || null,
          model: prev.model || DEFAULT_MODEL,
          project: null, // re-discover for this account
        });
        cache = { token: tokens.access_token, exp: Date.now() + (tokens.expires_in || 3600) * 1000 - 60000 };

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Nova: Cloud Code connected ✓ — ye tab band kar sakte ho.</h2>');
        finish(resolve, await status());
      } catch (e) {
        // Show the real reason instead of a bare "error" page.
        const msg = String((e && e.message) || e);
        try {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h2>Nova: Cloud Code sign-in failed</h2><p>${msg.replace(/</g, '&lt;')}</p>`);
        } catch {}
        finish(reject, e);
      }
    });

    server.on('error', (e) => finish(reject, e));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const u = new URL(AUTH_URL);
      u.searchParams.set('client_id', CLIENT_ID);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', SCOPES);
      u.searchParams.set('code_challenge', challenge);
      u.searchParams.set('code_challenge_method', 'S256');
      u.searchParams.set('state', state);
      u.searchParams.set('access_type', 'offline');
      u.searchParams.set('prompt', 'consent');
      lastAuthUrl = u.toString();
      const { shell } = require('electron');
      try {
        shell.openExternal(lastAuthUrl);
      } catch {}
    });

    timer = setTimeout(() => finish(reject, new Error('Sign-in timeout (5 min).')), 5 * 60 * 1000);
  });
}

async function logout() {
  await writeCfg({});
  cache = { token: null, exp: 0 };
  return status();
}

module.exports = {
  status,
  login,
  logout,
  saveModel,
  getLastAuthUrl,
  ensureProject,
  listModels,
  generate,
  toGeminiContents,
  toFunctionDeclarations,
  configPath,
};
