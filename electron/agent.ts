const fsp = require('node:fs/promises');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const fsTools = require('./tools/fsTools');
const { runCommand } = require('./tools/terminal');
const browser = require('./tools/browser');
const computer = require('./tools/computer');
const web = require('./tools/web');
const checkpoints = require('./tools/checkpoints');
const { describeHttpError } = require('./tools/errors');
const { isWithin, configRoot } = require('./tools/paths');
const memory = require('./tools/memory');
const security = require('./tools/security');
const findingsStore = require('./tools/findings');
const challenge = require('./tools/challenge');
const kaggle = require('./tools/kaggle');
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
      'Control the Ubuntu/Linux desktop. Actions: screenshot, move, click, double_click, right_click, drag, scroll, type, key, wait, active_window, list_windows, focus_window, launch_app, open_url, notify, clipboard_get, clipboard_set. After an input action a fresh screenshot is returned automatically.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'screenshot', 'move', 'click', 'double_click', 'right_click', 'drag', 'scroll', 'type', 'key', 'wait',
            'active_window', 'list_windows', 'focus_window', 'launch_app', 'open_url', 'notify', 'clipboard_get', 'clipboard_set',
          ],
        },
        x: { type: 'integer', description: 'Screen x in pixels.' },
        y: { type: 'integer', description: 'Screen y in pixels.' },
        to_x: { type: 'integer', description: 'Drag end x.' },
        to_y: { type: 'integer', description: 'Drag end y.' },
        text: { type: 'string', description: 'Text to type, window title, app name, notification body, or clipboard text.' },
        url: { type: 'string', description: 'URL or file path for open_url.' },
        key: { type: 'string', description: 'e.g. Return, Tab, ctrl+a, ctrl+c, alt+F4, super' },
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
    name: 'ubuntu_system',
    category: 'read',
    description:
      'Fast, native Ubuntu/Linux system assistant tool. Actions: overview (distro, kernel, CPU, RAM, disk, GPU, Wayland/X11 desktop), processes (top CPU/RAM or search by target), ports (listening TCP/UDP ports & PIDs), service_status (systemd service state), service_logs (journalctl logs for target service), package_status (apt/snap package version & install check), network (IPs, interfaces, routes, DNS), notify (send Ubuntu desktop notification), open (open URL/file/app via xdg-open/gtk-launch).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['overview', 'processes', 'ports', 'service_status', 'service_logs', 'package_status', 'network', 'notify', 'open'],
        },
        target: { type: 'string', description: 'Service name, package name, process filter, port number, URL/app, or notification text.' },
        user_scope: { type: 'boolean', description: 'Use --user for systemd service queries.' },
        lines: { type: 'integer', description: 'Max lines to return (default 25).' },
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
    name: 'security_scan',
    category: 'read',
    description:
      'Security audit, step 1 of 3. Runs deterministic scanners over the workspace (hardcoded secrets, injection sinks, unsafe deserialisation, TLS verification disabled, weak crypto, permissive CORS, container running as root, and vulnerable dependencies) and records every candidate as a finding with a stable id. ' +
      'These are CANDIDATES, not confirmed vulnerabilities: a regex knows what an AWS key looks like, it does not know whether an input is attacker-controlled. ' +
      'Your job after this is to triage each one: read the surrounding code, trace whether untrusted input reaches the sink, check whether the sink is reachable, and decide real vs false positive. Use security_triage to record the verdict and security_report to produce the output.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to audit (defaults to the workspace root).' },
        include_deps: { type: 'boolean', description: 'Also run the dependency audit (npm audit). Default true.' },
        max_findings: { type: 'integer', description: 'Cap on candidates (default 500).' },
      },
    },
  },
  {
    name: 'security_triage',
    category: 'read',
    description:
      'Security audit, step 2 of 3. Record your verdict for one finding from security_scan. ' +
      'Only mark a finding "confirmed" when you can explain how untrusted input reaches it (name the entry point and the path); otherwise use "false-positive" and say why, or "triaged" when it is real but not reachable from outside. ' +
      'Set severity when the rule severity is wrong for this context. Never mark something confirmed on a guess — an unverified report destroys trust in the whole audit.',
    parameters: {
      type: 'object',
      properties: {
        finding_id: { type: 'string', description: 'The id returned by security_scan.' },
        status: { type: 'string', enum: ['triaged', 'confirmed', 'false-positive', 'fixed', 'wont-fix'], description: 'Your verdict.' },
        analysis: { type: 'string', description: 'Why: the data flow, the entry point, reachability, and the concrete fix. Be specific about file and line.' },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Override the rule severity if it does not fit this context.' },
      },
      required: ['finding_id', 'status'],
    },
  },
  {
    name: 'security_report',
    category: 'read',
    description:
      'Security audit, step 3 of 3. Produce the audit output from the stored findings: "markdown" for a human-readable report, "sarif" for CI / GitHub code scanning, "json" for raw data. ' +
      'Dismissed findings are excluded from the report body.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace the audit ran against (defaults to the workspace root).' },
        format: { type: 'string', enum: ['markdown', 'sarif', 'json'], description: 'Output format (default markdown).' },
      },
    },
  },
  {
    name: 'challenge_find',
    category: 'read',
    description:
      'List contests worth taking on, soonest first. `source` picks the platform: topcoder (default; deliverable tracks only, not Design) or kaggle (ML competitions — a code+score deliverable, a much better fit). `search` filters Kaggle by text. Feed the id/ref to challenge_spec.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['topcoder', 'kaggle'], description: 'Which platform (default topcoder).' },
        search: { type: 'string', description: 'Kaggle only: filter by search text.' },
        tracks: { type: 'array', items: { type: 'string' }, description: 'TopCoder only: narrow to these tracks.' },
        all: { type: 'boolean', description: 'TopCoder only: include undeliverable tracks.' },
        limit: { type: 'integer', description: 'Max results (default 10).' },
      },
    },
  },
  {
    name: 'challenge_spec',
    category: 'read',
    description:
      'Challenge workflow 1/3. Ingest a contest brief into a tracked checklist for this workspace. Pass `url` (TopCoder URL or id) or `text`. Items are grouped by section; boilerplate dropped; the track adds its submission requirements. Re-ingesting KEEPS the status of items already done.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'TopCoder challenge URL or id.' },
        text: { type: 'string', description: 'Pasted brief, if there is no URL.' },
        name: { type: 'string', description: 'Name, when there is no URL to fetch.' },
      },
    },
  },
  {
    name: 'kaggle_data',
    category: 'read',
    description:
      'Kaggle: list a competition\'s data files and download them into ./data. Pass `ref` (the competition slug) and optionally `file` for one file; with no `file` it lists what is available. Needs KAGGLE_API_TOKEN (or KAGGLE_USERNAME + KAGGLE_KEY) and the competition rules accepted, or Kaggle answers 401.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Competition slug, e.g. titanic.' },
        file: { type: 'string', description: 'Download this one file instead of listing.' },
        all: { type: 'boolean', description: 'Download every file, not just the common three.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'kaggle_submit',
    category: 'read',
    description:
      'Kaggle: submit a prediction file and read the score back. Runs the real three-step flow (upload url -> upload -> submit). Pass `ref`, `file` (default submission.csv) and `description`. `check: true` only lists past submissions and scores instead of submitting. Submitting writes to a live competition, so confirm before using it.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Competition slug.' },
        file: { type: 'string', description: 'Submission file (default submission.csv).' },
        description: { type: 'string', description: 'Submission description.' },
        check: { type: 'boolean', description: 'Only list past submissions and scores.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'challenge_check',
    category: 'read',
    description:
      'Challenge workflow 2/3. Set one checklist item status (pending|generating|done|verified|skipped) and/or a note, as each deliverable is finished.',
    parameters: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'The checklist item id from challenge_spec.' },
        status: { type: 'string', enum: ['pending', 'generating', 'done', 'verified', 'skipped'], description: 'New status.' },
        note: { type: 'string', description: 'Short note: what was produced, where it lives.' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'challenge_pack',
    category: 'read',
    description:
      'Challenge workflow 3/3. Bundle deliverables into a submission zip. REFUSES while items are open unless `force`, listing what is missing.',
    parameters: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Files to include, relative to the workspace.' },
        out_path: { type: 'string', description: 'Zip path (default <workspace>/submission.zip).' },
        force: { type: 'boolean', description: 'Pack even if items are open.' },
      },
      required: ['files'],
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
  ubuntu: 'ubuntu_system',
  UbuntuSystem: 'ubuntu_system',
  ubuntu_system: 'ubuntu_system',
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
async function toolSchemas(settings: any = {}, ctx: any = {}) {
  // Lazy-load the follow-up tools. They are only useful once the state that needs
  // them exists, and the tool schemas are ~83% of every request — so the base list
  // stays small and the extra tools appear exactly when they can be used.
  //   challenge_check / challenge_pack  -> once a challenge spec is saved
  //   security_triage / security_report -> once a scan has produced findings
  let hasChallenge = false;
  let hasFindings = false;
  let isKaggle = false;
  if (ctx && ctx.workspaceRoot) {
    try {
      const spec = await challenge.listSpec(ctx.workspaceRoot);
      hasChallenge = Boolean(spec);
      // The Kaggle tools are only useful once the workspace is actually working a
      // Kaggle competition, so they stay out of the base schema until then.
      isKaggle = Boolean(spec && /kaggle/i.test(String(spec.track || '')));
    } catch {}
    try {
      hasFindings = (await findingsStore.list(ctx.workspaceRoot)).length > 0;
    } catch {}
  }
  const defs = TOOL_DEFS.filter((t) => {
    if (t.name === 'web_search') return settings.webSearch !== false;
    if (t.name === 'web_fetch') return settings.webFetch !== false;
    if (t.name === 'challenge_check' || t.name === 'challenge_pack') return hasChallenge;
    if (t.name === 'kaggle_data' || t.name === 'kaggle_submit') return isKaggle;
    if (t.name === 'security_triage' || t.name === 'security_report') return hasFindings;
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

const GEMINI_FREE_FALLBACKS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

// Official Google Gemini API bypass signature for functionCall parts when a prior
// step's thought_signature was not emitted by a streaming proxy or came from
// another model (see https://ai.google.dev/gemini-api/docs/thought-signatures).
const THOUGHT_SIGNATURE_BYPASS = 'skip_thought_signature_validator';

function isGeminiEndpointOrModel(baseUrl, model) {
  const b = String(baseUrl || '').toLowerCase();
  const m = String(model || '').toLowerCase();
  return (
    b.includes('generativelanguage.googleapis.com') ||
    b.includes('aiplatform.googleapis.com') ||
    m.includes('gemini')
  );
}

/**
 * Prepare messages for the target provider:
 * - For Gemini models/endpoints: ensure the first tool_call in every assistant
 *   turn carries `extra_content.google.thought_signature` (preserving the model's
 *   real signature or falling back to Google's official bypass token so multi-step
 *   tool loops never fail with HTTP 400 "missing a thought_signature").
 * - For non-Gemini providers: strip `extra_content` / `thoughtSignature` from
 *   tool_calls so strict OpenAI schemas never reject unknown properties.
 */
function prepareMessagesForProvider(messages: any, cfg: any = {}) {
  if (!Array.isArray(messages)) return [];
  const isGemini = isGeminiEndpointOrModel(cfg.baseUrl, cfg.model);

  return messages.map((m) => {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls.length) {
      return m;
    }
    const mappedCalls = m.tool_calls.map((tc, idx) => {
      if (!tc) return tc;
      const existingSig =
        (tc.extra_content &&
          tc.extra_content.google &&
          (tc.extra_content.google.thought_signature || tc.extra_content.google.thoughtSignature)) ||
        tc.thoughtSignature ||
        tc.thought_signature ||
        null;

      const cleanTc: any = {
        id: tc.id,
        type: tc.type || 'function',
        function: tc.function,
      };

      if (isGemini) {
        if (idx === 0) {
          const sig = existingSig || THOUGHT_SIGNATURE_BYPASS;
          cleanTc.extra_content = {
            ...(tc.extra_content || {}),
            google: {
              ...((tc.extra_content && tc.extra_content.google) || {}),
              thought_signature: sig,
            },
          };
        } else if (existingSig && existingSig !== THOUGHT_SIGNATURE_BYPASS) {
          cleanTc.extra_content = {
            ...(tc.extra_content || {}),
            google: {
              ...((tc.extra_content && tc.extra_content.google) || {}),
              thought_signature: existingSig,
            },
          };
        }
      }
      return cleanTc;
    });

    return { ...m, tool_calls: mappedCalls };
  });
}

/**
 * Convert OpenAI-style assistant `tool_calls` and `role: 'tool'` messages into
 * plain text messages when falling back to the prompt-based tool protocol
 * (`sendTools = false`), so Step 2+ retries never send orphan tool_calls without
 * a tools declaration or thought_signature.
 */
function flattenMessagesForPromptProtocol(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    if (!m) return m;
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const calls = m.tool_calls.map((tc) => {
        const fn = (tc && tc.function) || {};
        let args: any = {};
        try {
          args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : fn.arguments || {};
        } catch {}
        return { name: fn.name || 'tool', arguments: args };
      });
      const jsonBlock = JSON.stringify({ tool_calls: calls });
      const text = m.content ? `${m.content}\n${jsonBlock}` : jsonBlock;
      return { role: 'assistant', content: text };
    }
    if (m.role === 'tool') {
      const label = m.name || m.tool_call_id || 'tool';
      return { role: 'user', content: `Tool result (${label}):\n${m.content || ''}` };
    }
    return m;
  });
}

function isQuotaOrModelError(err) {
  if (!err) return false;
  const st = Number(err.status) || 0;
  if (st === 429 || st === 404 || st === 503) return true;
  const txt = String(err.body || err.message || '');
  return /\b(429|503)\b|resource_exhausted|quota|rate.?limit|overloaded|model.*not found/i.test(txt);
}

function isChatCapableId(id) {
  const s = String(id || '').toLowerCase().trim();
  if (!s) return false;
  return !/(^|[-_])(tts|embedding|embeddings|aqa|imagen|veo|whisper|dall-e|moderation)([-_]|$)/.test(s);
}

/**
 * Build a prioritized list of fallback model configs when the active model hits
 * a per-model quota / rate limit (429), 404, or 503.
 */
function buildFallbackChain(config) {
  if (!config || config.auth === 'gemini-web' || config.auth === 'cloudcode') return [];
  const base = String(config.baseUrl || '').trim().replace(/\/+$/, '');
  const curModel = String(config.model || '').trim();
  const isGemini = /generativelanguage\.googleapis\.com/i.test(base);
  const out = [];
  const seen = new Set();
  if (base && curModel) seen.add(`${base}::${curModel}`);

  const pushCandidate = (cfg) => {
    if (!cfg || !cfg.baseUrl || !cfg.model) return;
    const b = String(cfg.baseUrl).trim().replace(/\/+$/, '');
    const m = String(cfg.model).trim();
    if (!b || !m) return;
    const key = `${b}::${m}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...cfg, baseUrl: b, model: m });
  };

  if (base) {
    const rawIds = Array.isArray(config.fallbackModels)
      ? config.fallbackModels
      : Array.isArray(config.modelIds)
        ? config.modelIds
        : [];
    const usableIds = rawIds.filter(isChatCapableId);

    const pool = isGemini
      ? [
          ...GEMINI_FREE_FALLBACKS.filter((g) => !usableIds.length || usableIds.includes(g)),
          ...GEMINI_FREE_FALLBACKS,
          ...usableIds,
        ]
      : usableIds;

    const scored = [...new Set(pool)].sort((a, b) => {
      const rank = (s) => {
        const idx = GEMINI_FREE_FALLBACKS.indexOf(s);
        if (idx >= 0) return idx;
        if (/:free\b/i.test(s)) return 10;
        if (/flash-lite|mini|instant/i.test(s) && !/exp|preview|argon/i.test(s)) return 15;
        if (/flash/i.test(s) && !/exp|preview|argon/i.test(s)) return 20;
        if (/argon|exp|preview/i.test(s)) return 90;
        return 50;
      };
      return rank(a) - rank(b);
    });

    for (const mid of scored.slice(0, 4)) {
      pushCandidate({ ...config, model: mid });
    }
  }

  if (Array.isArray(config.fallbackConfigs)) {
    for (const fc of config.fallbackConfigs) {
      if (!fc || !fc.baseUrl || !fc.apiKey) continue;
      if (fc.auth === 'gemini-web' || fc.auth === 'cloudcode') continue;
      pushCandidate(fc);
      if (out.length >= 6) break;
    }
  }

  return out;
}

async function callModel({ config, messages, tools, signal, onDelta, onThinking = null, onReasoning = null, threadKey, onModelSwitch }) {
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

  async function callSingleHttpConfig(cfg) {
    const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('No base URL configured for this model.');
    const url = base + '/chat/completions';

    const headers: any = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    if (/openrouter\.ai/.test(base)) {
      headers['HTTP-Referer'] = 'https://nova-ide.local';
      headers['X-Title'] = 'Nova IDE';
    }

    async function streamOnce(msgs, sendTools) {
      const preparedMsgs = sendTools ? prepareMessagesForProvider(msgs, cfg) : flattenMessagesForPromptProtocol(msgs);
      const body: any = {
        model: cfg.model,
        messages: preparedMsgs,
        stream: true,
        temperature: cfg.temperature ?? 0.2,
      };
      if (sendTools) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      let res;
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          res = await fetch(url, { method: 'POST', headers, signal, body: JSON.stringify(body) });
        } catch (netErr) {
          if (signal && signal.aborted) throw netErr;
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 1200 * attempt));
            continue;
          }
          throw netErr;
        }

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          const isTransient =
            res.status === 503 ||
            res.status === 502 ||
            res.status === 504 ||
            (res.status === 429 && /high demand|spikes in demand|try again later/i.test(text));
          if (isTransient && attempt < maxAttempts && (!signal || !signal.aborted)) {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
            continue;
          }
          const err: any = new Error(describeHttpError(url, res.status, res.statusText, text));
          err.status = res.status;
          err.body = text;
          throw err;
        }
        break;
      }

      const decoder = new TextDecoder();
      let buf = '';
      let content = '';
      // Some providers stream the whole reply in `reasoning` / `reasoning_content`
      // and leave `content` empty (DeepSeek-style reasoning models, and some
      // hosted endpoints). We read it but do NOT emit it live: a normal model's
      // chain-of-thought must never appear as the answer. If `content` ends up
      // empty we fall back to it below, so the reply is never silently lost.
      let reasoning = '';
      let refusal = '';
      // Reasoning models think for a while before saying anything: Sarvam streamed
      // ~60 chunks of `reasoning` with `content: null` over ~3 seconds. The UI
      // showed nothing for that whole time, which reads as "stuck". Tell the
      // caller once, on the first reasoning chunk, so it can say so.
      let thinkingNotified = false;
      // Legacy OpenAI `function_call` (a single call, no id/index). Some
      // providers still emit it; without this the tool call is dropped.
      let legacyFn = null;
      let streamThoughtSig = null;
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
          if (j.error) {
            const streamErr: any = new Error(j.error.message || JSON.stringify(j.error));
            streamErr.status = j.error.code || j.error.status || 0;
            streamErr.body = JSON.stringify(j.error);
            throw streamErr;
          }
          const choiceObj = j.choices && j.choices[0];
          const delta = choiceObj && choiceObj.delta;
          if (!delta) continue;

          const chunkSig =
            (delta.extra_content &&
              delta.extra_content.google &&
              (delta.extra_content.google.thought_signature || delta.extra_content.google.thoughtSignature)) ||
            (choiceObj.extra_content &&
              choiceObj.extra_content.google &&
              (choiceObj.extra_content.google.thought_signature || choiceObj.extra_content.google.thoughtSignature)) ||
            delta.thought_signature ||
            delta.thoughtSignature ||
            null;
          if (chunkSig) streamThoughtSig = chunkSig;

          if (delta.content) {
            content += delta.content;
            if (onDelta) onDelta(delta.content);
          }
          const rChunk =
            typeof delta.reasoning_content === 'string'
              ? delta.reasoning_content
              : typeof delta.reasoning === 'string'
                ? delta.reasoning
                : '';
          if (rChunk) {
            reasoning += rChunk;
            if (!thinkingNotified) {
              thinkingNotified = true;
              if (onThinking) onThinking();
            }
            // Reasoning goes to its OWN channel. It must never be mixed into
            // assistant_delta, or a model's chain-of-thought would render as the
            // answer. Models that stream reasoning in a separate field (Sarvam,
            // DeepSeek-style) reach the collapsible thinking block this way;
            // models that inline it as <think> tags are handled in the renderer.
            if (onReasoning) onReasoning(rChunk);
          }
          if (typeof delta.refusal === 'string' && delta.refusal) refusal += delta.refusal;
          if (delta.function_call && typeof delta.function_call === 'object') {
            const lf = delta.function_call;
            legacyFn = legacyFn || { name: '', args: '' };
            if (lf.name) legacyFn.name += lf.name;
            if (lf.arguments) legacyFn.args += lf.arguments;
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0;
              const cur = toolAcc.get(i) || { id: '', name: '', args: '', extra_content: null, thoughtSignature: null };
              if (tc.id) cur.id = tc.id;
              if (tc.function && tc.function.name) cur.name += tc.function.name;
              if (tc.function && tc.function.arguments) cur.args += tc.function.arguments;
              if (tc.extra_content && typeof tc.extra_content === 'object') {
                cur.extra_content = {
                  ...(cur.extra_content || {}),
                  ...tc.extra_content,
                  ...(tc.extra_content.google
                    ? { google: { ...((cur.extra_content && cur.extra_content.google) || {}), ...tc.extra_content.google } }
                    : {}),
                };
                const gSig =
                  tc.extra_content.google &&
                  (tc.extra_content.google.thought_signature || tc.extra_content.google.thoughtSignature);
                if (gSig) cur.thoughtSignature = gSig;
              }
              const tcSig =
                tc.thought_signature ||
                tc.thoughtSignature ||
                (tc.function && (tc.function.thought_signature || tc.function.thoughtSignature)) ||
                null;
              if (tcSig) cur.thoughtSignature = tcSig;
              toolAcc.set(i, cur);
            }
          }
        }
        if (done) break;
      }

      const sortedEntries = [...toolAcc.entries()].sort((a, b) => a[0] - b[0]);
      const toolCalls = sortedEntries.map(([i, t], idx) => {
        const sig = t.thoughtSignature || (idx === 0 ? streamThoughtSig : null) || null;
        const extraContent =
          t.extra_content ||
          (sig ? { google: { thought_signature: sig } } : null);
        return {
          id: t.id || `call_${i}_${Date.now()}`,
          name: t.name,
          argsRaw: t.args,
          ...(extraContent ? { extra_content: extraContent } : {}),
          ...(sig ? { thoughtSignature: sig } : {}),
        };
      });

      // A legacy `function_call` stream is a single call with no index/id.
      if (!toolCalls.length && legacyFn && legacyFn.name) {
        toolCalls.push({
          id: `call_legacy_${Date.now()}`,
          name: legacyFn.name,
          argsRaw: legacyFn.args,
        });
      }

      // Both fallbacks below are guarded on there being NO tool call: when the
      // model's output for this turn is a tool call, an empty `content` is correct
      // and its `reasoning` is its private scratchpad — promoting that to the reply
      // would show the user the model's chain-of-thought as if it were an answer.
      if (!content && !toolCalls.length) {
        // A refusal IS the model's user-facing answer, so it wins over reasoning.
        if (refusal) {
          content = refusal;
          if (onDelta) onDelta(refusal);
        } else if (reasoning) {
          // The model put its answer in `reasoning` and left `content` empty.
          // Without this the user watches the reply arrive in the network log and
          // sees nothing in the chat.
          content = reasoning;
          if (onDelta) onDelta(reasoning);
        }
      }

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
      const toolsRejected = haveTools && status >= 400 && status < 500 && status !== 429 && /tool|function|thought_signature/i.test(bodyText);
      if (!toolsRejected) throw e;

      const proto = geminiWeb.protocolBlock(tools);
      const msgs = flattenMessagesForPromptProtocol(messages);
      const sysIdx = msgs.findIndex((m) => m && m.role === 'system' && typeof m.content === 'string');
      if (sysIdx >= 0) msgs[sysIdx] = { ...msgs[sysIdx], content: msgs[sysIdx].content + '\n\n' + proto };
      else msgs.unshift({ role: 'system', content: proto });

      const r = await streamOnce(msgs, false);
      const calls = geminiWeb.parseWebToolCalls(r.content);
      if (calls) return { content: '', toolCalls: calls };
      return { content: r.content, toolCalls: [] };
    }
  }

  try {
    return await callSingleHttpConfig(config);
  } catch (err) {
    if (signal && signal.aborted) throw err;
    if (!isQuotaOrModelError(err)) throw err;

    const fallbacks = buildFallbackChain(config);
    if (!fallbacks.length) throw err;

    const originalModel = config.model || 'model';
    for (const cand of fallbacks) {
      if (signal && signal.aborted) throw err;
      try {
        const res = await callSingleHttpConfig(cand);
        config.model = cand.model;
        if (cand.baseUrl) config.baseUrl = cand.baseUrl;
        if (cand.apiKey !== undefined) config.apiKey = cand.apiKey;
        if (cand.auth !== undefined) config.auth = cand.auth;
        if (cand.id) config.id = cand.id;
        if (onModelSwitch) {
          onModelSwitch({
            from: originalModel,
            model: cand.model,
            id: cand.id || config.id || null,
            baseUrl: cand.baseUrl || config.baseUrl,
            label: cand.label || config.label || cand.model,
          });
        }
        return res;
      } catch (fbErr) {
        if (signal && signal.aborted) throw fbErr;
        continue;
      }
    }
    throw err;
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
async function codeLineage(args: any, ctx: any = {}) {
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

/**
 * `ubuntu_system` — structured Ubuntu diagnostics & desktop helper.
 * Exported so it can be unit-tested directly.
 */
async function ubuntuSystem(args: any = {}) {
  const action = String(args.action || 'overview').trim();
  const target = String(args.target || args.query || args.text || '').trim();
  const maxLines = Math.max(5, Math.min(Number(args.lines) || 25, 100));
  const userFlag = args.user_scope ? '--user' : '';

  switch (action) {
    case 'overview': {
      const u = computer.detectUbuntu();
      const cmd = [
        'echo "=== Kernel & Uptime ===" && uname -srm && uptime -p 2>/dev/null || true',
        'echo "=== Memory ===" && free -h 2>/dev/null || true',
        'echo "=== Disk (/) ===" && df -h / 2>/dev/null || true',
        'echo "=== CPU ===" && (lscpu 2>/dev/null | grep -E "Model name|Socket|Thread|CPU\(s\):" || nproc 2>/dev/null || true)',
        'echo "=== GPU ===" && (lspci 2>/dev/null | grep -iE "vga|3d|display" || true)',
      ].join(' ; ');
      const r = await runCommand({ command: cmd, timeoutMs: 15000 });
      const header = [
        `Distro: ${u.distro}${u.codename ? ` (${u.codename})` : ''}`,
        `Desktop: ${u.desktop} · Session: ${u.session}${u.display ? ` (DISPLAY=${u.display})` : ''}${u.wayland ? ` (WAYLAND=${u.wayland})` : ''}`,
        `Available Ubuntu Tools: ${u.systemTools.join(', ') || 'basic'}`,
      ].join('\n');
      return { text: `${header}\n\n${(r.stdout || '').trim()}`.trim(), ok: true };
    }
    case 'processes': {
      const cmd = target
        ? `pgrep -af ${shq(target)} | head -n ${maxLines}`
        : `ps aux --sort=-%cpu,-%mem | head -n ${maxLines + 1}`;
      const r = await runCommand({ command: cmd, timeoutMs: 15000 });
      const out = (r.stdout || '').trim();
      return {
        text: out
          ? `Ubuntu processes${target ? ` matching "${target}"` : ' (top CPU/MEM)'}:\n${out}`
          : `No processes matched${target ? ` "${target}"` : ''}.`,
        ok: true,
      };
    }
    case 'ports': {
      const filter = target ? ` | grep -iE ${shq(target)}` : '';
      const cmd = `(ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null)${filter} | head -n ${maxLines + 2}`;
      const r = await runCommand({ command: cmd, timeoutMs: 15000 });
      const out = (r.stdout || '').trim();
      return {
        text: out ? `Listening ports${target ? ` (filter: ${target})` : ''}:\n${out}` : `No listening ports matched${target ? ` "${target}"` : ''}.`,
        ok: true,
      };
    }
    case 'service_status': {
      if (!target) {
        const r = await runCommand({
          command: `systemctl ${userFlag} list-units --type=service --state=running --no-pager | head -n ${maxLines + 5}`,
          timeoutMs: 15000,
        });
        return { text: `Running systemd services:\n${(r.stdout || r.stderr || '').trim()}`, ok: true };
      }
      const r = await runCommand({
        command: `systemctl ${userFlag} status ${shq(target)} --no-pager -n ${maxLines}`,
        timeoutMs: 15000,
      });
      return {
        text: `Service status (${target}):\n${(r.stdout || r.stderr || '').trim()}`,
        ok: r.code === 0 || Boolean((r.stdout || '').trim()),
      };
    }
    case 'service_logs': {
      if (!target) return { text: 'Error: provide service unit name in `target` for service_logs.', ok: false };
      const r = await runCommand({
        command: `journalctl ${userFlag} -u ${shq(target)} -n ${maxLines} --no-pager`,
        timeoutMs: 15000,
      });
      return {
        text: `Logs for ${target} (last ${maxLines} lines):\n${(r.stdout || r.stderr || '').trim() || '(no logs)'}`,
        ok: r.code === 0,
      };
    }
    case 'package_status': {
      if (!target) return { text: 'Error: provide package name or keyword in `target` for package_status.', ok: false };
      const cmd = [
        `echo "=== dpkg / apt ===" && (apt-cache policy ${shq(target)} 2>/dev/null || dpkg -l ${shq(target)} 2>/dev/null || true)`,
        `echo "=== snap ===" && (snap list ${shq(target)} 2>/dev/null || true)`,
        `echo "=== binary ===" && (which ${shq(target)} 2>/dev/null || true)`,
      ].join(' ; ');
      const r = await runCommand({ command: cmd, timeoutMs: 15000 });
      return { text: `Package check for "${target}":\n${(r.stdout || '').trim()}`, ok: true };
    }
    case 'network': {
      const cmd = [
        'echo "=== Interfaces ===" && (ip -br addr 2>/dev/null || ifconfig 2>/dev/null || true)',
        'echo "=== Default Route ===" && (ip route show default 2>/dev/null || true)',
        'echo "=== DNS ===" && (resolvectl status 2>/dev/null | head -n 20 || cat /etc/resolv.conf 2>/dev/null || true)',
      ].join(' ; ');
      const r = await runCommand({ command: cmd, timeoutMs: 15000 });
      return { text: (r.stdout || '').trim() || 'Network info unavailable.', ok: true };
    }
    case 'notify':
      return await computer.desktopAction('notify', { text: target });
    case 'open':
      if (/^https?:\/\/|\//.test(target)) return await computer.desktopAction('open_url', { url: target });
      return await computer.desktopAction('launch_app', { text: target });
    default:
      return { text: `Unknown ubuntu_system action: ${action}`, ok: false };
  }
}

async function executeTool(name: any, args: any = {}, ctx: any = {}) {
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
      if (r.hint) parts.push(r.hint);
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
    case 'ubuntu_system': {
      return await ubuntuSystem(args);
    }
    case 'computer_use': {
      if (computer.DESKTOP_ACTIONS && computer.DESKTOP_ACTIONS.has(args.action)) {
        return await computer.desktopAction(args.action, args);
      }
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
    case 'security_scan': {
      const target = args.path || workspaceRoot;
      const r = await security.scan({
        dir: target,
        maxFindings: Math.min(args.max_findings || 500, 2000),
        includeDeps: args.include_deps !== false,
      });
      await findingsStore.save(target, r.findings);
      const stored = await findingsStore.list(target);
      const top = stored
        .filter((f: any) => f.status === 'open')
        .slice(0, 40)
        .map((f: any) => `${f.id}  [${f.severity}] ${f.rule}  ${path.relative(target, f.file)}:${f.line}  ${String(f.snippet).slice(0, 120)}`)
        .join('\n');
      return {
        text:
          `Security scan of ${target}\n` +
          `candidates: ${r.count}  (critical ${r.bySeverity.critical}, high ${r.bySeverity.high}, medium ${r.bySeverity.medium}, low ${r.bySeverity.low})\n` +
          (r.notes.length ? r.notes.join('\n') + '\n' : '') +
          `\nThese are candidates, not confirmed vulnerabilities. Triage them now: read the code around each one, decide whether untrusted input reaches it, then call security_triage for each.\n\n` +
          (top || 'No candidates found.'),
      };
    }
    case 'security_triage': {
      const r = await findingsStore.triage(args.path || workspaceRoot, args.finding_id, {
        status: args.status,
        analysis: args.analysis,
        severity: args.severity,
      });
      if (r.error) return { text: `Error: ${r.error}` };
      return { text: `Recorded ${args.finding_id} as ${r.finding.status}${args.severity ? ` (severity ${args.severity})` : ''}.` };
    }
    case 'security_report': {
      const body = await findingsStore.report(args.path || workspaceRoot, { format: args.format || 'markdown' });
      return { text: body };
    }
    case 'challenge_find': {
      if (args.source === 'kaggle') {
        const k = await kaggle.listCompetitions({
          search: args.search,
          limit: Math.min(args.limit || 10, 50),
        });
        if (k.authRequired) {
          return { text: `Kaggle needs credentials.\n\n${(k.steps || []).map((s: string) => `- ${s}`).join('\n')}` };
        }
        if (!k.ok) return { text: `Could not list Kaggle competitions: ${k.error}` };
        if (!k.competitions.length) return { text: 'No Kaggle competitions matched.' };
        const body = k.competitions
          .map((c: any) => {
            const rem = challenge.timeRemaining(c.deadline);
            const ends = c.deadline
              ? `${rem.closed ? 'CLOSED' : `in ${rem.human}`}${rem.urgency === 'critical' ? ' \u26a0 critical' : rem.urgency === 'soon' ? ' \u26a0 soon' : ''}`
              : 'no deadline';
            const reward = c.reward ? ` · ${c.reward}` : '';
            const mine = c.userHasEntered ? ` · entered${c.userRank ? ` (rank ${c.userRank})` : ''}` : '';
            return `${c.ref}  [${c.category || '?'}] ${c.title}\n    closes ${ends} · ${c.teamCount} teams${reward}${mine} · ${c.url}`;
          })
          .join('\n');
        return {
          text: `${k.competitions.length} Kaggle competition(s):\n\n${body}\n\nKaggle's deliverable is a submission file scored by a metric — run challenge_spec with the ref to turn one into a checklist.`,
        };
      }
      const r = await challenge.listChallenges({
        tracks: args.tracks,
        deliverableOnly: args.all !== true,
        limit: Math.min(args.limit || 10, 50),
      });
      if (!r.ok) return { text: `Could not list challenges: ${r.error}` };
      if (!r.challenges.length) {
        return {
          text:
            'No open challenges right now for the tracks Nova can deliver.' +
            (args.all ? '' : ' (Design-only contests are filtered out — they need a Figma deliverable.)'),
        };
      }
      const body = r.challenges
        .map((c: any) => {
          const rem = challenge.timeRemaining(c.endsAt);
          const ends = c.endsAt
            ? `${rem.closed ? 'CLOSED' : `in ${rem.human}`}${rem.urgency === 'critical' ? ' \u26a0 critical' : rem.urgency === 'soon' ? ' \u26a0 soon' : ''}`
            : 'no deadline';
          return `${c.id}  [${c.track || '?'}] ${c.name}\n    closes ${ends} · ${c.registrants} registered · ${c.submissions} submitted · ${c.url}`;
        })
        .join('\n');
      return {
        text: `${r.challenges.length} challenge(s), soonest first:\n\n${body}\n\nPick one and run challenge_spec with its id.`,
      };
    }
    case 'challenge_spec': {
      const target = workspaceRoot;
      let payload = null;
      let note = '';
      const kRef = args.url ? challenge.parseKaggleRef(args.url) : null;
      if (kRef) {
        const k = await kaggle.listCompetitions({ search: kRef, limit: 20 });
        if (k.authRequired) {
          return { text: `Kaggle needs credentials.\n\n${(k.steps || []).map((s: string) => `- ${s}`).join('\n')}` };
        }
        if (!k.ok) return { text: `Could not look up that Kaggle competition: ${k.error}` };
        const hit = k.competitions.find((c: any) => c.ref === kRef) || k.competitions[0];
        if (!hit) return { text: `No Kaggle competition matched "${kRef}".` };
        const spec = await challenge.saveSpec(target, {
          source: 'kaggle',
          id: hit.ref,
          name: hit.title,
          url: hit.url,
          track: 'kaggle',
          tags: hit.category ? [hit.category] : [],
          deadlines: hit.deadline ? [{ phase: 'Submission', at: hit.deadline }] : [],
          description: '',
        });
        const p = challenge.progress(spec);
        const grouped: any = {};
        for (const it of spec.items) (grouped[it.group] = grouped[it.group] || []).push(it);
        const body = Object.entries(grouped)
          .map(([g, items]: any) => `${g}:\n` + items.map((i: any) => `  ${i.id}  [${i.status}] ${i.text}`).join('\n'))
          .join('\n');
        return {
          text:
            `Kaggle: ${spec.name} (${hit.ref})\n` +
            `category ${hit.category || '?'} · closes ${hit.deadline || '?'} · ${hit.teamCount} teams${hit.reward ? ` · ${hit.reward}` : ''}` +
            (() => {
              const d = challenge.timeRemaining(hit.deadline);
              if (!d.known) return '';
              if (d.closed) return '\n\u23f3 this competition has closed.';
              return `\n\u23f3 closes in ${d.human}${d.urgency === 'critical' ? ' \u2014 CRITICAL, get a baseline submitted now' : d.urgency === 'soon' ? ' \u2014 soon' : ''}`;
            })() +
            `\n\n` +
            `The API does not expose the evaluation metric, so fetch ${hit.url} and read the Evaluation section before modelling — the metric IS the objective.\n\n` +
            `Checklist: ${p.total} items (${p.done} done).\n\n${body}\n\n` +
            `Work through these, mark each with challenge_check, then challenge_pack.`,
        };
      }
      if (args.url) {
        const id = challenge.parseChallengeId(args.url);
        if (!id) return { text: `Could not read a challenge id out of "${args.url}". Pass a TopCoder challenge URL or id.` };
        const f = await challenge.fetchChallenge(id);
        if (!f.ok) return { text: `Could not fetch that challenge: ${f.error}` };
        payload = {
          source: 'topcoder', id: f.challenge.id, name: f.challenge.name, url: f.challenge.url,
          tags: f.challenge.tags, track: f.challenge.track, deadlines: f.challenge.deadlines,
          description: f.challenge.description,
        };
        note = `Fetched from TopCoder. Track: ${f.challenge.track || '?'} · format: ${f.challenge.fileTypes || 'unspecified'} · closes ${f.challenge.submissionEndDate || '?'} · ${f.challenge.registrants} registered, ${f.challenge.submissions} submitted.`;
        const dl = challenge.deadlineSummary(f.challenge.deadlines);
        if (dl.next) {
          note += `\n\u23f3 ${dl.next.phase} closes in ${dl.next.human}${dl.next.urgency === 'critical' ? ' \u2014 CRITICAL, prioritise a baseline submission now' : dl.next.urgency === 'soon' ? ' \u2014 soon' : ''}`;
        } else if (dl.all.length && dl.all.every((d: any) => d.closed)) {
          note += '\n\u23f3 every deadline on this challenge has passed.';
        }
        const deliv = challenge.deliverability(f.challenge.track);
        if (!deliv.ok) note += `\n\n\u26a0\ufe0f ${deliv.note}`;
      } else if (args.text) {
        payload = { source: 'pasted', name: args.name || 'Pasted challenge', description: args.text };
      } else {
        return { text: 'Pass either `url` (a TopCoder challenge) or `text` (a pasted brief).' };
      }
      const spec = await challenge.saveSpec(target, payload);
      const p = challenge.progress(spec);
      const grouped: any = {};
      for (const it of spec.items) (grouped[it.group] = grouped[it.group] || []).push(it);
      const body = Object.entries(grouped)
        .map(([g, items]: any) => `${g}:\n` + items.map((i: any) => `  ${i.id}  [${i.status}] ${i.text}`).join('\n'))
        .join('\n');
      return {
        text:
          `Challenge: ${spec.name}\n${note ? note + '\n' : ''}` +
          `Checklist: ${p.total} items (${p.done} done).\n\n${body}\n\n` +
          `Work through these and mark each with challenge_check as you finish it, then call challenge_pack.`,
      };
    }
    case 'kaggle_data': {
      if (!args.file) {
        const l = await kaggle.listDataFiles(args.ref);
        if (l.authRequired) return { text: `Kaggle needs credentials.\n\n${(l.steps || []).map((x: string) => `- ${x}`).join('\n')}` };
        if (!l.ok) return { text: `Could not list files: ${l.error}` };
        if (!l.files.length) return { text: 'That competition listed no data files.' };
        const body = l.files.map((f: any) => `  ${f.name}  ${(f.bytes / 1048576).toFixed(2)} MB`).join('\n');
        return { text: `${l.files.length} file(s) for ${args.ref}:\n\n${body}\n\nDownload with kaggle_data { ref, file } — start with train.csv, test.csv and sample_submission.csv.` };
      }
      const dest = path.join(workspaceRoot, 'data', path.basename(String(args.file)));
      const d = await kaggle.downloadDataFile(args.ref, args.file, dest);
      if (d.authRequired) return { text: `Kaggle needs credentials.\n\n${(d.steps || []).map((x: string) => `- ${x}`).join('\n')}` };
      if (!d.ok) return { text: `Download failed: ${d.error}` };
      return { text: `Downloaded ${args.file} -> ${d.path} (${d.bytes} bytes).` };
    }
    case 'kaggle_submit': {
      const rel = args.file || 'submission.csv';
      const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
      if (args.check === true) {
        const l = await kaggle.listSubmissions(args.ref);
        if (l.authRequired) return { text: `Kaggle needs credentials.\n\n${(l.steps || []).map((x: string) => `- ${x}`).join('\n')}` };
        if (!l.ok) return { text: `Could not list submissions: ${l.error}` };
        if (!l.submissions.length) return { text: 'No submissions yet for this competition.' };
        const body = l.submissions
          .map((x: any) => `  [${x.status || '?'}] ${x.fileName || '?'} public=${x.publicScore != null ? x.publicScore : '-'} ${x.date || ''}`)
          .join('\n');
        return { text: `${l.submissions.length} submission(s):\n\n${body}` };
      }
      // Submitting writes to a live competition, so the file must exist first.
      let exists = false;
      try {
        exists = (await fs.promises.stat(abs)).isFile();
      } catch {}
      if (!exists) return { text: `No submission file at ${abs}. Build it first, then submit.` };
      const r = await kaggle.submitPrediction(args.ref, abs, args.description || '');
      if (r.authRequired) return { text: `Kaggle needs credentials.\n\n${(r.steps || []).map((x: string) => `- ${x}`).join('\n')}` };
      if (!r.ok) return { text: `Submit failed: ${r.error}` };
      return { text: `Submitted ${rel} to ${args.ref} (via ${r.via}).\n${JSON.stringify(r.submission)}\n\nUse kaggle_submit { ref, check: true } to read the score once it is scored.` };
    }
    case 'challenge_check': {
      const r = await challenge.setItem(workspaceRoot, args.item_id, { status: args.status, note: args.note });
      if (r.error) return { text: `Error: ${r.error}` };
      const p = challenge.progress(await challenge.listSpec(workspaceRoot));
      return { text: `Marked ${r.item.id} as ${r.item.status} (${p.done}/${p.total} done).` };
    }
    case 'challenge_pack': {
      const r = await challenge.pack(workspaceRoot, {
        files: args.files,
        outPath: args.out_path,
        force: args.force === true,
      });
      if (!r.ok) {
        return {
          text:
            `Could not pack: ${r.error}` +
            (r.blocked && r.blocked.length ? `\nStill open:\n` + r.blocked.map((b) => `  ${b}`).join('\n') : ''),
        };
      }
      return { text: `Packed ${r.files.length} file(s) into ${r.path} (${r.bytes} bytes).\n${r.files.join('\n')}` };
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

function getNovaHome() {
  return configRoot();
}

async function loadSkills() {
  const dir = path.join(getNovaHome(), 'skills');
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
  const u = computer.detectUbuntu ? computer.detectUbuntu() : { distro: os.type(), session: 'x11', desktop: 'GNOME', systemTools: [] };
  const lines = [
    'You are Nova Agent, an autonomous coding and Ubuntu system assistant inside the Nova IDE.',
    `Workspace root: ${workspaceRoot || '(no folder opened — ask the user to open one)'}`,
    `OS: ${u.distro} — Kernel ${os.type()} ${os.release()} (${os.arch()}), user: ${os.userInfo().username}`,
    `Desktop Environment: ${u.desktop} (${u.session}${u.display ? `, DISPLAY=${u.display}` : ''}${u.wayland ? `, WAYLAND=${u.wayland}` : ''})`,
    `Available Ubuntu Tools: ${(u.systemTools || []).join(', ') || 'standard POSIX'}`,
    '',
    'Rules:',
    '- Use tools to inspect reality. Never claim you did something without tool output.',
    '- Read files before editing them. Prefer edit_file over write_file for small changes.',
    '- Use list_dir and grep_search to find relevant files instead of guessing paths.',
    '- For a task with several steps, call todo_write to keep a visible task list, updating it as you go.',
    '- Use code_lineage to see who last changed a file or a line range (git history).',
    '- Use remember to save durable context (user preferences, project facts, decisions) — it is read at the start of every future turn.',
    '- Use ubuntu_system for fast, zero-friction inspection of Ubuntu health (overview), top processes (processes), listening ports (ports), systemd services (service_status, service_logs), apt/snap packages (package_status), network interfaces (network), desktop notifications (notify), or opening apps/URLs (open).',
    '- For shell commands, use run_terminal_cmd (DEBIAN_FRONTEND=noninteractive, PAGER=cat, ~/.local/bin, and /snap/bin are already set). Always pass non-interactive flags (-y for apt-get, --no-pager for systemctl/journalctl).',
    '- Ubuntu privilege & Python tips: If sudo fails because there is no TTY password prompt, use `pkexec <cmd>` to open the native Ubuntu GUI authentication dialog, or prefer rootless flags (`systemctl --user`, `pip install --user`, `~/.local/bin`). On Ubuntu 23.04/24.04+ (PEP 668), use `python3 -m venv .venv` for Python packages.',
    '- The browser tool drives a real Chromium page. Use open before click/fill/text/screenshot.',
    '- computer_use drives the Ubuntu desktop: both pixel/keyboard actions (screenshot, move, click, double_click, right_click, drag, scroll, type, key, wait) and high-level desktop actions (active_window, list_windows, focus_window, launch_app, open_url, notify, clipboard_get, clipboard_set).',
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

function detectMode(userText: any, settings: any = {}, contextNote: any = '', sessionOrHistory: any = null) {
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
  const actionPattern = /\b(create|make|edit|update|change|replace|delete|remove|fix|debug|refactor|install|uninstall|run|execute|build|compile|test|git|commit|push|pull|clone|search|find|grep|list|scan|open|launch|focus|notify|inspect|check|verify|status|monitor|diagnose|troubleshoot|kill|stop|start|restart|reload|enable|disable|upgrade|benchmark|audit|write|read|add|rename|move|copy|show|generate|implement|setup|configure|format|lint|banao|likho|padho|chalao|chalhao|badlo|hatao|dhundo|jodo|daalo|dikhao|dekho|band\s+karo|chalu\s+karo)\b/i;
  const toolPattern = /(\.[a-zA-Z0-9_-]+\b|npm\s|git\s|pip\s|cargo\s|yarn\s|pnpm\s|\bcd\b|\bls\b|\bcat\b|\bmkdir\b|\btouch\b|\brm\b|\bapt(-get|-cache)?\b|\bdpkg\b|\bsnap\b|\bflatpak\b|\bsystemctl\b|\bjournalctl\b|\bservice\b|\bufw\b|\bdocker\b|\bpodman\b|\bpkexec\b|\bsudo\b|\bchmod\b|\bchown\b|\bps\b|\bhtop\b|\bkill\b|\bpkill\b|\blsof\b|\bss\b|\bnetstat\b|\bnmcli\b|\bxdotool\b|\bydotool\b|\bwmctrl\b|\bnotify-send\b|\bxdg-open\b|\bport\s+\d+\b|\b(ram|memory|disk|cpu|gpu)\s+(usage|space|free|status|check)\b|\bkitni\s+(ram|memory|disk|space)\b|\bkya\s+chal\s+raha\b)/i;

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
async function runAgent({ agentId, config, workspaceRoot, userText, settings = {}, contextNote, history, send, notifyFsChanged }: any) {
  const session = getSession(agentId);
  stopAgent(agentId);
  session.abort = new AbortController();
  const signal = session.abort.signal;

  const artifactsDir = path.join(getNovaHome(), 'artifacts');
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

function sanitizeAssistantReply(text) {
  if (!text || typeof text !== 'string') return text;

  // 1. Strip <think>...</think> and <thought>...</thought> reasoning blocks if model emitted them
  let cleaned = text.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/gi, '').trim();

  // 2. Only strip prompt-reflection meta-lines from the VERY START of the message.
  // Code blocks, markdown, formatting and technical explanations are NEVER touched.
  const metaRegex = /^\s*\*\s*(?:User says:|Context:|Workspace:|Mode:\s*(?:Direct\s*)?Chat|Acknowledge the user|Introduce myself|Mention (?:my )?capabilities|Remind the user)/i;

  if (metaRegex.test(cleaned)) {
    const lines = cleaned.split('\n');
    let startIdx = 0;
    while (startIdx < lines.length) {
      const line = lines[startIdx];
      if (metaRegex.test(line) || (startIdx === 0 && line.trim() === '')) {
        startIdx++;
      } else if (line.trim() === '' && startIdx > 0 && startIdx < lines.length && metaRegex.test(lines[startIdx + 1] || '')) {
        startIdx++; // blank line between meta bullets
      } else {
        break;
      }
    }
    if (startIdx > 0) {
      cleaned = lines.slice(startIdx).join('\n').trim();
    }
  }

  // 3. If there is a stray meta-prompt instruction at the very end
  cleaned = cleaned.replace(/\n+\s*\*\s*(?:Add a brief note|Remind the user about agent mode)[\s\S]*$/i, '').trim();

  // If the model wrapped the entire answer in redundant outer quotes like "Hello!"
  const wrapQuote = cleaned.match(/^["“]([\s\S]+)["”]$/);
  if (wrapQuote && !wrapQuote[1].includes('```')) {
    cleaned = wrapQuote[1].trim();
  }

  return cleaned || text;
}

    // Cursor Parity: Direct Chat Mode (fast conversation without tool schemas/loops)
    if (activeMode === 'chat') {
      emit({ type: 'turn_start' });
      emit({ type: 'step', step: 1, maxSteps: 1 });

      const chatSystem = [
        'You are Nova AI, a helpful and knowledgeable coding assistant inside Nova IDE.',
        workspaceRoot ? `Current workspace folder: ${workspaceRoot}` : '',
        'CRITICAL INSTRUCTIONS:',
        '- Answer conversationally, concisely, and directly.',
        '- NEVER output meta-scratchpads, prompt analysis, or bullet-point breakdowns of your instructions (e.g. never write "* User says...", "* Context...", "* Mode...", "* Acknowledge the user").',
        '- When greeted with "hi", "hello", etc., reply with a warm, natural greeting (e.g. "Hello! How can I help you today?") without listing your instructions.',
        '- You are in Chat mode (fast Q&A without tool loops). If the user asks to edit workspace files or run terminal commands, answer them and let them know they can toggle Agent mode.',
      ].filter(Boolean).join('\n');

      const chatMessages = [
        { role: 'system', content: chatSystem },
        ...session.messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).slice(-12),
      ];

      const onModelSwitch = (info) => {
        emit({ type: 'model_switched', ...info });
        emit({
          type: 'status',
          text: `⚡ ${info.from} ka quota khatam tha — ${info.model} pe auto-switch ho gaya.`,
        });
      };

      modelRequests += 1;
      const res = await callModel({
        config,
        messages: chatMessages,
        tools: [],
        signal,
        threadKey: agentId,
        onDelta: (text) => emit({ type: 'assistant_delta', text }),
        onThinking: () => emit({ type: 'status', text: 'Model is thinking\u2026' }),
        onReasoning: (text) => emit({ type: 'reasoning_delta', text }),
        onModelSwitch,
      });

      if (res.content) {
        const cleanContent = sanitizeAssistantReply(res.content);
        emit({ type: 'assistant_message', text: cleanContent });
        session.messages.push({ role: 'assistant', content: cleanContent });
      }
      emit({ type: 'done' });
      return;
    }

    emit({ type: 'turn_start' });

    const schemas = await toolSchemas(settings, { workspaceRoot });

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
          onThinking: () => emit({ type: 'status', text: 'Model is thinking\u2026' }),
          onReasoning: (text) => emit({ type: 'reasoning_delta', text }),
          onModelSwitch: (info) => {
            emit({ type: 'model_switched', ...info });
            emit({
              type: 'status',
              text: `⚡ ${info.from} ka quota khatam tha — ${info.model} pe auto-switch ho gaya.`,
            });
          },
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
      const cleanContent = sanitizeAssistantReply(content);

      if (cleanContent) emit({ type: 'assistant_message', text: cleanContent });

      if (!toolCalls.length) {
        session.messages.push({ role: 'assistant', content: cleanContent || '' });
        break;
      }

      session.messages.push({
        role: 'assistant',
        content: cleanContent || '',
        tool_calls: toolCalls.map((c, idx) => {
          const sig =
            (c.extra_content &&
              c.extra_content.google &&
              (c.extra_content.google.thought_signature || c.extra_content.google.thoughtSignature)) ||
            c.thoughtSignature ||
            (idx === 0 ? THOUGHT_SIGNATURE_BYPASS : null);
          return {
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.argsRaw || '{}' },
            ...(c.extra_content
              ? { extra_content: c.extra_content }
              : sig
                ? { extra_content: { google: { thought_signature: sig } } }
                : {}),
          };
        }),
      });

      for (const call of toolCalls) {
        if (signal.aborted) break;

        let args: any = {};
        try {
          args = JSON.parse(call.argsRaw || '{}');
        } catch {
          const result = `Error: could not parse tool arguments: ${String(call.argsRaw).slice(0, 300)}`;
          emit({ type: 'tool_end', callId: call.id, name: call.name, ok: false, output: result });
          session.messages.push({ role: 'tool', name: call.name, tool_call_id: call.id, content: result });
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
          session.messages.push({ role: 'tool', name: call.name, tool_call_id: call.id, content: result });
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
          session.messages.push({ role: 'tool', name: call.name, tool_call_id: call.id, content: truncate(r.text) });
        } catch (e) {
          const result = `Error: ${e.message}`;
          emit({ type: 'tool_end', callId: call.id, name: call.name, ok: false, output: result });
          session.messages.push({ role: 'tool', name: call.name, tool_call_id: call.id, content: result });
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
  callModel,
  buildFallbackChain,
  isQuotaOrModelError,
  GEMINI_FREE_FALLBACKS,
  THOUGHT_SIGNATURE_BYPASS,
  prepareMessagesForProvider,
  flattenMessagesForPromptProtocol,
  ubuntuSystem,
};
