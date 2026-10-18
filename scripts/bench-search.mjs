#!/usr/bin/env node
/**
 * Measure Nova's search engines on your own machine.
 *
 *   node scripts/bench-search.mjs [dir] [runs]
 *
 * Compares the ripgrep engine against the pure-JS walker on the same directory
 * and query. Reports the MINIMUM of N runs, because the minimum is the least
 * noisy estimate of the real cost — average timings on a shared or containerised
 * filesystem are dominated by whatever else is running.
 *
 * Wall-clock is the point here; the regression suite deliberately does NOT assert
 * on speed, because a timing assertion is a flake waiting to happen.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fsTools = require(path.join(ROOT, 'electron/tools/fsTools.js'));
const rg = require(path.join(ROOT, 'electron/tools/ripgrep.js'));

const TARGET = process.argv[2] || ROOT;
const RUNS = Number(process.argv[3] || 5);

/* Build a synthetic repo when asked, so the number is comparable across machines. */
async function synth(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (let d = 0; d < 40; d++) {
    const sub = path.join(dir, `pkg${d}`, 'src');
    fs.mkdirSync(sub, { recursive: true });
    for (let f = 0; f < 50; f++) {
      const lines = [`// module ${d}/${f}`];
      for (let i = 0; i < 60; i++) lines.push(`export function helper_${d}_${f}_${i}(a, b) { return a + b + ${i}; }`);
      if (f % 10 === 0) lines.push('export const NEEDLE_UNIQUE_SYMBOL = "handleLoginUser";');
      fs.writeFileSync(path.join(sub, `mod${f}.js`), lines.join('\n'));
    }
  }
  return dir;
}

let target = TARGET;
if (TARGET === '--synth') {
  target = await synth(path.join(os.tmpdir(), 'nova-bench-repo'));
  console.log(`built synthetic repo: ${target}`);
}

const countFiles = (d) => {
  let n = 0;
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const q = path.join(p, e.name);
      e.isDirectory() ? walk(q) : (n += 1);
    }
  };
  walk(d);
  return n;
};

const bin = await rg.binary();
console.log(`\ndirectory : ${target}`);
console.log(`files     : ${countFiles(target)}`);
console.log(`ripgrep   : ${bin || 'NOT FOUND — the JS walker will be used'}`);
console.log(`threads   : ${process.env.NOVA_RG_THREADS || 'ripgrep default'}`);
console.log(`runs      : ${RUNS} (reporting the minimum)\n`);

async function measure(fn) {
  const t = [];
  let last;
  for (let i = 0; i < RUNS; i++) {
    const s = Date.now();
    last = await fn();
    t.push(Date.now() - s);
  }
  t.sort((a, b) => a - b);
  return { min: t[0], med: t[Math.floor(t.length / 2)], last };
}

const cases = [
  ['codebaseSearch — many hits', { query: 'handleLoginUser', dir: target, maxResults: 25 }, 'codebaseSearchJs'],
  ['codebaseSearch — no hits', { query: 'zzz_absent_zzz', dir: target, maxResults: 25 }, 'codebaseSearchJs'],
  ['searchFiles — regex', { pattern: 'function|const', dir: target, maxResults: 50 }, 'searchFilesJs'],
];

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('case', 30)} ${pad('ripgrep', 10)} ${pad('JS walker', 10)} speedup`);
console.log('-'.repeat(64));

for (const [name, args, jsFn] of cases) {
  const viaRg = await measure(() => fsTools[name.startsWith('codebase') ? 'codebaseSearch' : 'searchFiles'](args));
  const viaJs = await measure(() => fsTools[jsFn](args));
  const speedup = viaRg.min > 0 ? (viaJs.min / viaRg.min).toFixed(1) : '-';
  console.log(`${pad(name, 30)} ${pad(viaRg.min + 'ms', 10)} ${pad(viaJs.min + 'ms', 10)} ${speedup}x`);
}

console.log('\nnotes:');
console.log('  - On a normal local disk ripgrep should win clearly (it is multi-threaded');
console.log('    and skips ignored/binary files).');
console.log('  - On a network filesystem (9p/NFS) parallel reads can be slower than');
console.log('    sequential ones; try NOVA_RG_THREADS=1.');
console.log('  - NOVA_SEARCH_ENGINE=js forces the JS walker.');
