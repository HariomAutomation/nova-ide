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

function configDir() {
  return process.env.NOVA_CONFIG_DIR || path.join(os.homedir(), '.nova-ide');
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
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GitHub HTTP ${res.status}${t ? ` — ${t.slice(0, 160)}` : ''}`);
  }
  return res.json();
}

async function status() {
  const c = await readCfg();
  return { connected: !!c.token, login: c.login || null, configPath: configPath() };
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

module.exports = { status, save, logout, whoami, listRepos, clone, configPath };
