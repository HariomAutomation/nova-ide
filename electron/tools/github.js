'use strict';

/**
 * GitHub for Nova — connect with a personal access token, list your repos, and
 * clone one straight into the IDE.
 *
 * Token is stored locally at ~/.nova-ide/github.json and only ever sent to
 * api.github.com.
 */

const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { configRoot } = require('./paths');

// A build can ship a GitHub OAuth App client ID (public for the device flow) so
// "Sign in with GitHub" is one click. Otherwise the user pastes their own once.
// Default GitHub OAuth App client ID, so "Sign in with GitHub" is one click with
// no setup. A client ID is public (not a secret) - the device flow is designed to
// be embedded in clients and needs no client secret. Override with the
// NOVA_GITHUB_CLIENT_ID env var, or clear it in the UI's Advanced field.
const DEFAULT_CLIENT_ID = process.env.NOVA_GITHUB_CLIENT_ID || 'Ov23lirvysSV2ryNxylL';

function configDir() {
  return configRoot();
}
function configPath() {
  return path.join(configDir(), 'github.json');
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

async function api(pathname) {
  const c = await readCfg();
  if (!c.token) throw new Error('GitHub connected nahi hai — pehle token daalo.');
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'NovaIDE',
    },
  });
  if (res.status === 401) {
    // Token revoked or expired ("Expire user access tokens" is on). Drop it so
    // the UI goes back to the sign-in state with a clear message.
    const c2 = await readCfg();
    delete c2.token;
    delete c2.login;
    await writeCfg(c2);
    throw new Error('GitHub token expire ho gaya — dobara "Sign in with GitHub" karo.');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GitHub HTTP ${res.status}${t ? ` — ${t.slice(0, 160)}` : ''}`);
  }
  return res.json();
}

async function status() {
  const c = await readCfg();
  return {
    connected: !!c.token,
    login: c.login || null,
    configPath: configPath(),
    clientId: c.clientId || null,
    hasClientId: !!(c.clientId || DEFAULT_CLIENT_ID),
    builtinClient: !c.clientId && !!DEFAULT_CLIENT_ID,
  };
}

async function saveClientId(clientId) {
  const id = String(clientId || '').trim();
  const c = await readCfg();
  if (id) c.clientId = id;
  else delete c.clientId;
  await writeCfg(c);
  return status();
}

async function clientId() {
  const c = await readCfg();
  return c.clientId || DEFAULT_CLIENT_ID;
}

/**
 * GitHub device flow (no client secret needed): start returns a user code and
 * a verification URL; the user approves in the browser and poll() picks up the
 * token automatically.
 */
async function deviceStart() {
  const id = await clientId();
  if (!id) {
    return { error: 'Ek baar GitHub OAuth App ka client ID daalo (Advanced me), phir sign-in one-click ho jayega.' };
  }
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: id, scope: 'repo read:user' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.device_code) {
    return { error: j.error_description || `GitHub HTTP ${res.status}` };
  }
  return {
    userCode: j.user_code,
    verificationUri: j.verification_uri || 'https://github.com/login/device',
    deviceCode: j.device_code,
    interval: j.interval || 5,
  };
}

async function devicePoll(deviceCode) {
  const id = await clientId();
  if (!id || !deviceCode) return { error: 'Sign-in session missing.' };
  const deadline = Date.now() + 15 * 60 * 1000;
  let interval = 5;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: id,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (j.access_token) {
      const c = await readCfg();
      c.token = j.access_token;
      delete c.login;
      await writeCfg(c);
      try {
        const me = await whoami();
        c.login = me.login;
        await writeCfg(c);
      } catch {}
      return { ok: true, status: await status() };
    }
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') {
      interval += 5;
      continue;
    }
    if (j.error) return { error: j.error_description || j.error };
  }
  return { error: 'Timed out waiting for GitHub authorization.' };
}

async function whoami() {
  const me = await api('/user');
  return { login: me.login, name: me.name || null, avatar: me.avatar_url || null };
}

async function save(token) {
  const t = String(token || '').trim();
  if (!t) return { error: 'Token required' };
  const c = await readCfg();
  c.token = t;
  delete c.login;
  await writeCfg(c);
  try {
    const me = await whoami();
    c.login = me.login;
    await writeCfg(c);
  } catch (e) {
    // Bad token — keep it out of the config so the UI shows "not connected".
    delete c.token;
    await writeCfg(c);
    return { error: String(e.message || e) };
  }
  return status();
}

async function logout() {
  const c = await readCfg();
  delete c.token;
  delete c.login;
  await writeCfg(c);
  return status();
}

async function listRepos(query) {
  const raw = await api('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member');
  const q = String(query || '').trim().toLowerCase();
  const repos = (Array.isArray(raw) ? raw : [])
    .filter((r) => !q || String(r.full_name || '').toLowerCase().includes(q))
    .map((r) => ({
      fullName: r.full_name,
      name: r.name,
      private: !!r.private,
      cloneUrl: r.clone_url,
      description: r.description || '',
      pushedAt: r.pushed_at || null,
      defaultBranch: r.default_branch || 'main',
    }));
  return { repos };
}

/** Clone a repo into ~/nova-repos/<name> (created on demand). */
async function clone(cloneUrl, name) {
  const url = String(cloneUrl || '').trim();
  if (!url) return { error: 'No clone URL' };
  const safe = String(name || 'repo').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
  const dir = path.join(os.homedir(), 'nova-repos');
  const dest = path.join(dir, safe);
  await fsp.mkdir(dir, { recursive: true });

  // If destination folder already exists, open it directly or verify remote origin
  try {
    const st = await fsp.stat(dest);
    if (st.isDirectory()) {
      const originUrl = await new Promise((res) => {
        execFile('git', ['remote', 'get-url', 'origin'], { cwd: dest, timeout: 5000 }, (err, stdout) => {
          res(err ? '' : String(stdout || '').trim());
        });
      });
      const norm = (u) => String(u || '').replace(/\.git$/i, '').toLowerCase().replace(/^https?:\/\/github\.com\//i, '').replace(/^git@github\.com:/i, '');
      // If existing directory points to a different repo, clone to a deterministic unique folder to avoid duplicate proliferation
      if (originUrl && norm(originUrl) !== norm(url)) {
        const repoOwnerSlug = norm(url).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-30);
        const uniqueSafe = `${safe}-${repoOwnerSlug || 'clone'}`;
        const uniqueDest = path.join(dir, uniqueSafe);
        try {
          const ust = await fsp.stat(uniqueDest);
          if (ust.isDirectory()) {
            execFile('git', ['pull', '--ff-only'], { cwd: uniqueDest, timeout: 8000 }, () => {});
            return { ok: true, path: uniqueDest, existed: true };
          }
        } catch {}
        return new Promise((resolve) => {
          execFile('git', ['clone', '--depth', '1', url, uniqueDest], { timeout: 300000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
              resolve({ error: String(stderr || err.message || err).slice(0, 400) });
            } else {
              resolve({ ok: true, path: uniqueDest });
            }
          });
        });
      }
      if (originUrl && norm(originUrl) === norm(url)) {
        execFile('git', ['pull', '--ff-only'], { cwd: dest, timeout: 8000 }, () => {});
      }
      return { ok: true, path: dest, existed: true };
    }
  } catch {}

  return new Promise((resolve) => {
    execFile('git', ['clone', '--depth', '1', url, dest], { timeout: 300000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ error: String(stderr || err.message || err).slice(0, 400) });
      } else {
        resolve({ ok: true, path: dest });
      }
    });
  });
}

module.exports = { status, save, saveClientId, deviceStart, devicePoll, logout, whoami, listRepos, clone, configPath };
