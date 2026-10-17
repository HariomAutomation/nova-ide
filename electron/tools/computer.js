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

/** Current screen size in pixels, via xdotool (null when unavailable). */
async function screenSize() {
  const x = which('xdotool');
  if (!x) return null;
  const r = await run(x, ['getdisplaygeometry']);
  const m = /(\d+)\s+(\d+)/.exec(r.stdout || '');
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/* ------------------------------ pure helpers ------------------------------ */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Parse {x,y} / {to_x,to_y} from tool params, rounding and rejecting NaN. */
function parsePoints(params = {}) {
  return {
    x: num(params.x),
    y: num(params.y),
    toX: num(params.to_x),
    toY: num(params.to_y),
  };
}

/** Clamp a point into a screen box (no-op when the size is unknown). */
function clampPoint(x, y, size) {
  if (!size || x == null || y == null) return { x, y };
  return {
    x: Math.min(Math.max(x, 0), Math.max(0, size.width - 1)),
    y: Math.min(Math.max(y, 0), Math.max(0, size.height - 1)),
  };
}

const SCROLL_BUTTON = { up: '4', down: '5', left: '6', right: '7' };
const YDOTOOL_BUTTON = { 1: '0xC0', 2: '0xC1', 3: '0xC2' };

/**
 * Build the concrete shell commands for one desktop-input action.
 *
 * Pure and side-effect free so it can be unit-tested without a display — the
 * actual execution is `inputAction` below. Returns `[{bin, args}]` (an empty
 * array means "nothing to do"); throws a descriptive error for an unsupported
 * action/backend combination.
 */
function buildInputCommands(action, params = {}, cap = {}) {
  const method = cap.inputMethod;
  const p = params || {};
  const { x, y, toX, toY } = parsePoints(p);
  const scrollDir = SCROLL_BUTTON[p.direction] ? p.direction : 'down';
  const scrollAmount = Math.max(1, Math.min(num(p.amount) || 3, 50));

  if (method === 'xdotool') {
    const X = 'xdotool';
    switch (action) {
      case 'move':
        if (x == null || y == null) return [];
        return [{ bin: X, args: ['mousemove', String(x), String(y)] }];
      case 'click':
      case 'double_click':
      case 'right_click': {
        const button = action === 'right_click' ? '3' : p.button === 3 ? '3' : p.button === 2 ? '2' : '1';
        const repeat = action === 'double_click' || p.double ? '2' : '1';
        const args = [];
        if (x != null && y != null) args.push('mousemove', String(x), String(y));
        args.push('click', '--repeat', repeat, '--delay', '60', button);
        return [{ bin: X, args }];
      }
      case 'drag': {
        if (x == null || y == null || toX == null || toY == null) return [];
        return [
          {
            bin: X,
            args: ['mousemove', String(x), String(y), 'mousedown', '1', 'mousemove', '--sync', String(toX), String(toY), 'mouseup', '1'],
            timeoutMs: 30000,
          },
        ];
      }
      case 'scroll': {
        const args = [];
        if (x != null && y != null) args.push('mousemove', String(x), String(y));
        args.push('click', '--repeat', String(scrollAmount), '--delay', '30', SCROLL_BUTTON[scrollDir]);
        return [{ bin: X, args }];
      }
      case 'type':
        return [{ bin: X, args: ['type', '--delay', String(num(p.delay) ?? 12), String(p.text ?? '')], timeoutMs: 60000 }];
      case 'key':
        return [{ bin: X, args: ['key', String(p.key || 'Return')] }];
      default:
        throw new Error(`Unknown computer action: ${action}`);
    }
  }

  if (method === 'ydotool') {
    const Y = 'ydotool';
    const moveTo = (px, py) => ({ bin: Y, args: ['mousemove', '--absolute', '-x', String(px), '-y', String(py)] });
    switch (action) {
      case 'move':
        if (x == null || y == null) return [];
        return [moveTo(x, y)];
      case 'click':
      case 'right_click': {
        const code = action === 'right_click' ? '0xC1' : YDOTOOL_BUTTON[p.button] || '0xC0';
        const cmds = [];
        if (x != null && y != null) cmds.push(moveTo(x, y));
        cmds.push({ bin: Y, args: ['click', code] });
        return cmds;
      }
      case 'double_click': {
        const cmds = [];
        if (x != null && y != null) cmds.push(moveTo(x, y));
        cmds.push({ bin: Y, args: ['click', '0xC0'] }, { bin: Y, args: ['click', '0xC0'] });
        return cmds;
      }
      case 'type':
        return [{ bin: Y, args: ['type', '--key-delay', String(num(p.delay) ?? 12), String(p.text ?? '')], timeoutMs: 60000 }];
      case 'key': {
        const code = YDOTOOL_KEYS[p.key];
        if (!code) throw new Error(`Key not mapped for ydotool: ${p.key}. Use xdotool for full key support.`);
        return [{ bin: Y, args: ['key', `${code}:1`, `${code}:0`] }];
      }
      case 'drag':
      case 'scroll':
        throw new Error(`${action} is not supported by ydotool. Install xdotool (works under X11/XWayland) for this action.`);
      default:
        throw new Error(`Unknown computer action: ${action}`);
    }
  }

  throw new Error(
    `No input tool available (session: ${cap.session || 'unknown'}). Install xdotool (X11) or ydotool (Wayland, needs uinput daemon). ` +
      `On GNOME Wayland: sudo apt install ydotoold, then enable the ydotool user service.`
  );
}

/* ------------------------------ screenshots ------------------------------ */

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

/* ------------------------------ input ------------------------------ */

const YDOTOOL_KEYS = {
  Return: '28', Enter: '28', Escape: '1', Tab: '15', Space: '57', Backspace: '14',
  Up: '103', Down: '108', Left: '105', Right: '106',
};

/**
 * Execute one desktop-input action. Coordinates are clamped to the detected
 * screen when known. Returns { method, commands } — the caller decides whether
 * to capture a fresh screenshot afterwards.
 */
async function inputAction(action, params = {}) {
  const cap = detect();
  const p = { ...(params || {}) };

  // Clamp click/drag coordinates into the screen box (best-effort).
  if (cap.inputMethod === 'xdotool' && (p.x != null || p.y != null)) {
    const size = await screenSize();
    if (size) {
      const a = clampPoint(num(p.x), num(p.y), size);
      p.x = a.x;
      p.y = a.y;
      if (p.to_x != null || p.to_y != null) {
        const b = clampPoint(num(p.to_x), num(p.to_y), size);
        p.to_x = b.x;
        p.to_y = b.y;
      }
    }
  }

  const cmds = buildInputCommands(action, p, cap);
  if (!cmds.length) throw new Error(`computer_use ${action}: missing coordinates (need x and y).`);
  for (const c of cmds) {
    const full = which(c.bin);
    if (!full) throw new Error(`${c.bin} not found on PATH.`);
    const r = await run(full, c.args, c.timeoutMs || 30000);
    if (r.err && r.err.code !== undefined && r.err.code !== 0) {
      throw new Error(`${c.bin} ${c.args[0]} failed: ${r.err.message}`);
    }
  }
  return { method: cap.inputMethod, commands: cmds.length };
}

module.exports = {
  detect,
  screenshotToFile,
  inputAction,
  which,
  screenSize,
  buildInputCommands,
  clampPoint,
  parsePoints,
};
