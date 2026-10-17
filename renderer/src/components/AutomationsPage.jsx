import { useState } from 'react';
import { useStore } from '../store';
import { timeAgo } from '../timeAgo';
import { describeTrigger } from '../automation-schedule';

function TriggerEditor({ value, onChange }) {
  const t = value || { type: 'manual' };
  return (
    <div className="auto-trigger">
      <span className="auto-trigger-label">Trigger</span>
      <select className="select" value={t.type} onChange={(e) => onChange({ ...t, type: e.target.value })}>
        <option value="manual">Manual — run from here</option>
        <option value="startup">On app start</option>
        <option value="interval">Every N minutes</option>
        <option value="daily">Daily at a time</option>
      </select>
      {t.type === 'interval' && (
        <>
          <input
            className="input narrow"
            type="number"
            min="1"
            value={t.minutes || 60}
            onChange={(e) => onChange({ ...t, minutes: Number(e.target.value) })}
          />
          <span className="muted small">minutes</span>
        </>
      )}
      {t.type === 'daily' && (
        <input
          className="input"
          style={{ width: 120 }}
          type="time"
          value={t.time || '09:00'}
          onChange={(e) => onChange({ ...t, time: e.target.value })}
        />
      )}
    </div>
  );
}

function StatusPill({ a }) {
  if (!a.lastStatus) return <span className="auto-status muted small">Never run</span>;
  const when = a.lastRunAt ? timeAgo(a.lastRunAt) : '';
  const cls =
    a.lastStatus === 'ok' ? 'ok' : a.lastStatus === 'running' ? 'run' : 'err';
  const text =
    a.lastStatus === 'ok' ? 'Last run ok' : a.lastStatus === 'running' ? 'Running…' : `Failed: ${a.lastError || 'error'}`;
  return (
    <span className={'auto-status ' + cls + ' small'}>
      {text}
      {when && when !== 'now' ? ` · ${when} ago` : when === 'now' ? ' · just now' : ''}
    </span>
  );
}

export default function AutomationsPage() {
  const automations = useStore((s) => s.automations);
  const webhookBase = useStore((s) => s.appInfo && s.appInfo.webhook && s.appInfo.webhook.base) || '';
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [trigger, setTrigger] = useState({ type: 'manual' });

  function reset() {
    setName('');
    setPrompt('');
    setTrigger({ type: 'manual' });
    setEditing(null);
    setOpen(false);
  }

  function save() {
    if (!prompt.trim()) return;
    const st = useStore.getState();
    if (editing) {
      st.updateAutomation(editing, { name, prompt, trigger });
      st.setStatus('Automation updated');
    } else {
      st.addAutomation({ name, prompt, trigger });
      st.setStatus('Automation saved');
    }
    reset();
  }

  function edit(a) {
    setEditing(a.id);
    setName(a.name);
    setPrompt(a.prompt);
    setTrigger(a.trigger || { type: 'manual' });
    setOpen(true);
  }

  return (
    <div className="page-main">
      <div className="page-header wide">
        <div>
          <h1>Automations</h1>
          <p className="muted">
            Save a prompt once and run it on a trigger — manually, on app start, on a timer, or from a local webhook.
            Each run is a normal agent task with your own model.
          </p>
        </div>
        <button className="btn primary" onClick={() => (open ? reset() : setOpen(true))}>
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
          <TriggerEditor value={trigger} onChange={setTrigger} />
          <div className="auto-form-actions">
            <button className="btn primary" onClick={save} disabled={!prompt.trim()}>
              {editing ? 'Save changes' : 'Save automation'}
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
            &ldquo;run the tests and fix failures&rdquo; — give it a trigger, and let it run.
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
                <div className="auto-name-row">
                  <span className="auto-name">{a.name}</span>
                  <span className={'auto-trigger-tag' + (a.enabled === false ? ' off' : '')}>
                    {describeTrigger(a.trigger)}
                  </span>
                </div>
                <div className="auto-prompt muted">{a.prompt}</div>
                <StatusPill a={a} />
                {a.webhookToken && (
                  <div className="auto-webhook muted small">
                    Webhook: <code>{`POST ${webhookBase || ''}/automations/webhook/${a.webhookToken}`}</code>
                    <button
                      className="linklike"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(`${webhookBase || ''}/automations/webhook/${a.webhookToken}`)
                          .then(() => useStore.getState().setStatus('Webhook URL copied'))
                      }
                    >
                      copy
                    </button>
                  </div>
                )}
              </div>
              <div className="auto-actions">
                <label className="auto-enable" title="Enable / disable this trigger">
                  <input
                    type="checkbox"
                    checked={a.enabled !== false}
                    onChange={(e) => useStore.getState().updateAutomation(a.id, { enabled: e.target.checked })}
                  />
                  on
                </label>
                <button className="btn primary small" onClick={() => useStore.getState().runAutomation(a.id, 'manual')}>
                  {'\u25B6'} Run
                </button>
                <button className="btn small" onClick={() => edit(a)}>
                  Edit
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
