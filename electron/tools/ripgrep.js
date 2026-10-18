'use strict';

/**
 * Ripgrep-backed search.
 *
 * The pure-JS walkers in fsTools.js read every file in the workspace: on an
 * 8,000-file repo `codebaseSearch` took ~3.8s (and a query with no hits always
 * burned the full 6s deadline). Ripgrep does the same scan in ~0.1s, so it does
 * the file walking and line matching, and we keep the JS scoring on top so the
 * ranking the agent sees does not change.
 *
 * Resolution order:
 *   1. NOVA_RG                     — explicit override (tests, power users)
 *   2. @vscode/ripgrep             — the prebuilt binary VS Code ships
 *   3. `rg` on PATH                — a system install
 *   4. nothing                     — caller falls back to the JS walker
 *
 * Nothing here throws: any failure returns null/empty so the caller can fall
 * back. A machine without ripgrep must still work, just slower.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let cachedBin; // undefined = not resolved yet, null = unavailable

/** A packaged Electron app cannot execute a binary from inside app.asar. */
function unpacked(p) {
  return String(p).includes('app.asar') ? String(p).replace('app.asar', 'app.asar.unpacked') : p;
}

function candidatePaths() {
  const out = [];
  if (process.env.NOVA_RG) out.push(process.env.NOVA_RG);
  try {
    // eslint-disable-next-line global-require
    const bundled = require('@vscode/ripgrep');
    if (bundled && bundled.rgPath) out.push(unpacked(bundled.rgPath));
  } catch {
    /* not installed — fine */
  }
  const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';
  out.push(path.join(process.resourcesPath || '', 'bin', exe)); // packaged layout
  out.push(exe); // rely on PATH
  return out;
}

function runVersion(bin) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    let proc;
    try {
      proc = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch {
      return finish(false);
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      finish(false);
    }, 4000);
    proc.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

/** Resolve once and cache. Returns the binary path or null. */
async function binary() {
  if (cachedBin !== undefined) return cachedBin;
  for (const c of candidatePaths()) {
    if (!c) continue;
    if (c !== 'rg' && c !== 'rg.exe' && !fs.existsSync(c)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await runVersion(c)) {
      cachedBin = c;
      return cachedBin;
    }
  }
  cachedBin = null;
  return cachedBin;
}

function availableSync() {
  return cachedBin || null;
}

/**
 * Run ripgrep and return parsed match records.
 *
 * @returns {Promise<{ok: boolean, matches?: Array, error?: string}>}
 */
function rgRun({ bin, args, dir, timeoutMs, maxCandidates }) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, error: String(e.message) });
    }

    const matches = [];
    let buf = '';
    let stderr = '';
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      // A timeout is still a usable partial result; only a hard failure is not.
      finish({ ok: matches.length > 0, matches, error: 'timeout' });
    }, Math.max(1000, Math.min(timeoutMs || 6000, 30000)));

    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type !== 'match') continue;
        const d = ev.data || {};
        matches.push({
          path: d.path && d.path.text,
          line: d.line_number,
          text: (d.lines && d.lines.text) || '',
        });
        if (maxCandidates && matches.length >= maxCandidates) {
          try {
            proc.kill('SIGKILL');
          } catch {}
        }
      }
    });
    proc.stderr.on('data', (c) => {
      stderr = (stderr + c.toString('utf8')).slice(-500);
    });

    proc.on('error', (e) => finish({ ok: false, error: String(e.message) }));
    proc.on('close', (code) => {
      // rg exits 1 for "no matches", which is a successful empty result.
      if (code === 0 || code === 1 || code === null) return finish({ ok: true, matches });
      finish({ ok: false, error: stderr || `ripgrep exited ${code}` });
    });
  });
}

/**
 * Common flags: no user config, no gitignore surprises, no huge files, no binary.
 *
 * Threads: ripgrep is multi-threaded, which wins on a normal disk. On a network
 * filesystem (9p/NFS) or a heavily throttled container, parallel reads can be
 * *slower* than sequential — measured 8-way parallel reads at 7x the cost of
 * sequential ones on a 9p mount. Set NOVA_RG_THREADS=1 there.
 */
function baseArgs({ maxFileBytes, respectIgnore, extraGlobs = [], threads } = {}) {
  const args = ['--json', '--no-config', '--no-messages', '--max-filesize', String(maxFileBytes || 512 * 1024)];
  if (!respectIgnore) args.push('--no-ignore');
  const t = threads || process.env.NOVA_RG_THREADS;
  if (t) args.push('--threads', String(Math.max(1, Math.min(Number(t) || 1, 32))));
  for (const g of extraGlobs) args.push('--glob', g);
  return args;
}

/**
 * Forget the resolved binary. Needed by tests that simulate "ripgrep is not
 * installed", and after an upgrade. Plain shorthand so Node's CJS named-export
 * detection actually sees it (an inline arrow is not picked up).
 */
function resetCache() {
  cachedBin = undefined;
}

module.exports = { binary, availableSync, rgRun, baseArgs, unpacked, resetCache };
