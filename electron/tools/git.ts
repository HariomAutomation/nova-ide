'use strict';

/**
 * Git integration for Nova — the Source Control surface.
 *
 * Everything goes through `execFile('git', [...])` with an argument array (no
 * shell), so paths with spaces or quotes are safe. The porcelain parser is pure
 * and unit-tested.
 */

const { execFile } = require('node:child_process');

function git(cwd: string, args: string[], timeoutMs = 60000): Promise<any> {
  return new Promise((resolve) => {
    if (!cwd) return resolve({ code: -1, stdout: '', stderr: 'No workspace folder is open.' });
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err ? String(err.message || err) : null,
        });
      },
    );
  });
}

const CODE_LABEL = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflict',
  '?': 'untracked',
  '!': 'ignored',
};

function labelFor(x, y) {
  if (x === '?' && y === '?') return 'untracked';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  const c = x !== ' ' ? x : y;
  return CODE_LABEL[c] || 'changed';
}

/**
 * Parse `git status --porcelain=v1 -b` output. Pure — exported for tests.
 */
function parseStatusPorcelain(text) {
  const out: Record<string, any> = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    if (!raw) continue;
    if (raw.startsWith('## ')) {
      const head = raw.slice(3).trim();
      if (/^No commits yet on /.test(head)) {
        out.branch = head.replace(/^No commits yet on /, '').split('...')[0].trim();
        continue;
      }
      const m = /^([^\s.]+?)(?:\.\.\.(\S+?))?(?:\s+\[(.+)\])?$/.exec(head);
      if (m) {
        out.branch = m[1] || null;
        out.upstream = m[2] || null;
        const meta = m[3] || '';
        const a = /ahead (\d+)/.exec(meta);
        const b = /behind (\d+)/.exec(meta);
        if (a) out.ahead = Number(a[1]);
        if (b) out.behind = Number(b[1]);
      }
      continue;
    }
    if (raw.length < 3) continue;
    const x = raw[0];
    const y = raw[1];
    let p = raw.slice(3);
    let origPath = null;
    const arrow = p.indexOf(' -> ');
    if (arrow >= 0) {
      origPath = p.slice(0, arrow);
      p = p.slice(arrow + 4);
    }
    // Porcelain quotes paths containing special characters.
    const unquote = (s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s);
    out.files.push({
      path: unquote(p),
      origPath: origPath ? unquote(origPath) : null,
      index: x,
      worktree: y,
      staged: x !== ' ' && x !== '?',
      untracked: x === '?' && y === '?',
      label: labelFor(x, y),
    });
  }
  return out;
}

async function isRepo(cwd) {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && /true/.test(r.stdout);
}

async function status(cwd) {
  if (!(await isRepo(cwd))) return { repo: false, files: [], branch: null };
  const r = await git(cwd, ['status', '--porcelain=v1', '-b', '--untracked-files=all']);
  if (r.code !== 0) return { repo: false, error: r.stderr || r.error, files: [], branch: null };
  const parsed = parseStatusPorcelain(r.stdout);
  const rem = await git(cwd, ['remote', 'get-url', 'origin']);
  parsed.repo = true;
  parsed.remote = rem.code === 0 ? rem.stdout.trim() : null;
  return parsed;
}

async function diff(cwd, file, staged = false) {
  const args = ['diff', '--no-color'];
  if (staged) args.push('--cached');
  if (file) args.push('--', file);
  const r = await git(cwd, args);
  return { ok: r.code === 0, diff: r.stdout, error: r.code === 0 ? null : r.stderr || r.error };
}

async function stage(cwd, paths) {
  const list = Array.isArray(paths) ? paths.filter(Boolean) : [paths].filter(Boolean);
  if (!list.length) return { ok: false, error: 'No paths' };
  const r = await git(cwd, ['add', '--', ...list]);
  return { ok: r.code === 0, error: r.code === 0 ? null : r.stderr || r.error };
}

async function unstage(cwd, paths) {
  const list = Array.isArray(paths) ? paths.filter(Boolean) : [paths].filter(Boolean);
  if (!list.length) return { ok: false, error: 'No paths' };
  let r = await git(cwd, ['restore', '--staged', '--', ...list]);
  if (r.code !== 0) r = await git(cwd, ['reset', '-q', 'HEAD', '--', ...list]);
  return { ok: r.code === 0, error: r.code === 0 ? null : r.stderr || r.error };
}

async function commit(cwd, message) {
  const msg = String(message || '').trim();
  if (!msg) return { ok: false, error: 'Commit message is empty.' };
  const r = await git(cwd, ['commit', '-m', msg]);
  return { ok: r.code === 0, output: r.stdout.trim(), error: r.code === 0 ? null : (r.stdout + r.stderr).trim() || r.error };
}

async function branches(cwd) {
  const r = await git(cwd, ['branch', '--format=%(refname:short)']);
  const list = r.code === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const cur = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return { branches: list, current: cur.code === 0 ? cur.stdout.trim() : null };
}

async function checkout(cwd, branch) {
  const r = await git(cwd, ['checkout', branch]);
  return { ok: r.code === 0, output: r.stdout.trim(), error: r.code === 0 ? null : (r.stderr || r.error) };
}

async function log(cwd, limit = 20) {
  const n = Math.max(1, Math.min(Number(limit) || 20, 100));
  const r = await git(cwd, ['log', `-n${n}`, '--date=short', '--pretty=format:%h\t%ad\t%an\t%s']);
  if (r.code !== 0) return { commits: [], error: r.stderr || r.error };
  const commits = r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, date, author, ...rest] = l.split('\t');
      return { hash, date, author, subject: rest.join('\t') };
    });
  return { commits };
}

async function push(cwd) {
  const r = await git(cwd, ['push'], 120000);
  return { ok: r.code === 0, output: (r.stdout + r.stderr).trim(), error: r.code === 0 ? null : (r.stderr || r.error) };
}

async function pull(cwd) {
  const r = await git(cwd, ['pull', '--ff-only'], 120000);
  return { ok: r.code === 0, output: (r.stdout + r.stderr).trim(), error: r.code === 0 ? null : (r.stderr || r.error) };
}

async function worktreeAdd(cwd, dir, branch) {
  if (!dir) return { ok: false, error: 'No path for the worktree.' };
  let r = await git(cwd, ['worktree', 'add', dir, '-b', branch], 60000);
  if (r.code !== 0 && /already exists/i.test(r.stderr || '')) {
    r = await git(cwd, ['worktree', 'add', dir, branch], 60000);
  }
  return { ok: r.code === 0, path: dir, output: (r.stdout + r.stderr).trim(), error: r.code === 0 ? null : (r.stderr || r.error) };
}

async function worktreeList(cwd) {
  const r = await git(cwd, ['worktree', 'list', '--porcelain']);
  if (r.code !== 0) return { worktrees: [] };
  const trees = [];
  let cur: any = {};
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) trees.push(cur);
      cur = { path: line.slice(9).trim() };
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    }
  }
  if (cur.path) trees.push(cur);
  return { worktrees: trees };
}

module.exports = {
  git,
  status,
  worktreeAdd,
  worktreeList,
  diff,
  stage,
  unstage,
  commit,
  branches,
  checkout,
  log,
  push,
  pull,
  isRepo,
  parseStatusPorcelain,
};
