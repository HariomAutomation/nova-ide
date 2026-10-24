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
const { configRoot } = require('./paths');

// Resolved lazily so an env override (NOVA_CONFIG_DIR) is honoured even when
// this module was loaded earlier (e.g. via agent.js).
function configDir() {
  return configRoot();
}
function memoryDir() {
  return path.join(configDir(), 'memory');
}
function legacyPath() {
  return path.join(configDir(), 'memory.json');
}
const MAX_NOTES = 500;
const MAX_TEXT = 4000;

// Memory is namespaced per user. When someone signs in with Google the account
// becomes the namespace (their email), so different users on the same machine
// get entirely separate memory and notes. Signed out -> the "local" namespace.
let currentAccount = 'local';

function sanitizeAccount(key) {
  const k = String(key == null ? '' : key).trim().toLowerCase();
  if (!k) return 'local';
  return k.replace(/[^a-z0-9._@+-]/g, '_').slice(0, 120);
}

function accountPath(account?: string) {
  return path.join(memoryDir(), `${sanitizeAccount(account || currentAccount)}.json`);
}

function getAccount() {
  return currentAccount;
}

/** Switch the active memory namespace (email on sign-in, 'local' on sign-out). */
async function setAccount(key) {
  currentAccount = sanitizeAccount(key);
  // One-time migration: fold the pre-account memory.json into "local".
  if (currentAccount === 'local') {
    try {
      await fsp.access(accountPath('local'));
    } catch {
      try {
        const legacy = await fsp.readFile(legacyPath(), 'utf8');
        await fsp.mkdir(memoryDir(), { recursive: true });
        await fsp.writeFile(accountPath('local'), legacy, 'utf8');
        await fsp.rename(legacyPath(), legacyPath() + '.migrated').catch(() => {});
      } catch {}
    }
  }
  return list();
}

function normalizeText(t) {
  return String(t == null ? '' : t)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

async function readAll() {
  try {
    const raw = await fsp.readFile(accountPath(), 'utf8');
    const j = JSON.parse(raw);
    const notes = Array.isArray(j && j.notes) ? j.notes : [];
    return { notes: notes.filter((n) => n && typeof n.text === 'string' && n.text.trim()) };
  } catch {
    return { notes: [] };
  }
}

async function writeAll(notes) {
  await fsp.mkdir(memoryDir(), { recursive: true });
  await fsp.writeFile(accountPath(), JSON.stringify({ notes }, null, 2), 'utf8');
}

async function list() {
  const { notes } = await readAll();
  return { path: accountPath(), account: currentAccount, notes };
}

async function add(text, source) {
  const body = normalizeText(text);
  if (!body) return { error: 'Note is empty.' };
  const { notes } = await readAll();
  const note = { id: crypto.randomUUID(), text: body, source: source || 'user', createdAt: Date.now() };
  const next = [note, ...notes].slice(0, MAX_NOTES);
  await writeAll(next);
  return { ok: true, note, notes: next, path: accountPath(), account: currentAccount };
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

async function setNotes(notes) {
  const clean = (Array.isArray(notes) ? notes : [])
    .filter((n) => n && typeof n.text === 'string' && n.text.trim())
    .slice(0, MAX_NOTES)
    .map((n) => ({
      id: n.id || crypto.randomUUID(),
      text: normalizeText(n.text),
      source: n.source || 'user',
      createdAt: n.createdAt || Date.now(),
    }));
  await writeAll(clean);
  return { ok: true, notes: clean, path: accountPath(), account: currentAccount };
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

module.exports = { list, add, update, remove, setNotes, clear, setAccount, getAccount, sanitizeAccount, memoryText, normalizeText, configDir, memoryDir };
