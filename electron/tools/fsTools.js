const fs = require('node:fs/promises');
const path = require('node:path');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.cache', '__pycache__',
  '.venv', 'venv', '.next', '.nuxt', 'target', 'vendor', '.Trash-1000',
  '.gradle', '.idea', '.vscode', 'coverage', 'tmp', 'temp',
]);

const IGNORE_FILES = new Set([
  '.DS_Store', 'Thumbs.db', '.env.local', '.env.development.local',
  '.env.test.local', '.env.production.local', 'pnpm-lock.yaml',
  'package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock',
]);

async function listDir(dir, { showIgnored = false } = {}) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => {
      if (showIgnored) return true;
      if (e.isDirectory() && IGNORE_DIRS.has(e.name)) return false;
      if (!e.isDirectory() && IGNORE_FILES.has(e.name)) return false;
      if (!e.isDirectory() && e.name.startsWith('.') && e.name !== '.gitignore') return false;
      return true;
    })
    .map((e) => ({ name: e.name, path: path.join(dir, e.name), isDir: e.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

async function readFileTool(file, { offset = 1, limit = 2000 } = {}) {
  const stat = await fs.stat(file);
  if (stat.size > 4 * 1024 * 1024) {
    return { error: `File too large (${stat.size} bytes). Use offset/limit with a smaller slice via grep_search first.` };
  }
  // Clamp so a runaway caller can never pull an unbounded slice into context.
  const safeLimit = Math.max(1, Math.min(Number(limit) || 2000, 5000));
  const buf = await fs.readFile(file);
  if (buf.subarray(0, 4096).includes(0)) return { error: 'Binary file.' };
  const lines = buf.toString('utf8').split('\n');
  const start = Math.max(0, offset - 1);
  const slice = lines.slice(start, start + safeLimit);
  return {
    path: file,
    totalLines: lines.length,
    from: start + 1,
    to: start + slice.length,
    truncated: start + slice.length < lines.length,
    content: slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n'),
  };
}

async function writeFileTool(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
  return { ok: true, path: file, bytes: Buffer.byteLength(content) };
}

async function editFileTool(file, oldString, newString, { replaceAll = false } = {}) {
  if (!oldString) return { error: 'old_string is required.' };
  const content = await fs.readFile(file, 'utf8');
  const count = content.split(oldString).length - 1;
  if (count === 0) return { error: 'old_string not found in file. Read the file again and copy the exact text.' };
  if (count > 1 && !replaceAll) {
    return { error: `old_string occurs ${count} times. Provide more surrounding context or set replace_all.` };
  }
  // Use a function replacer, not a string one: a string replacement expands
  // `$&`, `$$`, `` $` `` and `$'` patterns, so an edit whose new_string contains
  // them (very common in shell/Make/JS-template code) would be silently corrupted.
  const next = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, () => newString);
  await fs.writeFile(file, next, 'utf8');
  return { ok: true, path: file, occurrences: replaceAll ? count : 1 };
}

async function deleteFileTool(file) {
  await fs.rm(file, { recursive: false });
  return { ok: true, path: file };
}

async function searchFiles({ pattern, dir, caseSensitive = false, maxResults = 100, maxFileBytes = 512 * 1024 }) {
  let re;
  try {
    re = new RegExp(pattern, caseSensitive ? '' : 'i');
  } catch (e) {
    return { error: `Invalid regex: ${e.message}` };
  }
  const results = [];
  let scanned = 0;
  const root = dir || process.cwd();

  async function walk(d) {
    if (results.length >= maxResults) return;
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= maxResults) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.git')) continue;
        await walk(p);
      } else if (e.isFile()) {
        scanned += 1;
        if (scanned > 20000) return;
        let stat;
        try {
          stat = await fs.stat(p);
        } catch {
          continue;
        }
        if (stat.size > maxFileBytes) continue;
        let text;
        try {
          text = await fs.readFile(p, 'utf8');
        } catch {
          continue;
        }
        if (text.includes('\u0000')) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (re.test(lines[i])) {
            results.push({ path: p, line: i + 1, text: lines[i].slice(0, 240) });
          }
        }
      }
    }
  }

  await walk(root);
  return { pattern, dir: root, count: results.length, truncated: results.length >= maxResults, results };
}

module.exports = {
  listDir,
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  searchFiles,
  IGNORE_DIRS,
};
