const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function which(bin) {
  const extra = [path.join(os.homedir(), '.local', 'bin'), '/snap/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const parts = [...(process.env.PATH || '').split(':'), ...extra].filter(Boolean);
  for (const p of parts) {
    try {
      const full = path.join(p, bin);
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {}
  }
  return null;
}

// Allow user-space installs (e.g. xdotool extracted into ~/.local without sudo)
function toolEnv() {
  const localLib = path.join(os.homedir(), '.local', 'lib');
  const localBin = path.join(os.homedir(), '.local', 'bin');
  return {
    ...process.env,
    PATH: [localBin, '/snap/bin', process.env.PATH].filter(Boolean).join(':'),
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

function readOsRelease() {
  const info = { distro: 'Linux', version: '', codename: '', isUbuntu: false };
  try {
    const raw = fs.readFileSync('/etc/os-release', 'utf8');
    const get = (k) => {
      const m = new RegExp(`^${k}=["']?([^"'\\n]+)["']?`, 'm').exec(raw);
      return m ? m[1].trim() : '';
    };
    const pretty = get('PRETTY_NAME') || get('NAME') || 'Linux';
    const id = (get('ID') + ' ' + get('ID_LIKE')).toLowerCase();
    info.distro = pretty;
    info.version = get('VERSION_ID');
    info.codename = get('VERSION_CODENAME') || get('UBUNTU_CODENAME');
    info.isUbuntu = id.includes('ubuntu') || /ubuntu/i.test(pretty);
  } catch {}
  return info;
}

function detectUbuntu() {
  const osInfo = readOsRelease();
  const session = process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11');
  const desktop = process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '';
  const windowTools = ['wmctrl', 'xdotool', 'gdbus'].filter((b) => which(b));
  const clipboardTools = ['wl-copy', 'wl-paste', 'xclip', 'xsel'].filter((b) => which(b));
  const systemTools = [
    'apt-get',
    'apt-cache',
    'dpkg',
    'snap',
    'flatpak',
    'systemctl',
    'journalctl',
    'pkexec',
    'notify-send',
    'xdg-open',
    'gtk-launch',
    'ss',
    'ip',
    'ufw',
    'docker',
  ].filter((b) => which(b));

  return {
    ...osInfo,
    session,
    desktop: desktop || (osInfo.isUbuntu ? 'GNOME' : 'unknown'),
    display: process.env.DISPLAY || null,
    wayland: process.env.WAYLAND_DISPLAY || null,
    windowTools,
    clipboardTools,
    systemTools,
  };
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
  const ubuntu = detectUbuntu();
  return {
    session,
    display: process.env.DISPLAY || null,
    wayland: process.env.WAYLAND_DISPLAY || null,
    screenshotMethod: screenshotters[0] || null,
    screenshotCandidates: screenshotters,
    inputMethod: input[0] || null,
    inputCandidates: input,
    ubuntu,
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

/* ------------------------------ input ------------------------------ */

const YDOTOOL_KEYS = {
  Escape: '1', Esc: '1',
  '1': '2', '2': '3', '3': '4', '4': '5', '5': '6', '6': '7', '7': '8', '8': '9', '9': '10', '0': '11',
  minus: '12', equal: '13', Backspace: '14', Tab: '15',
  q: '16', w: '17', e: '18', r: '19', t: '20', y: '21', u: '22', i: '23', o: '24', p: '25',
  Return: '28', Enter: '28',
  ctrl: '29', Control_L: '29', Control: '29',
  a: '30', s: '31', d: '32', f: '33', g: '34', h: '35', j: '36', k: '37', l: '38',
  shift: '42', Shift_L: '42', Shift: '42',
  z: '44', x: '45', c: '46', v: '47', b: '48', n: '49', m: '50',
  alt: '56', Alt_L: '56', Alt: '56',
  Space: '57', space: '57',
  F1: '59', F2: '60', F3: '61', F4: '62', F5: '63', F6: '64',
  F7: '65', F8: '66', F9: '67', F10: '68', F11: '87', F12: '88',
  Home: '102', Up: '103', Page_Up: '104', PageUp: '104',
  Left: '105', Right: '106', End: '107', Down: '108',
  Page_Down: '109', PageDown: '109', Insert: '110', Delete: '111',
  super: '125', Super_L: '125', Meta_L: '125', win: '125',
};

function resolveYdotoolKeyArgs(keySpec) {
  const raw = String(keySpec || '').trim();
  if (!raw) return null;
  if (YDOTOOL_KEYS[raw]) {
    const code = YDOTOOL_KEYS[raw];
    return [`${code}:1`, `${code}:0`];
  }
  const parts = raw.split('+').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 1) {
    const codes = [];
    for (const part of parts) {
      const code = YDOTOOL_KEYS[part] || YDOTOOL_KEYS[part.toLowerCase()] || YDOTOOL_KEYS[part.toUpperCase()];
      if (!code) return null;
      codes.push(code);
    }
    const down = codes.map((c) => `${c}:1`);
    const up = [...codes].reverse().map((c) => `${c}:0`);
    return [...down, ...up];
  }
  return null;
}

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
        const keyArgs = resolveYdotoolKeyArgs(p.key);
        if (!keyArgs) throw new Error(`Key not mapped for ydotool: ${p.key}. Use xdotool for full key support.`);
        return [{ bin: Y, args: ['key', ...keyArgs] }];
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

/* ------------------------------ Ubuntu desktop actions ------------------------------ */

const DESKTOP_ACTIONS = new Set([
  'active_window',
  'list_windows',
  'focus_window',
  'launch_app',
  'open_url',
  'notify',
  'clipboard_get',
  'clipboard_set',
]);

async function desktopAction(action, params = {}) {
  const p = params || {};
  switch (action) {
    case 'active_window': {
      const x = which('xdotool');
      if (x) {
        const w = await run(x, ['getactivewindow', 'getwindowname']);
        if (!w.err && w.stdout.trim()) return { text: `Active window: ${w.stdout.trim()}`, ok: true };
      }
      const wm = which('wmctrl');
      if (wm) {
        const w = await run(wm, ['-lp']);
        if (!w.err && w.stdout.trim()) return { text: `Windows:\n${w.stdout.trim()}`, ok: true };
      }
      return { text: 'Could not read active window (install xdotool or wmctrl on Ubuntu).', ok: false };
    }
    case 'list_windows': {
      const wm = which('wmctrl');
      if (wm) {
        const r = await run(wm, ['-l']);
        if (!r.err) return { text: `Open Ubuntu desktop windows:\n${r.stdout.trim() || '(none)'}`, ok: true };
      }
      const x = which('xdotool');
      if (x) {
        const r = await run(x, ['search', '--onlyvisible', '--name', '.']);
        const ids = (r.stdout || '').trim().split(/\s+/).filter(Boolean).slice(0, 25);
        const names = [];
        for (const id of ids) {
          const n = await run(x, ['getwindowname', id]);
          if (n.stdout.trim()) names.push(`${id}: ${n.stdout.trim()}`);
        }
        return { text: `Visible windows (${names.length}):\n${names.join('\n') || '(none)'}`, ok: true };
      }
      return { text: 'No window listing tool found (install wmctrl or xdotool: `sudo apt install wmctrl xdotool`).', ok: false };
    }
    case 'focus_window': {
      const target = String(p.text || p.title || p.window || '').trim();
      if (!target) return { text: 'Error: provide window title/name in `text`.', ok: false };
      const wm = which('wmctrl');
      if (wm) {
        const r = await run(wm, ['-a', target]);
        if (!r.err) return { text: `Focused window matching "${target}" via wmctrl.`, ok: true };
      }
      const x = which('xdotool');
      if (x) {
        const r = await run(x, ['search', '--name', target, 'windowactivate']);
        if (!r.err) return { text: `Focused window matching "${target}" via xdotool.`, ok: true };
      }
      return { text: `Could not focus window "${target}".`, ok: false };
    }
    case 'launch_app': {
      const appName = String(p.text || p.app || '').trim();
      if (!appName) return { text: 'Error: provide application name or binary in `text`.', ok: false };
      const gtk = which('gtk-launch');
      if (gtk && !appName.includes(' ') && !appName.startsWith('/')) {
        const r = await run(gtk, [appName], 8000);
        if (!r.err) return { text: `Launched desktop application "${appName}" via gtk-launch.`, ok: true };
      }
      const bin = which(appName.split(/\s+/)[0]);
      if (bin) {
        const args = appName.split(/\s+/).slice(1);
        const child = spawn(bin, args, { detached: true, stdio: 'ignore', env: toolEnv() });
        child.unref();
        return { text: `Launched "${appName}" in background (PID ${child.pid}).`, ok: true };
      }
      return { text: `Application "${appName}" not found on PATH or desktop entries.`, ok: false };
    }
    case 'open_url': {
      const target = String(p.url || p.text || '').trim();
      if (!target) return { text: 'Error: provide URL or file path in `url` or `text`.', ok: false };
      const xdg = which('xdg-open');
      if (!xdg) return { text: 'xdg-open not available.', ok: false };
      const child = spawn(xdg, [target], { detached: true, stdio: 'ignore', env: toolEnv() });
      child.unref();
      return { text: `Opened "${target}" with xdg-open.`, ok: true };
    }
    case 'notify': {
      const body = String(p.text || '').trim();
      if (!body) return { text: 'Error: provide notification message in `text`.', ok: false };
      const ns = which('notify-send');
      if (!ns) return { text: 'notify-send not installed (`sudo apt install libnotify-bin`).', ok: false };
      const r = await run(ns, ['Nova IDE Agent', body], 8000);
      return { text: r.err ? `Notification failed: ${r.err.message}` : `Sent Ubuntu desktop notification: "${body}"`, ok: !r.err };
    }
    case 'clipboard_get': {
      if (which('wl-paste') && process.env.WAYLAND_DISPLAY) {
        const r = await run(which('wl-paste'), ['--no-newline'], 5000);
        if (!r.err) return { text: `Clipboard content:\n${r.stdout}`, ok: true };
      }
      if (which('xclip')) {
        const r = await run(which('xclip'), ['-selection', 'clipboard', '-o'], 5000);
        if (!r.err) return { text: `Clipboard content:\n${r.stdout}`, ok: true };
      }
      if (which('xsel')) {
        const r = await run(which('xsel'), ['--clipboard', '--output'], 5000);
        if (!r.err) return { text: `Clipboard content:\n${r.stdout}`, ok: true };
      }
      return { text: 'Clipboard read unavailable (install wl-clipboard or xclip).', ok: false };
    }
    case 'clipboard_set': {
      const val = String(p.text ?? '');
      const setWith = (bin, args) =>
        new Promise((resolve) => {
          try {
            const c = spawn(bin, args, { env: toolEnv(), stdio: ['pipe', 'ignore', 'pipe'] });
            c.stdin.write(val);
            c.stdin.end();
            c.on('close', (code) => resolve(code === 0));
            c.on('error', () => resolve(false));
          } catch {
            resolve(false);
          }
        });
      if (which('wl-copy') && process.env.WAYLAND_DISPLAY && (await setWith(which('wl-copy'), []))) {
        return { text: `Copied ${val.length} chars to Wayland clipboard.`, ok: true };
      }
      if (which('xclip') && (await setWith(which('xclip'), ['-selection', 'clipboard']))) {
        return { text: `Copied ${val.length} chars to X11 clipboard via xclip.`, ok: true };
      }
      if (which('xsel') && (await setWith(which('xsel'), ['--clipboard', '--input']))) {
        return { text: `Copied ${val.length} chars to X11 clipboard via xsel.`, ok: true };
      }
      return { text: 'Clipboard write unavailable (install wl-clipboard or xclip).', ok: false };
    }
    default:
      return { text: `Unknown desktop action: ${action}`, ok: false };
  }
}

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
  detectUbuntu,
  screenshotToFile,
  inputAction,
  desktopAction,
  DESKTOP_ACTIONS,
  which,
  screenSize,
  buildInputCommands,
  resolveYdotoolKeyArgs,
  clampPoint,
  parsePoints,
};
