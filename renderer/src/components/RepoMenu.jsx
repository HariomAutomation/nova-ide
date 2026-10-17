import { useEffect, useState } from 'react';
import { useStore } from '../store';

/**
 * GitHub repository picker — shared by the sidebar "+" and the composer's repo
 * chip.
 *
 * Sign in with GitHub is one click: the browser opens, you approve, and Nova
 * picks up the token automatically (GitHub device flow — no client secret).
 * A personal-access-token option is kept under "Advanced".
 */
export default function RepoMenu({ onClose }) {
  const github = useStore((s) => s.github);
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
      <div className="rp-head">Repositories</div>

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
                <button className="btn small" onClick={openLocal}>
                  Open local folder…
                </button>
              </div>
              <div className="rp-hint muted small">
                GitHub → Settings → Developer settings → <b>OAuth Apps</b> → New OAuth App. Device flow needs only the
                client ID (no secret, no callback URL).
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
