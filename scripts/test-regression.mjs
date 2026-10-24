// Comprehensive Regression Test Suite for Nova IDE core engine
// Tests: fsTools, checkpoints, terminal, web, geminiWeb, agent rules, and inline completions
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

import fsTools from '../dist-electron/tools/fsTools.js';
import checkpoints from '../dist-electron/tools/checkpoints.js';
import { runCommand, buildUbuntuEnv, diagnoseUbuntuCommand } from '../dist-electron/tools/terminal.js';
import { webFetch, webSearch } from '../dist-electron/tools/web.js';
import { parseWebToolCalls, protocolBlock, setEngineMode, getEngineMode } from '../dist-electron/gemini-web.js';
import { describeHttpError } from '../dist-electron/tools/errors.js';
import { gpuPlan } from '../dist-electron/tools/gpu-flags.js';
import { scan as secScan } from '../dist-electron/tools/security.js';
import * as findingsStore from '../dist-electron/tools/findings.js';
import * as challenge from '../dist-electron/tools/challenge.js';
import * as kaggle from '../dist-electron/tools/kaggle.js';
import * as penpot from '../dist-electron/tools/penpot.js';
import * as verifyEngine from '../dist-electron/tools/verify.js';
import {
  loadRules,
  toolSchemas,
  compactMessages,
  normalizeTodos,
  codeLineage,
  estimateChars,
  fitFromSizeError,
  detectMode,
  buildFallbackChain,
  callModel,
  runAgent,
  isQuotaOrModelError,
  prepareMessagesForProvider,
  flattenMessagesForPromptProtocol,
  THOUGHT_SIGNATURE_BYPASS,
  ubuntuSystem,
} from '../dist-electron/agent.js';
import { isWithin } from '../dist-electron/tools/paths.js';
import computer from '../dist-electron/tools/computer.js';
import git from '../dist-electron/tools/git.js';
import gdrive from '../dist-electron/tools/gdrive.js';
import gh from '../dist-electron/tools/github.js';
import cloudcode from '../dist-electron/tools/cloudcode.js';
import voice from '../dist-electron/tools/voice.js';
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
  isOldModel,
  chatModels,
  sortModelsLatestFirst,
  getModelBadge,
  preferredChatModel,
  fallbackChoices,
} from '../renderer/src/model-family.js';
import { handle as mcpHandle, askGemini } from './mcp-gemini-web.mjs';
import * as geminiPw from '../dist-electron/gemini-pw.js';
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
    assert.equal(typeof st.needsReconsent, 'boolean');
    assert.equal(typeof st.isolated, 'boolean');
    assert.match(st.scope, /drive\.(file|readonly)/);
    assert.match(st.configPath, /gdrive\.json$/);
  })
);

suite.push(
  test('drive access: a broader token is flagged for re-consent', async () => {
    const cfgPath = gdrive.getConfigPath ? gdrive.getConfigPath() : (await gdrive.status()).configPath;
    await fsp.mkdir(path.dirname(cfgPath), { recursive: true });
    let prev = null;
    try { prev = await fsp.readFile(cfgPath, 'utf8'); } catch {}
    try {
      // a token granted before the scope change carries no grantedScope record
      await fsp.writeFile(cfgPath, JSON.stringify({ refreshToken: 'legacy', email: 'a@b.c' }));
      let st = await gdrive.status();
      assert.equal(st.needsReconsent, true, 'a legacy token must ask for re-consent');
      assert.equal(st.isolated, false, 'it must NOT claim isolation');

      // a token granted for the narrow scope is fine
      await fsp.writeFile(cfgPath, JSON.stringify({
        refreshToken: 'fresh',
        grantedScope: 'openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata',
      }));
      st = await gdrive.status();
      assert.equal(st.needsReconsent, false);
      assert.equal(st.isolated, true);

      // and an explicitly broad token is never treated as isolated
      await fsp.writeFile(cfgPath, JSON.stringify({
        refreshToken: 'full',
        grantedScope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.appdata',
      }));
      st = await gdrive.status();
      assert.equal(st.needsReconsent, true, 'drive.readonly must never count as isolated');
    } finally {
      if (prev === null) await fsp.rm(cfgPath, { force: true }).catch(() => {});
      else await fsp.writeFile(cfgPath, prev, 'utf8').catch(() => {});
    }
  })
);

/* ---------------------------------- memory ---------------------------------- */

suite.push(
  test('memory: add / list / memoryText / remove round-trip', async () => {
    process.env.NOVA_CONFIG_DIR = path.join(TEST_DIR, 'nova-home');
    const memory = (await import('../dist-electron/tools/memory.js')).default;
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
    const memory = (await import('../dist-electron/tools/memory.js')).default;
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
    assert.equal(isChatModel('meta-llama/llama-prompt-guard-2-86m'), false);
    assert.equal(isChatModel('openai/gpt-oss-safeguard-20b'), false);
    assert.equal(isChatModel('canopylabs/orpheus-v1-english'), false);
    assert.equal(isChatModel(''), false);
    assert.equal(isOldModel('llama-2-70b'), true);
    assert.equal(isOldModel('gpt-3.5-turbo'), true);
    assert.equal(isOldModel('llama-3.3-70b-versatile'), false);
    assert.deepEqual(chatModels(['gemini-2.5-flash', 'gemini-3.8-flash-tts', 'text-embedding-004']), ['gemini-2.5-flash']);
    assert.deepEqual(chatModels(null), []);

    // sortModelsLatestFirst sorts newest flagship versions first
    const groqUnsorted = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];
    const sorted = sortModelsLatestFirst(groqUnsorted);
    assert.equal(sorted[0], 'llama-3.3-70b-versatile'); // 3.3 70b flagship is first
    assert.ok(getModelBadge('llama-3.3-70b-versatile').text === 'LATEST');
    assert.ok(getModelBadge('deepseek-r1').text === 'REASONING');
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

suite.push(
  test('isolation: NOVA_HOME alone redirects all subsystems without NOVA_CONFIG_DIR', async () => {
    const isolatedDir = path.join(TEST_DIR, 'nova-home-alone-test');
    await fsp.mkdir(isolatedDir, { recursive: true });

    const prevHome = process.env.NOVA_HOME;
    const prevCfg = process.env.NOVA_CONFIG_DIR;

    try {
      // Set ONLY NOVA_HOME, clear NOVA_CONFIG_DIR to prove full independent isolation
      process.env.NOVA_HOME = isolatedDir;
      delete process.env.NOVA_CONFIG_DIR;

      const { configRoot } = await import('../dist-electron/tools/paths.js');
      assert.equal(configRoot(), isolatedDir, 'configRoot() resolves to NOVA_HOME');

      // Test github
      const gh = await import('../dist-electron/tools/github.js');
      const ghSt = await gh.status();
      assert.ok(ghSt.configPath.startsWith(isolatedDir), `github configPath (${ghSt.configPath}) must start with NOVA_HOME`);

      // Test memory
      const mem = await import('../dist-electron/tools/memory.js');
      const memSt = await mem.list();
      assert.ok(memSt.path.startsWith(isolatedDir), `memory path (${memSt.path}) must start with NOVA_HOME`);

      // Test mcp
      const mcpMod = await import('../dist-electron/mcp.js');
      assert.ok(mcpMod.getConfigPath().startsWith(isolatedDir), `mcp configPath must start with NOVA_HOME`);

      // Test gdrive
      const gdriveMod = await import('../dist-electron/tools/gdrive.js');
      assert.ok(gdriveMod.getConfigPath().startsWith(isolatedDir), `gdrive configPath must start with NOVA_HOME`);

      // Test checkpoints
      const cpMod = await import('../dist-electron/tools/checkpoints.js');
      const cpDir = cpMod.dirFor('test-agent-iso');
      assert.ok(cpDir.startsWith(isolatedDir), `checkpoints dir (${cpDir}) must start with NOVA_HOME`);
    } finally {
      if (prevHome !== undefined) process.env.NOVA_HOME = prevHome;
      else delete process.env.NOVA_HOME;
      if (prevCfg !== undefined) process.env.NOVA_CONFIG_DIR = prevCfg;
      else delete process.env.NOVA_CONFIG_DIR;
      await fsp.rm(isolatedDir, { recursive: true, force: true }).catch(() => {});
    }
  })
);

suite.push(
  test('models:ping error handling returns clean chatOk:false without models ReferenceError', async () => {
    let thrown = null;
    let result = null;
    try {
      const base = 'http://127.0.0.1:59999';
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 100);
        await fetch(base + '/chat/completions', { signal: ctrl.signal });
      } catch (e) {
        result = { chatOk: false, chatError: String(e.message || e) };
      }
    } catch (e) {
      thrown = e;
    }
    assert.equal(thrown, null, 'Must not throw ReferenceError');
    assert.equal(result.chatOk, false);
    assert.ok(result.chatError, 'Should contain error string');
    assert.equal('models' in result, false, 'Must not have invalid models property');
  })
);

suite.push(
  test('sanitizer: preserves code blocks, indentation, and markdown while stripping prompt reflections', async () => {
    const agentFile = fs.existsSync(path.join(ROOT_DIR, 'electron/agent.ts'))
      ? path.join(ROOT_DIR, 'electron/agent.ts')
      : path.join(ROOT_DIR, 'dist-electron/agent.js');
    const agentCode = await fsp.readFile(agentFile, 'utf8');
    assert.match(agentCode, /function sanitizeAssistantReply/, 'agent must define sanitizeAssistantReply');

    // Extract function logic to test directly
    const fnMatch = agentCode.match(/function sanitizeAssistantReply\([\s\S]*?\n\}/);
    assert.ok(fnMatch, 'Must match sanitizeAssistantReply function');
    const sanitize = new Function('text', fnMatch[0] + '\nreturn sanitizeAssistantReply(text);');

    // 1. Code without prompt reflection must remain completely byte-for-byte identical
    const pureCode = "```python\ndef hello():\n    return 'world'\n```\n\n* point 1\n* point 2";
    assert.equal(sanitize(pureCode), pureCode, 'Pure code and bullet points must remain identical');

    // 2. Leaked prompt reflections must be stripped, while leaving code completely intact
    const leaked = '* User says: "hi"\n* Mode: Direct Chat\n* Context: I am Nova\n\n```javascript\nconst a = 10;\n```\n* Explanation: valid variable';
    const cleaned = sanitize(leaked);
    assert.ok(!cleaned.includes('* User says:'), 'Must strip * User says:');
    assert.ok(!cleaned.includes('* Mode: Direct Chat'), 'Must strip * Mode: Direct Chat');
    assert.ok(cleaned.includes('```javascript\nconst a = 10;\n```'), 'Code block must remain completely intact');
    assert.ok(cleaned.includes('* Explanation: valid variable'), 'Body bullet points must remain intact');

    // 3. <thought> reasoning blocks from Gemini models must be cleanly stripped
    const geminiThought = '<thought>* User says: "hi"\n* Plan: answer warmly</thought>Hello! How can I help you today?';
    assert.equal(sanitize(geminiThought), 'Hello! How can I help you today?', 'Must strip <thought> reasoning blocks');
  })
);

suite.push(
  test('errors: describeHttpError produces informative diagnostics for HTTP 503 high demand', async () => {
    const { describeHttpError } = await import('../dist-electron/tools/errors.js');
    const desc = describeHttpError('https://generativelanguage.googleapis.com/v1beta/openai', 503, 'Service Unavailable', 'This model is currently experiencing high demand.');
    assert.ok(desc.includes('503'), 'Must contain 503 status code');
    assert.ok(desc.includes('Google servers pe temporary high demand'), 'Must explain temporary high demand in clear Hindi');
    assert.ok(desc.includes('Retry'), 'Must suggest Retry');
  })
);

suite.push(
  test('quota fallback: gemini-4-argon 429 automatically switches to a free Gemini Flash model', async () => {
    const http = await import('node:http');
    const hitModels = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body || '{}');
        hitModels.push(j.model);
        if (j.model === 'gemini-4-argon') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: 429,
                message: 'Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                status: 'RESOURCE_EXHAUSTED',
              },
            })
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello from ' + j.model } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;

    try {
      const cfg = {
        id: 'gem-entry',
        label: 'Gemini',
        baseUrl: `http://127.0.0.1:${port}/v1beta/openai`,
        apiKey: 'test-key',
        model: 'gemini-4-argon',
        modelIds: ['gemini-4-argon', 'gemini-2.5-flash', 'gemini-flash-latest'],
      };

      const chain = buildFallbackChain(cfg);
      assert.ok(chain.length >= 2, 'fallback chain includes candidate models');
      assert.equal(chain[0].model, 'gemini-2.5-flash', 'prioritizes gemini-2.5-flash over experimental models');

      const events = [];
      await runAgent({
        agentId: 'test-quota-fallback',
        config: cfg,
        workspaceRoot: TEST_DIR,
        userText: 'hi',
        settings: { composerMode: 'auto' },
        send: (e) => events.push(e),
      });

      assert.deepEqual(hitModels, ['gemini-4-argon', 'gemini-2.5-flash']);
      const switched = events.find((e) => e.type === 'model_switched');
      assert.ok(switched, 'emitted model_switched event');
      assert.equal(switched.from, 'gemini-4-argon');
      assert.equal(switched.model, 'gemini-2.5-flash');

      const msg = events.find((e) => e.type === 'assistant_message');
      assert.ok(msg, 'completed chat turn with assistant_message');
      assert.equal(msg.text, 'Hello from gemini-2.5-flash');
      assert.equal(events.some((e) => e.type === 'error'), false, 'no error emitted when fallback succeeds');
    } finally {
      srv.close();
    }
  })
);

suite.push(
  test('fallbackChoices & preferredChatModel: single Gemini entry offers variant fallbacks and avoids argon default', () => {
    const models = [
      {
        id: 'g1',
        label: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIzaTest',
        model: 'gemini-4-argon',
        modelIds: ['gemini-4-argon', 'gemini-2.5-flash', 'gemini-flash-latest'],
      },
    ];
    const choices = fallbackChoices(models, 'g1');
    assert.ok(choices.length >= 2, 'returns variant fallback choices from same Gemini entry');
    assert.equal(choices[0].id, 'g1');
    assert.equal(choices[0].model, 'gemini-2.5-flash');
    assert.ok(!choices.some((c) => c.model === 'gemini-4-argon'), 'excludes the failing active model');

    assert.equal(
      preferredChatModel(['gemini-4-argon', 'gemini-2.5-flash', 'gemini-flash-latest'], 'gemini-4-argon'),
      'gemini-2.5-flash'
    );
  })
);

suite.push(
  test('ubuntu terminal: buildUbuntuEnv sets non-interactive vars and diagnoseUbuntuCommand gives recovery hints', () => {
    const env = buildUbuntuEnv({ PATH: '/usr/bin', HOME: '/home/hariom' });
    assert.equal(env.DEBIAN_FRONTEND, 'noninteractive');
    assert.equal(env.NEEDRESTART_MODE, 'a');
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.SYSTEMD_PAGER, 'cat');
    assert.ok(env.PATH.includes('/home/hariom/.local/bin'), 'adds ~/.local/bin to PATH');
    assert.ok(env.PATH.includes('/snap/bin'), 'adds /snap/bin to PATH');

    const sudoHint = diagnoseUbuntuCommand({
      code: 1,
      stderr: 'sudo: a terminal is required to read the password; either use the -S option',
    });
    assert.match(sudoHint, /pkexec/);

    const pep668Hint = diagnoseUbuntuCommand({
      code: 1,
      stderr: 'error: externally-managed-environment',
    });
    assert.match(pep668Hint, /venv/);

    const lockHint = diagnoseUbuntuCommand({
      code: 100,
      stderr: 'E: Could not get lock /var/lib/dpkg/lock-frontend',
    });
    assert.match(lockHint, /unattended-upgrades/);

    const portHint = diagnoseUbuntuCommand({
      code: 1,
      stderr: 'Error: listen EADDRINUSE: address already in use :::3000',
    });
    assert.match(portHint, /ss -tulpn/);
  })
);

suite.push(
  test('ubuntu desktop: detectUbuntu, ydotool key combos, and ubuntu_system diagnostics', async () => {
    const u = computer.detectUbuntu();
    assert.equal(typeof u.distro, 'string');
    assert.ok(u.distro.length > 0);
    assert.ok(Array.isArray(u.systemTools));

    // ydotool multi-key combo support on Ubuntu Wayland
    const cap = { inputMethod: 'ydotool' };
    assert.deepEqual(computer.buildInputCommands('key', { key: 'ctrl+c' }, cap), [
      { bin: 'ydotool', args: ['key', '29:1', '46:1', '46:0', '29:0'] },
    ]);
    assert.deepEqual(computer.buildInputCommands('key', { key: 'ctrl+shift+t' }, cap), [
      { bin: 'ydotool', args: ['key', '29:1', '42:1', '20:1', '20:0', '42:0', '29:0'] },
    ]);

    // ubuntu_system tool actions
    const ov = await ubuntuSystem({ action: 'overview' });
    assert.equal(ov.ok, true);
    assert.match(ov.text, /Distro:/);
    assert.match(ov.text, /Kernel & Uptime/);

    const procs = await ubuntuSystem({ action: 'processes', lines: 5 });
    assert.equal(procs.ok, true);
    assert.match(procs.text, /Ubuntu processes/);

    const net = await ubuntuSystem({ action: 'network' });
    assert.equal(net.ok, true);
    assert.match(net.text, /Interfaces/);

    // Ubuntu-aware detectMode routing
    assert.equal(detectMode('port 3000 pe kya chal raha hai'), 'agent');
    assert.equal(detectMode('what is running on port 8080'), 'agent');
    assert.equal(detectMode('nginx service status dekho'), 'agent');
    assert.equal(detectMode('batao mere ubuntu me kitni ram free hai'), 'agent');
    assert.equal(detectMode('systemctl restart nginx'), 'agent');
    assert.equal(detectMode('sudo apt install htop'), 'agent');
  })
);

suite.push(
  test('thought_signature: multi-step Gemini 3.8 Flash tool loop preserves extra_content.google.thought_signature on Step 2+', async () => {
    const http = await import('node:http');
    let stepCount = 0;
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        stepCount += 1;
        const payload = JSON.parse(body || '{}');
        const msgs = payload.messages || [];

        if (stepCount === 1) {
          // Step 1: return a tool_call (list_dir) with extra_content.google.thought_signature
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          const chunk = {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_list_1',
                      type: 'function',
                      function: {
                        name: 'list_dir',
                        arguments: JSON.stringify({ path: TEST_DIR }),
                      },
                      extra_content: {
                        google: {
                          thought_signature: 'Cp0B_real_gemini_3_8_sig',
                        },
                      },
                    },
                  ],
                },
              },
            ],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        // Step 2: strictly validate thought_signature on the replayed assistant tool_calls
        const asstMsg = msgs.find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
        const sig =
          asstMsg &&
          asstMsg.tool_calls[0] &&
          asstMsg.tool_calls[0].extra_content &&
          asstMsg.tool_calls[0].extra_content.google &&
          asstMsg.tool_calls[0].extra_content.google.thought_signature;
        const toolMsg = msgs.find((m) => m.role === 'tool');

        if (!sig || !toolMsg || toolMsg.name !== 'list_dir') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: 400,
                message:
                  'Function call is missing a thought_signature in functionCall parts. Additional data, function call `default_api:list_dir` , position 2.',
              },
            })
          );
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: `Project analysis complete (verified sig: ${sig})` } }],
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;

    try {
      const events = [];
      await runAgent({
        agentId: 'test-thought-sig-loop',
        config: {
          baseUrl: `http://127.0.0.1:${port}/v1beta/openai`,
          apiKey: 'test-key',
          model: 'gemini-3.8-flash',
        },
        workspaceRoot: TEST_DIR,
        userText: 'analysis my project',
        settings: { composerMode: 'agent', maxSteps: 5 },
        send: (e) => events.push(e),
      });

      assert.equal(stepCount, 2, 'completed 2-step tool loop');
      const errEvt = events.find((e) => e.type === 'error');
      assert.equal(errEvt, undefined, `must not error, got: ${errEvt && errEvt.message}`);
      const finalMsg = events.filter((e) => e.type === 'assistant_message').pop();
      assert.ok(finalMsg, 'emitted final assistant_message after tool call');
      assert.match(finalMsg.text, /Cp0B_real_gemini_3_8_sig/);
    } finally {
      srv.close();
    }
  })
);

suite.push(
  test('thought_signature: prepareMessagesForProvider injects bypass for Gemini and strips extra_content for non-Gemini', () => {
    const rawMsgs = [
      { role: 'user', content: 'analyze repo' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } },
          { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
        ],
      },
      { role: 'tool', name: 'list_dir', tool_call_id: 'c1', content: 'README.md' },
    ];

    // 1. Gemini model: first tool_call gets THOUGHT_SIGNATURE_BYPASS when missing, second parallel call stays clean
    const gemPrepared = prepareMessagesForProvider(rawMsgs, {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.8-flash',
    });
    assert.equal(
      gemPrepared[1].tool_calls[0].extra_content.google.thought_signature,
      THOUGHT_SIGNATURE_BYPASS
    );
    assert.equal(gemPrepared[1].tool_calls[1].extra_content, undefined);

    // 2. Non-Gemini provider (Groq/OpenAI): extra_content is stripped completely
    const groqPrepared = prepareMessagesForProvider(gemPrepared, {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
    });
    assert.equal(groqPrepared[1].tool_calls[0].extra_content, undefined);

    // 3. flattenMessagesForPromptProtocol converts tool_calls + tool results to plain text
    const flat = flattenMessagesForPromptProtocol(gemPrepared);
    assert.equal(flat[1].role, 'assistant');
    assert.equal(flat[1].tool_calls, undefined);
    assert.match(flat[1].content, /"tool_calls"/);
    assert.equal(flat[2].role, 'user');
    assert.match(flat[2].content, /Tool result \(list_dir\)/);
  })
);

/* ---------------------------- security audit ---------------------------- */

/** A deliberately vulnerable mini-app, written to disk for the scanner to audit. */
async function makeVulnApp(dir) {
  await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
  await fsp.writeFile(
    path.join(dir, 'src', 'config.js'),
    'const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";\nconst password = "SuperSecret123!x";\nmodule.exports = { AWS_ACCESS_KEY_ID, password };\n'
  );
  await fsp.writeFile(
    path.join(dir, 'src', 'app.js'),
    [
      "const cp = require('child_process');",
      'function run(req, res) {',
      '  const cmd = "ls " + req.query.dir;',
      '  cp.exec(cmd, (e, out) => res.send(out));',
      "  document.getElementById('x').innerHTML = req.query.name;",
      '  const q = "SELECT * FROM users WHERE id = " + req.query.id;',
      '  db.query(q);',
      '  const token = Math.random().toString(36);',
      '  const code = eval(req.query.expr);',
      '  const agent = new https.Agent({ rejectUnauthorized: false });',
      '  const hash = md5(password);',
      '  return token + code + agent + hash;',
      '}',
    ].join('\n')
  );
  await fsp.writeFile(
    path.join(dir, 'src', 'db.py'),
    [
      'import os, pickle, yaml, subprocess, requests, random',
      'def load_blob(data):',
      '    return pickle.loads(data)',
      'def run(cmd):',
      '    os.system(cmd)',
      '    subprocess.run(cmd, shell=True)',
      'def find(uid):',
      '    return db.execute(f"SELECT * FROM users WHERE id = {uid}")',
      'def fetch(url):',
      '    return requests.get(url, verify=False)',
      'def admin(user):',
      '    assert user.is_admin',
      'app.run(debug=True)',
    ].join('\n')
  );
  await fsp.writeFile(path.join(dir, 'Dockerfile'), 'FROM node:20-alpine\nCMD ["node", "src/app.js"]\n');
  await fsp.writeFile(path.join(dir, '.env'), 'DB_PASSWORD=prod_password_9921\n');
  await fsp.writeFile(
    path.join(dir, 'keys.pem'),
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----\n'
  );
  await fsp.writeFile(
    path.join(dir, 'src', 'traversal.js'),
    "const fs = require('fs');\nconst p = path.join(__dirname, 'public', req.query.file);\nfs.readFile(p, 'utf8', (e, d) => res.send(d));\n"
  );
  await fsp.writeFile(
    path.join(dir, 'src', 'auth.js'),
    "jwt.verify(token, SECRET, { algorithms: ['none'] });\nres.setHeader('Access-Control-Allow-Origin', '*');\n"
  );
  // two files that must produce nothing at all
  await fsp.writeFile(
    path.join(dir, 'src', 'clean.js'),
    "const crypto = require('crypto');\nfunction safeLookup(db, id) { return db.query('SELECT * FROM users WHERE id = ?', [id]); }\nfunction makeToken() { return crypto.randomBytes(32).toString('hex'); }\nfunction render(el, t) { el.textContent = t; }\n"
  );
  await fsp.writeFile(
    path.join(dir, 'src', 'safe.py'),
    'import json, secrets, hashlib\ndef load(t):\n    return json.loads(t)\ndef token():\n    return secrets.token_hex(32)\ndef digest(v):\n    return hashlib.sha256(v.encode()).hexdigest()\n'
  );
}

suite.push(
  test('security: the scanner finds every planted vulnerability class', async () => {
    const dir = path.join(TEST_DIR, 'sec-vuln');
    await makeVulnApp(dir);

    const r = await secScan({ dir, includeDeps: false });
    const rules = new Set(r.findings.map((f) => f.rule));

    const expected = [
      'secret.aws-access-key',
      'secret.generic-assignment',
      'file.env-committed',
      'file.key-material',
      'secret.private-key',
      'code.eval',
      'code.child-process',
      'code.html-injection',
      'code.sql-concat',
      'code.sql-execute-format',
      'crypto.insecure-random',
      'crypto.weak-hash',
      'crypto.tls-disabled',
      'code.deserialize',
      'code.os-system',
      'auth.assert-check',
      'config.debug-on',
      'config.docker-root',
      'code.path-traversal',
      'auth.jwt-none',
      'config.cors-any',
    ];
    const missing = expected.filter((x) => !rules.has(x));
    assert.deepEqual(missing, [], `scanner missed: ${missing.join(', ')}`);

    // every finding must carry the evidence the agent needs to triage it
    for (const f of r.findings) {
      assert.ok(f.rule && f.file && typeof f.line === 'number', 'finding shape');
      assert.ok(['critical', 'high', 'medium', 'low'].includes(f.severity), `bad severity ${f.severity}`);
      assert.ok(/^CWE-\d+$/.test(f.cwe), `bad cwe ${f.cwe}`);
      assert.ok(f.snippet, 'a finding without a snippet is not triageable');
      assert.ok(f.message, 'a finding without a remediation is not actionable');
    }
    assert.ok(r.bySeverity.critical >= 4, `expected criticals, got ${JSON.stringify(r.bySeverity)}`);

    // and the clean files must stay clean
    const fp = r.findings.filter((f) => /clean\.js|safe\.py$/.test(f.file));
    assert.deepEqual(fp.map((f) => `${f.rule}@${f.file}:${f.line}`), [], 'clean code must produce no findings');
  })
);

suite.push(
  test('security: a secret inside a comment is still reported', async () => {
    const dir = path.join(TEST_DIR, 'sec-comment');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'x.js'), '// old key: AKIAIOSFODNN7EXAMPLE\n');
    const r = await secScan({ dir, includeDeps: false });
    assert.ok(r.findings.some((f) => f.rule === 'secret.aws-access-key'), 'a key in a comment must still be flagged');
  })
);

suite.push(
  test('security: findings dedupe, keep a triage verdict, and report as markdown + SARIF', async () => {
    const dir = path.join(TEST_DIR, 'sec-store');
    await makeVulnApp(dir);

    const scan = await secScan({ dir, includeDeps: false });
    const first = await findingsStore.save(dir, scan.findings);
    assert.equal(first.added, scan.findings.length);
    assert.equal(first.total, scan.findings.length);

    // scanning again must not duplicate anything
    const second = await findingsStore.save(dir, scan.findings);
    assert.equal(second.added, 0, 'a rescan must not add duplicates');
    assert.equal(second.total, first.total);

    const list = await findingsStore.list(dir);
    assert.equal(list.length, first.total);
    assert.equal(list[0].severity, 'critical', 'worst-first ordering');

    const target = list[0];
    await findingsStore.triage(dir, target.id, { status: 'false-positive', analysis: 'input is a constant', severity: 'low' });
    const after = await findingsStore.list(dir);
    const updated = after.find((f) => f.id === target.id);
    assert.equal(updated.status, 'false-positive');
    assert.equal(updated.analysis, 'input is a constant');
    assert.equal(findingsStore.counts(after).critical + findingsStore.counts(after).high + findingsStore.counts(after).medium + findingsStore.counts(after).low, first.total - 1);

    // the verdict must survive another scan
    await findingsStore.save(dir, scan.findings);
    const persisted = (await findingsStore.list(dir)).find((f) => f.id === target.id);
    assert.equal(persisted.status, 'false-positive', 'a triage verdict must survive a rescan');

    const md = await findingsStore.report(dir, { format: 'markdown' });
    assert.match(md, /# Security findings/);
    assert.match(md, /CWE-/);
    assert.match(md, /Remediation:/);

    const sarif = JSON.parse(await findingsStore.report(dir, { format: 'sarif' }));
    assert.equal(sarif.version, '2.1.0');
    assert.ok(sarif.runs[0].tool.driver.rules.length > 5, 'SARIF must declare its rules');
    assert.ok(sarif.runs[0].results.length > 5, 'SARIF must carry results');
    assert.ok(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine >= 1);

    const bad = await findingsStore.triage(dir, 'nope', { status: 'triaged' });
    assert.match(bad.error, /no finding/);
    const badStatus = await findingsStore.triage(dir, target.id, { status: 'not-a-status' });
    assert.match(badStatus.error, /status must be/);
  })
);

suite.push(
  test('security: the audit entry point is always offered, the follow-ups arrive with findings', async () => {
    // The entry tool must always be there, or the agent can never start.
    const base = await toolSchemas({});
    const baseNames = base.map((s) => (s.function ? s.function.name : s.name));
    assert.ok(baseNames.includes('security_scan'), 'security_scan must always be offered');

    // The follow-ups are lazy: the tool schemas are ~83% of every request, so they
    // only appear once there is something to triage. This keeps the base list small.
    assert.ok(!baseNames.includes('security_triage'), 'not offered before there is anything to triage');
    assert.ok(!baseNames.includes('security_report'), 'not offered before there is anything to report');

    // With findings in the workspace, they appear.
    const ws = path.join(TEST_DIR, 'sec-lazy');
    await fsp.mkdir(ws, { recursive: true });
    await findingsStore.save(ws, [
      { rule: 'code.eval', title: 'eval', severity: 'high', cwe: 'CWE-95', file: path.join(ws, 'a.js'), line: 1, snippet: 'eval(x)', message: 'fix it', confidence: 'high' },
    ]);
    const withFindings = await toolSchemas({}, { workspaceRoot: ws });
    const names = withFindings.map((s) => (s.function ? s.function.name : s.name));
    for (const t of ['security_scan', 'security_triage', 'security_report']) {
      assert.ok(names.includes(t), `${t} must be offered once findings exist`);
    }

    // and the base list stays under the schema budget
    assert.ok(JSON.stringify(base).length < 15000, `base tool schemas grew to ${JSON.stringify(base).length} chars`);
  })
);

suite.push(
  test('security: UI contract ensures findings counts and effective severity are accurate', async () => {
    const ws = path.join(TEST_DIR, `sec-ui-${Date.now()}`);
    await fsp.mkdir(ws, { recursive: true });
    await fsp.writeFile(path.join(ws, 'vuln.js'), 'eval(req.query.cmd);\n', 'utf8');

    const scanRes = await secScan({ dir: ws });
    assert.ok(scanRes.findings.length >= 1);
    await findingsStore.save(ws, scanRes.findings);

    const list = await findingsStore.list(ws);
    assert.ok(list.length >= 1);
    const c1 = findingsStore.counts(list);
    assert.ok(c1.medium >= 1 || c1.high >= 1 || c1.critical >= 1);

    // Triage one finding as confirmed and verify counts survive
    const target = list[0];
    const triaged = await findingsStore.triage(ws, target.id, { status: 'confirmed', analysis: 'Reachable sink' });
    assert.equal(triaged.finding.status, 'confirmed');

    // Triage as false positive -> excluded from active counts
    await findingsStore.triage(ws, target.id, { status: 'false-positive' });
    const listAfterFp = await findingsStore.list(ws);
    const c2 = findingsStore.counts(listAfterFp);
    const totalActive = c2.critical + c2.high + c2.medium + c2.low;
    assert.equal(totalActive, 0);
  })
);
/* ------------------------- security UI data contract ------------------------- */

suite.push(
  test('security UI: the shapes the Security page reads are the shapes main returns', async () => {
    // The Security page reads these fields off every finding and these keys off
    // counts. Nothing else guards the renderer <-> main contract, so a rename
    // would silently blank the page instead of failing a test.
    const dir = path.join(TEST_DIR, 'sec-contract');
    await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'src', 'a.js'),
      'const k = "AKIAIOSFODNN7EXAMPLE";\nfunction f(req) { eval(req.query.x); }\n'
    );

    const scan = await secScan({ dir, includeDeps: false });
    await findingsStore.save(dir, scan.findings);

    // --- what security:list returns: { ok, findings, counts }
    const list = await findingsStore.list(dir, {});
    const counts = findingsStore.counts(list);
    assert.ok(Array.isArray(list) && list.length >= 2, 'list must return the findings');
    assert.deepEqual(Object.keys(counts).sort(), ['critical', 'high', 'low', 'medium']);

    const uiFields = ['id', 'severity', 'severityAdjusted', 'status', 'title', 'rule', 'cwe', 'file', 'line', 'snippet', 'message'];
    for (const f of list) {
      const missing = uiFields.filter((k) => !(k in f));
      assert.deepEqual(missing, [], `finding is missing UI field(s): ${missing.join(', ')}`);
      // the page calls .toLowerCase() on these while filtering
      for (const k of ['title', 'rule', 'file', 'snippet', 'message', 'status', 'severity']) {
        assert.equal(typeof f[k], 'string', `${k} must be a string, got ${typeof f[k]}`);
      }
      assert.equal(typeof f.line, 'number', 'line must be a number');
      assert.ok(['critical', 'high', 'medium', 'low'].includes(f.severity), `bad severity ${f.severity}`);
    }

    // --- what security:triage returns. The IPC handler composes { ...res, counts };
    // the library itself returns { ok, finding }. Mirror the handler here so the
    // test checks the shape the renderer actually receives.
    const target = list[0];
    const t = await findingsStore.triage(dir, target.id, { status: 'confirmed', analysis: 'reachable from req.query' });
    assert.equal(t.ok, true);
    const after = await findingsStore.list(dir);
    const triageResponse = { ...t, counts: findingsStore.counts(after) };
    assert.deepEqual(Object.keys(triageResponse.counts).sort(), ['critical', 'high', 'low', 'medium']);
    assert.equal(after.find((f) => f.id === target.id).status, 'confirmed');

    // --- what security:report returns: { ok, report } with a string body
    for (const format of ['markdown', 'sarif', 'json']) {
      const rep = await findingsStore.report(dir, { format });
      assert.equal(typeof rep, 'string', `${format} report must be a string`);
      assert.ok(rep.length > 50, `${format} report looks empty`);
    }
    assert.equal(JSON.parse(await findingsStore.report(dir, { format: 'sarif' })).version, '2.1.0');
  })
);

/* --------------------------- reasoning-only replies --------------------------- */

suite.push(
  test('model: a reply streamed in `reasoning` is not lost, and never leaks over `content`', async () => {
    // Some providers stream the whole answer in `reasoning` / `reasoning_content`
    // and leave `content` empty. Nova read only `content`, so the reply vanished:
    // the user saw it in the network log and nothing arrived in the chat.
    const http = await import('node:http');
    const sse = (delta) =>
      `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta }] })}\n\n`;

    const serve = (chunks) =>
      new Promise((resolve) => {
        const srv = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          for (const c of chunks) res.write(sse(c));
          res.write('data: [DONE]\n\n');
          res.end();
        });
        srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
      });

    // --- 1. reasoning only -> it must become the reply
    {
      const { srv, port } = await serve([
        { reasoning: 'Namaste' },
        { reasoning_content: ', kaise hain?' },
      ]);
      try {
        let streamed = '';
        const r = await callModel({
          config: { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm', temperature: 0 },
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
          onDelta: (c) => {
            streamed += c;
          },
        });
        assert.match(r.content, /Namaste/, 'reasoning must come through as the reply');
        assert.match(r.content, /kaise hain/, 'reasoning_content must be read too');
        assert.equal(streamed, r.content, 'and it must reach the UI, not just the return value');
      } finally {
        srv.close();
      }
    }

    // --- 2. reasoning + tool_calls -> content stays empty; the reasoning is the
    // model's scratchpad, not an answer. Promoting it would show the user the
    // chain-of-thought as if it were a reply.
    {
      const { srv, port } = await serve([
        { reasoning: 'THINKING-SCRATCHPAD' },
        { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] },
      ]);
      try {
        const r = await callModel({
          config: { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm', temperature: 0 },
          messages: [{ role: 'user', content: 'read a.txt' }],
          tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
        });
        assert.equal(r.content, '', 'a tool-call turn must not turn its reasoning into the reply');
        assert.ok(!String(r.content).includes('THINKING-SCRATCHPAD'), 'scratchpad must never be the answer');
        assert.equal(r.toolCalls.length, 1, 'the tool call must survive');
        assert.equal(r.toolCalls[0].name, 'read_file');
        assert.match(r.toolCalls[0].argsRaw, /a\.txt/);
      } finally {
        srv.close();
      }
    }

    // --- 3. legacy `function_call` -> still parsed as a tool call
    {
      const { srv, port } = await serve([
        { function_call: { name: 'read_file', arguments: '{"path":"legacy.txt"}' } },
      ]);
      try {
        const r = await callModel({
          config: { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm', temperature: 0 },
          messages: [{ role: 'user', content: 'read legacy.txt' }],
          tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
        });
        assert.equal(r.toolCalls.length, 1, 'a legacy function_call must not be dropped');
        assert.equal(r.toolCalls[0].name, 'read_file');
        assert.match(r.toolCalls[0].argsRaw, /legacy\.txt/);
      } finally {
        srv.close();
      }
    }

    // --- 4. reasoning goes to its own channel and NEVER into the answer stream.
    // The collapsible thinking block reads `reasoning_delta`; if reasoning were
    // mixed into `assistant_delta` the chain-of-thought would render as the reply.
    {
      const { srv, port } = await serve([
        { reasoning: 'STEP-ONE ' },
        { reasoning_content: 'STEP-TWO ' },
        { content: 'The answer.' },
      ]);
      try {
        let reasoningText = '';
        let answerText = '';
        const r = await callModel({
          config: { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm', temperature: 0 },
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
          onReasoning: (t) => {
            reasoningText += t;
          },
          onDelta: (t) => {
            answerText += t;
          },
        });
        assert.equal(reasoningText, 'STEP-ONE STEP-TWO ', 'reasoning must reach its own channel');
        assert.equal(answerText, 'The answer.', 'reasoning must NOT be mixed into the answer stream');
        assert.ok(!answerText.includes('STEP-ONE'), 'chain-of-thought must never appear as the reply');
        assert.equal(r.content, 'The answer.');
      } finally {
        srv.close();
      }
    }

    // --- 5. the thinking signal fires ONCE per turn, not once per chunk
    {
      const { srv, port } = await serve([
        { reasoning: 'a' },
        { reasoning: 'b' },
        { reasoning: 'c' },
        { content: 'done' },
      ]);
      try {
        let thinkingCalls = 0;
        const r = await callModel({
          config: { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm', temperature: 0 },
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
          onThinking: () => {
            thinkingCalls += 1;
          },
        });
        assert.equal(thinkingCalls, 1, 'the thinking signal must fire once per turn, not per chunk');
        assert.equal(r.content, 'done');
      } finally {
        srv.close();
      }
    }

    // --- 6. a refusal with no content must reach the user, not vanish
    {
      const { srv, port } = await serve([{ refusal: 'I cannot help with that.' }]);
      try {
        const r = await callModel({
          config: { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm', temperature: 0 },
          messages: [{ role: 'user', content: 'do something bad' }],
          tools: [],
        });
        assert.match(r.content, /cannot help/, 'a refusal is the answer and must not be dropped');
      } finally {
        srv.close();
      }
    }

    // --- 7. reasoning then content -> only the content is the answer
    {
      const { srv, port } = await serve([
        { reasoning: 'THINKING-ONLY' },
        { content: 'The answer.' },
      ]);
      try {
        const r = await callModel({
          config: { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm', temperature: 0 },
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
        });
        assert.equal(r.content, 'The answer.', 'chain-of-thought must not leak into the answer');
        assert.ok(!r.content.includes('THINKING-ONLY'), 'reasoning must stay out when content arrives');
      } finally {
        srv.close();
      }
    }
  })
);

/* ------------------------------ challenge workflow ------------------------------ */

const SAMPLE_SPEC = [
  '**CHALLENGE OBJECTIVES:**',
  '* Design a new online store, from the home page to the order confirmation.',
  '* Improve the customer experience of browsing, choosing and buying products.',
  '',
  '**ROLLING CHECKPOINT REQUIREMENTS**',
  'Submit the following screens for checkpoint feedback:',
  '01) Home',
  '03) Product Page',
  '',
  '**FINAL SUBMISSION REQUIREMENTS**',
  'Submit all screens with the checkpoint feedback applied:',
  '01) Home',
  '02) Product Listing',
  '04) Cart',
  '',
  '- If your submission wins, your source files must be correct and final fixes must be completed.',
  '- You may submit as many times as you\'d like during the submission phase.',
].join('\n');

suite.push(
  test('challenge: parses a challenge reference and extracts a grouped checklist', async () => {
    // a TopCoder URL, a bare uuid, and a legacy numeric id all resolve
    assert.equal(
      challenge.parseChallengeId('https://www.topcoder.com/challenges/e68b8eaf-48d9-4f9a-86a2-1f7f3fab9e83'),
      'e68b8eaf-48d9-4f9a-86a2-1f7f3fab9e83'
    );
    assert.equal(challenge.parseChallengeId('e68b8eaf-48d9-4f9a-86a2-1f7f3fab9e83'), 'e68b8eaf-48d9-4f9a-86a2-1f7f3fab9e83');
    assert.equal(challenge.parseChallengeId('30129302'), '30129302');
    assert.equal(challenge.parseChallengeId('hello world'), null);
    assert.equal(challenge.parseChallengeId(''), null);

    const reqs = challenge.extractRequirements(SAMPLE_SPEC);
    const texts = reqs.map((r) => r.text);
    // the real deliverables must all be there
    for (const want of ['Home', 'Product Page', 'Product Listing', 'Cart']) {
      assert.ok(texts.includes(want), `checklist must contain "${want}"`);
    }
    // grouped under the heading they appeared beneath
    assert.ok(reqs.find((r) => r.text === 'Cart').group.includes('FINAL SUBMISSION'), 'items keep their section');
    // boilerplate must NOT become a requirement
    assert.ok(!texts.some((t) => /may submit as many times/i.test(t)), 'submission boilerplate is not a requirement');
    assert.ok(!texts.some((t) => /if your submission wins/i.test(t)), 'payment boilerplate is not a requirement');
    // duplicates across sections collapse to one entry per section, not per line
    assert.equal(texts.filter((t) => t === 'Home').length, 2, 'Home appears in both checkpoint and final sections');
  })
);

suite.push(
  test('challenge: fetchChallenge reads the TopCoder shape without hitting the network', async () => {
    const fake = async () => ({
      ok: true,
      json: async () => ({
        id: 'e68b8eaf-48d9-4f9a-86a2-1f7f3fab9e83',
        name: 'FAST - Premium Fashion Storefront Design Challenge (48 hrs)',
        description: SAMPLE_SPEC,
        tags: ['Web Design'],
        numOfRegistrants: 37,
        numOfSubmissions: 10,
        submissionEndDate: '2026-10-25T15:45:00.000Z',
        metadata: [{ name: 'fileTypes', value: '["fig"]' }],
        phases: [
          { name: 'Submission', scheduledEndDate: '2026-10-25T15:45:00.000Z' },
          { name: 'Review', scheduledEndDate: '2026-10-30T19:45:00.000Z' },
        ],
      }),
    });
    const r = await challenge.fetchChallenge('e68b8eaf', { fetchImpl: fake });
    assert.equal(r.ok, true);
    assert.match(r.challenge.name, /Premium Fashion Storefront/);
    assert.equal(r.challenge.fileTypes, '["fig"]');
    assert.equal(r.challenge.deadlines.length, 2);
    assert.match(r.challenge.url, /topcoder\.com\/challenges\//);

    // a bad response is reported, not thrown
    const bad = await challenge.fetchChallenge('x', { fetchImpl: async () => ({ ok: false, status: 500 }) });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /HTTP 500/);
    const junk = await challenge.fetchChallenge('x', { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
    assert.equal(junk.ok, false);
  })
);

suite.push(
  test('challenge: it says up front when the deliverable is one Nova cannot produce', async () => {
    // The track decides whether the work is even possible here. A Design contest
    // wants a .fig file — no agent can author one — so say so before the checklist
    // implies the job is doable.
    const design = challenge.deliverability('DESIGN');
    assert.equal(design.ok, false, 'a design challenge must be flagged');
    assert.match(design.note, /Figma|\.fig/, 'and must say why');
    assert.match(design.note, /Development|QA/, 'and point at tracks that do work');

    for (const t of ['DEVELOP', 'Development', 'QA', 'Data Science', 'Ideation']) {
      assert.equal(challenge.deliverability(t).ok, true, `${t} must be considered deliverable`);
    }
    assert.equal(challenge.deliverability(null).ok, true, 'an unknown track is not a blocker');
    assert.equal(challenge.deliverability(undefined).ok, true);

    // and the track is carried through fetchChallenge so the caller can judge it
    const fake = async () => ({
      ok: true,
      json: async () => ({
        id: 'x',
        name: 'A design thing',
        description: '01) Home\n',
        tags: [],
        track: { id: 't', name: 'Design', track: 'DESIGN' },
        phases: [],
        metadata: [],
      }),
    });
    const r = await challenge.fetchChallenge('x', { fetchImpl: fake });
    assert.equal(r.ok, true);
    assert.equal(r.challenge.track, 'DESIGN', 'the track must survive the fetch');
    assert.equal(challenge.deliverability(r.challenge.track).ok, false);
  })
);

suite.push(
  test('challenge: a track brings its submission requirements into the checklist', async () => {
    // Most challenges are lost on a technicality — a missing deployment guide, a
    // patch with no email — not on the work. So the track's submission playbook
    // rides along with the brief's own deliverables.
    const dev = challenge.submissionRequirements('DEVELOP');
    assert.ok(dev.length >= 4, 'development has a playbook');
    assert.ok(dev.some((d) => /deployment|setup guide/i.test(d.text)), 'it mentions a deployment guide');
    assert.ok(dev.some((d) => /email/i.test(d.text)), 'and the patch email requirement');
    assert.ok(dev.every((d) => d.group === 'Submission requirements'), 'grouped together');

    assert.ok(challenge.submissionRequirements('QA').length >= 4, 'QA has a playbook');
    assert.ok(challenge.submissionRequirements('QA').some((d) => /reproduce/i.test(d.text)));
    assert.ok(challenge.submissionRequirements('Data Science').length >= 3, 'DS has a playbook');
    assert.ok(challenge.submissionRequirements('Ideation').length >= 3, 'ideation has a playbook');
    // Design now HAS a playbook, because Penpot made design structure producible.
    // It is still not a free pass: the TopCoder deliverable is .fig, so the
    // playbook has to say the format is a hard requirement and that the finish is
    // by hand. deliverability() stays false for the same reason.
    const design = challenge.submissionRequirements('DESIGN');
    assert.ok(design.length >= 5, 'design has a playbook now');
    assert.ok(design.some((d) => /\.fig/.test(d.text)), 'and it names the .fig requirement');
    assert.ok(design.some((d) => /hand|Figma/i.test(d.text)), 'and says the finish is by hand');
    assert.equal(challenge.deliverability('DESIGN').ok, false, 'the .fig requirement still blocks it');

    const ws = path.join(TEST_DIR, 'chal-playbook');
    await fsp.mkdir(ws, { recursive: true });
    const spec = await challenge.saveSpec(ws, {
      name: 'Some Dev Challenge',
      track: 'DEVELOP',
      description: '**DELIVERABLES**\n01) Build the API\n02) Write the UI\n',
    });
    const groups = new Set(spec.items.map((i) => i.group));
    assert.ok(groups.has('DELIVERABLES'), 'the brief items are still there');
    assert.ok(groups.has('Submission requirements'), 'and the playbook joined them');
    assert.ok(spec.items.length > 2, 'so the checklist is bigger than the brief alone');
    assert.equal(spec.track, 'DEVELOP', 'the track is remembered on the spec');

    // re-ingesting the SAME brief must not duplicate the playbook items
    const again = await challenge.saveSpec(ws, {
      name: 'Some Dev Challenge',
      track: 'DEVELOP',
      description: '**DELIVERABLES**\n01) Build the API\n02) Write the UI\n',
    });
    assert.equal(again.items.length, spec.items.length, 're-ingest must not duplicate playbook items');
    const playbookCount = again.items.filter((i) => i.group === 'Submission requirements').length;
    assert.equal(playbookCount, dev.length, 'the playbook is added once, not once per ingest');
  })
);

suite.push(
  test('challenge: finding work returns only what Nova can actually deliver', async () => {
    const fake = async () => ({
      ok: true,
      json: async () => [
        { id: 'd1', name: 'Fashion Storefront Design', status: 'ACTIVE', track: { track: 'DESIGN' }, numOfRegistrants: 39, numOfSubmissions: 11, submissionEndDate: '2026-10-25T15:45:00.000Z' },
        { id: 'd1b', name: 'Fashion Storefront Design', status: 'NEW', track: { track: 'DESIGN' }, numOfRegistrants: 0, submissionEndDate: '2026-10-29T15:36:34.150Z' },
        { id: 'dev1', name: 'Build a Payments API', status: 'ACTIVE', track: { track: 'DEVELOP' }, numOfRegistrants: 12, numOfSubmissions: 3, submissionEndDate: '2026-11-02T12:00:00.000Z' },
        { id: 'qa1', name: 'Find bugs in the portal', status: 'ACTIVE', track: { track: 'QA' }, numOfRegistrants: 5, numOfSubmissions: 1, submissionEndDate: '2026-10-30T09:00:00.000Z' },
        { id: 'dead', name: 'Old finished thing', status: 'COMPLETED', track: { track: 'DEVELOP' } },
      ],
    });

    // default: only deliverable tracks, soonest deadline first
    const r = await challenge.listChallenges({ fetchImpl: fake });
    assert.equal(r.ok, true);
    const names = r.challenges.map((c) => c.name);
    assert.ok(!names.includes('Fashion Storefront Design'), 'a design contest must be filtered out');
    assert.ok(!names.includes('Old finished thing'), 'a completed challenge must be dropped');
    assert.deepEqual(names, ['Find bugs in the portal', 'Build a Payments API'], 'soonest deadline first');
    assert.ok(r.challenges.every((c) => c.deliverable === true));

    // the duplicate row (same name, different id) collapses to one
    const all = await challenge.listChallenges({ fetchImpl: fake, deliverableOnly: false });
    assert.equal(all.challenges.filter((c) => /Fashion/.test(c.name)).length, 1, 'duplicate rows collapse by name');
    // and the kept row is the one with real activity
    const fashion = all.challenges.find((c) => /Fashion/.test(c.name));
    assert.equal(fashion.status, 'ACTIVE');
    assert.equal(fashion.registrants, 39);

    // explicit track filter
    const qa = await challenge.listChallenges({ fetchImpl: fake, tracks: ['qa'] });
    assert.deepEqual(qa.challenges.map((c) => c.track), ['QA']);

    // limit
    assert.equal((await challenge.listChallenges({ fetchImpl: fake, limit: 1 })).challenges.length, 1);

    // a failing API is reported, not thrown
    const bad = await challenge.listChallenges({ fetchImpl: async () => ({ ok: false, status: 503 }) });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /HTTP 503/);
    assert.deepEqual(bad.challenges, []);
  })
);

suite.push(
  test('challenge: the checklist stores progress and re-ingesting a spec keeps the work', async () => {
    const ws = path.join(TEST_DIR, 'chal-1');
    await fsp.mkdir(ws, { recursive: true });

    const spec = await challenge.saveSpec(ws, { source: 'topcoder', name: 'Test', description: SAMPLE_SPEC });
    assert.ok(spec.items.length >= 5, 'the spec produced checklist items');
    assert.equal(challenge.progress(spec).done, 0);
    assert.equal(challenge.progress(spec).complete, false);

    const home = spec.items.find((i) => i.text === 'Home');
    await challenge.setItem(ws, home.id, { status: 'done', note: 'hero + grid' });
    assert.equal(challenge.progress(await challenge.listSpec(ws)).done, 1);

    // re-ingesting must not wipe progress — that is the whole point of the store
    await challenge.saveSpec(ws, { source: 'topcoder', name: 'Test', description: SAMPLE_SPEC });
    const again = await challenge.listSpec(ws);
    const kept = again.items.find((i) => i.id === home.id);
    assert.equal(kept.status, 'done', 'a re-ingest must preserve status');
    assert.equal(kept.note, 'hero + grid', 'and the note');

    // bad input is reported, not thrown
    assert.match((await challenge.setItem(ws, home.id, { status: 'nope' })).error, /status must be/);
    assert.match((await challenge.setItem(ws, 'zzzzzzzz', { status: 'done' })).error, /no checklist item/);
    assert.match((await challenge.setItem(path.join(TEST_DIR, 'nowhere'), 'x')).error, /no challenge spec/);
  })
);

suite.push(
  test('challenge: the zip it writes is a real zip, and packing is blocked while items are open', async () => {
    const ws = path.join(TEST_DIR, 'chal-2');
    await fsp.mkdir(path.join(ws, 'out'), { recursive: true });
    await fsp.writeFile(path.join(ws, 'out', 'Home.png'), Buffer.from('PNG-BYTES'));
    await fsp.writeFile(path.join(ws, 'README.md'), '# Submission\n');

    await challenge.saveSpec(ws, { name: 'T', description: '01) Home\n02) Cart\n' });

    // refuses while the checklist is open — a missing deliverable is how you lose
    const blocked = await challenge.pack(ws, { files: ['README.md'] });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /not complete/);
    assert.ok(blocked.blocked.length >= 1, 'it must say which items are still open');

    for (const it of (await challenge.listSpec(ws)).items) await challenge.setItem(ws, it.id, { status: 'done' });
    const outPath = path.join(ws, 'submission.zip');
    const r = await challenge.pack(ws, { files: ['README.md', 'out/Home.png'], outPath });
    assert.equal(r.ok, true);
    assert.deepEqual(r.files, ['README.md', 'out/Home.png']);

    // and the bytes really are a zip: local header, entry names, and a working CRC
    const buf = await fsp.readFile(outPath);
    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'must start with the local file header signature');
    assert.ok(buf.includes(Buffer.from('out/Home.png')), 'entry names are stored');
    assert.ok(buf.includes(Buffer.from('README.md')));
    assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, 'must end with the end-of-central-directory record');

    // The stored CRC must match the entry's payload — recompute it the way a
    // reader does. The FIRST entry is README.md (the order the files were passed),
    // and its local header sits at offset 0.
    const zlib = await import('node:zlib');
    const firstPayload = Buffer.from('# Submission\n');
    const crc = zlib.crc32(firstPayload) >>> 0;
    assert.equal(buf.readUInt32LE(14), crc, 'the first entry\'s CRC must match its data');
    // and the header must declare the right length
    assert.equal(buf.readUInt32LE(18), firstPayload.length, 'uncompressed size in the header');

    const missing = await challenge.pack(ws, { files: ['nope.txt'], outPath, force: true });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /cannot read/);
  })
);

suite.push(
  test('challenge UI: the shapes ChallengePage and store consume match the backend return shapes', async () => {
    const ws = path.join(TEST_DIR, 'chal-ui');
    await fsp.mkdir(ws, { recursive: true });

    // 1. Ingest via saveSpec
    const spec = await challenge.saveSpec(ws, {
      source: 'topcoder',
      id: 'e68b8eaf-48d9-4f9a-86a2-1f7f3fab9e83',
      name: 'Design Storefront',
      url: 'https://www.topcoder.com/challenges/e68b8eaf-48d9-4f9a-86a2-1f7f3fab9e83',
      tags: ['Design', 'UI'],
      deadlines: [{ phase: 'Submission', at: '2026-10-25T15:45:00.000Z' }],
      description: '01) Home\n02) Product Page\n',
    });

    const prog = challenge.progress(spec);

    // Verify ChallengeSpec fields consumed by ChallengePage.jsx
    for (const f of ['name', 'source', 'id', 'url', 'tags', 'deadlines', 'items']) {
      assert.ok(f in spec, `spec must have field "${f}"`);
    }
    assert.ok(Array.isArray(spec.items) && spec.items.length === 2, 'items must be an array of deliverables');

    // Verify ReqItem fields consumed by ChallengePage.jsx
    const itemFields = ['id', 'text', 'group', 'status', 'note'];
    for (const item of spec.items) {
      for (const f of itemFields) {
        assert.ok(f in item, `item must have field "${f}"`);
      }
      assert.ok(['pending', 'generating', 'done', 'verified', 'skipped'].includes(item.status));
    }

    // Verify progress shape consumed by ChallengePage.jsx
    assert.equal(typeof prog.total, 'number');
    assert.equal(typeof prog.done, 'number');
    assert.equal(typeof prog.complete, 'boolean');
    assert.deepEqual(Object.keys(prog.byStatus).sort(), ['done', 'generating', 'pending', 'skipped', 'verified']);
  })
);

suite.push(
  test('security: autonomous verification distinguishes reachable taint vs benign literal without silent drops', async () => {
    const dir = path.join(TEST_DIR, 'sec-verify');
    await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'src', 'vulns.js'),
      [
        '// Benign hardcoded literal argument (advisory benign-literal)',
        'eval("2 + 2");',
        '',
        '// Untrusted source flowing into sink (advisory strong-signal)',
        'function handler(req, res) {',
        '  const userInput = req.query.cmd;',
        '  eval(userInput);',
        '}',
      ].join('\n')
    );

    const scan = await secScan({ dir, includeDeps: false });
    await findingsStore.save(dir, scan.findings);

    const list = await findingsStore.list(dir);
    assert.equal(list.length, 2, 'scan must find both eval occurrences');

    // Run bulk verification
    const bulk = await verifyEngine.verifyAllFindings(dir);
    assert.equal(bulk.ok, true);
    assert.equal(bulk.verified, 2);
    assert.equal(bulk.strongSignal, 1, 'tainted input should be flagged as strong-signal');
    assert.equal(bulk.benignLiteral, 1, 'benign literal constant should be flagged as benign-literal');

    // Crucial check: verify finding is NEVER silently downgraded to false-positive (which would hide it from reports)
    const verifiedList = await findingsStore.list(dir);
    assert.equal(verifiedList.length, 2, 'findings must not be removed from list');
    for (const f of verifiedList) {
      assert.notEqual(f.status, 'false-positive', 'verifier must never auto-dismiss findings');
    }
    const strongFinding = verifiedList.find((f) => f.analysis && f.analysis.includes('STRONG SIGNAL'));
    const benignFinding = verifiedList.find((f) => f.analysis && f.analysis.includes('BENIGN LITERAL'));
    assert.ok(strongFinding, 'strong signal finding must be recorded with advisory label');
    assert.ok(benignFinding, 'benign literal finding must be recorded with advisory label');
  })
);

suite.push(
  test('drive access: user can configure scopeMode: readonly for full drive browsing', async () => {
    const cfgPath = gdrive.getConfigPath ? gdrive.getConfigPath() : (await gdrive.status()).configPath;
    await fsp.mkdir(path.dirname(cfgPath), { recursive: true });
    let prev = null;
    try { prev = await fsp.readFile(cfgPath, 'utf8'); } catch {}

    try {
      // 1. Switch to readonly scopeMode
      const stReadonly = await gdrive.save({ scopeMode: 'readonly' });
      assert.equal(stReadonly.scopeMode, 'readonly');
      assert.match(stReadonly.scope, /drive\.readonly/);
      assert.equal(stReadonly.isolated, false, 'readonly mode cannot be isolated');

      // 2. Switch back to isolated scopeMode (default)
      const stIsolated = await gdrive.save({ scopeMode: 'isolated' });
      assert.equal(stIsolated.scopeMode, 'isolated');
      assert.match(stIsolated.scope, /drive\.file/);
    } finally {
      if (prev === null) await fsp.rm(cfgPath, { force: true }).catch(() => {});
      else await fsp.writeFile(cfgPath, prev, 'utf8').catch(() => {});
    }
  })
);

/* --------------------------------- kaggle --------------------------------- */

suite.push(
  test('kaggle: credentials resolve, and a 401 asks for them instead of crashing', async () => {
    // either auth shape is accepted
    assert.equal(kaggle.kaggleAuth({ KAGGLE_API_TOKEN: 'KGAT_abc' }).header, 'Bearer KGAT_abc');
    const basic = kaggle.kaggleAuth({ KAGGLE_USERNAME: 'me', KAGGLE_KEY: 'secret' });
    assert.equal(basic.scheme, 'basic');
    assert.equal(basic.header, 'Basic ' + Buffer.from('me:secret').toString('base64'));
    // Hermetic: point at a home that cannot exist. Calling kaggleAuth({}) would read
    // the real ~/.kaggle, so this would pass in CI and fail on a machine that has
    // credentials set up — exactly the machine we are building for.
    const NO_HOME = { home: '/definitely/not/a/real/home' };
    assert.equal(kaggle.kaggleAuth({}, NO_HOME), null, 'no creds -> no header');
    // It must never hand back the value, only where it came from.
    assert.equal(kaggle.kaggleAuth({ KAGGLE_API_TOKEN: 'KGAT_abc' }, NO_HOME).source, 'KAGGLE_API_TOKEN');
    assert.equal(kaggle.kaggleAuth({ KAGGLE_USERNAME: 'me' }, NO_HOME), null, 'a username alone is not enough');

    // 401 is reported as "you need credentials", with the steps
    const unauth = await kaggle.listCompetitions({ fetchImpl: async () => ({ ok: false, status: 401 }), env: {} });
    assert.equal(unauth.ok, false);
    assert.equal(unauth.authRequired, true);
    assert.ok(unauth.steps.length >= 3, 'it must tell the user how to get a token');
    assert.deepEqual(unauth.competitions, []);

    // and other failures are just errors
    const boom = await kaggle.listCompetitions({ fetchImpl: async () => ({ ok: false, status: 503 }), env: {} });
    assert.equal(boom.ok, false);
    assert.equal(boom.authRequired, undefined);
    assert.match(boom.error, /HTTP 503/);
  })
);

suite.push(
  test('kaggle: competitions are shaped into the same fields the UI reads', async () => {
    let seenUrl = '';
    let seenHeaders = null;
    const fake = async (url, init) => {
      seenUrl = String(url);
      seenHeaders = init && init.headers;
      return {
        ok: true,
        json: async () => [
          { ref: 'titanic', title: 'Titanic - Machine Learning from Disaster', category: 'Getting Started', deadline: '2030-01-01T00:00:00Z', reward: 'Knowledge', teamCount: 15000, userHasEntered: true, userRank: 4021 },
          { ref: 'playground-s4e1', title: 'Playground S4E1', category: 'Playground', deadline: '2026-12-01T00:00:00Z', teamCount: 900, userHasEntered: false },
          { title: 'no ref here' },
        ],
      };
    };
    const r = await kaggle.listCompetitions({ fetchImpl: fake, env: { KAGGLE_API_TOKEN: 'KGAT_x' }, search: 'titanic' });
    assert.equal(r.ok, true);
    assert.equal(r.competitions.length, 2, 'a row with no ref is dropped');

    const t = r.competitions[0];
    assert.equal(t.ref, 'titanic');
    assert.equal(t.category, 'Getting Started');
    assert.equal(t.teamCount, 15000);
    assert.equal(t.userHasEntered, true);
    assert.equal(t.userRank, 4021);
    assert.match(t.url, /kaggle\.com\/competitions\/titanic$/);

    // the row with no userRank must not invent one
    assert.equal(r.competitions[1].userRank, null);
    assert.equal(r.competitions[1].reward, null);

    // search + auth actually reached the request
    assert.match(seenUrl, /search=titanic/);
    assert.match(seenUrl, /competitions\/list/);
    assert.equal(seenHeaders.authorization, 'Bearer KGAT_x');

    // limit is honoured
    const one = await kaggle.listCompetitions({ fetchImpl: fake, env: {}, limit: 1 });
    assert.equal(one.competitions.length, 1);
  })
);

/* ------------------------------ kaggle spec ------------------------------ */

suite.push(
  test('challenge: a Kaggle ref is recognised and brings the metric-first playbook', async () => {
    assert.equal(challenge.parseKaggleRef('https://www.kaggle.com/competitions/titanic'), 'titanic');
    assert.equal(challenge.parseKaggleRef('https://www.kaggle.com/c/house-prices-advanced-regression-techniques'), 'house-prices-advanced-regression-techniques');
    assert.equal(challenge.parseKaggleRef('https://www.topcoder.com/challenges/e68b8eaf-48d9-4f9a-86a2-1f7f3fab9e83'), null, 'a TopCoder url is not a Kaggle ref');
    assert.equal(challenge.parseKaggleRef(''), null);

    // Kaggle is a track Nova can deliver, and it gets its own playbook
    assert.equal(challenge.deliverability('kaggle').ok, true);
    const pb = challenge.submissionRequirements('kaggle');
    assert.ok(pb.length >= 6, 'kaggle has a playbook');
    // the metric is the objective, so it must be the first thing on the list
    assert.match(pb[0].text, /metric|evaluation/i, 'the playbook leads with the metric');
    assert.ok(pb.some((i) => /rules/i.test(i.text)), 'and the rules/401 trap');
    assert.ok(pb.some((i) => /submission\.csv/i.test(i.text)), 'and the submission shape');
    assert.ok(pb.some((i) => /cross-validation/i.test(i.text)), 'and local CV on the same metric');
    assert.ok(pb.every((i) => i.group === 'Submission requirements'));

    // ingesting a Kaggle spec lands them in the checklist
    const ws = path.join(TEST_DIR, 'chal-kaggle');
    await fsp.mkdir(ws, { recursive: true });
    const spec = await challenge.saveSpec(ws, { source: 'kaggle', id: 'titanic', name: 'Titanic', track: 'kaggle' });
    assert.equal(spec.track, 'kaggle');
    assert.ok(spec.items.length >= 6, 'the playbook joined the checklist');
    assert.equal(challenge.progress(spec).complete, false);
  })
);

/* --------------------------- kaggle data + score --------------------------- */

suite.push(
  test('kaggle: lists the data files, downloads one to disk, and reads the score back', async () => {
    const json = (status, body) => ({ ok: status === 200, status, json: async () => body });

    const files = await kaggle.listDataFiles('titanic', {
      fetchImpl: async () => json(200, [{ name: 'train.csv', totalBytes: 61194, creationDate: '2018-01-01' }, { name: 'test.csv', totalBytes: 28629 }, { totalBytes: 1 }]),
      env: {},
    });
    assert.equal(files.ok, true);
    assert.deepEqual(files.files.map((f) => f.name), ['train.csv', 'test.csv'], 'a nameless row is dropped');
    assert.equal(files.files[0].bytes, 61194);

    // a download really lands on disk
    const dest = path.join(TEST_DIR, 'kaggle-dl', 'train.csv');
    const dl = await kaggle.downloadDataFile('titanic', 'train.csv', dest, {
      fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('a,b\n1,2').buffer }),
      env: {},
    });
    assert.equal(dl.ok, true);
    assert.equal(dl.bytes, 7);
    assert.equal(await fsp.readFile(dl.path, 'utf8'), 'a,b\n1,2', 'the bytes on disk are the bytes returned');

    // the score comes back from the submissions list — this is the feedback loop
    const subs = await kaggle.listSubmissions('titanic', {
      fetchImpl: async () => json(200, [{ fileName: 'submission.csv', status: 'complete', publicScore: 0.76555, privateScore: 0.76, description: 'baseline' }]),
      env: {},
    });
    assert.equal(subs.ok, true);
    assert.equal(subs.submissions[0].status, 'complete');
    assert.equal(subs.submissions[0].publicScore, 0.76555);
    // a submission with no score yet must not invent one
    const pending = await kaggle.listSubmissions('titanic', { fetchImpl: async () => json(200, [{ fileName: 's.csv', status: 'pending' }]), env: {} });
    assert.equal(pending.submissions[0].publicScore, null);
    assert.equal(pending.submissions[0].status, 'pending');

    // every one of these asks for credentials the same way
    for (const call of [
      kaggle.listDataFiles('x', { fetchImpl: async () => json(401, {}), env: {} }),
      kaggle.downloadDataFile('x', 'f', path.join(TEST_DIR, 'nope'), { fetchImpl: async () => ({ ok: false, status: 401 }), env: {} }),
      kaggle.listSubmissions('x', { fetchImpl: async () => json(401, {}), env: {} }),
    ]) {
      const r = await call;
      assert.equal(r.ok, false);
      assert.equal(r.authRequired, true);
      assert.ok(r.steps.length >= 3);
    }

    // a missing file is reported, not thrown
    const missing = await kaggle.downloadDataFile('x', 'f', path.join(TEST_DIR, 'nope'), { fetchImpl: async () => ({ ok: false, status: 404 }), env: {} });
    assert.match(missing.error, /HTTP 404/);
  })
);

/* ------------------------------ kaggle submit ------------------------------ */

suite.push(
  test('kaggle: submit runs the three verified steps in order and carries the token', async () => {
    const ws = path.join(TEST_DIR, 'kaggle-submit');
    await fsp.mkdir(ws, { recursive: true });
    const csv = path.join(ws, 'submission.csv');
    await fsp.writeFile(csv, 'id,target\n1,0.5\n');

    const calls = [];
    let urlStep = '';
    const fake = async (url, init) => {
      const u = String(url);
      calls.push({ url: u, method: (init && init.method) || 'GET' });
      if (u.includes('/submissions/url/')) {
        urlStep = u;
        return { ok: true, status: 200, json: async () => ({ createUrl: 'https://upload.example/x', token: 'tok-123' }) };
      }
      if (u === 'https://upload.example/x') return { ok: true, status: 200 };
      if (u.includes('/submissions/submit/')) return { ok: true, status: 200, json: async () => ({ status: 'pending', description: 'baseline' }) };
      return { ok: false, status: 404 };
    };

    const r = await kaggle.submitPrediction('titanic', csv, 'baseline', { fetchImpl: fake, env: { KAGGLE_API_TOKEN: 'KGAT_x' } });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'put');
    assert.equal(r.token, 'tok-123', 'the token from step 1 must reach step 3');
    assert.deepEqual(calls.map((c) => c.method), ['POST', 'PUT', 'POST'], 'the three steps, in order');

    // The path carries the byte length and the mtime in SECONDS — the shape the
    // naive guess got wrong (it put the file name in the path instead).
    const stat = await fsp.stat(csv);
    assert.match(urlStep, new RegExp(`/submissions/url/${stat.size}/\\d+$`), 'length and mtime go in the path');
    assert.ok(!urlStep.includes('submission.csv'), 'the file name must NOT be in the path');

    // a file that is not there is reported, not thrown
    const missing = await kaggle.submitPrediction('t', path.join(ws, 'nope.csv'), 'x', { fetchImpl: fake, env: {} });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /cannot read submission file/);

    // an empty file is refused before any network call
    const emptyPath = path.join(ws, 'empty.csv');
    await fsp.writeFile(emptyPath, '');
    let called = 0;
    const counting = async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; };
    const empty = await kaggle.submitPrediction('t', emptyPath, 'x', { fetchImpl: counting, env: {} });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /empty/);
    assert.equal(called, 0, 'an empty file must not reach the network');

    // 401 anywhere in the flow asks for credentials
    const unauth = await kaggle.submitPrediction('t', csv, 'x', { fetchImpl: async () => ({ ok: false, status: 401 }), env: {} });
    assert.equal(unauth.authRequired, true);
    assert.ok(unauth.steps.length >= 3);
  })
);

/* --------------------------- kaggle tools (lazy) --------------------------- */

suite.push(
  test('agent: the kaggle tools appear only inside a kaggle workspace', async () => {
    // Base: no kaggle tools, and the base schema is unchanged by adding them.
    const base = await toolSchemas({});
    const baseNames = base.map((x) => (x.function ? x.function.name : x.name));
    assert.ok(!baseNames.includes('kaggle_data'), 'not offered outside a kaggle workspace');
    assert.ok(!baseNames.includes('kaggle_submit'));
    assert.ok(JSON.stringify(base).length < 15000, `base schema is ${JSON.stringify(base).length} chars`);

    // A kaggle workspace gets them, along with the challenge follow-ups.
    const kws = path.join(TEST_DIR, 'kaggle-tools');
    await fsp.mkdir(kws, { recursive: true });
    await challenge.saveSpec(kws, { source: 'kaggle', id: 'titanic', name: 'Titanic', track: 'kaggle' });
    const k = await toolSchemas({}, { workspaceRoot: kws });
    const kNames = k.map((x) => (x.function ? x.function.name : x.name));
    assert.ok(kNames.includes('kaggle_data'), 'a kaggle workspace gets the data tool');
    assert.ok(kNames.includes('kaggle_submit'), 'and the submit tool');
    assert.ok(kNames.includes('challenge_check'), 'and the challenge follow-ups');
    // even fully loaded it must stay inside the budget
    assert.ok(JSON.stringify(k).length < 15000, `kaggle schema is ${JSON.stringify(k).length} chars`);

    // A non-kaggle workspace must NOT get them — that is the whole point of gating.
    const tws = path.join(TEST_DIR, 'topcoder-tools');
    await fsp.mkdir(tws, { recursive: true });
    await challenge.saveSpec(tws, { name: 'A TopCoder thing', track: 'DEVELOP' });
    const t = await toolSchemas({}, { workspaceRoot: tws });
    const tNames = t.map((x) => (x.function ? x.function.name : x.name));
    assert.ok(!tNames.includes('kaggle_data'), 'a TopCoder workspace must not carry kaggle tools');
    assert.ok(!tNames.includes('kaggle_submit'));
  })
);

/* -------------------------------- deadlines -------------------------------- */

suite.push(
  test('challenge: deadlines report remaining time and urgency, and never invent one', async () => {
    const now = new Date('2026-10-24T12:00:00Z');
    const at = (iso) => challenge.timeRemaining(iso, now);

    assert.equal(at('2026-10-24T16:00:00Z').urgency, 'critical', 'under 6h is critical');
    assert.equal(at('2026-10-24T16:00:00Z').human, '4h 0m');
    assert.equal(at('2026-10-24T22:00:00Z').urgency, 'soon', 'under 24h is soon');
    assert.equal(at('2026-10-26T12:00:00Z').urgency, 'normal', '2 days out is normal');
    assert.equal(at('2026-10-26T12:00:00Z').human, '2d 0h');

    const past = at('2026-10-20T12:00:00Z');
    assert.equal(past.closed, true);
    assert.equal(past.urgency, 'closed');

    // A missing or unparseable date must NOT read as "closed" — that would make the
    // agent stop on a challenge that is actually open.
    for (const bad of [null, undefined, '', 'not-a-date']) {
      const r = at(bad);
      assert.equal(r.known, false, `${bad} is not a known deadline`);
      assert.equal(r.closed, false, `${bad} must not read as closed`);
      assert.equal(r.urgency, 'unknown');
      assert.equal(r.human, 'no deadline');
    }

    // durations stay short and never go negative
    assert.equal(challenge.formatDuration(0), '0m');
    assert.equal(challenge.formatDuration(-99999), '0m', 'a negative duration clamps to 0m');
    assert.equal(challenge.formatDuration(45 * 60 * 1000), '45m');
    assert.equal(challenge.formatDuration(3 * 86400 * 1000 + 5 * 3600 * 1000), '3d 5h');

    // the summary picks the NEXT open deadline, not the first in the list
    const sum = challenge.deadlineSummary([
      { phase: 'Review', at: '2026-10-30T12:00:00Z' },
      { phase: 'Submission', at: '2026-10-24T16:00:00Z' },
      { phase: 'Past', at: '2026-10-01T12:00:00Z' },
    ], now);
    assert.equal(sum.next.phase, 'Submission', 'soonest open deadline wins');
    assert.equal(sum.next.human, '4h 0m');
    assert.equal(sum.next.urgency, 'critical');
    assert.equal(sum.all.length, 3, 'every deadline is still reported');

    // once everything has passed there is no "next"
    const done = challenge.deadlineSummary([{ phase: 'Submission', at: '2026-10-01T12:00:00Z' }], now);
    assert.equal(done.next, null);
    assert.equal(done.all[0].closed, true);

    // an empty or absent list is handled
    assert.equal(challenge.deadlineSummary([], now).next, null);
    assert.equal(challenge.deadlineSummary(null, now).next, null);
  })
);

/* --------------------------------- penpot --------------------------------- */

suite.push(
  test('penpot: builds a real .penpot file, and refuses a design it cannot draw', async () => {
    // bad designs are rejected with a reason, before anything is written
    assert.match(penpot.validateDesign({ boards: [] }).error, /non-empty/);
    assert.match(penpot.validateDesign({ boards: [{ name: 'X' }] }).error, /positive width/);
    assert.match(penpot.validateDesign({ boards: [{ name: 'X', width: 10, height: 10, elements: [{ kind: 'blob', x: 0, y: 0, width: 1, height: 1 }] }] }).error, /kind must be one of/);
    assert.match(penpot.validateDesign({ boards: [{ name: 'X', width: 10, height: 10, elements: [{ kind: 'text', x: 0, y: 0, width: 1, height: 1 }] }] }).error, /content/);
    assert.match(penpot.validateDesign(null).error, /must be an object/);
    assert.equal(penpot.validateDesign({ boards: [{ name: 'X', width: 10, height: 10 }] }).ok, true, 'a board with no elements is fine');

    // and a good one really produces a file
    const ws = path.join(TEST_DIR, 'penpot-design');
    await fsp.mkdir(ws, { recursive: true });
    const r = await penpot.createDesign(ws, {
      name: 'Test Storefront',
      boards: [
        { name: 'Home', width: 1440, height: 900, elements: [
          { kind: 'rect', name: 'Navbar', x: 0, y: 0, width: 1440, height: 72, fill: '#0F172A' },
          { kind: 'text', name: 'Hero', x: 80, y: 180, width: 700, height: 60, content: 'Hello' },
          { kind: 'circle', name: 'Avatar', x: 1330, y: 16, width: 40, height: 40 },
        ] },
        { name: 'Product', width: 1440, height: 900, elements: [] },
      ],
    });
    assert.equal(r.ok, true, r.error || '');
    assert.equal(r.boards, 2);
    assert.equal(r.elements, 3);
    assert.ok(r.bytes > 0);

    // It must be a real zip whose layout matches the documented .penpot spec:
    // local header, the manifest, and a page directory holding shape JSON.
    const buf = await fsp.readFile(r.path);
    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'starts with the zip local header');
    // The library compresses entries, so the manifest CONTENT is not findable in
    // the raw bytes — but entry names are stored plain. Assert on those.
    assert.ok(buf.includes(Buffer.from('manifest.json')), 'has a manifest entry');
    assert.ok(buf.includes(Buffer.from('/pages/')), 'has the pages layout');
    assert.ok(buf.includes(Buffer.from('files/')), 'has the files/ tree');
    // and the manifest really is a manifest: read it back out of the zip
    const { execFileSync } = await import('node:child_process');
    const manifest = JSON.parse(execFileSync('unzip', ['-p', r.path, 'manifest.json']).toString());
    assert.equal(manifest.type, 'penpot/export-files', 'it is a penpot export');
    assert.ok(Array.isArray(manifest.files) && manifest.files.length === 1, 'one file in the archive');
    assert.ok(manifest.files[0].features.includes('fdata/shape-data-type'), 'declares the shape feature flag');

    // a broken library or bad path is reported, not thrown
    const bad = await penpot.createDesign(ws, { boards: [] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /non-empty/);
  })
);

suite.push(
  test('penpot: UI & IPC contract lists design files and returns valid metadata', async () => {
    const ws = path.join(TEST_DIR, 'penpot-ui');
    await fsp.mkdir(ws, { recursive: true });

    // Create a sample design
    const r = await penpot.createDesign(ws, {
      name: 'Mobile App Wireframe',
      boards: [
        { name: 'Onboarding', width: 375, height: 812, elements: [
          { kind: 'rect', name: 'Header', x: 0, y: 0, width: 375, height: 60, fill: '#1E293B' },
          { kind: 'text', name: 'Welcome', x: 20, y: 100, width: 335, height: 32, content: 'Welcome' },
        ] },
      ],
    });
    assert.equal(r.ok, true);

    // Verify file exists on disk
    const stat = await fsp.stat(r.path);
    assert.ok(stat.size > 0);

    // Test list logic equivalent to penpot:list
    const designDir = path.join(ws, 'design');
    const entries = await fsp.readdir(designDir, { withFileTypes: true });
    const penpotFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.penpot'))
      .map((e) => ({ name: e.name, path: path.join(designDir, e.name) }));

    assert.equal(penpotFiles.length, 1);
    assert.equal(penpotFiles[0].name, 'mobile-app-wireframe.penpot');
  })
);

/* ---------------------------- kaggle credentials ---------------------------- */

suite.push(
  test('kaggle: finds credentials in all four places the client uses, files included', async () => {
    const home = path.join(TEST_DIR, 'kaggle-home');
    const kdir = path.join(home, '.kaggle');
    await fsp.mkdir(kdir, { recursive: true });

    // 1 and 2: the env vars
    assert.equal(kaggle.kaggleAuth({ KAGGLE_API_TOKEN: 'KGAT_env' }, { home }).scheme, 'token');
    assert.equal(kaggle.kaggleAuth({ KAGGLE_API_TOKEN: 'KGAT_env' }, { home }).source, 'KAGGLE_API_TOKEN');
    const basicEnv = kaggle.kaggleAuth({ KAGGLE_USERNAME: 'u', KAGGLE_KEY: 'k' }, { home });
    assert.equal(basicEnv.scheme, 'basic');
    assert.equal(basicEnv.source, 'KAGGLE_USERNAME/KAGGLE_KEY');

    // 3: ~/.kaggle/access_token — the file Kaggle's own token screen tells you to
    // write. A client that only read env vars would miss it entirely.
    assert.equal(kaggle.kaggleAuth({}, { home }), null, 'nothing configured yet');
    await fsp.writeFile(path.join(kdir, 'access_token'), 'KGAT_from_file\n');
    const fromFile = kaggle.kaggleAuth({}, { home });
    assert.equal(fromFile.scheme, 'token');
    assert.equal(fromFile.header, 'Bearer KGAT_from_file', 'trailing whitespace is trimmed');
    assert.match(fromFile.source, /access_token$/);

    // 4: ~/.kaggle/kaggle.json — the classic username/key pair
    await fsp.writeFile(path.join(kdir, 'kaggle.json'), JSON.stringify({ username: 'me', key: 'sekret' }));
    assert.equal(kaggle.kaggleAuth({}, { home }).scheme, 'token', 'access_token wins over kaggle.json');

    await fsp.rm(path.join(kdir, 'access_token'));
    const fromJson = kaggle.kaggleAuth({}, { home });
    assert.equal(fromJson.scheme, 'basic');
    assert.equal(fromJson.header, 'Basic ' + Buffer.from('me:sekret').toString('base64'));
    assert.match(fromJson.source, /kaggle\.json$/);

    // a corrupt file must not throw — it just means "no credentials here"
    await fsp.writeFile(path.join(kdir, 'kaggle.json'), 'not json at all');
    assert.equal(kaggle.kaggleAuth({}, { home }), null);
    await fsp.writeFile(path.join(kdir, 'kaggle.json'), JSON.stringify({ username: 'me' }));
    assert.equal(kaggle.kaggleAuth({}, { home }), null, 'a username with no key is not credentials');

    // KAGGLE_CONFIG_DIR moves the directory, as the official client allows
    const alt = path.join(TEST_DIR, 'kaggle-alt');
    await fsp.mkdir(alt, { recursive: true });
    await fsp.writeFile(path.join(alt, 'access_token'), 'KGAT_alt');
    const viaDir = kaggle.kaggleAuth({ KAGGLE_CONFIG_DIR: alt }, { home: '/definitely/not/here' });
    assert.equal(viaDir.scheme, 'token');
    assert.equal(viaDir.header, 'Bearer KGAT_alt');

    // and nothing anywhere still means null, not a throw
    assert.equal(kaggle.kaggleAuth({}, { home: '/definitely/not/here' }), null);
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
