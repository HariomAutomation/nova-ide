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
import { parseWebToolCalls, protocolBlock } from '../electron/gemini-web.js';
import { loadRules, toolSchemas, compactMessages, normalizeTodos, codeLineage } from '../electron/agent.js';
import { isWithin } from '../electron/tools/paths.js';
import computer from '../electron/tools/computer.js';
import git from '../electron/tools/git.js';
import gdrive from '../electron/tools/gdrive.js';
import {
  isAutomationDue,
  dueAutomations,
  normalizeTrigger,
  describeTrigger,
} from '../renderer/src/automation-schedule.js';
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
    assert.match(l.path, /memory\.json$/);

    const txt = await memory.memoryText();
    assert.match(txt, /TypeScript/);
    assert.match(txt, /Electron/);

    await memory.remove(l.notes[0].id);
    const l2 = await memory.list();
    assert.equal(l2.notes.length, 1);

    assert.equal(memory.normalizeText('  a\n\n   b  '), 'a b');
    assert.equal((await memory.add('   ')).error, 'Note is empty.');
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
