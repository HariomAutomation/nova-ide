// Headless End-to-End Agent Test: verifies the full agent loop, tool execution,
// approval gate, and chat vs agent routing against the mock LLM completely headless
// (requires no GUI, no display, no Electron, and no API keys).
//
// Usage: node scripts/test-headless.mjs [mockPort]

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import { runAgent, stopAgent, resolveApproval, detectMode, toolSchemas } from '../electron/agent.js';

const MOCK_PORT = Number(process.argv[2] || 9988);
const TEST_DIR = path.join(os.tmpdir(), `nova-headless-test-${Date.now()}`);
const APP_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname);

console.log('\n--- Running Nova IDE Headless Agent Test Suite ---');
console.log(`Workspace: ${TEST_DIR}`);
console.log(`Mock LLM port: ${MOCK_PORT}\n`);

// Setup clean test directory
await fsp.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
await fsp.mkdir(TEST_DIR, { recursive: true });

// Start mock LLM server
const mockProc = spawn(process.execPath, [path.join(APP_ROOT, 'scripts', 'mock-llm.mjs'), TEST_DIR, String(MOCK_PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Mock LLM server failed to start within 8s')), 8000);
  mockProc.stdout.on('data', (d) => {
    if (String(d).includes('mock-llm-ready')) {
      clearTimeout(timer);
      resolve();
    }
  });
  mockProc.on('error', reject);
});

console.log('✓ Mock LLM server started successfully.');

let passed = 0;
let failed = 0;

async function runCheck(name, fn) {
  process.stdout.write(`  Testing ${name}... `);
  try {
    await fn();
    console.log('✓ PASS');
    passed++;
  } catch (err) {
    console.log(`✗ FAIL: ${err.message}`);
    failed++;
  }
}

try {
  const modelConfig = {
    baseUrl: `http://127.0.0.1:${MOCK_PORT}`,
    model: 'mock-model',
    apiKey: 'mock-api-key',
  };

  // Test 1: Full autonomous agent loop (file write, terminal cmd, grep search, final reply)
  await runCheck('full agent loop end-to-end (write_file + terminal + grep)', async () => {
    const agentId = `headless-test-agent-${Date.now()}`;
    const events = [];

    await runAgent({
      agentId,
      config: modelConfig,
      workspaceRoot: TEST_DIR,
      userText: 'write the file and run terminal check',
      settings: {
        autoApproveEdit: true,
        autoApproveTerminal: true,
        autoApproveBrowser: true,
        browserHeadless: true,
        maxSteps: 15,
      },
      send: (e) => events.push(e),
    });

    // Check mode
    const modeEvt = events.find((e) => e.type === 'mode');
    assert.ok(modeEvt, 'mode event was emitted');
    assert.equal(modeEvt.mode, 'agent', 'routed to agent mode');

    // Check write_file execution and file on disk
    const targetFile = path.join(TEST_DIR, 'hello.txt');
    assert.ok(fs.existsSync(targetFile), 'hello.txt was written to disk by write_file');
    const content = fs.readFileSync(targetFile, 'utf8');
    assert.match(content, /hello from nova agent/);

    // Check terminal execution
    const termTool = events.find((e) => e.type === 'tool_end' && e.name === 'run_terminal_cmd');
    assert.ok(termTool, 'terminal command tool executed');
    assert.equal(termTool.ok, true, 'terminal tool succeeded');
    assert.match(termTool.output, /MOCK-OK/, 'terminal output captured');

    // Check grep search execution
    const grepTool = events.find((e) => e.type === 'tool_end' && e.name === 'grep_search');
    assert.ok(grepTool, 'grep search tool executed');

    // Check final turn completion
    const doneEvt = events.find((e) => e.type === 'done');
    assert.ok(doneEvt, 'agent completed the turn successfully');
  });

  // Test 2: Security Approvals Gate (Deny flow prevents file modification)
  await runCheck('approval gate (denial prevents tool execution)', async () => {
    const agentId = `headless-test-deny-${Date.now()}`;
    const events = [];
    const protectedFile = path.join(TEST_DIR, 'protected-file.txt');

    // Start run with auto-approve off
    const agentPromise = runAgent({
      agentId,
      config: modelConfig,
      workspaceRoot: TEST_DIR,
      userText: 'write protected file',
      settings: {
        autoApproveEdit: false,
        maxSteps: 2,
      },
      send: (e) => {
        events.push(e);
        // When approval requested, reject it
        if (e.type === 'approval_request') {
          setTimeout(() => {
            resolveApproval(agentId, e.callId, false);
          }, 10);
        }
      },
    });

    await agentPromise;

    const approvalEvt = events.find((e) => e.type === 'approval_request');
    assert.ok(approvalEvt, 'approval was requested by agent');

    const deniedEvt = events.find((e) => e.type === 'tool_end' && e.denied);
    assert.ok(deniedEvt, 'tool was marked as denied');

    assert.equal(fs.existsSync(protectedFile), false, 'protected file was NOT created after denial');
  });

  // Test 3: Direct conversational Chat Mode (no tools executed)
  await runCheck('conversational chat mode (answers without tool calls)', async () => {
    const agentId = `headless-test-chat-${Date.now()}`;
    const events = [];

    await runAgent({
      agentId,
      config: modelConfig,
      workspaceRoot: TEST_DIR,
      userText: 'hello there! what is react hooks?',
      settings: {
        maxSteps: 5,
      },
      send: (e) => events.push(e),
    });

    const modeEvt = events.find((e) => e.type === 'mode');
    assert.ok(modeEvt, 'mode event was emitted');
    assert.equal(modeEvt.mode, 'chat', 'conversational prompt correctly routed to chat');

    const toolEvents = events.filter((e) => e.type === 'tool_start');
    assert.equal(toolEvents.length, 0, 'no tools were invoked in chat mode');

    const deltas = events.filter((e) => e.type === 'assistant_delta');
    assert.ok(deltas.length > 0, 'streaming deltas received in chat mode');
  });

  // Test 4: Follow-up continuity in Auto Mode
  await runCheck('auto mode follow-up confirmations maintain agent mode', () => {
    assert.equal(detectMode('ok do it'), 'agent');
    assert.equal(detectMode('karo'), 'agent');
    assert.equal(detectMode('continue'), 'agent');
    assert.equal(detectMode('haan karo'), 'agent');
    assert.equal(detectMode('go ahead'), 'agent');
    assert.equal(detectMode('add a dark mode toggle'), 'agent');
    assert.equal(detectMode('write the file'), 'agent');
    assert.equal(detectMode('read the config'), 'agent');
  });

} finally {
  // Shutdown mock LLM server
  mockProc.kill();
  // Cleanup test directory
  await fsp.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
}

console.log(`\nHeadless Suite Results: ${passed}/${passed + failed} passed (${failed} failed)\n`);
if (failed > 0) {
  process.exit(1);
}
process.exit(0);
