import { useEffect, useState } from 'react';
import { useStore } from '../store';

function fmtSize(n) {
  const b = Number(n);
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function CloudPage() {
  const drive = useStore((s) => s.drive);
  const [q, setQ] = useState('');

  useEffect(() => {
    useStore
      .getState()
      .loadDrive()
      .then(() => {
        if (useStore.getState().drive.connected) useStore.getState().loadDriveFiles('');
      });
  }, []);

  const header = (sub) => (
    <div className="page-header wide">
      <div>
        <h1>Cloud</h1>
        <p className="muted">{sub}</p>
      </div>
      {drive.connected && (
        <div className="sc-actions">
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="Search Drive…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') useStore.getState().loadDriveFiles(q);
            }}
          />
          <button className="btn small" onClick={() => useStore.getState().loadDriveFiles(q)}>
            Search
          </button>
          <button className="btn-icon" title="Refresh" onClick={() => useStore.getState().loadDriveFiles(q)}>
            {'\u21BB'}
          </button>
          <button className="btn small danger" onClick={() => useStore.getState().driveSignOut()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );

  if (!drive.connected) {
    return (
      <div className="page-main">
        {header('Connect Google Drive to read your cloud files right in the IDE.')}
        <div className="auto-empty">
          <div className="auto-empty-ico">{'\u2601\uFE0F'}</div>
          <div className="auto-empty-title">Cloud not connected</div>
          <p className="muted small">
            Sign in with Google once (read-only Drive access). After that Nova can list and open your cloud files any
            time — nothing else to set up.
          </p>
          <button className="btn primary" onClick={() => useStore.getState().setSettingsOpen(true, 'cloud')}>
            Connect in Settings → Cloud
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-main">
      {header(`Connected${drive.email ? ` as ${drive.email}` : ''} \u00B7 read-only`)}
      {drive.error && (
        <div
          className="search-error"
          style={{
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'flex-start',
            padding: '12px 16px',
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <div>
            <strong>Google Drive Error:</strong> {drive.error}
          </div>
          {drive.error.match(/https?:\/\/[^\s"]+/) && (
            <button
              className="btn small"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={() => {
                const url = (drive.error.match(/https?:\/\/[^\s"]+/) || [])[0];
                if (url && window.nova?.openExternal) {
                  window.nova.openExternal(url);
                } else if (url) {
                  window.open(url, '_blank');
                }
              }}
            >
              🔗 Enable Google Drive API in Google Cloud Console
            </button>
          )}
        </div>
      )}
      {drive.loading && <p className="muted">Loading…</p>}
      {!drive.loading && drive.files.length === 0 && !drive.error && <p className="muted">No files found.</p>}
      <div className="cloud-list">
        {drive.files.map((f) => (
          <div key={f.id} className="cloud-row">
            <span className="cloud-ico">
              {String(f.mimeType || '').includes('folder') ? '\u{1F4C1}' : '\u{1F4C4}'}
            </span>
            <button className="sc-path" title={f.name} onClick={() => useStore.getState().openCloudFile(f)}>
              {f.name}
            </button>
            <span className="muted small">{fmtSize(f.size)}</span>
            <button className="btn small" onClick={() => useStore.getState().openCloudFile(f)}>
              Open
            </button>
            <button className="btn small" onClick={() => useStore.getState().downloadCloudFile(f)}>
              Download
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
