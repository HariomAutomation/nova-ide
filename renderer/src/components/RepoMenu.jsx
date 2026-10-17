import { useEffect, useState } from 'react';
import { useStore } from '../store';

/**
 * GitHub repository picker — shared by the sidebar "+" and the composer's repo
 * chip. Connect with a token, search your repos, click one to clone + open it.
 */
export default function RepoMenu({ onClose }) {
  const github = useStore((s) => s.github);
  const [q, setQ] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    useStore.getState().loadGithub();
  }, []);

  useEffect(() => {
    if (github.connected && github.repos.length === 0 && !github.loading) {
      useStore.getState().loadGithubRepos('');
    }
  }, [github.connected]);

  async function connect() {
    const ok = await useStore.getState().saveGithubToken(token);
    if (ok) setToken('');
  }

  function openLocal() {
    if (onClose) onClose();
    useStore.getState().openFolder();
  }

  return (
    <>
      <div className="rp-head">Repositories</div>
      {!github.connected ? (
        <div className="rp-connect">
          <div className="rp-desc muted small">Connect GitHub to browse and clone your repositories.</div>
          <input
            className="input"
            type="password"
            placeholder="Personal access token (ghp_…)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && token.trim()) connect();
            }}
          />
          <div className="input-row">
            <button className="btn small primary" disabled={!token.trim()} onClick={connect}>
              Connect GitHub
            </button>
            <button className="btn small" onClick={openLocal}>
              Open local folder…
            </button>
          </div>
          <div className="rp-hint muted small">
            GitHub → Settings → Developer settings → Personal access tokens → <b>repo</b> scope.
          </div>
        </div>
      ) : (
        <>
          <div className="rp-search">
            <input
              className="input"
              placeholder={`Repos for ${github.login || 'you'}…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') useStore.getState().loadGithubRepos(q);
              }}
            />
            <button className="btn-icon" title="Refresh" onClick={() => useStore.getState().loadGithubRepos(q)}>
              {'\u21BB'}
            </button>
          </div>
          <div className="rp-list">
            {github.loading && <div className="rp-empty muted small">Loading…</div>}
            {github.error && <div className="rp-empty search-error small">{github.error}</div>}
            {!github.loading && !github.error && github.repos.length === 0 && (
              <div className="rp-empty muted small">No repositories found.</div>
            )}
            {github.repos.map((r) => (
              <button
                key={r.fullName}
                className="rp-row"
                title={r.fullName}
                onClick={() => {
                  if (onClose) onClose();
                  useStore.getState().cloneRepo(r);
                }}
              >
                <span className="rp-ico">{r.private ? '\u{1F512}' : '\u{1F4E6}'}</span>
                <span className="rp-text">
                  <span className="rp-name">{r.fullName}</span>
                  {r.description && <span className="rp-desc muted">{r.description}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="rp-foot">
            <button className="btn small" onClick={openLocal}>
              Open local folder…
            </button>
            <button className="btn small" onClick={() => useStore.getState().githubLogout()}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </>
  );
}
