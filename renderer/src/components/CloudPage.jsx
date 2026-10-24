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
          <button
            className="btn small"
            title="Pick a file from your Drive to open in Nova (asks Google for access to just that file)"
            onClick={() => useStore.getState().pickDriveFile()}
          >
            Open from Drive…
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
      {header(
        <span>
          Connected{drive.email ? ` as ${drive.email}` : ''} &middot;{' '}
          {drive.needsReconsent ? (
            <span style={{ color: 'var(--warning, #eab308)', fontWeight: 500 }}>
              ⚠️ Full Drive scope (Re-consent recommended)
            </span>
          ) : (
            <span style={{ color: 'var(--accent)', fontWeight: 500 }}>
              🔒 Isolated to &quot;Nova IDE&quot; folder
            </span>
          )}
        </span>
      )}
      {drive.needsReconsent && (
        <div
          className="cloud-reconsent-banner"
          style={{
            padding: '12px 16px',
            background: 'rgba(234, 179, 8, 0.12)',
            border: '1px solid rgba(234, 179, 8, 0.35)',
            borderRadius: 6,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: '18px', lineHeight: 1 }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                Access level badla — Re-consent zaroori hai
              </div>
              <p className="muted small" style={{ margin: 0, lineHeight: 1.4 }}>
                Aapka current token purane broad (<b>drive.readonly</b>) scope se connected hai, jisse poori Google Drive readable hai.
                Naye privacy-safe isolated (<b>drive.file</b>) mode me aane ke liye sign out karke dobara sign in karein.
              </p>
            </div>
          </div>
          <button
            className="btn small primary"
            style={{ flexShrink: 0 }}
            onClick={async () => {
              await useStore.getState().driveSignOut();
              await useStore.getState().driveSignIn();
            }}
          >
            Re-connect Now
          </button>
        </div>
      )}
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
      {!drive.loading && drive.files.length === 0 && !drive.error && (
        <div className="auto-empty" style={{ marginTop: 24, textAlign: 'center', padding: '32px 20px' }}>
          <div className="auto-empty-ico" style={{ fontSize: '32px', marginBottom: 12 }}>🔒</div>
          <div className="auto-empty-title" style={{ fontSize: '16px', fontWeight: 600, marginBottom: 8 }}>
            Isolated Nova Cloud Storage
          </div>
          <p className="muted small" style={{ maxWidth: 520, margin: '0 auto 12px', lineHeight: 1.6 }}>
            Aapki privacy secure rakhne ke liye Nova IDE aapki personal Google Drive files (Aadhaar, certificates, personal docs) ko hide rakhta hai. IDE sirf <b>&quot;Nova IDE&quot;</b> folder ko access karta hai.
          </p>
          <p className="muted small" style={{ maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Apne Google Drive me <b>&quot;Nova IDE&quot;</b> naam ka folder banayein aur usme jo project files dalenge, sirf wahi yahan dikhengi.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              className="btn small"
              onClick={() => window.nova?.openExternal && window.nova.openExternal('https://drive.google.com/drive/my-drive')}
            >
              Open Google Drive ↗
            </button>
            <button className="btn small danger" onClick={() => useStore.getState().driveSignOut()}>
              Sign out from Drive
            </button>
          </div>
          <div
            style={{
              marginTop: 28,
              padding: '12px 16px',
              background: 'var(--bg-elevated)',
              borderRadius: 6,
              maxWidth: 520,
              margin: '28px auto 0',
              textAlign: 'left',
              fontSize: '12px',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
              ⚡ Gemini AI Models use karne ke liye:
            </div>
            <div className="muted" style={{ lineHeight: 1.5 }}>
              Agar aap Google account ko Gemini models (Gemini 2.5 Flash, Gemini 1.5 Pro, etc.) ke liye use karna chahte hain, toh Settings (&quot;Ctrl+,&quot;) &rarr; <b>Models</b> me jakar free Google AI Studio key add karein. Uske liye Google Drive connect karne ki bilkul zaroorat nahi hoti.
            </div>
          </div>
        </div>
      )}
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
