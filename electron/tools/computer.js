const { execFile, spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function which(bin) {
  const parts = (process.env.PATH || '').split(':');
  for (const p of parts) {
    try {
      const full = path.join(p, bin);
      require('node:fs').accessSync(full, require('node:fs').constants.X_OK);
      return full;
    } catch {}
  }
  return null;
}

// Allow user-space installs (e.g. xdotool extracted into ~/.local without sudo)
function toolEnv() {
  const localLib = path.join(os.homedir(), '.local', 'lib');
  return {
    ...process.env,
    LD_LIBRARY_PATH: [localLib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  };
}

function run(bin, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: toolEnv() }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function detect() {
  const session = process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11');
  const screenshotters = [];
  if (which('gnome-screenshot')) screenshotters.push('gnome-screenshot');
  if (which('grim')) screenshotters.push('grim');
  if (which('scrot')) screenshotters.push('scrot');
  const input = [];
  if (which('ydotool')) input.push('ydotool');
  if (which('xdotool')) input.push('xdotool');
  return {
    session,
    display: process.env.DISPLAY || null,
    wayland: process.env.WAYLAND_DISPLAY || null,
    screenshotMethod: screenshotters[0] || null,
    screenshotCandidates: screenshotters,
    inputMethod: input[0] || null,
    inputCandidates: input,
  };
}

async function screenshotToFile(dir) {
  const cap = detect();
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `screen_${Date.now()}.png`);

  // On Wayland the xdg-desktop-portal is the reliable path (GNOME asks the user
  // once per capture via a Share dialog).
  if (cap.session === 'wayland') {
    try {
      const r = await portalScreenshot(dir, file);
      if (r) return r;
    } catch {}
  }

  const attempts = [];
  if (cap.screenshotCandidates.includes('gnome-screenshot')) {
    attempts.push(['gnome-screenshot', ['-f', file]]);
  }
  if (cap.screenshotCandidates.includes('grim')) {
    attempts.push(['grim', [file]]);
  }
  if (cap.screenshotCandidates.includes('scrot')) {
    attempts.push(['scrot', [file]]);
  }

  // GNOME Shell D-Bus fallback (works on some GNOME versions)
  if (which('gdbus')) {
    attempts.push([
      'gdbus',
      [
        'call', '--session',
        '--dest', 'org.gnome.Shell.Screenshot',
        '--object-path', '/org/gnome/Shell/Screenshot',
        '--method', 'org.gnome.Shell.Screenshot.Screenshot',
        'false', 'false', file,
      ],
    ]);
  }

  const errors = [];
  for (const [bin, args] of attempts) {
    const full = which(bin);
    if (!full) continue;
    try {
      const r = await run(full, args, 20000);
      const stat = await fsp.stat(file).catch(() => null);
      if (stat && stat.size > 0) {
        return { file, method: bin, bytes: stat.size };
      }
      if (r.err) errors.push(`${bin}: ${r.err.message}`);
    } catch (e) {
      errors.push(`${bin}: ${e.message}`);
    }
  }

  // xdg-desktop-portal Screenshot (GNOME Wayland): shows a permission dialog,
  // then the portal saves the PNG and emits Response(uri) on the request object.
  try {
    const r = await portalScreenshot(dir, file);
    if (r) return r;
  } catch (e) {
    errors.push(`portal: ${e.message}`);
  }

  throw new Error(
    `Screenshot failed. Tried: ${attempts.map((a) => a[0]).join(', ') || 'nothing'}. ${errors.join(' | ')}`
  );
}

function portalScreenshot(dir, targetFile) {
  return new Promise((resolve, reject) => {
    const gdbus = which('gdbus');
    if (!gdbus) return reject(new Error('gdbus missing'));

    const token = `nova_${Date.now()}`;
    const opts = `{'handle_token': <'${token}'>, 'interactive': <true>}`;

    run(
      gdbus,
      [
        'call', '--session',
        '--dest', 'org.freedesktop.portal.Desktop',
        '--object-path', '/org/freedesktop/portal/desktop',
        '--method', 'org.freedesktop.portal.Screenshot.Screenshot',
        '', opts,
      ],
      10000
    ).then((callRes) => {
      const reqPath = (callRes.stdout.match(/'([^']+)'/) || [])[1];
      if (!reqPath) return reject(new Error(callRes.err ? callRes.err.message : 'no request handle'));

      const mon = spawn(gdbus, ['monitor', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', reqPath]);
      let out = '';
      const done = async (err, result) => {
        clearTimeout(timer);
        try { mon.kill(); } catch {}
        if (err) reject(err);
        else resolve(result);
      };
      const timer = setTimeout(
        () => done(new Error('portal screenshot timed out — approve the on-screen share dialog (GNOME Wayland asks once per capture)')),
        60000
      );

      mon.stdout.on('data', async (d) => {
        out += String(d);
        if (!out.includes('Response')) return;
        const uri = (out.match(/uri':\s*<'([^']+)'/) || [])[1];
        const code = (out.match(/Response'\s*\(uint32 (\d+)/) || [])[1];
        if (code !== '0' || !uri) return done(new Error(`portal response code ${code ?? '?'}`));
        try {
          const src = decodeURIComponent(uri.replace(/^file:\/\//, ''));
          await fsp.copyFile(src, targetFile);
          const stat = await fsp.stat(targetFile);
          done(null, { file: targetFile, method: 'portal', bytes: stat.size });
        } catch (e) {
          done(e);
        }
      });
      mon.on('error', (e) => done(e));
    }).catch(reject);
  });
}

const YDOTOOL_KEYS = {
  Return: '28', Enter: '28', Escape: '1', Tab: '15', Space: '57', Backspace: '14',
  Up: '103', Down: '108', Left: '105', Right: '106',
};

async function inputAction(action, params = {}) {
  const cap = detect();

  if (cap.inputMethod === 'xdotool') {
    const x = which('xdotool');
    switch (action) {
      case 'move':
        return run(x, ['mousemove', String(params.x | 0), String(params.y | 0)]);
      case 'click':
        if (params.x != null) await run(x, ['mousemove', String(params.x | 0), String(params.y | 0)]);
        return run(x, ['click', String(params.button || 1)]);
      case 'type':
        return run(x, ['type', '--delay', '12', String(params.text ?? '')], 60000);
      case 'key':
        return run(x, ['key', String(params.key || 'Return')]);
      default:
        throw new Error(`Unknown computer action: ${action}`);
    }
  }

  if (cap.inputMethod === 'ydotool') {
    const y = which('ydotool');
    switch (action) {
      case 'move':
        return run(y, ['mousemove', '--absolute', '-x', String(params.x | 0), '-y', String(params.y | 0)]);
      case 'click': {
        if (params.x != null) await run(y, ['mousemove', '--absolute', '-x', String(params.x | 0), '-y', String(params.y | 0)]);
        const btn = params.button === 3 ? '0xC2' : params.button === 2 ? '0xC1' : '0xC0';
        return run(y, ['click', btn]);
      }
      case 'type':
        return run(y, ['type', '--key-delay', '12', String(params.text ?? '')], 60000);
      case 'key': {
        const code = YDOTOOL_KEYS[params.key];
        if (!code) throw new Error(`Key not mapped for ydotool: ${params.key}. Use xdotool names or install xdotool.`);
        return run(y, ['key', `${code}:1`, `${code}:0`]);
      }
      default:
        throw new Error(`Unknown computer action: ${action}`);
    }
  }

  throw new Error(
    `No input tool available (session: ${cap.session}). Install xdotool (X11) or ydotool (Wayland, needs uinput daemon). ` +
      `On GNOME Wayland: sudo apt install ydotoold, then enable the ydotool user service.`
  );
}

module.exports = { detect, screenshotToFile, inputAction, which };
