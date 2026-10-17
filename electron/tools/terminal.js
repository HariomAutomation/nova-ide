const { spawn } = require('node:child_process');

const MAX_OUTPUT = 200 * 1024;

/**
 * Run one shell command. Optionally streams output through onData({stream, text}).
 * Resolves with {code, signal, stdout, stderr, timedOut}.
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

    try {
      child = spawn('/bin/bash', ['-lc', command], {
        cwd: cwd || process.cwd(),
        env: env || process.env,
        detached: useGroup,
      });
    } catch (e) {
      resolve({ code: -1, error: e.message, stdout: '', stderr: '' });
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
      resolve({ code: -1, error: e.message, stdout, stderr });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        timedOut,
        stdout: stdout.length >= MAX_OUTPUT ? stdout + '\n[output truncated]' : stdout,
        stderr: stderr.length >= MAX_OUTPUT ? stderr + '\n[output truncated]' : stderr,
      });
    });
  });
}

module.exports = { runCommand };
