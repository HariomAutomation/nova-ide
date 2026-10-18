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
import { parseWebToolCalls, protocolBlock, setEngineMode, getEngineMode } from '../electron/gemini-web.js';
import { describeHttpError } from '../electron/tools/errors.js';
import { gpuPlan } from '../electron/tools/gpu-flags.js';
import { loadRules, toolSchemas, compactMessages, normalizeTodos, codeLineage, estimateChars, fitFromSizeError, detectMode } from '../electron/agent.js';
import { isWithin } from '../electron/tools/paths.js';
import computer from '../electron/tools/computer.js';
import git from '../electron/tools/git.js';
import gdrive from '../electron/tools/gdrive.js';
import gh from '../electron/tools/github.js';
import cloudcode from '../electron/tools/cloudcode.js';
import voice from '../electron/tools/voice.js';
import { usableModels, isModelUsable } from '../renderer/src/model-filter.js';
import { formatRetry, retryWindow, sizeNumbers } from '../renderer/src/error-text.js';
import {
  groupModels,
  latestOf,
  versionOf,
  variantsOf,
  variantCount,
  pickerMaxHeight,
  chipLabel,
  isChatModel,
  chatModels,
} from '../renderer/src/model-family.js';
import { handle as mcpHandle, askGemini } from './mcp-gemini-web.mjs';
import * as geminiPw from '../electron/gemini-pw.js';
import {
  isAutomationDue,
  dueAutomations,
  normalizeTrigger,
  describeTrigger,
} from '../renderer/src/automation-schedule.js';
import { getHeuristicCompletion } from '../renderer/src/completion-heuristics.js';

const ROOT_DIR = process.cwd();
const TEST_DIR = path.join(os.tmpdir(), 'nova-regression-' + Date.now());
process.env.NOVA_HOME = TEST_DIR;
process.env.NOVA_CONFIG_DIR = TEST_DIR;
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

/* --------------------------- fixes: path safety --------------------------- */

suite.push(
  test('paths: isWithin rejects sibling prefix dirs and escapes', () => {
    assert.equal(isWithin('/a/b', '/a/b/c'), true);
    assert.equal(isWithin('/a/b', '/a/b'), true);
    assert.equal(isWithin('/a/b', '/a/bc'), false); // prefix, not a child
    assert.equal(isWithin('/a/b', '/a/b/../c'), false);
    assert.equal(isWithin('/a/b', '/a'), false);
    assert.equal(isWithin('/a/b', ''), false);
  })
);

/* ------------------------ fixes: editFileTool $-safety ------------------------ */

suite.push(
  test('fsTools: editFileTool keeps $ patterns in new_string literal', async () => {
    const target = path.join(TEST_DIR, 'dollar.txt');
    await fsTools.writeFileTool(target, 'TOTAL=1\n');
    await fsTools.editFileTool(target, 'TOTAL=1', 'TOTAL=$$');
    assert.equal(fs.readFileSync(target, 'utf8'), 'TOTAL=$$\n');

    await fsTools.writeFileTool(target, 'a\n');
    await fsTools.editFileTool(target, 'a', '$&$&');
    assert.equal(fs.readFileSync(target, 'utf8'), '$&$&\n');
  })
);

/* ------------------------ fixes: readFileTool limit clamp ------------------------ */

suite.push(
  test('fsTools: readFileTool clamps an oversized limit', async () => {
    const target = path.join(TEST_DIR, 'big.txt');
    const body = Array.from({ length: 8000 }, (_, i) => 'L' + (i + 1)).join('\n');
    await fsTools.writeFileTool(target, body);
    const r = await fsTools.readFileTool(target, { limit: 1e9 });
    assert.ok(r.to - r.from + 1 <= 5000);
    assert.ok(r.truncated);
  })
);

/* --------------------------- fixes: terminal timeout --------------------------- */

suite.push(
  test('terminal: runCommand times out and stops a long command', async () => {
    const t0 = Date.now();
    const res = await runCommand({ command: 'sleep 30', timeoutMs: 400 });
    assert.equal(res.timedOut, true);
    assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0}ms`);
  })
);

/* ------------------------ improvement: context compaction ------------------------ */

suite.push(
  test('agent: compactMessages collapses old tool output, keeps recent + pairing', () => {
    const msgs = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 40; i++) {
      msgs.push({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c' + i, type: 'function', function: { name: 'read_file', arguments: '{}' } }],
      });
      msgs.push({ role: 'tool', tool_call_id: 'c' + i, content: 'X'.repeat(500) });
    }
    const out = compactMessages(msgs, { keepRecent: 10 });
    assert.equal(out.length, msgs.length); // nothing dropped -> pairing intact
    assert.equal(out[0].content, 'sys');
    assert.equal(out[1].role, 'assistant'); // tool_calls preserved
    assert.equal(out[2].content, '[older tool output omitted to save context]');
    assert.equal(out[out.length - 1].content, 'X'.repeat(500)); // recent window verbatim

    // Every assistant tool_call still has a matching tool reply.
    const callIds = out.filter((m) => m.role === 'assistant' && m.tool_calls).flatMap((m) => m.tool_calls.map((t) => t.id));
    const replyIds = out.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
    assert.deepEqual(callIds, replyIds);

    // Short transcripts are returned untouched (same reference).
    const small = [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }];
    assert.equal(compactMessages(small), small);
  })
);

/* --------------------------- Cursor-parity tools --------------------------- */

suite.push(
  test('agent: toolSchemas exposes the Cursor-parity tools', async () => {
    const names = (await toolSchemas({ webSearch: true, webFetch: true })).map((s) => s.function.name);
    assert.ok(names.includes('todo_write'), 'todo_write missing');
    assert.ok(names.includes('code_lineage'), 'code_lineage missing');
  })
);

suite.push(
  test('agent: normalizeTodos bounds and coerces status', () => {
    const out = normalizeTodos([
      { text: '  read the file ', status: 'in_progress' },
      { text: 'write tests', status: 'done' },
      { text: 'bogus status', status: 'weird' },
      { text: '   ' }, // dropped
      null, // dropped
    ]);
    assert.equal(out.length, 3);
    assert.deepEqual(out[0], { text: 'read the file', status: 'in_progress' });
    assert.deepEqual(out[1], { text: 'write tests', status: 'done' });
    assert.equal(out[2].status, 'pending');
    assert.deepEqual(normalizeTodos('nope'), []);
    assert.ok(normalizeTodos(Array.from({ length: 80 }, (_, i) => ({ text: 't' + i }))).length <= 50);
  })
);

suite.push(
  test('agent: codeLineage returns git history for a file and a line range', async () => {
    const repo = path.join(TEST_DIR, 'git-repo');
    await fsp.mkdir(repo, { recursive: true });
    const setup =
      'git init -q && git config user.email t@t && git config user.name t && ' +
      'printf "a\\nb\\nc\\n" > f.txt && git add f.txt && git commit -qm first && ' +
      'printf "a\\nB2\\nc\\n" > f.txt && git commit -qam second';
    const r = await runCommand({ command: setup, cwd: repo });
    assert.equal(r.code, 0, r.stderr);

    const whole = await codeLineage({ path: 'f.txt' }, { workspaceRoot: repo });
    assert.equal(whole.ok, true);
    assert.match(whole.text, /Lineage of f\.txt:/);
    assert.match(whole.text, /first|second/);

    const range = await codeLineage({ path: 'f.txt', start_line: 2, end_line: 2 }, { workspaceRoot: repo });
    assert.match(range.text, /Lineage of f\.txt \(lines 2-2\)/);

    const missing = await codeLineage({}, { workspaceRoot: repo });
    assert.equal(missing.ok, false);
  })
);

/* --------------------------- computer-use mirror --------------------------- */

suite.push(
  test('computer: buildInputCommands maps xdotool actions', () => {
    const cap = { inputMethod: 'xdotool' };
    assert.deepEqual(computer.buildInputCommands('move', { x: 10, y: 20 }, cap), [
      { bin: 'xdotool', args: ['mousemove', '10', '20'] },
    ]);
    assert.deepEqual(computer.buildInputCommands('click', { x: 5, y: 6 }, cap)[0].args, [
      'mousemove', '5', '6', 'click', '--repeat', '1', '--delay', '60', '1',
    ]);
    assert.deepEqual(computer.buildInputCommands('double_click', {}, cap)[0].args, [
      'click', '--repeat', '2', '--delay', '60', '1',
    ]);
    assert.deepEqual(computer.buildInputCommands('right_click', {}, cap)[0].args, [
      'click', '--repeat', '1', '--delay', '60', '3',
    ]);
    assert.deepEqual(computer.buildInputCommands('drag', { x: 1, y: 2, to_x: 3, to_y: 4 }, cap)[0].args, [
      'mousemove', '1', '2', 'mousedown', '1', 'mousemove', '--sync', '3', '4', 'mouseup', '1',
    ]);
    assert.deepEqual(computer.buildInputCommands('scroll', { direction: 'up', amount: 2 }, cap)[0].args, [
      'click', '--repeat', '2', '--delay', '30', '4',
    ]);
    assert.deepEqual(computer.buildInputCommands('key', { key: 'ctrl+a' }, cap)[0].args, ['key', 'ctrl+a']);
    // move without coordinates is a no-op, not a crash
    assert.deepEqual(computer.buildInputCommands('move', {}, cap), []);
  })
);

suite.push(
  test('computer: buildInputCommands handles ydotool and unsupported combos', () => {
    const cap = { inputMethod: 'ydotool' };
    assert.deepEqual(computer.buildInputCommands('move', { x: 1, y: 2 }, cap), [
      { bin: 'ydotool', args: ['mousemove', '--absolute', '-x', '1', '-y', '2'] },
    ]);
    assert.deepEqual(computer.buildInputCommands('click', {}, cap), [{ bin: 'ydotool', args: ['click', '0xC0'] }]);
    assert.throws(() => computer.buildInputCommands('drag', { x: 1, y: 2, to_x: 3, to_y: 4 }, cap), /not supported by ydotool/);
    assert.throws(() => computer.buildInputCommands('scroll', {}, cap), /not supported by ydotool/);
  })
);

suite.push(
  test('computer: clampPoint keeps points on screen', () => {
    assert.deepEqual(computer.clampPoint(-5, 10, { width: 100, height: 50 }), { x: 0, y: 10 });
    assert.deepEqual(computer.clampPoint(500, 500, { width: 100, height: 50 }), { x: 99, y: 49 });
    assert.deepEqual(computer.clampPoint(10, 10, null), { x: 10, y: 10 });
  })
);

suite.push(
  test('computer: buildInputCommands errors without an input tool', () => {
    assert.throws(
      () => computer.buildInputCommands('click', { x: 1, y: 1 }, { inputMethod: null, session: 'x11' }),
      /No input tool available/
    );
  })
);

suite.push(
  test('agent: computer_use exposes the full action set', async () => {
    const schema = (await toolSchemas({})).find((s) => s.function.name === 'computer_use');
    const actions = schema.function.parameters.properties.action.enum;
    for (const a of ['screenshot', 'move', 'click', 'double_click', 'right_click', 'drag', 'scroll', 'type', 'key', 'wait']) {
      assert.ok(actions.includes(a), `${a} missing`);
    }
  })
);

/* --------------------- prompt-tools fallback (free models) --------------------- */

suite.push(
  test('geminiWeb: protocolBlock renders a tool surface for the fallback', () => {
    const block = protocolBlock([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'integer' } }, required: ['path'] },
        },
      },
    ]);
    assert.match(block, /read_file\(path, limit\?\)/);
    assert.match(block, /tool_calls/);
    assert.match(protocolBlock([]), /^$/); // no tools -> empty
  })
);

suite.push(
  test('geminiWeb: a protocolBlock round-trips through parseWebToolCalls', () => {
    const block = protocolBlock([
      { type: 'function', function: { name: 'run_terminal_cmd', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
    ]);
    assert.ok(block.includes('run_terminal_cmd'));
    // A model following the protocol replies with exactly this shape:
    const reply = '{"tool_calls":[{"name":"run_terminal_cmd","arguments":{"command":"npm test"}}]}';
    const calls = parseWebToolCalls(reply);
    assert.ok(calls && calls.length === 1);
    assert.equal(calls[0].name, 'run_terminal_cmd');
    assert.match(calls[0].argsRaw, /npm test/);
  })
);

/* ------------------------------- automations ------------------------------- */

suite.push(
  test('automation: normalizeTrigger validates and clamps', () => {
    assert.deepEqual(normalizeTrigger({ type: 'interval', minutes: 0 }), { type: 'interval', minutes: 60 }); // 0 is invalid -> default
    assert.deepEqual(normalizeTrigger({ type: 'interval', minutes: 99999 }), { type: 'interval', minutes: 10080 });
    assert.deepEqual(normalizeTrigger({ type: 'daily', time: '7:05' }), { type: 'daily', time: '07:05' });
    assert.deepEqual(normalizeTrigger({ type: 'daily', time: '7:5' }), { type: 'daily', time: '09:00' }); // needs 2-digit minutes
    assert.deepEqual(normalizeTrigger({ type: 'daily', time: 'nope' }), { type: 'daily', time: '09:00' });
    assert.deepEqual(normalizeTrigger({ type: 'bogus' }), { type: 'manual' });
    assert.deepEqual(normalizeTrigger(null), { type: 'manual' });
  })
);

suite.push(
  test('automation: isAutomationDue across trigger types', () => {
    const now = new Date(2026, 0, 1, 10, 0, 0).getTime();
    assert.equal(isAutomationDue({ enabled: true, trigger: { type: 'manual' } }, now), false);
    assert.equal(isAutomationDue({ enabled: false, trigger: { type: 'interval', minutes: 1 }, lastRunAt: 0 }, now), false);
    // startup: once
    assert.equal(isAutomationDue({ enabled: true, trigger: { type: 'startup' }, lastRunAt: 0 }, now), true);
    assert.equal(isAutomationDue({ enabled: true, trigger: { type: 'startup' }, lastRunAt: 1 }, now), false);
    // interval
    assert.equal(isAutomationDue({ enabled: true, trigger: { type: 'interval', minutes: 30 }, lastRunAt: now - 29 * 60000 }, now), false);
    assert.equal(isAutomationDue({ enabled: true, trigger: { type: 'interval', minutes: 30 }, lastRunAt: now - 31 * 60000 }, now), true);
    // daily 09:00 — now is 10:00
    assert.equal(isAutomationDue({ enabled: true, trigger: { type: 'daily', time: '09:00' }, lastRunAt: 0 }, now), true);
    assert.equal(
      isAutomationDue({ enabled: true, trigger: { type: 'daily', time: '09:00' }, lastRunAt: new Date(2026, 0, 1, 9, 30).getTime() }, now),
      false,
    );
    assert.equal(isAutomationDue({ enabled: true, trigger: { type: 'daily', time: '23:00' }, lastRunAt: 0 }, now), false);
  })
);

suite.push(
  test('automation: dueAutomations filters + orders, describeTrigger labels', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const list = [
      { id: 'a', createdAt: 2, enabled: true, trigger: { type: 'startup' }, lastRunAt: 0 },
      { id: 'b', createdAt: 1, enabled: true, trigger: { type: 'startup' }, lastRunAt: 0 },
      { id: 'c', createdAt: 3, enabled: true, trigger: { type: 'manual' } },
      { id: 'd', createdAt: 4, enabled: true, trigger: { type: 'interval', minutes: 5 }, lastRunAt: now },
    ];
    const due = dueAutomations(list, now).map((x) => x.id);
    assert.deepEqual(due, ['b', 'a']);
    assert.deepEqual(dueAutomations(null, now), []);
    assert.equal(describeTrigger({ type: 'manual' }), 'Manual');
    assert.equal(describeTrigger({ type: 'interval', minutes: 15 }), 'Every 15 min');
    assert.equal(describeTrigger({ type: 'daily', time: '07:30' }), 'Daily at 07:30');
    assert.equal(describeTrigger({ type: 'startup' }), 'On app start');
  })
);

/* ----------------------------------- git ----------------------------------- */

suite.push(
  test('git: parseStatusPorcelain parses branch, tracking and files', () => {
    const out = git.parseStatusPorcelain(
      [
        '## main...origin/main [ahead 1, behind 2]',
        ' M src/a.js',
        'M  src/b.js',
        '?? new.txt',
        'R  old.js -> renamed.js',
        ' D gone.js',
      ].join('\n'),
    );
    assert.equal(out.branch, 'main');
    assert.equal(out.upstream, 'origin/main');
    assert.equal(out.ahead, 1);
    assert.equal(out.behind, 2);
    assert.equal(out.files.length, 5);
    const byPath = Object.fromEntries(out.files.map((f) => [f.path, f]));
    assert.equal(byPath['src/a.js'].label, 'modified');
    assert.equal(byPath['src/a.js'].staged, false);
    assert.equal(byPath['src/b.js'].staged, true);
    assert.equal(byPath['new.txt'].label, 'untracked');
    assert.equal(byPath['new.txt'].staged, false);
    assert.equal(byPath['renamed.js'].label, 'renamed');
    assert.equal(byPath['renamed.js'].origPath, 'old.js');
    assert.equal(byPath['gone.js'].label, 'deleted');
  })
);

suite.push(
  test('git: status / diff / stage / commit round-trip', async () => {
    const repo = path.join(TEST_DIR, 'git-sc');
    await fsp.mkdir(repo, { recursive: true });
    const setup =
      'git init -q && git config user.email t@t && git config user.name t && ' +
      'printf "a\\n" > f.txt && git add f.txt && git commit -qm init';
    const r = await runCommand({ command: setup, cwd: repo });
    assert.equal(r.code, 0, r.stderr);

    await fsTools.writeFileTool(path.join(repo, 'f.txt'), 'a\nb\n');
    let st = await git.status(repo);
    assert.equal(st.repo, true);
    assert.ok(st.branch, 'branch detected');
    assert.ok(st.files.some((f) => f.path === 'f.txt' && f.label === 'modified'));

    const d = await git.diff(repo, 'f.txt');
    assert.match(d.diff, /\+b/);

    await git.stage(repo, ['f.txt']);
    st = await git.status(repo);
    assert.ok(st.files.find((f) => f.path === 'f.txt').staged);

    const c = await git.commit(repo, 'add b');
    assert.equal(c.ok, true, c.error);
    st = await git.status(repo);
    assert.equal(st.files.length, 0);

    const log = await git.log(repo, 5);
    assert.ok(log.commits.length >= 2);
    assert.match(log.commits[0].subject, /add b/);
  })
);

suite.push(
  test('git: worktreeAdd creates a sibling worktree on a new branch', async () => {
    const repo = path.join(TEST_DIR, 'git-wt');
    await fsp.mkdir(repo, { recursive: true });
    const setup =
      'git init -q && git config user.email t@t && git config user.name t && ' +
      'printf "a\\n" > f.txt && git add f.txt && git commit -qm init';
    const r0 = await runCommand({ command: setup, cwd: repo });
    assert.equal(r0.code, 0, r0.stderr);

    const dir = repo + '-wt';
    const r = await git.worktreeAdd(repo, dir, 'wt-branch');
    assert.equal(r.ok, true, r.error);

    const list = await git.worktreeList(repo);
    assert.ok(list.worktrees.some((w) => w.path === dir), 'worktree path listed');
    assert.ok(list.worktrees.some((w) => w.branch === 'wt-branch'), 'worktree branch listed');
  })
);

/* ----------------------------------- cloud ----------------------------------- */

suite.push(
  test('gdrive: exposes the cloud API and reports status', async () => {
    for (const fn of ['status', 'save', 'login', 'logout', 'listFiles', 'readFile', 'downloadFile']) {
      assert.equal(typeof gdrive[fn], 'function', `${fn} missing`);
    }
    const st = await gdrive.status();
    assert.equal(typeof st.connected, 'boolean');
    assert.equal(typeof st.hasClient, 'boolean');
    assert.match(st.scope, /drive\.readonly/);
    assert.match(st.configPath, /gdrive\.json$/);
  })
);

/* ---------------------------------- memory ---------------------------------- */

suite.push(
  test('memory: add / list / memoryText / remove round-trip', async () => {
    process.env.NOVA_CONFIG_DIR = path.join(TEST_DIR, 'nova-home');
    const memory = (await import('../electron/tools/memory.js')).default;
    await memory.clear();

    const a = await memory.add('User prefers TypeScript and pnpm.', 'user');
    assert.equal(a.ok, true);
    await memory.add('Project Nova uses Electron + Vite.', 'agent');

    const l = await memory.list();
    assert.equal(l.notes.length, 2);
    assert.match(l.path, /memory[\\/]local\.json$/);
    assert.equal(l.account, 'local');

    const txt = await memory.memoryText();
    assert.match(txt, /TypeScript/);
    assert.match(txt, /Electron/);

    await memory.remove(l.notes[0].id);
    const l2 = await memory.list();
    assert.equal(l2.notes.length, 1);

    const setRes = await memory.setNotes([{ id: 'x1', text: 'Merged from Drive', source: 'agent' }]);
    assert.equal(setRes.notes.length, 1);
    assert.equal((await memory.list()).notes.length, 1);

    assert.equal(memory.normalizeText('  a\n\n   b  '), 'a b');
    assert.equal((await memory.add('   ')).error, 'Note is empty.');
  })
);

suite.push(
  test('memory: each account gets its own namespace', async () => {
    const memory = (await import('../electron/tools/memory.js')).default;
    await memory.setAccount('local');
    await memory.clear();
    await memory.add('local note', 'user');

    const alice = await memory.setAccount('alice@example.com');
    assert.equal(alice.account, 'alice@example.com');
    assert.equal(alice.notes.length, 0, 'fresh namespace for a new account');
    await memory.add('alice note', 'user');
    assert.equal((await memory.list()).notes.length, 1);

    const back = await memory.setAccount('local');
    assert.equal(back.notes.length, 1);
    assert.match(back.notes[0].text, /local note/);

    assert.equal(memory.sanitizeAccount('Bob@Example.com'), 'bob@example.com');
    assert.equal(memory.sanitizeAccount(''), 'local');
  })
);

/* ---------------------------------- github ---------------------------------- */

suite.push(
  test('github: exposes the API and validates tokens without hitting the network', async () => {
    process.env.NOVA_CONFIG_DIR = path.join(TEST_DIR, 'nova-home');
    for (const fn of ['status', 'save', 'logout', 'listRepos', 'clone', 'whoami']) {
      assert.equal(typeof gh[fn], 'function', `${fn} missing`);
    }
    const st = await gh.status();
    assert.equal(typeof st.connected, 'boolean');
    assert.match(st.configPath, /github\.json$/);
    assert.equal((await gh.save('   ')).error, 'Token required');
  })
);

suite.push(
  test('github: clone opens already existing directory without failing', async () => {
    const reposDir = path.join(os.homedir(), 'nova-repos');
    const dummyName = 'test-existed-repo-' + Date.now();
    const dest = path.join(reposDir, dummyName);
    await fsp.mkdir(dest, { recursive: true });
    try {
      const res = await gh.clone('https://github.com/foo/' + dummyName + '.git', dummyName);
      assert.equal(res.ok, true);
      assert.equal(res.existed, true);
      assert.equal(res.path, dest);
    } finally {
      await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
    }
  })
);

suite.push(
  test('github: clone routes conflicting remote origin to deterministic folder', async () => {
    const reposDir = path.join(os.homedir(), 'nova-repos');
    const dummyName = 'test-conflict-' + Date.now();
    const dest = path.join(reposDir, dummyName);
    await fsp.mkdir(dest, { recursive: true });
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync('git', ['init'], { cwd: dest, stdio: 'ignore' });
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/other-org/other-repo.git'], { cwd: dest, stdio: 'ignore' });

      // Attempting to clone another repo to this existing folder name should not clobber dest
      const res = await gh.clone('https://github.com/my-org/my-repo.git', dummyName);
      assert.notEqual(res.path, dest);
    } finally {
      await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
      const entries = await fsp.readdir(reposDir).catch(() => []);
      for (const e of entries) {
        if (e.startsWith(dummyName)) {
          await fsp.rm(path.join(reposDir, e), { recursive: true, force: true }).catch(() => {});
        }
      }
    }
  })
);

/* --------------------------------- cloud code --------------------------------- */

suite.push(
  test('cloudcode: maps OpenAI-style messages + tools to the Gemini shape', () => {
    const contents = cloudcode.toGeminiContents([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'file body' },
    ]);
    assert.equal(contents.length, 3);
    assert.equal(contents[0].role, 'user');
    assert.equal(contents[0].parts[0].text, 'hi');
    assert.equal(contents[1].role, 'model');
    assert.equal(contents[1].parts[0].functionCall.name, 'read_file');
    assert.deepEqual(contents[1].parts[0].functionCall.args, { path: 'a.js' });
    assert.equal(contents[2].parts[0].functionResponse.name, 'read_file');

    const decls = cloudcode.toFunctionDeclarations([
      {
        name: 'read_file',
        description: 'read',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ]);
    assert.equal(decls[0].functionDeclarations[0].name, 'read_file');
    assert.equal(decls[0].functionDeclarations[0].parameters.additionalProperties, undefined);
    assert.equal(cloudcode.toFunctionDeclarations([]), undefined);
    assert.equal(typeof cloudcode.generate, 'function');
  })
);

/* --------------------------- linux GPU flags --------------------------- */

suite.push(
  test('gpu flags: Wayland gets the ozone hint and no Vulkan, other OSes untouched', () => {
    // non-Linux: leave Chromium alone
    assert.deepEqual(gpuPlan({ platform: 'win32', env: {} }).switches, []);

    // Linux on X11: just let Chromium pick the platform
    const x11 = gpuPlan({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11' } });
    assert.equal(x11.mode, 'auto');
    assert.equal(x11.wayland, false);
    assert.deepEqual(x11.switches, [['ozone-platform-hint', 'auto']]);

    // Wayland: also drop Vulkan + VA-API (the reported errors)
    const wl = gpuPlan({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' } });
    assert.equal(wl.wayland, true);
    const flat = wl.switches.map(([k, v]) => `${k}=${v}`);
    assert.ok(flat.includes('ozone-platform-hint=auto'));
    assert.ok(flat.some((x) => x.startsWith('disable-features=') && x.includes('Vulkan')));

    // WAYLAND_DISPLAY is enough on its own
    assert.equal(gpuPlan({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } }).wayland, true);

    // escape hatches
    assert.equal(gpuPlan({ platform: 'linux', env: { NOVA_GPU: 'off' } }).mode, 'off');
    assert.equal(gpuPlan({ platform: 'linux', env: { NOVA_GPU: 'keep', XDG_SESSION_TYPE: 'wayland' } }).mode, 'keep');
    assert.deepEqual(gpuPlan({ platform: 'linux', env: { NOVA_GPU: 'keep' } }).switches, []);
  })
);

/* --------------------------- oversized requests --------------------------- */

suite.push(
  test('oversized request: Nova shrinks the context instead of just failing', () => {
    const groq =
      'HTTP 413 Payload Too Large: Request too large for model `qwen/qwen3.8-27b` in organization `org_1` ' +
      'service tier `on_demand` on input tokens per minute (ITPM): Limit 7000, Requested 19502, please reduce ' +
      'your message size and try again.';
    // the budget we retry with is derived from the provider's own limit
    const fit = fitFromSizeError(groq);
    assert.ok(fit > 0 && fit < 19502 * 3.5, `expected a smaller budget, got ${fit}`);
    assert.equal(fit, 22400); // 7000 tokens * 3.2 chars

    // a 413 without numbers cannot be acted on
    assert.equal(fitFromSizeError('HTTP 413 Payload Too Large'), 0);
    // and a size error where we already fit is not a size problem
    assert.equal(fitFromSizeError('Limit 7000, Requested 500'), 0);

    // compactMessages honours the budget while keeping the system prompt
    const sys = { role: 'system', content: 's'.repeat(200) };
    const big = [];
    for (let i = 0; i < 40; i++) big.push({ role: 'user', content: `msg ${i} ` + 'x'.repeat(400) });
    const compacted = compactMessages([sys, ...big], { maxChars: 3000 });
    assert.equal(compacted[0], sys);
    assert.ok(estimateChars(compacted) <= 3000, `still ${estimateChars(compacted)} chars`);
    assert.ok(compacted.length < 41);
    // it must not start with an orphan tool result
    assert.notEqual(compacted[1] && compacted[1].role, 'tool');
  })
);

suite.push(
  test('error text: the reset window is human, not 17h24m8.276149635', () => {
    assert.equal(formatRetry('17h24m8.276149635'), '17h 24m');
    assert.equal(formatRetry('22680.179850251'), '6h 18m');
    assert.equal(formatRetry('45s'), '45s');
    assert.equal(formatRetry('2m30.5'), '2m');
    assert.equal(retryWindow('Please retry in 17h24m8.276149635s'), '17h 24m');
    assert.equal(retryWindow('"retryDelay":"22680.179850251s"'), '6h 18m');
    assert.equal(retryWindow('no timing here'), '');
    assert.deepEqual(sizeNumbers('Limit 7000, Requested 19502'), { limit: 7000, requested: 19502 });
    assert.deepEqual(sizeNumbers('nothing'), { limit: 0, requested: 0 });
  })
);

/* ------------------------------- quota errors ------------------------------- */

suite.push(
  test('errors: a Gemini 429 explains the quota and the reset time', () => {
    const day = JSON.stringify({
      error: {
        code: 429,
        message: 'Quota exceeded for quota metric GenerateRequestsPerDayPerProjectPerModel-FreeTier',
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '22680.179850251s' }],
      },
    });
    const out = describeHttpError('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 429, 'Too Many Requests', day);
    assert.match(out, /DAILY quota khatam/);
    assert.match(out, /6h 18m/);            // 22680s -> 6h 18m, not "6h30m1.798"
    assert.match(out, /har "step" = ek API request/);
    // the API key and the Gemini web app (AI Pro) are different things
    assert.match(out, /API KEY ka hai/);
    assert.match(out, /AI Pro API access nahi deta/);
    assert.match(out, /Groq/);

    const zero = JSON.stringify({ error: { code: 429, message: 'Quota exceeded, limit: 0' } });
    const out2 = describeHttpError('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 429, '', zero);
    assert.match(out2, /free quota 0 hai/);

    const perMin = JSON.stringify({ error: { code: 429, message: 'Quota exceeded per_minute' } });
    const out3 = describeHttpError('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 429, '', perMin);
    assert.match(out3, /Per-minute rate limit/);

    // non-Google providers keep the generic hints
    const generic = describeHttpError('https://api.example.com/v1/chat/completions', 429, '', 'rate limited');
    assert.match(generic, /HTTP 429/);
  })
);

/* ----------------------------------- voice ----------------------------------- */

suite.push(
  test('voice: guards empty audio and missing configuration (no network)', async () => {
    assert.equal(typeof voice.transcribe, 'function');
    const b64 = Buffer.from('x').toString('base64');

    const empty = await voice.transcribe({ base64: '' });
    assert.match(empty.error, /koi audio nahi mila/);

    const noCfg = await voice.transcribe({ base64: b64, settings: {} });
    assert.match(noCfg.error, /Settings .* Voice/);

    const geminiNoKey = await voice.transcribe({ base64: b64, settings: { provider: 'gemini' } });
    assert.match(geminiNoKey.error, /API key/);

    const badBase = await voice.transcribe({ base64: b64, settings: { provider: 'openai', baseUrl: 'nope' } });
    assert.match(badBase.error, /base URL/);
  })
);

/* --------------------------- renderer structure --------------------------- */

suite.push(
  test('renderer: stateful sub-views are module-level, not nested components', () => {
    // A component declared INSIDE another component is a new type on every
    // parent render, so React remounts it and its state is thrown away
    // mid-request. That is what made "Fetch models" appear to do nothing.
    const src = fs.readFileSync(
      path.join(ROOT_DIR, 'renderer', 'src', 'components', 'SettingsModal.jsx'),
      'utf8'
    );
    for (const name of ['GeminiApiLine']) {
      assert.ok(
        new RegExp(`^function ${name}\\(`, 'm').test(src),
        `${name} must be declared at module level`
      );
      assert.ok(
        !new RegExp(`^\\s+function ${name}\\(`, 'm').test(src),
        `${name} must not be nested inside another component`
      );
    }
  })
);

/* ------------------------------ chip label ------------------------------ */

suite.push(
  test('composer chip shows the chosen model, and non-chat models are filtered', () => {
    // an entry with a fetched list: the chip must show the picked id, not the
    // label the entry was created with
    const gem = { id: 'g', label: 'Gemini 3.7 Flash', model: 'gemini-4-argon', modelIds: ['gemini-3.7-flash', 'gemini-4-argon'] };
    assert.equal(chipLabel(gem), 'gemini-4-argon');
    // a plain entry keeps its friendly label
    assert.equal(chipLabel({ id: 'd', label: 'DeepSeek', model: 'deepseek-chat' }), 'DeepSeek');
    assert.equal(chipLabel(null), 'Select Model…');

    assert.equal(isChatModel('gemini-2.5-flash'), true);
    assert.equal(isChatModel('gemini-3.8-flash-tts'), false);
    assert.equal(isChatModel('text-embedding-004'), false);
    assert.equal(isChatModel('gemini-2.5-flash-image'), true); // '-image' is not in the blocklist by design
    assert.equal(isChatModel('veo-3'), false);
    assert.equal(isChatModel(''), false);
    assert.deepEqual(chatModels(['gemini-2.5-flash', 'gemini-3.8-flash-tts', 'text-embedding-004']), ['gemini-2.5-flash']);
    assert.deepEqual(chatModels(null), []);
  })
);

/* --------------------------- picker geometry --------------------------- */

suite.push(
  test('model picker: its height fits the space above the composer', () => {
    // plenty of room -> the normal cap
    assert.equal(pickerMaxHeight(700), 460);
    // near the top -> shrink, so the list top is never clipped
    assert.equal(pickerMaxHeight(300), 276);
    // never collapse to nothing
    assert.equal(pickerMaxHeight(10), 220);
    assert.equal(pickerMaxHeight(NaN), 460);
    assert.equal(pickerMaxHeight(undefined), 460);
  })
);

/* ------------------------- fetched model variants ------------------------- */

suite.push(
  test('model picker: a fetched model list becomes selectable rows and is kept', () => {
    const gemini = {
      id: 'g',
      label: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      modelIds: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-flash-latest'],
    };
    const vs = variantsOf(gemini);
    assert.equal(vs.length, 3);
    assert.deepEqual(vs.map((v) => v.id), ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-flash-latest']);
    assert.equal(variantCount([gemini]), 3);

    // an entry with no fetched list still offers its own model (by label)
    const plain = { id: 'p', label: 'DeepSeek', model: 'deepseek-chat' };
    assert.deepEqual(variantsOf(plain), [{ id: 'deepseek-chat', label: 'DeepSeek' }]);
    assert.equal(variantCount([plain]), 1);
    assert.equal(variantCount([gemini, plain]), 4);
    assert.equal(variantCount([]), 0);
  })
);

/* ------------------------------- model picker ------------------------------- */

suite.push(
  test('model picker: all Gemini models collapse under one entry, newest first', () => {
    const models = [
      { id: 'g1', label: 'Gemini 3.1 Flash Lite', model: 'gemini-3.1-flash-lite', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'k' },
      { id: 'g2', label: 'Gemini 3.7 Flash', model: 'gemini-3.7-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'k' },
      { id: 'w', label: 'Gemini Web', model: 'gemini-web', auth: 'gemini-web' },
      { id: 'o', label: 'OpenRouter', model: 'google/gemini-4-argon', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' },
    ];
    const fams = groupModels(models);
    assert.deepEqual(fams.map((f) => f.label), ['Gemini', 'OpenRouter']);
    const gem = fams[0];
    assert.equal(gem.models.length, 3);
    assert.equal(gem.models[0].id, 'g2'); // newest first
    assert.equal(latestOf(gem.models).id, 'g2');
    assert.ok(versionOf({ model: 'gemini-3.7-flash' }) > versionOf({ model: 'gemini-3.1-flash-lite' }));
    assert.deepEqual(groupModels([]), []);
  })
);

suite.push(
  test('model picker: only keyed models show; retired providers are hidden', () => {
    const models = [
      { id: 'a', label: 'A' }, // no key -> hidden
      { id: 'b', label: 'B', apiKey: 'sk-1' }, // key -> shown
      { id: 'c', label: 'C', auth: 'gemini-web' }, // retired -> hidden
      { id: 'd', label: 'D', auth: 'cloudcode' }, // retired -> hidden
    ];
    assert.deepEqual(
      usableModels(models, null).map((m) => m.id),
      ['b']
    );
    // the active model is always kept, even without a key
    assert.deepEqual(
      usableModels(models, 'a').map((m) => m.id),
      ['a', 'b']
    );
    // a retired provider never shows, even when it is the active one
    assert.deepEqual(
      usableModels(models, 'c').map((m) => m.id),
      ['b']
    );
    assert.equal(isModelUsable({ id: 'x', apiKey: '   ' }, null), false);
    assert.equal(isModelUsable({ id: 'y', auth: 'cloudcode' }, null), false);
    assert.equal(isModelUsable({ id: 'z', auth: 'gemini-web' }, null), false);
  })
);

/* ------------------------------ renderer sanity ------------------------------ */

suite.push(
  test('renderer: no undefined JSX component references (would white-screen a view)', () => {
    // A component used in JSX but never defined throws at render time and, with
    // no error boundary, blanks the whole window. Catch that statically.
    const root = path.join(ROOT_DIR, 'renderer', 'src');
    const files = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx|js)$/.test(e.name)) files.push(p);
      }
    })(root);

    const missing = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const used = new Set([...src.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)].map((m) => m[1]));
      for (const name of used) {
        // Placeholders like <CURSOR> inside prompt strings are all-caps; real
        // components are PascalCase.
        if (!/[a-z]/.test(name)) continue;
        const defined =
          new RegExp(`(function|class)\\s+${name}\\b`).test(src) ||
          new RegExp(`(const|let|var)\\s+${name}\\b`).test(src) ||
          new RegExp(`import[^;]*\\b${name}\\b[^;]*from`).test(src);
        if (!defined) missing.push(`${name} <- ${path.relative(ROOT_DIR, f)}`);
      }
    }
    assert.deepEqual(missing, [], `undefined JSX components: ${missing.join(', ')}`);
  })
);

/* ------------------------------ gemini-web MCP ------------------------------ */

suite.push(
  test('gemini-web MCP: protocol handshake and ask_gemini dispatch', async () => {
    const init = await mcpHandle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(init.result.protocolVersion, '2024-11-05');
    assert.equal(init.result.serverInfo.name, 'nova-gemini-web');
    assert.equal(await mcpHandle({ method: 'notifications/initialized' }), null);

    const list = await mcpHandle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(list.result.tools.length, 1);
    assert.equal(list.result.tools[0].name, 'ask_gemini');
    assert.deepEqual(list.result.tools[0].inputSchema.required, ['prompt']);

    const ok = await mcpHandle(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask_gemini', arguments: { prompt: 'hi' } } },
      { askGemini: async () => ({ text: 'hello from gemini' }) }
    );
    assert.equal(ok.result.content[0].text, 'hello from gemini');

    const unknown = await mcpHandle(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } },
      { askGemini: async () => ({ text: 'x' }) }
    );
    assert.equal(unknown.error.code, -32602);

    const failed = await mcpHandle(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'ask_gemini', arguments: {} } },
      { askGemini: async () => ({ error: 'boom' }) }
    );
    assert.equal(failed.result.isError, true);
    assert.match(failed.result.content[0].text, /boom/);

    const missing = await mcpHandle({ jsonrpc: '2.0', id: 6, method: 'wat' });
    assert.equal(missing.error.code, -32601);
    assert.equal(await mcpHandle({ jsonrpc: '2.0', method: 'wat' }), null);

    // with no bridge file, askGemini explains instead of fetching
    process.env.NOVA_GEMINI_BRIDGE_FILE = path.join(TEST_DIR, 'no-such-bridge.json');
    const noBridge = await askGemini({ prompt: 'hi' }, async () => {
      throw new Error('must not fetch');
    });
    assert.match(noBridge.error, /bridge nahi mila/);
  })
);

/* ------------------------------ gemini engine ------------------------------ */

suite.push(
  test('gemini engine: mode round-trip and Playwright engine info', () => {
    const info = geminiPw.engineInfo();
    assert.equal(typeof info.available, 'boolean');
    assert.ok(String(info.profile).includes('gemini-profile'));
    assert.equal(typeof geminiPw.ask, 'function');
    assert.equal(typeof geminiPw.newChat, 'function');
    assert.equal(typeof geminiPw.openLogin, 'function');
    assert.equal(geminiPw.GEMINI_URL, 'https://gemini.google.com/app');

    // mode is a plain setting: valid values stick, anything else falls back
    assert.equal(setEngineMode('playwright'), 'playwright');
    assert.equal(getEngineMode(), 'playwright');
    assert.equal(setEngineMode('builtin'), 'builtin');
    assert.equal(getEngineMode(), 'builtin');
    assert.equal(setEngineMode('nonsense'), 'auto');
    assert.equal(getEngineMode(), 'auto');
  })
);

/* ------------------------------ Cursor Parity Tools ------------------------------ */

suite.push(
  test('fsTools: codebaseSearch ranks definitions and keywords', async () => {
    const searchDir = path.join(TEST_DIR, 'cb-search');
    await fsp.mkdir(searchDir, { recursive: true });
    await fsp.writeFile(
      path.join(searchDir, 'auth.js'),
      'function handleLoginUser(req, res) {\n  const token = generateAuthToken();\n  return res.json({ token });\n}\n'
    );
    await fsp.writeFile(
      path.join(searchDir, 'config.js'),
      'export const authConfig = {\n  domain: "auth.example.com",\n};\n'
    );

    const r = await fsTools.codebaseSearch({ query: 'handleLoginUser', dir: searchDir });
    assert.ok(r.count >= 1);
    assert.equal(r.results[0].relPath, 'auth.js');
    assert.equal(r.results[0].line, 1);
    assert.ok(r.results[0].snippet.includes('handleLoginUser'));
  })
);

suite.push(
  test('fsTools: editNotebook manipulates ipynb cells safely', async () => {
    const nbPath = path.join(TEST_DIR, 'test.ipynb');
    const initialNb = {
      cells: [
        { cell_type: 'markdown', metadata: {}, source: ['# Welcome\n'] },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 2,
    };
    await fsp.writeFile(nbPath, JSON.stringify(initialNb, null, 1), 'utf8');

    // 1. Insert a code cell
    const ins = await fsTools.editNotebook({
      path: nbPath,
      action: 'insert',
      cellIndex: 1,
      cellType: 'code',
      source: 'print("hello from notebook")',
    });
    assert.equal(ins.ok, true);
    assert.equal(ins.totalCells, 2);

    // 2. Replace the cell
    const rep = await fsTools.editNotebook({
      path: nbPath,
      action: 'replace',
      cellIndex: 1,
      cellType: 'code',
      source: 'print("updated code")',
    });
    assert.equal(rep.ok, true);

    const readBack = JSON.parse(await fsp.readFile(nbPath, 'utf8'));
    assert.equal(readBack.cells.length, 2);
    assert.ok(readBack.cells[1].source.join('').includes('updated code'));

    // 2b. Verify bug fix: replace markdown cell 0 without cellType keeps cell_type as 'markdown'
    const repMd = await fsTools.editNotebook({
      path: nbPath,
      action: 'replace',
      cellIndex: 0,
      source: '# Welcome to Nova IDE\n',
    });
    assert.equal(repMd.ok, true);
    const readMd = JSON.parse(await fsp.readFile(nbPath, 'utf8'));
    assert.equal(readMd.cells[0].cell_type, 'markdown', 'markdown cell must not silently become code cell');
    assert.ok(readMd.cells[0].source.join('').includes('Nova IDE'));

    // 3. Delete the cell
    const del = await fsTools.editNotebook({
      path: nbPath,
      action: 'delete',
      cellIndex: 1,
    });
    assert.equal(del.ok, true);
    assert.equal(del.totalCells, 1);
  })
);

suite.push(
  test('agent: toolSchemas includes codebase_search and edit_notebook for Cursor parity', async () => {
    const schemas = await toolSchemas();
    const names = schemas.map((s) => s.function.name);
    assert.ok(names.includes('codebase_search'));
    assert.ok(names.includes('edit_notebook'));
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('todo_write'));
    assert.ok(names.includes('code_lineage'));
  })
);

suite.push(
  test('agent: detectMode routes conversational chat vs autonomous agent work', () => {
    // Explicit mode override
    assert.equal(detectMode('fix the bug in login', { composerMode: 'chat' }), 'chat');
    assert.equal(detectMode('hi', { composerMode: 'agent' }), 'agent');

    // Auto routing: greetings and questions -> chat
    assert.equal(detectMode('hi'), 'chat');
    assert.equal(detectMode('hello there!'), 'chat');
    assert.equal(detectMode('who are you'), 'chat');
    assert.equal(detectMode('kya kar sakte ho'), 'chat');
    assert.equal(detectMode('what is react hooks'), 'chat');
    assert.equal(detectMode('explain closures in javascript'), 'chat');

    // Auto routing: actions and tool requests -> agent
    assert.equal(detectMode('write the file'), 'agent');
    assert.equal(detectMode('write a function to sort an array'), 'agent');
    assert.equal(detectMode('read the config'), 'agent');
    assert.equal(detectMode('add a dark mode toggle'), 'agent');
    assert.equal(detectMode('rename the variable'), 'agent');
    assert.equal(detectMode('move this to utils'), 'agent');
    assert.equal(detectMode('copy the file'), 'agent');
    assert.equal(detectMode('show me the code'), 'agent');
    assert.equal(detectMode('drivenow-car-rental ka architecture inspect karo'), 'agent');
    assert.equal(detectMode('create auth.js file'), 'agent');
    assert.equal(detectMode('auth.js file banao'), 'agent');
    assert.equal(detectMode('npm test chalao'), 'agent');
    assert.equal(detectMode('fix the bug in login.js'), 'agent');
    assert.equal(detectMode('git status check karo'), 'agent');
    assert.equal(detectMode('search for symbol handleLoginUser'), 'agent');

    // Mentions -> agent
    assert.equal(detectMode('check this', {}, 'Contents of @-mentioned files:\n...'), 'agent');
    assert.equal(detectMode('see this', {}, 'User tagged @git'), 'agent');

    // Auto routing: direct follow-up action confirmations -> agent
    assert.equal(detectMode('ok do it'), 'agent');
    assert.equal(detectMode('do it'), 'agent');
    assert.equal(detectMode('continue'), 'agent');
    assert.equal(detectMode('karo'), 'agent');
    assert.equal(detectMode('haan karo'), 'agent');
    assert.equal(detectMode('kar do'), 'agent');
    assert.equal(detectMode('go ahead'), 'agent');
    assert.equal(detectMode('same karo'), 'agent');
    assert.equal(detectMode('proceed'), 'agent');
    assert.equal(detectMode('next step'), 'agent');
    assert.equal(detectMode('try again'), 'agent');

    // Auto routing: contextual brief confirmations with history -> agent
    const mockSession = {
      messages: [
        { role: 'user', content: 'inspect login.js' },
        { role: 'assistant', content: 'I can fix the bug in login.js. Proceed?' },
      ],
    };
    assert.equal(detectMode('yes', {}, '', mockSession), 'agent');
    assert.equal(detectMode('ok', {}, '', mockSession), 'agent');
    assert.equal(detectMode('sure', {}, '', mockSession), 'agent');
    assert.equal(detectMode('theek hai', {}, '', mockSession), 'agent');

    // Brand new empty conversation with just 'yes' or 'ok' -> chat
    assert.equal(detectMode('yes'), 'chat');
    assert.equal(detectMode('ok'), 'chat');
  })
);

suite.push(
  test('renderer: store handles both streamed and non-streamed assistant replies with mode tagging', async () => {
    globalThis.window = { nova: {} };
    const { useStore } = await import('../renderer/src/store.js');
    const st = useStore.getState();

    // 1. Non-streamed reply (direct assistant_message without assistant_delta)
    useStore.setState({ agentItems: [] });
    st.agentHandleEvent({ type: 'mode', mode: 'agent' });
    st.agentHandleEvent({ type: 'assistant_message', text: 'Direct non-streamed reply' });
    const items1 = useStore.getState().agentItems;
    assert.equal(items1.length, 1);
    assert.equal(items1[0].text, 'Direct non-streamed reply');
    assert.equal(items1[0].streaming, false);
    assert.equal(items1[0].mode, 'agent');

    // 2. Streamed reply (assistant_delta followed by assistant_message)
    useStore.setState({ agentItems: [] });
    st.agentHandleEvent({ type: 'mode', mode: 'chat' });
    st.agentHandleEvent({ type: 'assistant_delta', text: 'Chunk 1' });
    st.agentHandleEvent({ type: 'assistant_delta', text: ' Chunk 2' });
    st.agentHandleEvent({ type: 'assistant_message', text: 'Chunk 1 Chunk 2' });
    const items2 = useStore.getState().agentItems;
    assert.equal(items2.length, 1);
    assert.equal(items2[0].text, 'Chunk 1 Chunk 2');
    assert.equal(items2[0].streaming, false);
    assert.equal(items2[0].mode, 'chat');

    // 3. Errored streamed turn: error event clears streaming flag so next turn creates its own bubble
    useStore.setState({ agentItems: [] });
    st.agentHandleEvent({ type: 'turn_start' });
    st.agentHandleEvent({ type: 'assistant_delta', text: 'Partial text before error' });
    st.agentHandleEvent({ type: 'error', message: 'Quota exceeded 429' });

    const itemsAfterError = useStore.getState().agentItems;
    assert.equal(itemsAfterError[0].streaming, false, 'errored assistant item must have streaming=false');
    assert.equal(itemsAfterError[1].kind, 'error');

    // Next turn arrives: must create its own bubble rather than overwriting turn 1
    st.agentHandleEvent({ type: 'turn_start' });
    st.agentHandleEvent({ type: 'assistant_message', text: 'Second turn reply' });
    const itemsTurn2 = useStore.getState().agentItems;
    assert.equal(itemsTurn2.length, 3, 'turn 2 must create its own bubble rather than overwriting turn 1');
    assert.equal(itemsTurn2[0].text, 'Partial text before error');
    assert.equal(itemsTurn2[2].text, 'Second turn reply');
  })
);

suite.push(
  test('agent: toolSchemas serialization size stays within token budget', async () => {
    const schemas = await toolSchemas({});
    const jsonStr = JSON.stringify(schemas);
    // Tool schemas are sent on every agent provider request (~83% of the payload).
    // Set a strict budget of 15,000 characters (~3,750 tokens) so schema bloat is caught immediately.
    assert.ok(jsonStr.length < 15000, `toolSchemas size (${jsonStr.length} chars) exceeded 15,000 char budget`);
    assert.ok(schemas.length >= 8, 'at least 8 core tools registered');
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
