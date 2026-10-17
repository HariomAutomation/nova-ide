import { useState } from 'react';
import { useStore } from '../store';
import { timeAgo } from '../timeAgo';

export default function AutomationsPage() {
  const automations = useStore((s) => s.automations);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [open, setOpen] = useState(false);

  function create() {
    if (!prompt.trim()) return;
    useStore.getState().addAutomation({ name, prompt });
    setName('');
    setPrompt('');
    setOpen(false);
    useStore.getState().setStatus('Automation saved');
  }

  return (
    <div className="page-main">
      <div className="page-header wide">
        <div>
          <h1>Automations</h1>
          <p className="muted">
            Automate repetitive tasks with always-on agents. Nova runs each automation as a normal agent task — free,
            with your own models.
          </p>
        </div>
        <button className="btn primary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : '+ New Automation'}
        </button>
      </div>

      {open && (
        <div className="auto-form card">
          <input
            className="input"
            placeholder="Name (e.g. Morning repo check)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="input"
            rows={3}
            placeholder="What should the agent do? e.g. Review recent changes for bugs and write a short report."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="auto-form-actions">
            <button className="btn primary" onClick={create} disabled={!prompt.trim()}>
              Save automation
            </button>
          </div>
        </div>
      )}

      {automations.length === 0 && !open ? (
        <div className="auto-empty">
          <div className="auto-empty-ico">{'\u26A1'}</div>
          <div className="auto-empty-title">Automate repetitive tasks</div>
          <p className="muted small">
            Create an automation once — e.g. &ldquo;review my changes&rdquo;, &ldquo;update the changelog&rdquo;,
            &ldquo;run the tests and fix failures&rdquo; — and run it with one click.
          </p>
          <button className="btn primary" onClick={() => setOpen(true)}>
            Create your first automation
          </button>
        </div>
      ) : (
        <div className="auto-list">
          {automations.map((a) => (
            <div key={a.id} className="auto-card card">
              <div className="auto-card-main">
                <div className="auto-name">{a.name}</div>
                <div className="auto-prompt muted">{a.prompt}</div>
                <div className="auto-meta muted small">
                  {timeAgo(a.createdAt) === 'now' ? 'Created just now' : `Created ${timeAgo(a.createdAt)} ago`}
                </div>
              </div>
              <div className="auto-actions">
                <button className="btn primary small" onClick={() => useStore.getState().runAutomation(a.id)}>
                  {'\u25B6'} Run
                </button>
                <button
                  className="btn-icon"
                  title="Delete automation"
                  onClick={() => useStore.getState().removeAutomation(a.id)}
                >
                  {'\u{1F5D1}'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
