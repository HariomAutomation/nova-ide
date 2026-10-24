'use strict';

/**
 * Google Drive (read-only) for Nova's Cloud.
 *
 * Sign in with Google once (OAuth 2.0 loopback + PKCE); the refresh token is
 * stored in ~/.nova-ide/gdrive.json, so afterwards Nova can list and read the
 * user's Drive files without signing in again.
 *
 * Scope is drive.readonly — Nova can read cloud files, never modify them.
 *
 * One-time setup (in Google Cloud Console, by the user):
 *   1. Create a project (no billing needed for Drive).
 *   2. Enable the "Google Drive API".
 *   3. Credentials -> OAuth client ID -> Desktop app -> copy the Client ID.
 */

const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
let shell = null;
try {
  ({ shell } = require('electron'));
} catch {}
const { configRoot } = require('./paths');

function getConfigDir() {
  return configRoot();
}
function getConfigPath() {
  return path.join(getConfigDir(), 'gdrive.json');
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const MEMORY_NAME = 'memory.json';
const SCOPE =
  'openid email https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.appdata';

const GOOGLE_DOC = 'application/vnd.google-apps.document';
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';

// A build can ship its own Google OAuth client so sign-in is one click and the
// user never sees a Client ID field. If none is bundled, the user can still
// paste their own under "Advanced".
// Default Google OAuth client ID, so "Sign in with Google" is one click with no
// setup. A client ID is public (it appears in the consent URL). Override with the
// NOVA_GOOGLE_CLIENT_ID env var, or clear it in the UI's Advanced field.
const DEFAULT_CLIENT_ID =
  process.env.NOVA_GOOGLE_CLIENT_ID ||
  '695004570637-16f2oo3s60a0m93p7dt8hld3et8fqunp.apps.googleusercontent.com';
// Deliberately NOT committed: a client secret is a real credential. Desktop-app
// clients do not need one (Nova uses PKCE); set it via the NOVA_GOOGLE_CLIENT_SECRET
// env var or the Advanced field in Settings -> Cloud if your setup asks for it.
const DEFAULT_CLIENT_SECRET = process.env.NOVA_GOOGLE_CLIENT_SECRET || '';

let accessCache = { token: null, exp: 0 };
let lastAuthUrl = null;

function getLastAuthUrl() {
  return lastAuthUrl;
}

async function readConfig() {
  try {
    const raw = await fsp.readFile(getConfigPath(), 'utf8');
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

async function writeConfig(cfg) {
  await fsp.mkdir(getConfigDir(), { recursive: true });
  await fsp.writeFile(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function effectiveConfig() {
  const cfg = await readConfig();
  return {
    ...cfg,
    clientId: cfg.clientId || DEFAULT_CLIENT_ID,
    clientSecret: cfg.clientSecret || DEFAULT_CLIENT_SECRET,
  };
}

async function status() {
  const cfg = await readConfig();
  const eff = await effectiveConfig();
  return {
    configPath: getConfigPath(),
    hasClient: !!eff.clientId,
    builtin: !cfg.clientId && !!DEFAULT_CLIENT_ID,
    clientId: cfg.clientId || null,
    connected: !!cfg.refreshToken,
    email: cfg.email || null,
    name: cfg.name || null,
    picture: cfg.picture || null,
    scope: SCOPE,
  };
}

/** Save the OAuth client id/secret (tokens are untouched). */
async function save(patch) {
  const cfg = await readConfig();
  const next = { ...cfg };
  if (patch && typeof patch.clientId === 'string') next.clientId = patch.clientId.trim();
  if (patch && typeof patch.clientSecret === 'string' && patch.clientSecret.trim()) {
    next.clientSecret = patch.clientSecret.trim();
  }
  await writeConfig(next);
  accessCache = { token: null, exp: 0 };
  return status();
}

async function logout() {
  const cfg = await readConfig();
  delete cfg.refreshToken;
  delete cfg.email;
  delete cfg.name;
  delete cfg.picture;
  await writeConfig(cfg);
  accessCache = { token: null, exp: 0 };
  cachedFolderId = null;
  cachedFolderExp = 0;
  return status();
}

async function exchangeCode(cfg, code, redirectUri, verifier) {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(j.error_description || j.error || `token exchange failed (HTTP ${res.status})`);
  }
  return j;
}

/** Valid access token, refreshed automatically from the stored refresh token. */
async function getAccessToken() {
  if (accessCache.token && Date.now() < accessCache.exp) return accessCache.token;
  const cfg = await effectiveConfig();
  if (!cfg.refreshToken) throw new Error('Cloud not connected — Settings -> Cloud -> Sign in with Google.');
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    refresh_token: cfg.refreshToken,
    grant_type: 'refresh_token',
  });
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(j.error_description || j.error || `token refresh failed (HTTP ${res.status})`);
  }
  accessCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000 };
  return accessCache.token;
}

/** Full loopback sign-in: opens the browser and waits for the redirect. */
async function login() {
  const cfg = await effectiveConfig();
  if (!cfg.clientId) {
    throw new Error('Sign-in ke liye Google client ID chahiye (Cloud settings me "Advanced" khol ke paste karo).');
  }
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
          const code = String(q.get('error') || 'error');
          const friendly =
            code === 'access_denied'
              ? 'Google ne sign-in block kiya (access_denied). Ye tab hota hai jab OAuth app "Testing" status me ho aur aapka Google account "Test users" me add na ho. Fix: Google Cloud Console -> APIs & Services -> OAuth consent screen -> Audience -> Test users -> apna email add karo, phir dobara try karo.'
              : q.get('error_description') || code;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            `<h2>Nova: sign-in nahi hua (${code.replace(/[<>&]/g, '')})</h2><p>${friendly.replace(/</g, '&lt;')}</p>`
          );
          finish(reject, new Error(friendly));
          return;
        }
        if (q.get('state') !== state) {
          res.writeHead(400).end('state mismatch');
          finish(reject, new Error('OAuth state mismatch — dobara try karo.'));
          return;
        }
        const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
        const tokens = await exchangeCode(cfg, q.get('code'), redirectUri, verifier);

        let profile = {};
        try {
          const ui = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
          if (ui.ok) {
            const j = await ui.json();
            profile = { email: j.email || null, name: j.name || null, picture: j.picture || null };
          }
        } catch {}

        const next = {
          ...cfg,
          refreshToken: tokens.refresh_token || cfg.refreshToken,
          email: profile.email || cfg.email || null,
          name: profile.name || cfg.name || null,
          picture: profile.picture || cfg.picture || null,
        };
        await writeConfig(next);
        accessCache = { token: tokens.access_token, exp: Date.now() + (tokens.expires_in || 3600) * 1000 - 60000 };

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Nova: Cloud connected ✓ — ye tab band kar sakte ho.</h2>');
        finish(resolve, await status());
      } catch (e) {
        try {
          res.writeHead(500).end('error');
        } catch {}
        finish(reject, e);
      }
    });

    timer = setTimeout(() => finish(reject, new Error('Sign-in timeout (5 min) — dobara try karo.')), 5 * 60 * 1000);
    server.on('error', (e) => finish(reject, e));
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
      const authUrl =
        `${AUTH_URL}?client_id=${encodeURIComponent(cfg.clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code&scope=${encodeURIComponent(SCOPE)}` +
        `&code_challenge=${challenge}&code_challenge_method=S256` +
        `&access_type=offline&prompt=consent&state=${state}`;
      lastAuthUrl = authUrl;
      shell
        .openExternal(authUrl)
        .catch((e) =>
          finish(reject, new Error(`Browser nahi khula: ${e.message} — "Copy sign-in URL" se manually kholo.`)),
        );
    });
  });
}

async function apiGet(url, { raw = false } = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = t;
    try {
      const parsed = JSON.parse(t);
      if (parsed?.error?.message) {
        msg = parsed.error.message;
      }
    } catch {}
    throw new Error(`Drive HTTP ${res.status}: ${msg}`);
  }
  return raw ? res : res.json();
}

const NOVA_FOLDER_NAME = 'Nova IDE';

let cachedFolderId: string | null = null;
let cachedFolderExp = 0;

/**
 * Find the dedicated 'Nova IDE' folder ID.
 * To protect user privacy, Nova IDE NEVER queries root Drive or personal documents
 * (such as ID cards, certificates, salary slips, etc.). It only accesses files
 * within the 'Nova IDE' folder.
 */
async function getNovaFolderId() {
  const now = Date.now();
  if (cachedFolderId && now < cachedFolderExp) {
    return cachedFolderId;
  }
  const q = `mimeType='application/vnd.google-apps.folder' and name='${NOVA_FOLDER_NAME}' and trashed=false`;
  const url = `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  try {
    const j = await apiGet(url);
    if (j?.files?.length > 0) {
      cachedFolderId = j.files[0].id;
      cachedFolderExp = now + 5 * 60 * 1000; // cache for 5 minutes
      return cachedFolderId;
    }
  } catch {}
  return null;
}

/** List the user's Drive files inside the isolated Nova IDE folder ONLY. */
async function listFiles(query) {
  const folderId = await getNovaFolderId();
  if (!folderId) {
    // Nova IDE folder does not exist yet. Keep personal files completely hidden.
    return { files: [], isolated: true, folderMissing: true, folderName: NOVA_FOLDER_NAME };
  }

  const q = query && String(query).trim()
    ? `'${folderId}' in parents and name contains '${String(query).trim().replace(/'/g, "\\'")}' and trashed=false`
    : `'${folderId}' in parents and trashed=false`;
  const url =
    `${DRIVE_FILES}?pageSize=60&orderBy=modifiedTime desc&q=${encodeURIComponent(q)}` +
    `&fields=${encodeURIComponent('files(id,name,mimeType,size,modifiedTime,webViewLink)')}`;
  const j = await apiGet(url);
  return { files: (j && j.files) || [], isolated: true, folderId, folderName: NOVA_FOLDER_NAME };
}

/** Read a Drive file's contents as text (Google Docs/Sheets/Slides are exported). */
async function readFile(id) {
  if (!id) return { error: 'No file id' };
  const meta = await apiGet(`${DRIVE_FILES}/${encodeURIComponent(id)}?fields=id,name,mimeType,size`);
  const mime = meta.mimeType || '';
  let text = '';
  if (mime === GOOGLE_DOC) {
    const r = await apiGet(`${DRIVE_FILES}/${encodeURIComponent(id)}/export?mimeType=text/plain`, { raw: true });
    text = await r.text();
  } else if (mime === GOOGLE_SHEET) {
    const r = await apiGet(`${DRIVE_FILES}/${encodeURIComponent(id)}/export?mimeType=text/csv`, { raw: true });
    text = await r.text();
  } else if (mime === GOOGLE_SLIDES) {
    const r = await apiGet(`${DRIVE_FILES}/${encodeURIComponent(id)}/export?mimeType=text/plain`, { raw: true });
    text = await r.text();
  } else {
    const r = await apiGet(`${DRIVE_FILES}/${encodeURIComponent(id)}?alt=media`, { raw: true });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 4096).includes(0)) {
      return { name: meta.name, mimeType: mime, binary: true, size: buf.length };
    }
    text = buf.toString('utf8');
  }
  return { name: meta.name, mimeType: mime, text };
}

/** Download a Drive file to a local path (creates parent dirs). */
async function downloadFile(id, dest) {
  if (!id || !dest) return { error: 'id and dest are required' };
  const meta = await apiGet(`${DRIVE_FILES}/${encodeURIComponent(id)}?fields=name,mimeType`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if ((meta.mimeType || '').startsWith('application/vnd.google-apps')) {
    // Native Google docs have no bytes — export as text.
    const r = await apiGet(`${DRIVE_FILES}/${encodeURIComponent(id)}/export?mimeType=text/plain`, { raw: true });
    await fsp.writeFile(dest, await r.text(), 'utf8');
  } else {
    const r = await apiGet(`${DRIVE_FILES}/${encodeURIComponent(id)}?alt=media`, { raw: true });
    const buf = Buffer.from(await r.arrayBuffer());
    await fsp.writeFile(dest, buf);
  }
  return { ok: true, path: dest, name: meta.name };
}


/* ------------------------- memory sync (appDataFolder) ------------------------- */
// Memory lives in the user's Drive app-data folder, so it follows the signed-in
// account across machines. Nova only ever sees its own file.

async function findMemoryFile() {
  const url =
    `${DRIVE_FILES}?spaces=appDataFolder&q=${encodeURIComponent(`name='${MEMORY_NAME}'`)}` +
    `&fields=${encodeURIComponent('files(id,name,modifiedTime)')}`;
  const j = await apiGet(url);
  return ((j && j.files) || [])[0] || null;
}

async function readMemory() {
  const f = await findMemoryFile();
  if (!f) return { found: false, notes: [] };
  const r = await apiGet(`${DRIVE_FILES}/${encodeURIComponent(f.id)}?alt=media`, { raw: true });
  const text = await r.text();
  try {
    const j = JSON.parse(text);
    return { found: true, fileId: f.id, notes: Array.isArray(j.notes) ? j.notes : [] };
  } catch {
    return { found: true, fileId: f.id, notes: [] };
  }
}

async function writeMemory(notes) {
  const json = JSON.stringify({ notes: Array.isArray(notes) ? notes : [] }, null, 2);
  const token = await getAccessToken();
  const existing = await findMemoryFile();

  if (existing) {
    const res = await fetch(`${DRIVE_UPLOAD}/${encodeURIComponent(existing.id)}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: json,
    });
    if (!res.ok) throw new Error(`Drive memory update HTTP ${res.status}`);
    return { ok: true, fileId: existing.id };
  }

  const boundary = 'nova' + crypto.randomBytes(8).toString('hex');
  const metadata = { name: MEMORY_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive memory create HTTP ${res.status}`);
  const j = await res.json().catch(() => ({}));
  return { ok: true, fileId: j.id || null };
}

module.exports = {
  status,
  save,
  login,
  logout,
  listFiles,
  readFile,
  downloadFile,
  readMemory,
  writeMemory,
  getAccessToken,
  getLastAuthUrl,
  getConfigDir,
  getConfigPath,
};
