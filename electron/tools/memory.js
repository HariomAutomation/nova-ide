'use strict';

/**
 * Long-term memory for Nova.
 *
 * Whatever the user works on, the agent (or the user) can save a short note.
 * Every note is injected into the system prompt at the start of every turn —
 * for every model — so a new model immediately understands the context of the
 * conversation instead of starting cold.
 *
 * Stored as plain JSON at ~/.nova-ide/memory.json so it is easy to inspect,
 * back up or sync (e.g. through Drive).
 */

const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');

const CONFIG_DIR = process.env.NOVA_CONFIG_DIR || path.join(os.homedir(), '.nova-ide');
const MEMORY_PATH = path.join(CONFIG_DIR, 'memory.json');
const MAX_NOTES = 500;
const MAX_TEXT = 4000;

function normalizeText(t) {
  return String(t == null ? '' : t)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

async function readAll() {
  try {
    const raw = await fsp.readFile(MEMORY_PATH, 'utf8');
    const j = JSON.parse(raw);
    const notes = Array.isArray(j && j.notes) ? j.notes : [];
    return { notes: notes.filter((n) => n && typeof n.text === 'string' && n.text.trim()) };
  } catch {
    return { notes: [] };
  }
}

async function writeAll(notes) {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.writeFile(MEMORY_PATH, JSON.stringify({ notes }, null, 2), 'utf8');
}

async function list() {
  const { notes } = await readAll();
  return { path: MEMORY_PATH, notes };
}

async function add(text, source) {
  const body = normalizeText(text);
  if (!body) return { error: 'Note is empty.' };
  const { notes } = await readAll();
  const note = { id: crypto.randomUUID(), text: body, source: source || 'user', createdAt: Date.now() };
  const next = [note, ...notes].slice(0, MAX_NOTES);
  await writeAll(next);
  return { ok: true, note, notes: next, path: MEMORY_PATH };
}

async function update(id, patch) {
  const { notes } = await readAll();
  let hit = null;
  const next = notes.map((n) => {
    if (n.id !== id) return n;
    hit = { ...n, ...(patch && typeof patch.text === 'string' ? { text: normalizeText(patch.text) } : {}) };
    return hit;
  });
  if (!hit) return { error: 'Note not found.' };
  await writeAll(next);
  return { ok: true, note: hit, notes: next };
}

async function remove(id) {
  const { notes } = await readAll();
  const next = notes.filter((n) => n.id !== id);
  await writeAll(next);
  return { ok: true, notes: next };
}

async function clear() {
  await writeAll([]);
  return { ok: true, notes: [] };
}

/**
 * Compact bullet list for the system prompt. Bounded so memory never bloats
 * every request.
 */
async function memoryText(maxChars = 6000, maxNotes = 80) {
  const { notes } = await readAll();
  if (!notes.length) return '';
  const lines = notes
    .slice(0, maxNotes)
    .map((n) => `- ${normalizeText(n.text).slice(0, 400)}`)
    .filter((l) => l.length > 2);
  return lines.join('\n').slice(0, maxChars);
}

module.exports = { list, add, update, remove, clear, memoryText, normalizeText, MEMORY_PATH, CONFIG_DIR };
