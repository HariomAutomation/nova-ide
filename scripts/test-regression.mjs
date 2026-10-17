// Comprehensive Regression Test Suite for Nova IDE core engine
// Tests: fsTools, checkpoints, terminal, web, geminiWeb, agent rules, and inline completions
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

import fsTools from '../electron/tools/fsTools.js';
import checkpoints from '../electron/tools/checkpoints.js';
import { runCommand } from '../electron/tools/terminal.js';
import { webFetch, webSearch } from '../electron/tools/web.js';
import { parseWebToolCalls } from '../electron/gemini-web.js';
import { loadRules, toolSchemas } from '../electron/agent.js';
import { getHeuristicCompletion } from '../renderer/src/completion-heuristics.js';

const TEST_DIR = path.join(os.tmpdir(), 'nova-regression-' + Date.now());
await fsp.mkdir(TEST_DIR, { recursive: true });

const results = [];
function test(name, fn) {
  return async () => {
    try {
      await fn();
      results.push({ name, pass: true });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      results.push({ name, pass: false, error: err.message });
      console.error(`  ✗ ${name}: ${err.message}`);
    }
  };
}

const suite = [];

/* -------------------------------- fsTools -------------------------------- */

suite.push(
  test('fsTools: writeFileTool creates directory and writes file', async () => {
    const target = path.join(TEST_DIR, 'sub', 'nested', 'hello.txt');
    const res = await fsTools.writeFileTool(target, 'line1\nline2\nline3\n');
    assert.equal(res.ok, true);
    assert.equal(fs.existsSync(target), true);
    assert.equal(fs.readFileSync(target, 'utf8'), 'line1\nline2\nline3\n');
  })
);

suite.push(
  test('fsTools: readFileTool reads line slices with line numbers', async () => {
    const target = path.join(TEST_DIR, 'sub', 'nested', 'hello.txt');
    const res = await fsTools.readFileTool(target, { offset: 2, limit: 2 });
    assert.equal(res.from, 2);
    assert.equal(res.to, 3);
    assert.match(res.content, /2\tline2/);
    assert.match(res.content, /3\tline3/);
  })
);

suite.push(
  test('fsTools: editFileTool safely replaces exact target string', async () => {
    const target = path.join(TEST_DIR, 'sub', 'nested', 'hello.txt');
    const res = await fsTools.editFileTool(target, 'line2', 'line2-modified');
    assert.equal(res.ok, true);
    assert.equal(res.occurrences, 1);
    const content = fs.readFileSync(target, 'utf8');
    assert.match(content, /line2-modified/);
  })
);

suite.push(
  test('fsTools: editFileTool detects ambiguous occurrences', async () => {
    const target = path.join(TEST_DIR, 'sub', 'nested', 'ambiguous.txt');
    await fsTools.writeFileTool(target, 'repeat repeat repeat');
    const res = await fsTools.editFileTool(target, 'repeat', 'one');
    assert.ok(res.error);
    assert.match(res.error, /occurs 3 times/);
  })
);

suite.push(
  test('fsTools: listDir ignores node_modules and .git by default', async () => {
    const nmDir = path.join(TEST_DIR, 'node_modules');
    await fsp.mkdir(nmDir, { recursive: true });
    await fsTools.writeFileTool(path.join(nmDir, 'pkg.json'), '{}');
    const list = await fsTools.listDir(TEST_DIR);
    const names = list.map((e) => e.name);
    assert.ok(names.includes('sub'));
    assert.ok(!names.includes('node_modules'));
  })
);

suite.push(
  test('fsTools: searchFiles searches regex across files', async () => {
    const res = await fsTools.searchFiles({ pattern: 'line2-modified', dir: TEST_DIR });
    assert.ok(res.count >= 1);
    assert.ok(res.results.some((r) => r.text.includes('line2-modified')));
  })
);

suite.push(
  test('fsTools: deleteFileTool deletes file', async () => {
    const target = path.join(TEST_DIR, 'to-delete.txt');
    await fsTools.writeFileTool(target, 'trash');
    const res = await fsTools.deleteFileTool(target);
    assert.equal(res.ok, true);
    assert.equal(fs.existsSync(target), false);
  })
);

/* ------------------------------- checkpoints ------------------------------- */

suite.push(
  test('checkpoints: snapshots and restores modified file', async () => {
    const agentId = 'test-agent-' + Date.now();
    const target = path.join(TEST_DIR, 'checkpoint-target.txt');
    await fsTools.writeFileTool(target, 'initial content');

    // Snapshot before agent edit
    const snap = await checkpoints.snapshot(agentId, target);
    assert.ok(snap.existed);
    assert.ok(snap.backup);

    // Agent modifies file
    await fsTools.writeFileTool(target, 'agent dirty content');
    assert.equal(fs.readFileSync(target, 'utf8'), 'agent dirty content');

    // Rollback
    const res = await checkpoints.restore(agentId);
    assert.ok(res.restored.length >= 1);
    assert.equal(fs.readFileSync(target, 'utf8'), 'initial content');
  })
);

suite.push(
  test('checkpoints: removes newly created files on rollback', async () => {
    const agentId = 'test-agent-new-' + Date.now();
    const target = path.join(TEST_DIR, 'newly-created.txt');

    // Snapshot before non-existent file is created
    const snap = await checkpoints.snapshot(agentId, target);
    assert.equal(snap.existed, false);

    // Agent creates file
    await fsTools.writeFileTool(target, 'new file');
    assert.equal(fs.existsSync(target), true);

    // Rollback should delete it
    const res = await checkpoints.restore(agentId);
    assert.ok(res.restored.some((r) => r.path === target && r.action === 'deleted'));
    assert.equal(fs.existsSync(target), false);
  })
);

/* -------------------------------- terminal -------------------------------- */

suite.push(
  test('terminal: runCommand executes shell command and captures stdout', async () => {
    const res = await runCommand({ command: 'echo "NOVA_TERMINAL_TEST_123"' });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /NOVA_TERMINAL_TEST_123/);
  })
);

/* ---------------------------------- web ---------------------------------- */

suite.push(
  test('web: webFetch rejects invalid URLs cleanly', async () => {
    const res = await webFetch('ftp://not-supported');
    assert.equal(res.ok, false);
  })
);

suite.push(
  test('web: webSearch requires query', async () => {
    const res = await webSearch('');
    assert.equal(res.ok, false);
  })
);

/* -------------------------------- geminiWeb -------------------------------- */

suite.push(
  test('geminiWeb: parseWebToolCalls parses array tool calls', () => {
    const raw = JSON.stringify({
      tool_calls: [{ name: 'read_file', arguments: { file: 'index.js' } }],
    });
    const parsed = parseWebToolCalls(raw);
    assert.ok(parsed && parsed.length === 1);
    assert.equal(parsed[0].name, 'read_file');
    assert.match(parsed[0].argsRaw, /index\.js/);
  })
);

suite.push(
  test('geminiWeb: parseWebToolCalls parses single tool object', () => {
    const raw = '{"name": "write_file", "arguments": {"file": "a.txt", "content": "123"}}';
    const parsed = parseWebToolCalls(raw);
    assert.ok(parsed && parsed.length === 1);
    assert.equal(parsed[0].name, 'write_file');
  })
);

suite.push(
  test('geminiWeb: parseWebToolCalls parses fenced JSON block', () => {
    const raw = 'Sure! Here is the call:\n```json\n{"tool": "run_terminal_cmd", "params": {"command": "pwd"}}\n```';
    const parsed = parseWebToolCalls(raw);
    assert.ok(parsed && parsed.length === 1);
    assert.equal(parsed[0].name, 'run_terminal_cmd');
    assert.match(parsed[0].argsRaw, /pwd/);
  })
);

suite.push(
  test('geminiWeb: parseWebToolCalls returns null for conversational answers', () => {
    const raw = 'Hello! I am Gemini 4. How can I help you today with your project?';
    const parsed = parseWebToolCalls(raw);
    assert.equal(parsed, null);
  })
);

/* ------------------------------- agent rules ------------------------------- */

suite.push(
  test('agent: loadRules loads .cursorrules, .cursor/rules/*.mdc and NOVA.md', async () => {
    const ruleWs = path.join(TEST_DIR, 'rule-ws');
    await fsp.mkdir(path.join(ruleWs, '.cursor', 'rules'), { recursive: true });

    await fsTools.writeFileTool(path.join(ruleWs, '.cursorrules'), 'Use TypeScript strictly');
    await fsTools.writeFileTool(path.join(ruleWs, '.cursor', 'rules', 'frontend.mdc'), 'Prefer CSS modules');
    await fsTools.writeFileTool(path.join(ruleWs, 'NOVA.md'), 'Always write tests');

    const rules = (await loadRules(ruleWs)).join('\n\n');
    assert.match(rules, /Use TypeScript strictly/);
    assert.match(rules, /Prefer CSS modules/);
    assert.match(rules, /Always write tests/);
  })
);

suite.push(
  test('agent: toolSchemas generates expected core tool definitions', async () => {
    const schemas = await toolSchemas({ webSearch: true, webFetch: true });
    const names = schemas.map((s) => s.function.name);
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('write_file'));
    assert.ok(names.includes('edit_file'));
    assert.ok(names.includes('run_terminal_cmd'));
    assert.ok(names.includes('grep_search'));
    assert.ok(names.includes('web_search'));
    assert.ok(names.includes('web_fetch'));
  })
);

/* ------------------------- inline completions ------------------------- */

suite.push(
  test('inlineCompletions: getHeuristicCompletion provides instant patterns', () => {
    assert.equal(getHeuristicCompletion('const ['), 'state, setState] = useState(null);');
    assert.equal(getHeuristicCompletion('console.'), 'log()');
    assert.equal(getHeuristicCompletion('try {'), '\n} catch (err) {\n  console.error(err);\n}');
    assert.equal(getHeuristicCompletion('if ('), 'condition) {\n  \n}');
  })
);

/* --------------------------------- runner --------------------------------- */

console.log('\n--- Running Nova IDE Regression Test Suite ---\n');
for (const t of suite) {
  await t();
}

// Cleanup test dir
await fsp.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});

const total = results.length;
const passed = results.filter((r) => r.pass).length;
const failed = total - passed;

console.log(`\nRegression Suite Results: ${passed}/${total} passed (${failed} failed)`);
if (failed > 0) {
  process.exit(1);
}
process.exit(0);
