/**
 * Google Picker.
 *
 * Why this exists: Nova's Drive access is `drive.file` (least privilege), so it
 * can only see files it created. Google grants per-file access only through the
 * Picker — that is the one supported way for the user to hand the app a file it
 * did not create. Picking a file is what makes it readable afterwards.
 *
 * Why a separate window and a loopback server, instead of loading the Picker in
 * the renderer: the Picker needs the `apis.google.com` script and a real origin.
 * The renderer has a strict CSP, and a `file://` origin is rejected by Google.
 * A short-lived http server on 127.0.0.1 gives a legitimate origin and keeps the
 * Picker fully outside the app's own page — the same pattern the OAuth flow in
 * gdrive.ts already uses.
 *
 * The access token is written into the served page. That page only exists on
 * 127.0.0.1 on an ephemeral port for the lifetime of one pick, and the token is
 * already being handed to Google by the Picker itself. It is never logged.
 */

const http = require('node:http');
const { BrowserWindow } = require('electron');
const gdrive = require('./gdrive');

interface PickResult {
  ok: boolean;
  file?: { id: string; name: string };
  error?: string;
  needsApiKey?: boolean;
  steps?: string[];
  cancelled?: boolean;
}

/** "695004570637-abc.apps.googleusercontent.com" -> "695004570637" */
function projectNumberFromClientId(clientId: string): string {
  const m = /^(\d+)-/.exec(String(clientId || ''));
  return m ? m[1] : '';
}

function esc(v: any): string {
  return JSON.stringify(String(v == null ? '' : v)).replace(/</g, '\\u003c');
}

const API_KEY_STEPS = [
  'Google Cloud Console -> APIs & Services -> Credentials -> Create credentials -> API key',
  'Restrict the key: Application restrictions -> None is fine for local desktop use, but set an API restriction of "Google Picker API".',
  'Enable the "Google Picker API" for the project (APIs & Services -> Library).',
  'Put the key in Nova: set NOVA_GOOGLE_API_KEY, or paste it in Settings -> Cloud -> Picker API key.',
];

function pickerHtml(token: string, apiKey: string, appId: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Open from Drive</title>
<style>
  body { font-family: system-ui, sans-serif; background: #1b1b1f; color: #e6e6ea; display: flex;
         align-items: center; justify-content: center; height: 100vh; margin: 0; }
  #msg { font-size: 14px; opacity: .85; }
</style>
</head>
<body>
<div id="msg">Loading Google Drive\u2026</div>
<script src="https://apis.google.com/js/api.js"></script>
<script>
  var TOKEN = ${esc(token)};
  var KEY = ${esc(apiKey)};
  var APPID = ${esc(appId)};
  function show(t) { document.getElementById('msg').textContent = t; }
  if (!window.gapi) {
    show('Could not load the Google Picker script. Check the internet connection and reload.');
  } else {
    window.gapi.load('picker', { callback: function () {
      try {
        var view = new google.picker.DocsView(google.picker.ViewId.DOCS);
        var picker = new google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(TOKEN)
          .setDeveloperKey(KEY)
          .setAppId(APPID)
          .setCallback(function (data) {
            if (data.action === google.picker.Action.PICKED && data.docs && data.docs.length) {
              var f = data.docs[0];
              window.location = '/picked?id=' + encodeURIComponent(f.id) + '&name=' + encodeURIComponent(f.name || '');
            } else if (data.action === google.picker.Action.CANCEL) {
              window.location = '/cancel';
            }
          })
          .build();
        picker.setVisible(true);
        show('Pick a file to open in Nova\u2026');
      } catch (e) {
        show('Picker error: ' + (e && e.message ? e.message : String(e)));
      }
    }});
  }
</script>
</body>
</html>`;
}

/**
 * Open the Picker and resolve with the file the user chose.
 * With `drive.file` scope, choosing a file is what grants Nova access to it.
 */
async function pickFile(opts: { apiKey?: string; parent?: any; timeoutMs?: number } = {}): Promise<PickResult> {
  const apiKey = String(opts.apiKey || process.env.NOVA_GOOGLE_API_KEY || '').trim();
  const status: any = await gdrive.status();
  if (!status || !status.connected) {
    return { ok: false, error: 'Not connected to Google. Sign in from Settings -> Cloud first.' };
  }
  if (!apiKey) {
    return { ok: false, needsApiKey: true, error: 'The Picker needs a Google API key.', steps: API_KEY_STEPS };
  }

  let token: string;
  try {
    token = await gdrive.getAccessToken();
  } catch (e: any) {
    return { ok: false, error: `Could not get an access token: ${e && e.message ? e.message : e}` };
  }
  if (!token) return { ok: false, error: 'No access token — sign in again.' };

  const appId = projectNumberFromClientId(status.clientId || '');
  const timeoutMs = opts.timeoutMs || 5 * 60 * 1000;

  return new Promise<PickResult>((resolve) => {
    let settled = false;
    let win: any = null;
    let timer: any = null;

    const server = http.createServer((req: any, res: any) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pickerHtml(token, apiKey, appId));
        return;
      }
      if (url.pathname === '/picked') {
        const id = url.searchParams.get('id') || '';
        const name = url.searchParams.get('name') || '';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Nova: file selected \u2713 \u2014 this window can close.</h2>');
        finish({ ok: true, file: { id, name } });
        return;
      }
      if (url.pathname === '/cancel') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Nova: nothing selected.</h2>');
        finish({ ok: false, cancelled: true, error: 'No file selected.' });
        return;
      }
      res.writeHead(404).end('not found');
    });

    const finish = (result: PickResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        server.close();
      } catch {}
      try {
        if (win && !win.isDestroyed()) win.destroy();
      } catch {}
      resolve(result);
    };

    server.on('error', (e: any) => finish({ ok: false, error: `Local server error: ${e && e.message ? e.message : e}` }));
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      win = new BrowserWindow({
        width: 1000,
        height: 700,
        parent: opts.parent || undefined,
        modal: Boolean(opts.parent),
        title: 'Open from Drive',
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      win.on('closed', () => finish({ ok: false, cancelled: true, error: 'Picker window closed.' }));
      win.loadURL(`http://127.0.0.1:${port}/`);
      timer = setTimeout(() => finish({ ok: false, cancelled: true, error: 'Picker timed out.' }), timeoutMs);
    });
  });
}

module.exports = { pickFile, projectNumberFromClientId, API_KEY_STEPS, pickerHtml };
