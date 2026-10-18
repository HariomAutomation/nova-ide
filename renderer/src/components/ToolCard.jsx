import { useState } from 'react';
import { useStore } from '../store';

const LABELS = {
  list_dir: 'List directory',
  read_file: 'Read file',
  write_file: 'Write file',
  edit_file: 'Edit file',
  delete_file: 'Delete file',
  grep_search: 'Search',
  run_terminal_cmd: 'Run command',
  browser: 'Browser',
  computer_use: 'Computer',
  web_search: 'Web search',
  web_fetch: 'Web fetch',
};

const ICONS = {
  list_dir: '\u{1F4C1}',
  read_file: '\u{1F4C4}',
  write_file: '\u{1F4DD}',
  edit_file: '\u270F\uFE0F',
  delete_file: '\u{1F5D1}\uFE0F',
  grep_search: '\u{1F50D}',
  run_terminal_cmd: '\u25B6',
  browser: '\u{1F310}',
  computer_use: '\u{1F5A5}\uFE0F',
  web_search: '\u{1F310}',
  web_fetch: '\u{1F4E5}',
};

const LANG_LABELS = {
  js: 'JavaScript', ts: 'TypeScript', jsx: 'JSX', tsx: 'TSX',
  py: 'Python', java: 'Java', c: 'C', cpp: 'C++', cs: 'C#',
  go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', html: 'HTML',
  css: 'CSS', json: 'JSON', md: 'Markdown', sh: 'Shell',
};

function argSummary(name, args) {
  if (!args) return '';
  switch (name) {
    case 'run_terminal_cmd':
      return `$ ${args.command}`;
    case 'grep_search':
      return `/${args.pattern}/ ${args.path ? 'in ' + args.path : ''}`;
    case 'web_search':
      return args.query || '';
    case 'web_fetch':
      return args.url || '';
    case 'browser':
      return `${args.action}${args.url ? ' ' + args.url : ''}${args.selector ? ' ' + args.selector : ''}${args.text ? ` "${String(args.text).slice(0, 40)}"` : ''}${args.key ? ' ' + args.key : ''}`;
    case 'computer_use':
      return `${args.action}${args.x != null ? ` (${args.x},${args.y})` : ''}${args.text ? ` "${String(args.text).slice(0, 30)}"` : ''}${args.key ? ' ' + args.key : ''}`;
    default:
      return args.path || '';
  }
}

function labelFor(name) {
  if (LABELS[name]) return LABELS[name];
  if (name && name.startsWith('mcp__')) {
    const parts = name.split('__');
    return `MCP · ${parts[1] || ''}${parts[2] ? ' · ' + parts[2] : ''}`;
  }
  return name;
}

const STATUS = {
  running: { label: 'running', cls: 'running' },
  awaiting: { label: 'needs approval', cls: 'awaiting' },
  done: { label: 'done', cls: 'done' },
  error: { label: 'error', cls: 'error' },
  denied: { label: 'denied', cls: 'denied' },
};

function parseDiff(output) {
  if (!output || !output.includes('@@')) return null;
  const lines = output.split('\n');
  const changes = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) changes.push(current);
      current = { header: line, added: [], removed: [], context: [] };
    } else if (current) {
      if (line.startsWith('+') && !line.startsWith('+++')) current.added.push(line.slice(1));
      else if (line.startsWith('-') && !line.startsWith('---')) current.removed.push(line.slice(1));
      else current.context.push(line);
    }
  }
  if (current) changes.push(current);
  return changes;
}

function DiffView({ output }) {
  const changes = parseDiff(output);
  if (!changes) return null;
  return (
    <div className="diff-view">
      {changes.map((c, ci) => (
        <div key={ci} className="diff-hunk">
          <div className="diff-header">{c.header}</div>
          {Math.max(c.added.length, c.removed.length) > 0 && (
            <div className="diff-rows">
              {c.removed.map((r, i) => (
                <div key={'r-' + i} className="diff-row removed">➖ {r}</div>
              ))}
              {c.added.map((a, i) => (
                <div key={'a-' + i} className="diff-row added">➕ {a}</div>
              ))}
            </div>
          )}
          {c.context.length && (
            <div className="diff-context">{c.context.length} line{c.context.length !== 1 ? 's' : ''} unchanged</div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ToolCard({ item }) {
  const [expanded, setExpanded] = useState(false);
  const approve = useStore((s) => s.agentApprove);
  const st = STATUS[item.status] || STATUS.running;
  const output = item.output || '';
  const lines = output.split('\n');
  const showCollapsed = lines.length > 10;
  const shown = expanded || !showCollapsed ? output : lines.slice(0, 10).join('\n');

  return (
    <div className={'tool-card ' + st.cls} data-testid="tool-card" data-tool-name={item.name} data-tool-status={item.status}>
      <div className="tool-head">
        <span className="tool-icon">{ICONS[item.name] || (item.name && item.name.startsWith('mcp__') ? '\u{1F50C}' : '\u2699')}</span>
        <span className="tool-name">{labelFor(item.name)}</span>
        <span className="tool-arg" title={argSummary(item.name, item.args)}>
          {argSummary(item.name, item.args)}
        </span>
        <span className={'tool-status ' + st.cls}>
          {item.status === 'running' && <span className="spin" />}
          {st.label}
        </span>
      </div>

      {item.status === 'awaiting' && (
        <div className="tool-approval">
          <span className="approval-text">
            {item.reason
              ? `${item.reason} — allow anyway?`
              : item.category === 'terminal'
                ? 'Allow this command to run?'
                : item.category === 'computer'
                  ? 'Allow desktop control?'
                  : item.category === 'web'
                    ? 'Allow web access?'
                    : item.category === 'mcp'
                      ? 'Allow this MCP tool call?'
                      : 'Allow this action?'}
          </span>
          <button className="btn small primary" data-testid="tool-allow-btn" aria-label="Allow" onClick={() => approve(item.callId, true, false)}>
            Allow
          </button>
          <button className="btn small" data-testid="tool-always-btn" aria-label="Always" onClick={() => approve(item.callId, true, true)}>
            Always
          </button>
          <button className="btn small danger" data-testid="tool-deny-btn" aria-label="Deny" onClick={() => approve(item.callId, false, false)}>
            Deny
          </button>
        </div>
      )}

      {item.image && (
        <div className="tool-image-wrap">
          <img className="tool-image" src={item.image} alt="tool output" />
        </div>
      )}

      {output && (
        <div className={'tool-output' + (item.name === 'run_terminal_cmd' ? ' terminal-style' : '')}>
          {item.name === 'edit_file' && <DiffView output={output} />}
          <pre>{shown}</pre>
          {showCollapsed && (
            <button className="tool-expand" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show less' : `Show all (${lines.length} lines)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
