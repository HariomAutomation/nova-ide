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

    try {
      child = spawn('/bin/bash', ['-lc', command], {
        cwd: cwd || process.cwd(),
        env: env || process.env,
      });
    } catch (e) {
      resolve({ code: -1, error: e.message, stdout: '', stderr: '' });
      return;
    }

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
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
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
