import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { basename } from '../timeAgo';

/**
 * Repository & Workspace switcher — opened by the sidebar "+" icon.
 * Allows picking recent workspaces, opening a local folder, or cloning/opening from GitHub.
 */
export default function RepoMenu({ onClose }) {
  const github = useStore((s) => s.github);
  const rootFolder = useStore((s) => s.rootFolder);
  const recentFolders = useStore((s) => s.recentFolders) || [];
  const removeRecentFolder = useStore((s) => s.removeRecentFolder);
  const [q, setQ] = useState('');
  const [token, setToken] = useState('');
  const [cid, setCid] = useState('');
  const [adv, setAdv] = useState(false);
  const [device, setDevice] = useState(null); // { userCode, verificationUri, deviceCode }
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    useStore.getState().loadGithub();
  }, []);

  useEffect(() => {
    if (github.connected && github.repos.length === 0 && !github.loading) {
      useStore.getState().loadGithubRepos('');
    }
  }, [github.connected]);

  useEffect(() => {
    if (github && github.clientId) setCid(github.clientId);
  }, [github && github.clientId]);

  async function connectToken() {
    const ok = await useStore.getState().saveGithubToken(token);
    if (ok) setToken('');
  }

  async function startSignIn() {
    const r = await useStore.getState().githubSignIn();
    if (!r) return;
    setDevice(r);
    setPolling(true);
    const ok = await useStore.getState().githubPollSignIn(r.deviceCode);
    setPolling(false);
    if (ok && onClose) onClose();
  }

  function openLocal() {
    if (onClose) onClose();
    useStore.getState().openFolder();
  }

  return (
    <>
      <div className="rp-head">Workspaces &amp; Repositories</div>

      <div style={{ padding: '0 2px 8px' }}>
        <button
          className="btn small primary"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={openLocal}
        >
          📂 Open local folder…
        </button>
      </div>

      {recentFolders.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="rp-head" style={{ padding: '2px 6px 4px' }}>Recent Workspaces</div>
          <div className="rp-list" style={{ maxHeight: 160, overflowY: 'auto' }}>
            {recentFolders.map((f) => {
              const isActive = f === rootFolder;
              return (
                <div
                  key={f}
                  className={'rp-row' + (isActive ? ' active' : '')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px 6px',
                    borderRadius: 6,
                    background: isActive ? 'var(--bg-active)' : 'transparent',
                  }}
                >
                  <div
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => {
                      if (onClose) onClose();
                      useStore.getState().openFolder(f);
                    }}
                    title={f}
                  >
                    <div style={{ fontSize: '12px', fontWeight: isActive ? 600 : 500, color: 'var(--text)' }}>
                      📁 {basename(f)} {isActive ? '✓' : ''}
                    </div>
                    <div className="muted" style={{ fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f}
                    </div>
                  </div>
                  <button
                    className="btn-icon tiny"
                    title="Remove from recents"
                    style={{ opacity: 0.6, flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecentFolder(f);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {github.connected ? (
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
      ) : (
        <div className="rp-connect">
          {github.hasClientId ? (
            device ? (
              <>
                <div className="rp-desc muted small">Browser me ye code daalo (ya Copy karke paste karo):</div>
                <div className="rp-code">{device.userCode}</div>
                <div className="input-row">
                  <button
                    className="btn small"
                    onClick={() => navigator.clipboard.writeText(device.userCode)}
                  >
                    Copy code
                  </button>
                  <button className="btn small" onClick={() => window.nova.openExternal(device.verificationUri)}>
                    Open GitHub
                  </button>
                </div>
                <div className="rp-hint muted small">
                  {polling ? 'Approve karne ka intezaar… connect hote hi ye khud band ho jayega.' : 'Waiting…'}
                </div>
              </>
            ) : (
              <>
                <div className="rp-desc muted small">
                  Sign in with GitHub in your browser — approve, and it comes right back here.
                </div>
                <div className="input-row">
                  <button className="btn primary" onClick={startSignIn}>
                    Sign in with GitHub
                  </button>
                  <button className="btn small" onClick={openLocal}>
                    Open local folder…
                  </button>
                </div>
              </>
            )
          ) : (
            <>
              <div className="rp-desc muted small">
                Ek baar GitHub <b>OAuth App</b> ka client ID daalo — uske baad sign-in one-click ho jayega.
              </div>
              <input
                className="input"
                placeholder="OAuth App client ID (Iv1.… / Ov23li…)"
                value={cid}
                onChange={(e) => setCid(e.target.value)}
              />
              <div className="input-row">
                <button
                  className="btn small primary"
                  disabled={!cid.trim()}
                  onClick={() => useStore.getState().saveGithubClientId(cid.trim())}
                >
                  Save client ID
                </button>
                <button
                  className="btn small"
                  onClick={() => window.nova.openExternal('https://github.com/settings/applications/new')}
                >
                  Create OAuth App ↗
                </button>
              </div>
              <div className="rp-hint muted small">
                "Create OAuth App" kholo → Application name kuch bhi → Homepage URL kuch bhi → <b>Enable Device Flow</b> tick →
                Redirect/Callback URL me <b>https://nova.local</b> daalo (form ise maangta hai, device flow me use nahi hota)
                → "Expire user access tokens" uncheck → <b>Register</b> → client ID copy karke upar paste karo.
              </div>
            </>
          )}

          <button className="btn small" onClick={() => setAdv((v) => !v)}>
            {adv ? 'Hide advanced' : 'Advanced'}
          </button>
          {adv && (
            <>
              <input
                className="input"
                type="password"
                placeholder="…or a personal access token (ghp_…)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && token.trim()) connectToken();
                }}
              />
              <div className="input-row">
                <button className="btn small" disabled={!token.trim()} onClick={connectToken}>
                  Connect with token
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
