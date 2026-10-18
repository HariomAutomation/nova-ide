const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const fsTools = require('./tools/fsTools');
const { runCommand } = require('./tools/terminal');
const browser = require('./tools/browser');
const computer = require('./tools/computer');
const web = require('./tools/web');
const checkpoints = require('./tools/checkpoints');
const { describeHttpError } = require('./tools/errors');
const { isWithin } = require('./tools/paths');
const memory = require('./tools/memory');
const mcp = require('./mcp');
const geminiWeb = require('./gemini-web');
const cloudcode = require('./tools/cloudcode');

/* ------------------------------ tool schemas ------------------------------ */

const TOOL_DEFS = [
  {
    name: 'list_dir',
    category: 'read',
    description: 'List files and directories at a path.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute directory path.' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    category: 'read',
    description:
      'Read a text file. Returns numbered lines. Use offset/limit for large files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer', description: '1-based first line (default 1).' },
        limit: { type: 'integer', description: 'Max lines (default 2000).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    category: 'edit',
    description: 'Create or overwrite a file with the given content.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    category: 'edit',
    description:
      'Replace exact text in a file. Prefer this over write_file for modifications. old_string must match exactly and be unique unless replace_all is true.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_file',
    category: 'edit',
    description: 'Delete a file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'grep_search',
    category: 'read',
    description:
      'Regex search across text files under a directory. Skips node_modules/.git and binary files.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: 'Directory to search (default: workspace root).' },
        case_sensitive: { type: 'boolean' },
        max_results: { type: 'integer' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'web_search',
    category: 'web',
    description:
      'Search the web (no API key needed). Returns result titles, URLs and snippets. Follow up with web_fetch to read a page.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'integer', description: 'Number of results (1-10, default 6).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    category: 'web',
    description:
      'Fetch a URL and return its readable text content (HTML is converted to text). Use for docs, READMEs and API references.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'http(s) URL.' } },
      required: ['url'],
    },
  },
  {
    name: 'mcp_list_tools',
    category: 'read',
    description:
      'List tools from connected MCP servers (name + description). Big servers (e.g. REA) keep their tools hidden to save tokens — use this to discover them, then call any tool directly as mcp__<server>__<tool>.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server name (optional; lists every server when omitted).' },
        query: { type: 'string', description: 'Optional filter substring on the tool name or description.' },
      },
    },
  },
  {
    name: 'run_terminal_cmd',
    category: 'terminal',
    description:
      'Run a shell command (bash -lc) and return stdout, stderr and exit code. Commands run on the user machine and may require approval.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeout_ms: { type: 'integer' },
      },
      required: ['command'],
    },
  },
  {
    name: 'browser',
    category: 'browser',
    description:
      'Control a real Chromium browser (Playwright). Actions: open(url), click(selector), fill(selector,text), press(key), text, screenshot, back, close.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'click', 'fill', 'press', 'text', 'screenshot', 'back', 'close'],
        },
        url: { type: 'string' },
        selector: { type: 'string', description: 'CSS selector' },
        text: { type: 'string' },
        key: { type: 'string', description: 'e.g. Enter, Tab, Control+A' },
      },
      required: ['action'],
    },
  },
  {
    name: 'computer_use',
    category: 'computer',
    description:
      'Control the user desktop. Actions: screenshot, move, click, double_click, right_click, drag, scroll, type, key, wait. After an input action a fresh screenshot is returned automatically so you can see the result and decide the next step. Requires a system input tool; returns an error with setup hints when unavailable.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['screenshot', 'move', 'click', 'double_click', 'right_click', 'drag', 'scroll', 'type', 'key', 'wait'],
        },
        x: { type: 'integer', description: 'Screen x in pixels.' },
        y: { type: 'integer', description: 'Screen y in pixels.' },
        to_x: { type: 'integer', description: 'Drag end x.' },
        to_y: { type: 'integer', description: 'Drag end y.' },
        text: { type: 'string' },
        key: { type: 'string', description: 'e.g. Return, Tab, ctrl+a' },
        button: { type: 'integer', description: '1 left (default), 2 middle, 3 right.' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction (default down).' },
        amount: { type: 'integer', description: 'Scroll wheel clicks (default 3).' },
        ms: { type: 'integer', description: 'Wait duration in milliseconds (for action "wait").' },
        return_screenshot: { type: 'boolean', description: 'Capture a fresh screenshot after the action (default true).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'todo_write',
    category: 'read',
    description:
      'Maintain a short task list for the current job so progress stays visible. Pass the FULL list each call — it replaces the previous one. Use it for multi-step work: keep exactly one item in_progress, and mark items done as you finish them.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The complete task list, in order.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Short imperative description.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
            },
            required: ['text'],
          },
        },
      },
      required: ['todos'],
    },
  },
  {
    name: 'code_lineage',
    category: 'read',
    description:
      'Show the git history (lineage) of a file, or of a line range within it: which commits last touched those lines, when, and by whom. Requires the file to be inside a git repository.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (absolute, or relative to the workspace).' },
        start_line: { type: 'integer', description: 'Optional 1-based first line of a range.' },
        end_line: { type: 'integer', description: 'Optional 1-based last line of a range.' },
        max: { type: 'integer', description: 'Max commits to show (default 20).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'remember',
    category: 'read',
    description:
      'Save a durable note to long-term memory — user preferences, project facts, decisions, anything worth carrying into future chats. Memory is injected into the system prompt at the start of every future turn, for every model, so a new model understands the context right away.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'One concise fact or decision to remember.' },
      },
      required: ['note'],
    },
  },
  {
    name: 'codebase_search',
    category: 'read',
    description:
      'Fast keyword and code symbol search across workspace files with relevance ranking. Returns top matches with file paths, lines and code excerpts.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword, function name, class name or symbol to find across the codebase (e.g. "handleLoginUser", "theme switch", "model list").' },
        path: { type: 'string', description: 'Optional subfolder to constrain search.' },
        max_results: { type: 'integer', description: 'Max matches (default 25).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'edit_notebook',
    category: 'edit',
    description:
      'Inspect or modify a Jupyter notebook (.ipynb) cell by cell without breaking its JSON structure.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to .ipynb file.' },
        action: { type: 'string', enum: ['replace', 'insert', 'delete'], description: 'Action to perform on the cell.' },
        cell_index: { type: 'integer', description: '0-based index of the target cell.' },
        cell_type: { type: 'string', enum: ['code', 'markdown'], description: 'Type of the cell.' },
        source: { type: 'string', description: 'New code or markdown content for the cell.' },
      },
      required: ['path', 'action'],
    },
  },
];

const CURSOR_TOOL_ALIASES = {
  Read: 'read_file',
  ReadFile: 'read_file',
  read: 'read_file',
  LS: 'list_dir',
  ls: 'list_dir',
  dir: 'list_dir',
  Grep: 'grep_search',
  grep: 'grep_search',
  rg: 'grep_search',
  ripgrep: 'grep_search',
  Shell: 'run_terminal_cmd',
  terminal: 'run_terminal_cmd',
  bash: 'run_terminal_cmd',
  sh: 'run_terminal_cmd',
  Delete: 'delete_file',
  delete: 'delete_file',
  WebSearch: 'web_search',
  webSearch: 'web_search',
  WebFetch: 'web_fetch',
  webFetch: 'web_fetch',
  TodoWrite: 'todo_write',
  todoWrite: 'todo_write',
  CodeLineage: 'code_lineage',
  codeLineage: 'code_lineage',
  codebase_search: 'codebase_search',
  CodebaseSearch: 'codebase_search',
  edit_notebook: 'edit_notebook',
  EditNotebook: 'edit_notebook',
};

const mcpToolMap = new Map();

function sanitizeName(s) {
  return String(s || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);
}

/** Quote a string for safe use as a single shell argument. */
function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** Normalise a todo_write payload into a bounded, well-formed list. */
function normalizeTodos(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 50)
    .map((t) => {
      const text = String((t && t.text) || '').trim().slice(0, 200);
      if (!text) return null;
      const status =
        t && t.status === 'done' ? 'done' : t && t.status === 'in_progress' ? 'in_progress' : 'pending';
      return { text, status };
    })
    .filter(Boolean);
}

/**
 * Build the tool schema list for one agent turn.
 * - Web tools can be switched off in Settings → Agents.
 * - MCP tools from ~/.nova-ide/mcp.json are appended as mcp__server__tool.
 */
async function toolSchemas(settings = {}) {
  const defs = TOOL_DEFS.filter((t) => {
    if (t.name === 'web_search') return settings.webSearch !== false;
    if (t.name === 'web_fetch') return settings.webFetch !== false;
    return true;
  });
  const schemas = defs.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  mcpToolMap.clear();
  try {
    const mcpTools = await mcp.tools();
    for (const t of mcpTools) {
      const name = `mcp__${sanitizeName(t.server)}__${sanitizeName(t.name)}`;
      mcpToolMap.set(name, { server: t.server, tool: t.name });
      if (t.exposed === false) continue; // bridge mode — discovered via mcp_list_tools
      schemas.push({
        type: 'function',
        function: {
          name,
          description: `[MCP · ${t.server}] ${String(t.description || t.name).slice(0, 900)}`,
          parameters: t.schema,
        },
      });
    }
  } catch {
    /* MCP is optional — failing to load it must never break the agent */
  }
  return schemas;
}

/* ------------------------------ sessions ------------------------------ */

const sessions = new Map();

function newSession(agentId) {
  const s = {
    agentId,
    messages: [],
    abort: new AbortController(),
    pending: new Map(), // callId -> resolve
    running: false,
    todos: [],
  };
  sessions.set(agentId, s);
  return s;
}

function getSession(agentId) {
  return sessions.get(agentId) || newSession(agentId);
}

function resolveApproval(agentId, callId, allow) {
  const s = sessions.get(agentId);
  if (!s) return false;
  const r = s.pending.get(callId);
  if (r) {
    s.pending.delete(callId);
    r(allow);
    return true;
  }
  return false;
}

function stopAgent(agentId) {
  const s = sessions.get(agentId);
  if (!s) return;
  s.abort.abort();
  for (const [, r] of s.pending) r(false);
  s.pending.clear();
}

/* ------------------------------ streaming model call ------------------------------ */

async function callModel({ config, messages, tools, signal, onDelta, threadKey }) {
  if (config.auth === 'gemini-web') {
    // Gemini Web "jugaad": the signed-in web app is the brain. It can't do
    // native function calling, so we ask it (in-prompt) to reply with a JSON
    // tool_calls object and translate that into the agent's tool loop.
    const sys = messages.find((m) => m && m.role === 'system');
    const system = sys && typeof sys.content === 'string' ? sys.content : '';
    const key = `agent:${threadKey || 'default'}`;
    const text = await geminiWeb.prompt({ threadKey: key, system, messages, tools, onDelta, signal });
    const toolCalls = geminiWeb.parseWebToolCalls(text);
    if (toolCalls) return { content: '', toolCalls };

    // The web model often answers in prose first, which would end the turn with
    // no tool ever running (the agent looks like it "did nothing"). Nudge it
    // once for the protocol JSON before accepting a plain answer.
    const hasTools = Array.isArray(tools) && tools.length > 0;
    if (hasTools && !(signal && signal.aborted)) {
      const nudge = [
        ...messages,
        { role: 'assistant', content: text },
        {
          role: 'user',
          content:
            'NOVA PROTOCOL: that reply was prose. Reply with ONLY one JSON object — {"tool_calls":[{"name":"<tool>","arguments":{...}}]} to act, or {"final":true,"content":"<answer>"} if the task is truly finished. No other text.',
        },
      ];
      try {
        const text2 = await geminiWeb.prompt({ threadKey: key, system, messages: nudge, tools, signal });
        const tc2 = geminiWeb.parseWebToolCalls(text2);
        if (tc2) return { content: '', toolCalls: tc2 };
        const fin = (() => {
          const str = String(text2 || '').trim();
          const a = str.indexOf('{');
          const b = str.lastIndexOf('}');
          if (a < 0 || b <= a) return null;
          try {
            const j = JSON.parse(str.slice(a, b + 1));
            return j && j.final && typeof j.content === 'string' ? j.content : null;
          } catch {
            return null;
          }
        })();
        if (fin) return { content: fin, toolCalls: [] };
        return { content: text2 || text, toolCalls: [] };
      } catch {
        return { content: text, toolCalls: [] };
      }
    }
    return { content: text, toolCalls: [] };
  }

  if (config.auth === 'cloudcode') {
    // Gemini via Google's Cloud Code backend (what Antigravity uses), driven by
    // the signed-in Google account. Real function calling, no API key.
    const sys = messages.find((m) => m && m.role === 'system');
    return cloudcode.generate({
      model: config.model,
      system: sys && typeof sys.content === 'string' ? sys.content : '',
      messages,
      tools,
      onDelta,
      signal,
    });
  }

  const base = String(config.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('No base URL configured for this model.');
  const url = base + '/chat/completions';

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (/openrouter\.ai/.test(base)) {
    headers['HTTP-Referer'] = 'https://nova-ide.local';
    headers['X-Title'] = 'Nova IDE';
  }

  async function streamOnce(msgs, sendTools) {
    const body = {
      model: config.model,
      messages: msgs,
      stream: true,
      temperature: config.temperature ?? 0.2,
    };
    if (sendTools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch(url, { method: 'POST', headers, signal, body: JSON.stringify(body) });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      const err = new Error(describeHttpError(url, res.status, res.statusText, text));
      err.status = res.status;
      err.body = text;
      throw err;
    }

    const decoder = new TextDecoder();
    let buf = '';
    let content = '';
    const toolAcc = new Map();

    let done = false;
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          done = true;
          break;
        }
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        const delta = j.choices && j.choices[0] && j.choices[0].delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          if (onDelta) onDelta(delta.content);
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0;
            const cur = toolAcc.get(i) || { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function && tc.function.name) cur.name += tc.function.name;
            if (tc.function && tc.function.arguments) cur.args += tc.function.arguments;
            toolAcc.set(i, cur);
          }
        }
      }
      if (done) break;
    }

    const toolCalls = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, t]) => ({ id: t.id || `call_${i}_${Date.now()}`, name: t.name, argsRaw: t.args }));

    return { content, toolCalls };
  }

  const haveTools = Array.isArray(tools) && tools.length > 0;
  try {
    return await streamOnce(messages, haveTools);
  } catch (e) {
    if (signal && signal.aborted) throw e;

    // Fallback for models/endpoints that reject native tool calling (very
    // common on free tiers): retry WITHOUT the `tools` parameter and hand the
    // model the same tool surface as a prompt protocol — the trick the Gemini
    // Web provider already uses — then parse its JSON reply back into tool
    // calls. Guarded so a working setup never takes this path.
    const status = Number(e && e.status) || 0;
    const bodyText = String((e && e.body) || '');
    const toolsRejected = haveTools && status >= 400 && status < 500 && /tool|function/i.test(bodyText);
    if (!toolsRejected) throw e;

    const proto = geminiWeb.protocolBlock(tools);
    const msgs = messages.slice();
    const sysIdx = msgs.findIndex((m) => m && m.role === 'system' && typeof m.content === 'string');
    if (sysIdx >= 0) msgs[sysIdx] = { ...msgs[sysIdx], content: msgs[sysIdx].content + '\n\n' + proto };
    else msgs.unshift({ role: 'system', content: proto });

    const r = await streamOnce(msgs, false);
    const calls = geminiWeb.parseWebToolCalls(r.content);
    if (calls) return { content: '', toolCalls: calls };
    return { content: r.content, toolCalls: [] };
  }
}

/* ------------------------------ tool execution ------------------------------ */

async function snapshotFor(ctx, p) {
  if (!ctx.agentId || !p) return;
  try {
    await checkpoints.snapshot(ctx.agentId, p);
  } catch {
    /* checkpoints are best-effort */
  }
}

/**
 * `code_lineage` — git history for a file or a line range (Cursor parity).
 * Exported so it can be unit-tested without spinning up the whole agent loop.
 */
async function codeLineage(args, ctx = {}) {
  const p = args && args.path;
  if (!p) return { text: 'Error: path is required.', ok: false };
  const cwd = ctx.workspaceRoot || process.cwd();
  const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
  const rel = isWithin(cwd, abs) ? path.relative(cwd, abs) : abs;
  const max = Math.max(1, Math.min(Number(args.max) || 20, 100));
  const s = Number(args.start_line);
  const e = Number(args.end_line);
  const hasRange = Number.isFinite(s) && s > 0;
  const end = hasRange && Number.isFinite(e) && e >= s ? e : s;

  const cmd = hasRange
    ? `git log --no-color -L ${s},${end}:${shq(rel)}`
    : `git log --no-color -n ${max} --date=short --pretty=format:'%h %ad %an  %s' -- ${shq(rel)}`;

  const r = await runCommand({ command: cmd, cwd, timeoutMs: 30000 });
  const out = (r.stdout || '').trim();
  if (!out) {
    const why = (r.stderr || '').trim().slice(0, 300);
    return {
      text: `No git history for ${rel}${why ? ` (${why})` : ''}. Is the file committed and inside a git repo?`,
      ok: false,
    };
  }
  const label = hasRange ? ` (lines ${s}-${end})` : '';
  return { text: `Lineage of ${rel}${label}:\n${truncate(out, 6000)}`, ok: true };
}

async function executeTool(name, args = {}, ctx = {}) {
  const { workspaceRoot, artifactsDir } = ctx;
  const canonical = CURSOR_TOOL_ALIASES[name] || name;

  // Parameter normalization for Cursor and alternative model conventions
  if (args && typeof args === 'object') {
    if (!args.path && (args.file || args.target || args.filePath)) {
      args.path = args.file || args.target || args.filePath;
    }
    if (!args.command && (args.cmd || args.script)) {
      args.command = args.cmd || args.script;
    }
    if (!args.pattern && (args.query || args.regex)) {
      args.pattern = args.query || args.regex;
    }
    if (!args.old_string && (args.oldText || args.find || args.old)) {
      args.old_string = args.oldText || args.find || args.old;
    }
    if (!args.new_string && (args.newText || args.replace || args.new)) {
      args.new_string = args.newText || args.replace || args.new;
    }
  }

  switch (canonical) {
    case 'list_dir': {
      const entries = await fsTools.listDir(args.path);
      const listing = entries
        .map((e) => (e.isDir ? e.name + '/' : e.name))
        .join('\n');
      return { text: `Contents of ${args.path}:\n${listing || '(empty)'}` };
    }
    case 'read_file': {
      const r = await fsTools.readFileTool(args.path, {
        offset: args.offset,
        limit: args.limit,
      });
      if (r.error) return { text: `Error: ${r.error}` };
      return {
        text: `File ${r.path} (lines ${r.from}-${r.to} of ${r.totalLines}${r.truncated ? ', truncated' : ''}):\n${r.content}`,
      };
    }
    case 'write_file': {
      await snapshotFor(ctx, args.path);
      const r = await fsTools.writeFileTool(args.path, args.content ?? '');
      ctx.notifyFsChanged(args.path);
      return { text: `Wrote ${r.bytes} bytes to ${r.path}`, ok: true };
    }
    case 'edit_file': {
      await snapshotFor(ctx, args.path);
      const r = await fsTools.editFileTool(args.path, args.old_string, args.new_string, {
        replaceAll: !!args.replace_all,
      });
      if (r.error) return { text: `Error: ${r.error}` };
      ctx.notifyFsChanged(args.path);
      return { text: `Applied edit to ${r.path} (${r.occurrences} replacement${r.occurrences > 1 ? 's' : ''})`, ok: true };
    }
    case 'delete_file': {
      await snapshotFor(ctx, args.path);
      const r = await fsTools.deleteFileTool(args.path);
      ctx.notifyFsChanged(args.path);
      return { text: `Deleted ${r.path}`, ok: true };
    }
    case 'grep_search': {
      const r = await fsTools.searchFiles({
        pattern: args.pattern,
        dir: args.path || workspaceRoot,
        caseSensitive: !!args.case_sensitive,
        maxResults: Math.min(args.max_results || 100, 300),
      });
      if (r.error) return { text: `Error: ${r.error}` };
      if (!r.results.length) return { text: `No matches for /${r.pattern}/ under ${r.dir}` };
      const body = r.results
        .map((m) => `${m.path}:${m.line}: ${m.text}`)
        .join('\n');
      return { text: `${r.count} matches${r.truncated ? ' (truncated)' : ''}:\n${body}` };
    }
    case 'run_terminal_cmd': {
      const r = await runCommand({
        command: args.command,
        cwd: args.cwd || workspaceRoot,
        timeoutMs: Math.min(args.timeout_ms || 120000, 600000),
      });
      const parts = [];
      if (r.stdout) parts.push(r.stdout);
      if (r.stderr) parts.push('[stderr]\n' + r.stderr);
      parts.push(`(exit code ${r.code}${r.timedOut ? ', TIMED OUT' : ''})`);
      return { text: parts.join('\n') };
    }
    case 'browser': {
      const r = await browser.act(args.action, args, {
        headless: ctx.browserHeadless !== false,
        artifactsDir,
      });
      if (r.file) {
        const dataUrl = await fileToDataUrl(r.file);
        return { text: `Screenshot saved: ${r.file}`, image: dataUrl, imagePath: r.file };
      }
      return { text: JSON.stringify(r).slice(0, 4000) };
    }
    case 'computer_use': {
      if (args.action === 'screenshot') {
        const r = await computer.screenshotToFile(artifactsDir);
        const dataUrl = await fileToDataUrl(r.file);
        return { text: `Desktop screenshot saved: ${r.file} (method: ${r.method})`, image: dataUrl, imagePath: r.file };
      }

      const ms = Math.max(0, Math.min(Number(args.ms) || 1000, 30000));
      if (args.action === 'wait') {
        await new Promise((res) => setTimeout(res, ms));
      } else {
        await computer.inputAction(args.action, args);
      }

      const size = await computer.screenSize().catch(() => null);
      const head = `computer_use ${args.action} done${
        args.action === 'wait' ? ` (waited ${ms}ms)` : ''
      }${size ? ` — screen ${size.width}x${size.height}` : ''}`;

      // Observe loop: hand the model a fresh screenshot so it can verify the
      // effect of its action before deciding the next one (opt out with
      // return_screenshot:false).
      if (args.return_screenshot !== false) {
        try {
          const r = await computer.screenshotToFile(artifactsDir);
          const dataUrl = await fileToDataUrl(r.file);
          return { text: `${head}\nFresh screenshot attached (${r.method}).`, image: dataUrl, imagePath: r.file };
        } catch (e) {
          return { text: `${head}\n(screenshot after action failed: ${e.message})` };
        }
      }
      return { text: head };
    }
    case 'web_search': {
      const r = await web.webSearch(args.query, args.count);
      return { text: r.text, ok: r.ok };
    }
    case 'web_fetch': {
      const r = await web.webFetch(args.url);
      return { text: r.text, ok: r.ok };
    }
    case 'mcp_list_tools': {
      const all = await mcp.tools();
      if (!all.length) return { text: 'No MCP servers are running. Add servers in ~/.nova-ide/mcp.json.' };
      const serverFilter = args.server ? String(args.server) : null;
      const q = args.query ? String(args.query).toLowerCase() : null;
      const byServer = new Map();
      for (const t of all) {
        if (serverFilter && t.server !== serverFilter) continue;
        if (q && !(t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))) continue;
        if (!byServer.has(t.server)) byServer.set(t.server, []);
        byServer.get(t.server).push(t);
      }
      if (!byServer.size) return { text: 'No MCP tools matched.' };
      const chunks = [];
      for (const [server, list] of byServer) {
        chunks.push(
          `${server} (${list.length} tools):\n` +
            list
              .slice(0, 130)
              .map((t) => `- mcp__${sanitizeName(server)}__${sanitizeName(t.name)} — ${(t.description || '').replace(/\s+/g, ' ').slice(0, 140)}`)
              .join('\n') +
            (list.length > 130 ? `\n…and ${list.length - 130} more.` : '')
        );
      }
      return { text: chunks.join('\n\n') };
    }
    case 'remember': {
      const r = await memory.add(args.note, 'agent');
      if (r.error) return { text: `Could not save note: ${r.error}`, ok: false };
      return { text: `Saved to memory: ${r.note.text}` };
    }
    case 'todo_write': {
      const todos = normalizeTodos(args.todos);
      if (ctx.session) ctx.session.todos = todos;
      const open = todos.filter((t) => t.status !== 'done').length;
      const body = todos
        .map((t) => `${t.status === 'done' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]'} ${t.text}`)
        .join('\n');
      return {
        text: `Task list updated (${todos.length} item${todos.length === 1 ? '' : 's'}, ${open} open):\n${body || '(empty)'}`,
        ok: true,
        todos,
      };
    }
    case 'code_lineage': {
      return await codeLineage(args, { workspaceRoot });
    }
    case 'codebase_search': {
      const r = await fsTools.codebaseSearch({
        query: args.query || args.pattern || '',
        dir: args.path || workspaceRoot,
        maxResults: Math.min(args.max_results || 25, 100),
      });
      if (r.error) return { text: `Error: ${r.error}` };
      if (!r.results || !r.results.length) return { text: `No codebase matches for "${r.query}" under ${r.dir}` };
      const body = r.results
        .map((m) => `${m.relPath}:${m.line}: ${m.snippet}`)
        .join('\n');
      return { text: `Codebase search found ${r.count} matches for "${r.query}":\n${body}` };
    }
    case 'edit_notebook': {
      await snapshotFor(ctx, args.path);
      const r = await fsTools.editNotebook({
        path: args.path,
        action: args.action,
        cellIndex: args.cell_index,
        cellType: args.cell_type,
        source: args.source,
      });
      if (r.error) return { text: `Error: ${r.error}` };
      ctx.notifyFsChanged(args.path);
      return { text: `Notebook updated (${r.path}): ${r.action} executed, total cells: ${r.totalCells}`, ok: true };
    }
    default: {
      if (canonical.startsWith('mcp__')) {
        let target = mcpToolMap.get(canonical);
        if (!target) {
          const parts = canonical.slice(5).split('__');
          if (parts.length >= 2) target = { server: parts[0], tool: parts.slice(1).join('__') };
        }
        if (!target) return { text: `Unknown MCP tool: ${canonical}` };
        const r = await mcp.call(target.server, target.tool, args);
        return { text: r.text, ok: r.ok };
      }
      return { text: `Unknown tool: ${name}` };
    }
  }
}

async function fileToDataUrl(file) {
  const buf = await fsp.readFile(file);
  return 'data:image/png;base64,' + buf.toString('base64');
}

/* ------------------------------ agent loop ------------------------------ */

async function loadRules(workspaceRoot) {
  const parts = [];
  const candidates = [];
  if (workspaceRoot) {
    candidates.push(path.join(workspaceRoot, 'NOVA.md'));
    candidates.push(path.join(workspaceRoot, '.cursorrules'));
    candidates.push(path.join(workspaceRoot, 'AGENTS.md'));
    candidates.push(path.join(workspaceRoot, 'GEMINI.md'));
    try {
      const dir = path.join(workspaceRoot, '.nova', 'rules');
      for (const f of await fsp.readdir(dir)) {
        if (/\.(md|mdc|txt)$/i.test(f)) candidates.push(path.join(dir, f));
      }
    } catch {}
    try {
      const dir = path.join(workspaceRoot, '.cursor', 'rules');
      for (const f of await fsp.readdir(dir)) {
        if (/\.(md|mdc|txt)$/i.test(f)) candidates.push(path.join(dir, f));
      }
    } catch {}
  }
  for (const c of candidates) {
    try {
      const txt = await fsp.readFile(c, 'utf8');
      if (txt.trim()) parts.push(`--- ${path.basename(c)} ---\n${txt.slice(0, 4000)}`);
    } catch {}
  }
  return parts;
}

async function loadSkills() {
  const dir = path.join(os.homedir(), '.nova-ide', 'skills');
  const out = [];
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      const file = path.join(dir, n, 'SKILL.md');
      const txt = await fsp.readFile(file, 'utf8');
      const nameM = /^name:\s*(.+)$/m.exec(txt);
      const descM = /^description:\s*(.+)$/m.exec(txt);
      out.push({
        name: nameM ? nameM[1].trim() : n,
        description: descM ? descM[1].trim() : '',
        path: file,
      });
    } catch {}
  }
  return out;
}

async function buildSystemPrompt({ workspaceRoot, settings }) {
  const lines = [
    'You are Nova Agent, an autonomous coding assistant inside the Nova IDE.',
    `Workspace root: ${workspaceRoot || '(no folder opened — ask the user to open one)'}`,
    `OS: ${os.type()} ${os.release()} (${os.arch()}), user: ${os.userInfo().username}`,
    '',
    'Rules:',
    '- Use tools to inspect reality. Never claim you did something without tool output.',
    '- Read files before editing them. Prefer edit_file over write_file for small changes.',
    '- Use list_dir and grep_search to find relevant files instead of guessing paths.',
    '- For a task with several steps, call todo_write to keep a visible task list, updating it as you go.',
    '- Use code_lineage to see who last changed a file or a line range (git history).',
    '- Use remember to save durable context (user preferences, project facts, decisions) — it is read at the start of every future turn.',
    '- For commands, use run_terminal_cmd. Prefer non-interactive commands (-y flags, no pagers).',
    '- The browser tool drives a real Chromium page. Use open before click/fill/text/screenshot.',
    '- computer_use drives the real desktop (screenshot, move, click, double_click, right_click, drag, scroll, type, key, wait); a fresh screenshot comes back after each action, so screenshot → act → look at the result.',
    '- web_search and web_fetch are available for looking things up on the internet.',
    '- After finishing the task, reply with a short summary of what changed and any caveats.',
    '- If the task needs more information, ask a concise question instead of guessing.',
  ];

  // Memory FIRST, so any model starts with the user's context instead of cold.
  const mem = await memory.memoryText();
  if (mem) {
    lines.splice(4, 0, 'Long-term memory — notes saved earlier (read these first for context):', mem, '');
  }

  const rules = await loadRules(workspaceRoot);
  if (rules.length) {
    lines.push('', 'Project rules from the workspace (follow these):', ...rules);
  }

  const skills = await loadSkills();
  if (skills.length) {
    lines.push(
      '',
      'User skills (instruction packs). If a task matches one, read its SKILL.md first and follow it:'
    );
    for (const sk of skills) {
      lines.push(`- ${sk.name}${sk.description ? `: ${sk.description}` : ''} (${sk.path})`);
    }
  }

  try {
    const mt = await mcp.tools();
    if (mt.length) {
      const byServer = new Map();
      for (const t of mt) {
        if (!byServer.has(t.server)) byServer.set(t.server, { total: 0, exposed: 0 });
        const g = byServer.get(t.server);
        g.total++;
        if (t.exposed !== false) g.exposed++;
      }
      const parts = [];
      for (const [name, g] of byServer) {
        if (g.exposed > 0) parts.push(`${name} (${g.exposed} tools loaded directly)`);
        else
          parts.push(
            `${name} (${g.total} tools, bridge mode — call mcp_list_tools with server:"${name}" to discover them, then call mcp__${name}__<tool>)`
          );
      }
      lines.push('', `MCP servers: ${parts.join('; ')}.`);
    }
  } catch {}

  if (settings && settings.extraInstructions) {
    lines.push('', 'User instructions:', String(settings.extraInstructions));
  }
  return lines.join('\n');
}

function truncate(text, max = 20000) {
  if (typeof text !== 'string') text = String(text);
  return text.length > max ? text.slice(0, max) + `\n[...truncated ${text.length - max} chars]` : text;
}

/**
 * Keep long agent sessions affordable.
 *
 * Every tool result is replayed to the model on every subsequent step, so a
 * 20-step run re-sends ~20 large tool outputs on the final call. Rather than
 * dropping messages (which would orphan an assistant `tool_calls` from its
 * `tool` reply and make the provider reject the request), we keep the system
 * prompt and the most recent turns verbatim and collapse the *content* of older
 * tool outputs to a short placeholder. Pairing stays valid; the token cost of
 * the transcript stops growing linearly with the step count.
 */
/** Rough character count of what we are about to send (~3.5 chars per token). */
function estimateChars(messages) {
  let n = 0;
  for (const m of messages || []) {
    if (!m) continue;
    n += String(m.content || '').length;
    if (Array.isArray(m.tool_calls)) {
      for (const c of m.tool_calls) n += String((c && c.function && c.function.arguments) || '').length + 40;
    }
  }
  return n;
}

/**
 * Providers reject oversized requests with numbers we can act on, e.g. Groq:
 *   "Limit 7000, Requested 19502"
 * Returns a character budget that should fit, or 0 when the message tells us
 * nothing useful.
 */
function fitFromSizeError(message) {
  const t = String(message || '');
  const lim = /limit[:\s]+([\d,]{3,})/i.exec(t);
  const req = /requested[:\s]+([\d,]{3,})/i.exec(t);
  if (!lim) return 0;
  const limit = Number(lim[1].replace(/,/g, ''));
  const requested = req ? Number(req[1].replace(/,/g, '')) : 0;
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  if (requested && requested <= limit) return 0; // not actually a size problem
  // ~3.5 chars per token, with a margin so the retry does not bounce again
  return Math.max(4000, Math.floor(limit * 3.2));
}

function compactMessages(
  messages,
  { keepRecent = 16, maxChars = 0, placeholder = '[older tool output omitted to save context]' } = {}
) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  let out = messages;
  if (messages.length > keepRecent + 1) {
    const cutoff = messages.length - keepRecent;
    out = messages.map((m, i) => {
      if (!m || i === 0 || i >= cutoff) return m; // system prompt + recent window untouched
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 200) {
        return { ...m, content: placeholder };
      }
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 2000) {
        return { ...m, content: m.content.slice(0, 2000) + '\n[...truncated]' };
      }
      return m;
    });
  }
  // Hard budget: keep the system prompt and the newest turns, drop the middle.
  if (maxChars > 0 && estimateChars(out) > maxChars) {
    const head = out[0];
    const tail = out.slice(1);
    let lo = 0;
    while (lo < tail.length - 1 && estimateChars([head, ...tail.slice(lo)]) > maxChars) lo += 1;
    const kept = tail.slice(lo);
    // never start on a tool result without its assistant tool_call before it
    const boundary = kept.findIndex((m) => m && m.role !== 'tool');
    out = [head, ...(boundary > 0 ? kept.slice(boundary) : kept)];
  }
  return out;
}

function detectMode(userText, settings = {}, contextNote = '', sessionOrHistory = null) {
  const mode = settings.composerMode || 'auto';
  if (mode === 'chat') return 'chat';
  if (mode === 'agent') return 'agent';

  const text = String(userText || '').trim().toLowerCase();
  if (!text) return 'chat';

  if (contextNote && (contextNote.includes('Contents of @-mentioned files') || contextNote.includes('User tagged @'))) {
    return 'agent';
  }

  // Direct action follow-ups: user explicitly telling the agent to do it, continue, execute, or retry
  const directActionFollowup = /^(ok\s+do\s+it|do\s+it|go\s+ahead|continue|proceed|next(\s+step)?|apply(\s+it)?|run\s+it|same\s+karo|karo|haan\s+karo|kar\s+do|aage\s+badho|shuru\s+karo|start|try\s+again|retry|fir\s+se\s+karo|theek\s+karo|fix\s+it)[.!?\s]*$/i;
  if (directActionFollowup.test(text)) {
    return 'agent';
  }

  // Pure conversational greetings / identity queries
  const greetingPattern = /^(hi|hello|hey|hiya|howdy|yo|namaste|sup|greetings|good\s+(morning|afternoon|evening|night)|who are you|what are you|what can you do|kya kar sakte ho|kaise ho|kya haal hai|help|shukriya|thanks|thank you|suno)(\s+(there|friend|nova|agent|bot|ji|bro|mate|everyone|all))?[.!?\s]*$/i;
  if (greetingPattern.test(text)) {
    return 'chat';
  }

  // Short confirmations (e.g. "ok", "yes", "sure", "yeah", "yep", "theek hai")
  // In an active multi-turn session where the agent presented a plan or ran tools, route to agent
  const briefConfirmPattern = /^(ok|okay|yes|yeah|yep|sure|theek hai|sahi hai|bilkul|agreed)[.!?\s]*$/i;
  if (briefConfirmPattern.test(text)) {
    const msgs = Array.isArray(sessionOrHistory)
      ? sessionOrHistory
      : (sessionOrHistory && Array.isArray(sessionOrHistory.messages))
        ? sessionOrHistory.messages
        : null;
    if (msgs && msgs.length > 1) {
      return 'agent';
    }
    return 'chat';
  }

  const explanationPattern = /^(what is|what are|explain|difference between|how does|why does|tell me about|summarize|give me ideas|suggest|batao|samjhao)\b/i;
  const actionPattern = /\b(create|make|edit|update|change|replace|delete|remove|fix|debug|refactor|install|run|execute|build|compile|test|git|commit|push|pull|clone|search|find|grep|list|scan|open|inspect|benchmark|audit|write|read|add|rename|move|copy|show|generate|implement|setup|configure|format|lint|banao|likho|padho|chalao|chalhao|badlo|hatao|dhundo|jodo|daalo|dikhao)\b/i;
  const toolPattern = /(\.[a-zA-Z0-9_-]+\b|npm\s|git\s|pip\s|cargo\s|yarn\s|pnpm\s|\bcd\b|\bls\b|\bcat\b|\bmkdir\b|\btouch\b|\brm\b)/i;

  const strippedGreeting = text.replace(/^(?:(?:hi|hello|hey|hiya|howdy|yo|namaste|sup|greetings|suno)(?:\s+(?:there|friend|nova|agent|bot|ji|bro|mate|everyone|all))?[,\s!.]+)+\s*/i, '');

  if ((explanationPattern.test(text) || (strippedGreeting && explanationPattern.test(strippedGreeting))) && !toolPattern.test(text) && !actionPattern.test(text)) {
    return 'chat';
  }

  if (toolPattern.test(text) || actionPattern.test(text)) {
    return 'agent';
  }

  // Bias toward agent: in an AI coding assistant, ambiguous instructions should retain
  // autonomous capabilities (agent mode answers questions naturally without calling tools,
  // whereas chat mode strips tools and silently breaks real work).
  return 'agent';
}

/**
 * Run the agent loop for one user turn.
 * send(event) pushes {type, ...} events to the renderer.
 */
async function runAgent({ agentId, config, workspaceRoot, userText, settings = {}, contextNote, history, send, notifyFsChanged }) {
  const session = getSession(agentId);
  stopAgent(agentId);
  session.abort = new AbortController();
  const signal = session.abort.signal;

  const artifactsDir = path.join(os.homedir(), '.nova-ide', 'artifacts');
  const maxSteps = Math.min(Math.max(settings.maxSteps || 25, 1), 100);

  if (!session.messages.length) {
    session.messages.push({ role: 'system', content: await buildSystemPrompt({ workspaceRoot, settings }) });
    // Seed a fresh session with the visible transcript when the UI is
    // continuing a chat whose live session no longer exists (app restarted
    // or an old chat was loaded from history). Ignored for live sessions.
    if (Array.isArray(history)) {
      for (const h of history.slice(-30)) {
        if (!h || typeof h.content !== 'string' || !h.content) continue;
        if (h.role !== 'user' && h.role !== 'assistant') continue;
        session.messages.push({ role: h.role, content: h.content.slice(0, 4000) });
      }
    }
  }

  let userContent = userText;
  if (contextNote) userContent += `\n\n[Context] ${contextNote}`;
  session.messages.push({ role: 'user', content: userContent });

  const emit = (e) => send({ agentId, ...e });
  session.running = true;

  const withinWorkspace = (p) => {
    if (!workspaceRoot || !p || typeof p !== 'string') return false;
    return isWithin(workspaceRoot, p);
  };

  // Every loop iteration is one provider request. Counting them makes it
  // obvious why a single message can eat a free-tier quota. Declared outside the
  // try so the catch can report it.
  let modelRequests = 0;

  try {
    const activeMode = detectMode(userText, settings, contextNote, session);
    emit({ type: 'mode', mode: activeMode });

    // Cursor Parity: Direct Chat Mode (fast conversation without tool schemas/loops)
    if (activeMode === 'chat') {
      emit({ type: 'turn_start' });
      emit({ type: 'step', step: 1, maxSteps: 1 });

      const chatSystem = [
        'You are Nova AI, an intelligent coding assistant inside Nova IDE.',
        workspaceRoot ? `Workspace folder: ${workspaceRoot}` : '',
        'You are in direct Chat mode (no tools). Answer questions, write code snippets with markdown formatting, and explain concepts directly and concisely.',
        'If the user wants you to edit files, inspect project files, or run terminal commands, answer their question and let them know they can switch to Agent mode or ask you to perform the action.',
      ].filter(Boolean).join('\n');

      const chatMessages = [
        { role: 'system', content: chatSystem },
        ...session.messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).slice(-12),
      ];

      modelRequests += 1;
      const res = await callModel({
        config,
        messages: chatMessages,
        tools: [],
        signal,
        threadKey: agentId,
        onDelta: (text) => emit({ type: 'assistant_delta', text }),
      });

      if (res.content) {
        emit({ type: 'assistant_message', text: res.content });
        session.messages.push({ role: 'assistant', content: res.content });
      }
      emit({ type: 'done' });
      return;
    }

    emit({ type: 'turn_start' });

    const schemas = await toolSchemas(settings);

    for (let step = 0; step < maxSteps; step++) {
      if (signal.aborted) break;
      emit({ type: 'step', step: step + 1, maxSteps });

      const attempt = async (maxChars) => {
        modelRequests += 1;
        return callModel({
          config,
          messages: compactMessages(session.messages, { maxChars }),
          tools: schemas,
          signal,
          threadKey: agentId,
          onDelta: (text) => emit({ type: 'assistant_delta', text }),
        });
      };

      let result;
      try {
        result = await attempt(settings.contextChars || 0);
      } catch (e) {
        // Provider says the request is too big and tells us the limit: shrink the
        // context to fit and try once more instead of just failing.
        const fit = fitFromSizeError(e && e.message);
        if (!fit) throw e;
        emit({ type: 'status', text: 'Request bada tha — context chhota karke dobara bhej raha hoon…' });
        result = await attempt(fit);
      }
      const { content, toolCalls } = result;

      if (content) emit({ type: 'assistant_message', text: content });

      if (!toolCalls.length) {
        session.messages.push({ role: 'assistant', content: content || '' });
        break;
      }

      session.messages.push({
        role: 'assistant',
        content: content || '',
        tool_calls: toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.argsRaw || '{}' },
        })),
      });

      for (const call of toolCalls) {
        if (signal.aborted) break;

        let args = {};
        try {
          args = JSON.parse(call.argsRaw || '{}');
        } catch {
          const result = `Error: could not parse tool arguments: ${String(call.argsRaw).slice(0, 300)}`;
          emit({ type: 'tool_end', callId: call.id, name: call.name, ok: false, output: result });
          session.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
          continue;
        }

        const canonicalName = CURSOR_TOOL_ALIASES[call.name] || call.name;
        const def = TOOL_DEFS.find((t) => t.name === canonicalName);
        const category = def ? def.category : (call.name.startsWith('mcp__') || canonicalName.startsWith('mcp__')) ? 'mcp' : 'unknown';
        const autoFlags = {
          read: true,
          edit: settings.autoApproveEdit !== false,
          terminal: !!settings.autoApproveTerminal,
          browser: settings.autoApproveBrowser !== false,
          computer: !!settings.autoApproveComputer,
          web: !!settings.autoAcceptWebSearch,
          mcp: !!settings.autoApproveMcp,
        };

        // Cursor-style protections (Settings → Agents → Execution and Approvals)
        let requiresApproval = !autoFlags[category];
        let approveReason = null;
        const targetPath = typeof args.path === 'string' ? args.path : (typeof args.file === 'string' ? args.file : null);
        if (!requiresApproval) {
          if (category === 'read' && targetPath && settings.readAccess === 'workspace' && !withinWorkspace(targetPath)) {
            requiresApproval = true;
            approveReason = 'Read Access is set to Workspace only';
          }
          if (category === 'edit' && targetPath && settings.externalFileProtection !== false && !withinWorkspace(targetPath)) {
            requiresApproval = true;
            approveReason = 'External-File Protection is on (path outside the workspace)';
          }
          if ((call.name === 'delete_file' || canonicalName === 'delete_file') && settings.fileDeletionProtection) {
            requiresApproval = true;
            approveReason = 'File-Deletion Protection is on';
          }
        }

        emit({
          type: 'tool_start',
          callId: call.id,
          name: call.name,
          args,
          category,
          requiresApproval,
          reason: approveReason,
        });

        let allowed = !requiresApproval;
        if (!allowed) {
          allowed = await new Promise((resolve) => {
            session.pending.set(call.id, resolve);
            emit({ type: 'approval_request', callId: call.id, name: call.name, args, category, reason: approveReason });
          });
          emit({ type: 'approval_resolved', callId: call.id, allowed });
        }

        if (!allowed || signal.aborted) {
          const result = 'User denied this tool call. Do not retry it; ask how to proceed or continue differently.';
          emit({ type: 'tool_end', callId: call.id, name: call.name, ok: false, denied: true, output: result });
          session.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
          continue;
        }

        try {
          const r = await executeTool(call.name, args, {
            agentId,
            workspaceRoot,
            artifactsDir,
            browserHeadless: settings.browserHeadless,
            notifyFsChanged,
            session,
          });
          emit({
            type: 'tool_end',
            callId: call.id,
            name: call.name,
            ok: r.ok !== false,
            output: truncate(r.text, 6000),
            image: r.image || null,
          });
          if (r.todos) emit({ type: 'todos', todos: r.todos });
          session.messages.push({ role: 'tool', tool_call_id: call.id, content: truncate(r.text) });
        } catch (e) {
          const result = `Error: ${e.message}`;
          emit({ type: 'tool_end', callId: call.id, name: call.name, ok: false, output: result });
          session.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
      }
    }

    emit({ type: 'done' });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      emit({ type: 'done', aborted: true });
    } else {
      const used = typeof modelRequests === 'number' && modelRequests ? `\n\n(Is turn me ${modelRequests} model request gaye.)` : '';
      emit({ type: 'error', message: String((e && e.message) || e) + used });
    }
  } finally {
    session.running = false;
  }
}

function resetAgent(agentId) {
  sessions.delete(agentId);
}

module.exports = {
  runAgent,
  stopAgent,
  resolveApproval,
  resetAgent,
  toolSchemas,
  TOOL_DEFS,
  loadRules,
  compactMessages,
  estimateChars,
  fitFromSizeError,
  normalizeTodos,
  codeLineage,
  detectMode,
};
