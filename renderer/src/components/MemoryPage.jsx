import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { timeAgo } from '../timeAgo';

export default function MemoryPage() {
  const memory = useStore((s) => s.memory);
  const [text, setText] = useState('');

  useEffect(() => {
    useStore.getState().loadMemory();
  }, []);

  function add() {
    const body = text.trim();
    if (!body) return;
    useStore.getState().addMemory(body);
    setText('');
  }

  return (
    <div className="page-main">
      <div className="page-header wide">
        <div>
          <h1>Memory</h1>
          <p className="muted">
            Notes the agent reads at the start of every turn — for every model — so it knows the context before you say
            anything.
          </p>
        </div>
        {memory.notes.length > 0 && (
          <button className="btn small danger" onClick={() => useStore.getState().clearMemory()}>
            Clear all
          </button>
        )}
      </div>

      <div className="mem-add card">
        <textarea
          className="input"
          rows={2}
          placeholder="Save a note: a preference, a project fact, a decision…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add();
          }}
        />
        <button className="btn primary" disabled={!text.trim()} onClick={add}>
          Save
        </button>
      </div>

      {memory.loading && <p className="muted">Loading…</p>}
      {!memory.loading && memory.notes.length === 0 && (
        <p className="muted">
          No notes yet. Add one above, or just work with the agent — it can save notes itself with the{' '}
          <code>remember</code> tool.
        </p>
      )}

      <div className="mem-list">
        {memory.notes.map((n) => (
          <div key={n.id} className="mem-row">
            <div className="mem-text">{n.text}</div>
            <div className="mem-meta muted small">
              {n.source === 'agent' ? 'agent' : 'you'}
              {n.createdAt ? ` \u00B7 ${timeAgo(n.createdAt)}` : ''}
            </div>
            <button className="btn-icon" title="Delete note" onClick={() => useStore.getState().removeMemory(n.id)}>
              {'\u00D7'}
            </button>
          </div>
        ))}
      </div>

      {memory.path && (
        <p className="muted small">
          Stored at <code>{memory.path}</code> — plain JSON, easy to back up or sync.
        </p>
      )}
    </div>
  );
}
