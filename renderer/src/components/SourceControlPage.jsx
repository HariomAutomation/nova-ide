import { useEffect, useState } from 'react';
import { useStore } from '../store';

function FileRow({ f, onDiff, onToggle, action }) {
  const letter = (f.label || 'changed')[0].toUpperCase();
  return (
    <div className="sc-row">
      <span className={'sc-badge ' + (f.label || '')} title={f.label}>
        {letter}
      </span>
      <button className="sc-path" onClick={onDiff} title={f.path}>
        {f.path}
      </button>
      <button className="btn-icon" title={action === '+' ? 'Stage' : 'Unstage'} onClick={onToggle}>
        {action}
      </button>
    </div>
  );
}

export default function SourceControlPage() {
  const git = useStore((s) => s.git);
  const gitMessage = useStore((s) => s.gitMessage);
  const gitBusy = useStore((s) => s.gitBusy);
  const rootFolder = useStore((s) => s.rootFolder);
  const [branches, setBranches] = useState([]);
  const [diff, setDiff] = useState(null);

  useEffect(() => {
    if (rootFolder) useStore.getState().loadGit();
  }, [rootFolder]);

  useEffect(() => {
    if (rootFolder && git.repo) {
      window.nova
        .gitBranches(rootFolder)
        .then((r) => setBranches((r && r.branches) || []))
        .catch(() => {});
    }
  }, [rootFolder, git.repo, git.branch]);

  async function showDiff(f) {
    const r = await window.nova.gitDiff({ cwd: rootFolder, path: f.path, staged: f.staged });
    setDiff({ path: f.path, text: (r && r.diff) || '' });
  }

  const header = (sub) => (
    <div className="page-header wide">
      <div>
        <h1>Source Control</h1>
        <p className="muted">{sub}</p>
      </div>
      {git.repo && (
        <div className="sc-actions">
          <select
            className="select"
            value={git.branch || ''}
            onChange={(e) => useStore.getState().gitSwitchBranch(e.target.value)}
            disabled={gitBusy}
            title="Switch branch"
          >
            {[git.branch, ...branches.filter((b) => b !== git.branch)]
              .filter(Boolean)
              .map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
          </select>
          <button className="btn small" onClick={() => useStore.getState().gitPull()} disabled={gitBusy}>
            {'\u2193'} Pull
          </button>
          <button className="btn small" onClick={() => useStore.getState().gitPush()} disabled={gitBusy}>
            {'\u2191'} Push
          </button>
          <button className="btn-icon" title="Refresh" onClick={() => useStore.getState().loadGit()}>
            {'\u21BB'}
          </button>
        </div>
      )}
    </div>
  );

  if (!rootFolder) {
    return (
      <div className="page-main">
        {header('Open a folder to use Git.')}
      </div>
    );
  }

  if (!git.repo) {
    return (
      <div className="page-main">
        {header(git.error ? `Not a git repository — ${git.error}` : 'This folder is not a git repository.')}
      </div>
    );
  }

  const staged = git.files.filter((f) => f.staged);
  const changes = git.files.filter((f) => !f.staged);
  const meta = [
    git.branch,
    git.upstream ? `\u2192 ${git.upstream}` : null,
    git.ahead ? `${git.ahead} ahead` : null,
    git.behind ? `${git.behind} behind` : null,
    git.remote || null,
  ]
    .filter(Boolean)
    .join('  \u00B7  ');

  return (
    <div className="page-main">
      {header(meta)}

      <div className="sc-commit card">
        <textarea
          className="input"
          rows={2}
          placeholder="Commit message"
          value={gitMessage}
          onChange={(e) => useStore.getState().setGitMessage(e.target.value)}
        />
        <button
          className="btn primary"
          onClick={() => useStore.getState().gitCommit()}
          disabled={gitBusy || !gitMessage.trim()}
        >
          Commit
        </button>
      </div>

      {git.files.length === 0 && <p className="muted">No changes — working tree clean.</p>}

      {staged.length > 0 && (
        <div className="sc-group">
          <div className="sc-group-head">
            Staged changes <span className="muted small">{staged.length}</span>
          </div>
          {staged.map((f) => (
            <FileRow
              key={f.path}
              f={f}
              action="-"
              onDiff={() => showDiff(f)}
              onToggle={() => useStore.getState().gitUnstage([f.path])}
            />
          ))}
        </div>
      )}

      {changes.length > 0 && (
        <div className="sc-group">
          <div className="sc-group-head">
            Changes <span className="muted small">{changes.length}</span>
          </div>
          {changes.map((f) => (
            <FileRow
              key={f.path}
              f={f}
              action="+"
              onDiff={() => showDiff(f)}
              onToggle={() => useStore.getState().gitStage([f.path])}
            />
          ))}
        </div>
      )}

      {diff && (
        <div className="sc-diff card">
          <div className="sc-diff-head">
            <span>{diff.path}</span>
            <button className="btn-icon" title="Close" onClick={() => setDiff(null)}>
              {'\u00D7'}
            </button>
          </div>
          <pre className="sc-diff-body">{diff.text || '(no textual diff)'}</pre>
        </div>
      )}
    </div>
  );
}
