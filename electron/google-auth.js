/**
 * Google Sign-In (OAuth 2.0, loopback + PKCE) for Nova IDE.
 *
 * Lets the user connect their Google account and use Gemini models through
 * their own Google Cloud project (Vertex AI, OpenAI-compatible endpoint).
 * Tokens live in ~/.nova-ide/google.json and are refreshed automatically;
 * requests get `Authorization: Bearer <access-token>` at call time.
 *
 * Setup (one-time, done by the user in Google Cloud Console):
 *   1. Create a project + enable billing (the $300 free trial works).
 *   2. Enable the "Vertex AI API".
 *   3. APIs & Services -> Credentials -> Create credentials ->
 *      OAuth client ID -> Desktop app -> copy Client ID (and secret).
 * Then paste them in Nova: Settings -> Models -> Google Account -> Sign in.
 */
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const { shell } = require('electron');

const CONFIG_DIR = path.join(os.homedir(), '.nova-ide');
const CONFIG_PATH = path.join(CONFIG_DIR, 'google.json');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const SCOPE = 'openid email https://www.googleapis.com/auth/cloud-platform';

let accessCache = { token: null, exp: 0 };
let lastAuthUrl = null;

function getLastAuthUrl() {
  return lastAuthUrl;
}

async function readConfig() {
  try {
    const raw = await fsp.readFile(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch {
    return {};
  }
}

async function writeConfig(cfg) {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  await fsp.chmod(CONFIG_PATH, 0o600).catch(() => {});
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Public status for the UI (never returns tokens). */
async function status() {
  const cfg = await readConfig();
  return {
    configPath: CONFIG_PATH,
    hasClient: !!cfg.clientId,
    clientId: cfg.clientId || null,
    connected: !!cfg.refreshToken,
    email: cfg.email || null,
    projectId: cfg.projectId || null,
    location: cfg.location || 'us-central1',
    expiresIn: accessCache.token ? Math.max(0, Math.round((accessCache.exp - Date.now()) / 1000)) : 0,
  };
}

/** Save the OAuth client + project settings (does not touch tokens). */
async function save(patch) {
  const cfg = await readConfig();
  const next = { ...cfg };
  if (patch && typeof patch.clientId === 'string') next.clientId = patch.clientId.trim();
  if (patch && typeof patch.clientSecret === 'string' && patch.clientSecret.trim()) {
    next.clientSecret = patch.clientSecret.trim();
  }
  if (patch && typeof patch.projectId === 'string') next.projectId = patch.projectId.trim();
  if (patch && typeof patch.location === 'string' && patch.location.trim()) next.location = patch.location.trim();
  next.location = next.location || 'us-central1';
  await writeConfig(next);
  accessCache = { token: null, exp: 0 };
  return status();
}

async function logout() {
  const cfg = await readConfig();
  delete cfg.refreshToken;
  delete cfg.email;
  await writeConfig(cfg);
  accessCache = { token: null, exp: 0 };
  return status();
}

/** Exchange an authorization code for tokens (PKCE). */
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

/**
 * Full loopback sign-in: opens the system browser, waits for the redirect on
 * 127.0.0.1, exchanges the code and stores the refresh token.
 */
async function login() {
  const cfg = await readConfig();
  if (!cfg.clientId) {
    throw new Error(
      'Pehle OAuth Client ID paste karo (Google Cloud Console -> APIs & Services -> Credentials -> OAuth client ID -> Desktop app).'
    );
  }

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => {});
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
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>Nova: sign-in cancel ho gaya. Tab band kar do.</h2>');
          finish(reject, new Error(q.get('error_description') || q.get('error')));
          return;
        }
        if (q.get('state') !== state) {
          res.writeHead(400).end('state mismatch');
          finish(reject, new Error('OAuth state mismatch — dobara try karo.'));
          return;
        }
        const code = q.get('code');
        const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
        const tokens = await exchangeCode(cfg, code, redirectUri, verifier);

        let email = null;
        try {
          const ui = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
          if (ui.ok) email = (await ui.json()).email || null;
        } catch {}

        const next = { ...cfg, refreshToken: tokens.refresh_token || cfg.refreshToken, email };
        await writeConfig(next);
        accessCache = { token: tokens.access_token, exp: Date.now() + (tokens.expires_in || 3600) * 1000 - 60000 };

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Nova: Google sign-in ho gaya ✓ — ye tab band kar sakte ho.</h2>');
        finish(resolve, await status());
      } catch (e) {
        try {
          res.writeHead(500).end('error');
        } catch {}
        finish(reject, e);
      }
    });

    const timer = setTimeout(() => finish(reject, new Error('Sign-in timeout (5 min) — dobara try karo.')), 5 * 60 * 1000);

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
        .catch((e) => finish(reject, new Error(`Browser nahi khula: ${e.message} — Settings me "Copy sign-in URL" button se URL copy karke browser me kholo.`)));
    });
  });
}

/** Valid access token, refreshed automatically. */
async function getAccessToken() {
  if (accessCache.token && Date.now() < accessCache.exp) return accessCache.token;
  const cfg = await readConfig();
  if (!cfg.refreshToken) throw new Error('Google account connected nahi hai — Settings -> Models -> Sign in with Google.');
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
    if (j.error === 'invalid_grant') {
      throw new Error('Google session expire ho gaya — Settings -> Models me dobara Sign in karo.');
    }
    throw new Error(j.error_description || j.error || `token refresh failed (HTTP ${res.status})`);
  }
  accessCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000 };
  return accessCache.token;
}

module.exports = { status, save, login, logout, getAccessToken, getLastAuthUrl, CONFIG_PATH };
