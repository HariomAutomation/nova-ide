// Master Automated Test Runner for Nova IDE
// Executes: Regression -> Sanity -> Smoke -> Agent E2E
// Usage: node scripts/test-all.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';

const APP = decodeURIComponent(new URL('..', import.meta.url).pathname);
const CDP_PORT = '9222';

function runStep(title, command, args, env = {}) {
  return new Promise((resolve) => {
    console.log(`\n============================================================`);
    console.log(`  STARTING: ${title}`);
    console.log(`============================================================\n`);
    const t0 = Date.now();
    const p = spawn(command, args, {
      cwd: APP,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    p.on('close', (code) => {
      const durationMs = Date.now() - t0;
      resolve({ title, code, durationMs, pass: code === 0 });
    });
    p.on('error', (err) => {
      console.error(`Error running ${title}:`, err);
      resolve({ title, code: -1, durationMs: Date.now() - t0, pass: false, error: err.message });
    });
  });
}

async function waitForCdp(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        if (list.some((t) => t.type === 'page')) return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const summary = [];

// 1. Regression Tests
const regRes = await runStep('Regression Test Suite', process.execPath, ['scripts/test-regression.mjs']);
summary.push(regRes);

// 2. Build Renderer
const buildRes = await runStep('Vite Production Build', 'npm', ['run', 'build']);
summary.push(buildRes);

if (!buildRes.pass) {
  console.error('\nVite build failed. Aborting remaining UI tests.');
  process.exit(1);
}

// 3. Launch Electron with CDP
console.log(`\nLaunching Nova IDE Electron instance with CDP on port ${CDP_PORT}...`);
const electronBin = path.join(APP, 'node_modules', '.bin', 'electron');
const electronProc = spawn(electronBin, ['.', '--no-sandbox', `--remote-debugging-port=${CDP_PORT}`], {
  cwd: APP,
  env: { ...process.env, CDP_PORT },
  stdio: 'ignore',
});

const cdpReady = await waitForCdp(CDP_PORT, 20000);
if (!cdpReady) {
  console.error('Failed to connect to Electron CDP port 9222 within 20s');
  electronProc.kill('SIGKILL');
  process.exit(1);
}
console.log('✓ Nova IDE Electron CDP instance ready.');

try {
  // 4. Sanity Tests
  const sanityRes = await runStep('Sanity Test Suite', process.execPath, ['scripts/test-sanity.mjs', CDP_PORT]);
  summary.push(sanityRes);

  // 5. Smoke Tests
  const smokeRes = await runStep('Smoke Test Suite (Flow & Navigation)', process.execPath, ['scripts/test-flow.mjs', CDP_PORT]);
  summary.push(smokeRes);

  // 6. Agent E2E Tests
  const agentRes = await runStep('Agent End-to-End Suite (Tool loop & Approvals)', process.execPath, ['scripts/test-agent.mjs', CDP_PORT]);
  summary.push(agentRes);
} finally {
  console.log('\nShutting down Electron test instance...');
  electronProc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  try {
    electronProc.kill('SIGKILL');
  } catch {}
}

// Final Report Matrix
console.log('\n============================================================');
console.log('             NOVA IDE AUTOMATED TEST MATRIX                 ');
console.log('============================================================');
let allPassed = true;
for (const s of summary) {
  const icon = s.pass ? '✓ PASS' : '✗ FAIL';
  const duration = (s.durationMs / 1000).toFixed(2) + 's';
  console.log(`  [${icon}]  ${s.title.padEnd(46)} (${duration})`);
  if (!s.pass) allPassed = false;
}
console.log('============================================================');
console.log(`OVERALL RESULT: ${allPassed ? 'ALL TEST SUITES PASSED' : 'SOME TESTS FAILED'}`);
console.log('============================================================\n');

process.exit(allPassed ? 0 : 1);
