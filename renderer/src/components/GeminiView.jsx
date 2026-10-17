import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

/**
 * Gemini Web tab — the signed-in gemini.google.com app, embedded with its own
 * persistent session (partition "persist:gemini").
 *
 * Nova's agent + chat can use this very tab as a model ("Gemini Web" provider,
 * auth: 'gemini-web'): the driver in electron/gemini-web.js attaches to this
 * webview and drives the UI. So sign in here once and both you AND the agent
 * can use your Google account / Pro subscription.
 *
 * Keep this component always mounted (App renders it; the `active` prop only
 * toggles visibility) — an unmounted webview would lose its page state.
 */
export default function GeminiView({ active }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState('https://gemini.google.com/app');
  const setStatusMsg = useStore((s) => s.setStatus);

  useEffect(() => {
    const wv = ref.current;
    if (!wv || !wv.addEventListener) return;

    const report = () => {
      try {
        const id = wv.getWebContentsId();
        if (id) {
          window.nova.reportGeminiWebview(id);
          setReady(true);
        }
      } catch {
        /* webview not attached yet */
      }
    };
    const onNav = (e) => {
      if (e && e.url) setUrl(e.url);
      // Navigation may attach a new webContents (reload / crash recovery).
      report();
    };

    wv.addEventListener('dom-ready', report);
    wv.addEventListener('did-finish-load', report);
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    // In case it already finished loading before React attached listeners.
    try {
      if (wv.getWebContentsId()) report();
    } catch {}

    return () => {
      wv.removeEventListener('dom-ready', report);
      wv.removeEventListener('did-finish-load', report);
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
    };
  }, []);

  useEffect(() => {
    if (!window.nova?.onGeminiSignedIn) return;
    const unsub = window.nova.onGeminiSignedIn((info) => {
      if (ref.current) {
        ref.current.loadURL('https://gemini.google.com/app');
      }
      // Signed in with Google -> make Gemini models usable right away.
      if (!info || info.ok !== false) useStore.getState().ensureGeminiWebModel();
    });
    return unsub;
  }, []);

  const [drv, setDrv] = useState(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      window.nova
        .geminiStatus()
        .then((s) => {
          if (alive) setDrv(s);
        })
        .catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const signedInHint = /accounts\.google\.com/.test(url);
  const drvBadge = !drv
    ? 'driver: …'
    : drv.ok && drv.hasEditor
      ? 'driver: ready'
      : drv.error
        ? `driver: ${String(drv.error).slice(0, 90)}`
        : drv.hasEditor
          ? 'driver: ready'
          : 'driver: editor not found';

  return (
    <div className={'gemini-view' + (active ? '' : ' gw-offscreen')}>
      <div className="gemini-toolbar">
        <span className="gemini-brand">{'\u{1F310}'} Gemini Web</span>
        <span className="gemini-sub">
          {signedInHint
            ? 'Sign in karo — usi Google account se Nova agent bhi Gemini use karega.'
            : 'Connected with your Google Account. 💡 Tip: Upar model dropdown se Gemini 4 / Advanced select karo, Nova Agent wahi use karega!'}
        </span>
        <div className="spacer" />
        <span
          className="gemini-drv"
          title={drv ? JSON.stringify(drv) : ''}
          style={{ color: drv && drv.ok && drv.hasEditor ? '#4ade80' : '#f2a1a4' }}
        >
          {drvBadge}
        </span>
        {!ready && <span className="muted small">loading…</span>}
        <button
          className="btn small"
          style={{ background: '#1a73e8', color: '#ffffff', fontWeight: 600, border: 'none' }}
          title="Open secure Google login window (bypasses browser security check)"
          onClick={() => window.nova.openGeminiLoginWindow()}
        >
          🔑 Sign In with Google
        </button>
        <button
          className="btn small"
          title="Re-run Nova's thread tracking + Gemini me nayi chat"
          onClick={async () => {
            const r = await window.nova.geminiNewChat();
            setStatusMsg(r && r.ok ? 'Nayi Gemini chat shuru.' : `Gemini new chat: ${(r && r.error) || 'failed'}`);
          }}
        >
          + New chat
        </button>
        <button className="btn small" title="Reload the page" onClick={() => ref.current && ref.current.reload()}>
          Reload
        </button>
        <button
          className="btn small"
          title="Fresh home page"
          onClick={() => ref.current && ref.current.loadURL('https://gemini.google.com/app')}
        >
          Home
        </button>
      </div>
      {signedInHint && (
        <div style={{ background: '#2d1d02', color: '#ffd56b', padding: '9px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #644405' }}>
          <span>
            ⚠️ <b>Google Security Notice:</b> Embedded browser me "browser not secure" aa sakta hai. Upar ya yahan <b>Sign In with Google</b> par click karo — direct clean window me sign in ho jayega!
          </span>
          <button
            className="btn small"
            style={{ background: '#1a73e8', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 600, cursor: 'pointer', borderRadius: 4 }}
            onClick={() => window.nova.openGeminiLoginWindow()}
          >
            🔑 Sign In with Google
          </button>
        </div>
      )}
      <webview
        ref={ref}
        className="gemini-frame"
        partition="persist:gemini"
        useragent={window.nova.chromeUA || undefined}
        src="https://gemini.google.com/app"
        allowpopups="true"
        webpreferences="backgroundThrottling=no"
      />
    </div>
  );
}
