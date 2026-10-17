import { useRef, useState } from 'react';
import { useStore } from '../store';

export default function TerminalPanel() {
  const lines = useStore((s) => s.termLines);
  const busy = useStore((s) => s.termBusy);
  const clearTerminal = useStore((s) => s.clearTerminal);
  const setTerminalOpen = useStore((s) => s.setTerminalOpen);
  const termRun = useStore((s) => s.termRun);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const bodyRef = useRef(null);

  function run() {
    const cmd = input.trim();
    if (!cmd || busy) return;
    setHistory([cmd, ...history].slice(0, 50));
    setHistIdx(-1);
    setInput('');
    termRun(cmd);
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    });
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span className="terminal-title">Terminal &mdash; bash</span>
        <div className="spacer" />
        <button className="btn-icon" title="Clear" onClick={clearTerminal}>
          &#128465;
        </button>
        <button className="btn-icon" title="Hide (Ctrl+`)" onClick={() => setTerminalOpen(false)}>
          &#215;
        </button>
      </div>
      <div className="terminal-body" ref={bodyRef}>
        {lines.length === 0 && (
          <div className="terminal-hint">
            Type a command and press Enter. Commands run in the workspace folder.
          </div>
        )}
        {lines.map((l, i) => (
          <pre key={i} className={'term-line ' + l.kind}>
            {l.text}
          </pre>
        ))}
      </div>
      <div className="terminal-input-row">
        <span className="terminal-prompt">$</span>
        <input
          className="terminal-input"
          value={input}
          disabled={busy}
          placeholder={busy ? 'running…' : 'command'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
            else if (e.key === 'ArrowUp') {
              const idx = Math.min(histIdx + 1, history.length - 1);
              if (history[idx]) {
                setHistIdx(idx);
                setInput(history[idx]);
              }
            } else if (e.key === 'ArrowDown') {
              const idx = histIdx - 1;
              setHistIdx(idx);
              setInput(history[idx] || '');
            }
          }}
        />
      </div>
    </div>
  );
}
