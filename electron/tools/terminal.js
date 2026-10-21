const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const MAX_OUTPUT = 200 * 1024;

/**
 * Build a non-interactive, Ubuntu-friendly environment for shell commands:
 * - Ensures ~/.local/bin and /snap/bin are on PATH (often missing when Electron
 *   launches from a GNOME .desktop entry on Ubuntu).
 * - Sets DEBIAN_FRONTEND=noninteractive, NEEDRESTART_MODE=a, PAGER=cat,
 *   SYSTEMD_PAGER=cat, and GIT_TERMINAL_PROMPT=0 so apt, systemctl, journalctl,
 *   and git never hang waiting for interactive TTY input.
 */
function buildUbuntuEnv(baseEnv = process.env) {
  const env = { ...(baseEnv || process.env) };
  const home = env.HOME || os.homedir();
  const extraPaths = [
    path.join(home, '.local', 'bin'),
    '/snap/bin',
    '/usr/local/sbin',
    '/usr/local/bin',
    '/usr/sbin',
    '/usr/bin',
    '/sbin',
    '/bin',
  ];
  const currentParts = String(env.PATH || '')
    .split(':')
    .filter(Boolean);
  for (const p of extraPaths) {
    if (!currentParts.includes(p)) currentParts.push(p);
  }
  env.PATH = currentParts.join(':');
  if (!env.DEBIAN_FRONTEND) env.DEBIAN_FRONTEND = 'noninteractive';
  if (!env.NEEDRESTART_MODE) env.NEEDRESTART_MODE = 'a';
  if (!env.APT_LISTCHANGES_FRONTEND) env.APT_LISTCHANGES_FRONTEND = 'none';
  if (!env.GIT_TERMINAL_PROMPT) env.GIT_TERMINAL_PROMPT = '0';
  if (!env.SYSTEMD_PAGER) env.SYSTEMD_PAGER = 'cat';
  if (!env.PAGER) env.PAGER = 'cat';
  return env;
}

/**
 * Diagnose common Ubuntu command failures and return a concise, actionable hint
 * for the agent (or '' when no special hint applies).
 */
function diagnoseUbuntuCommand({ command = '', code = 0, stdout = '', stderr = '', timedOut = false } = {}) {
  if (code === 0 && !timedOut) return '';
  const combined = `${stdout}\n${stderr}`;

  if (/sudo:\s*(a terminal is required|no tty present|a password is required)/i.test(combined)) {
    return (
      '[Ubuntu Hint] `sudo` failed because there is no interactive TTY for password input. ' +
      'On Ubuntu desktop, use `pkexec <command>` to trigger the native GUI password dialog, ' +
      'or use rootless user-space flags (`systemctl --user`, `pip install --user`, `flatpak --user`, `~/.local/bin`).'
    );
  }
  if (/externally-managed-environment/i.test(combined)) {
    return (
      '[Ubuntu Hint] Ubuntu 23.04/24.04+ enforces PEP 668 (`externally-managed-environment`). ' +
      'Use a virtual environment (`python3 -m venv .venv && .venv/bin/pip install ...`), `pipx`, ' +
      'or pass `--break-system-packages --user` if explicitly installing for the user.'
    );
  }
  if (/Could not get lock \/var\/lib\/(dpkg|apt)|Unable to acquire the dpkg frontend lock/i.test(combined)) {
    return (
      '[Ubuntu Hint] Another apt/dpkg process (such as `unattended-upgrades`) holds the package lock. ' +
      'Check with `ps aux | grep -E "apt|dpkg"` and wait a few seconds before retrying.'
    );
  }
  if (/E:\s*Unable to locate package/i.test(combined)) {
    return (
      '[Ubuntu Hint] Package not found in current apt cache. Run `apt-cache search <keyword>` or `snap find <keyword>`, ' +
      'or refresh package lists with `apt-get update`.'
    );
  }
  if (/EADDRINUSE|Address already in use/i.test(combined)) {
    return (
      '[Ubuntu Hint] Port is already in use. Inspect the owning process with `ss -tulpn` or `lsof -i :<port>` ' +
      '(or call the `ubuntu_system` tool with action `ports`).'
    );
  }
  return '';
}

/**
 * Run one shell command. Optionally streams output through onData({stream, text}).
 * Resolves with {code, signal, stdout, stderr, timedOut, hint}.
 */
function runCommand({ command, cwd, timeoutMs = 120000, onData = null, env = null }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;

    // Spawn in its own process group so a timeout can kill the whole tree
    // (e.g. `npm start` -> node -> children), not just the shell.
    const useGroup = process.platform !== 'win32';
    const childEnv = buildUbuntuEnv(env || process.env);

    try {
      child = spawn('/bin/bash', ['-lc', command], {
        cwd: cwd || process.cwd(),
        env: childEnv,
        detached: useGroup,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: -1, error: e.message, stdout: '', stderr: '', hint: '' });
      return;
    }

    const killTree = (sig) => {
      try {
        if (useGroup && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try {
          child.kill(sig);
        } catch {}
      }
    };

    const append = (which, buf) => {
      const text = buf.toString('utf8');
      if (which === 'stdout') {
        if (stdout.length < MAX_OUTPUT) stdout += text;
      } else {
        if (stderr.length < MAX_OUTPUT) stderr += text;
      }
      if (onData) onData({ stream: which, text });
    };

    child.stdout.on('data', (d) => append('stdout', d));
    child.stderr.on('data', (d) => append('stderr', d));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      setTimeout(() => {
        killTree('SIGKILL');
      }, 3000);
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, error: e.message, stdout, stderr, hint: '' });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const outStr = stdout.length >= MAX_OUTPUT ? stdout + '\n[output truncated]' : stdout;
      const errStr = stderr.length >= MAX_OUTPUT ? stderr + '\n[output truncated]' : stderr;
      const hint = diagnoseUbuntuCommand({ command, code, stdout: outStr, stderr: errStr, timedOut });
      resolve({
        code,
        signal,
        timedOut,
        stdout: outStr,
        stderr: errStr,
        ...(hint ? { hint } : {}),
      });
    });
  });
}

module.exports = { runCommand, buildUbuntuEnv, diagnoseUbuntuCommand };

