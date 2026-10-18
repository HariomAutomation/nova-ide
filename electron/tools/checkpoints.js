'use strict';

/**
 * File checkpoints — snapshot files just before the agent edits them so the
 * user can undo all of the agent's changes for a chat ("Restore files").
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function getRootDir() {
  const home = process.env.NOVA_HOME || process.env.NOVA_CONFIG_DIR;
  return home ? path.join(home, 'checkpoints') : path.join(os.homedir(), '.nova-ide', 'checkpoints');
}

function safeId(agentId) {
  return String(agentId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function dirFor(agentId) {
  return path.join(getRootDir(), safeId(agentId));
}

/** Snapshot the current content of `filePath` (or record that it didn't exist). */
async function snapshot(agentId, filePath) {
  if (!agentId || !filePath) return null;
  const d = dirFor(agentId);
  await fsp.mkdir(d, { recursive: true });
  let cur = null;
  try {
    cur = await fsp.readFile(filePath);
  } catch {
    cur = null;
  }
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const backup = path.join(d, `${stamp}.bak`);
  const entry = { path: String(filePath), existed: !!cur, backup: cur ? backup : null, ts: Date.now() };
  if (cur) await fsp.writeFile(backup, cur);
  await fsp.appendFile(path.join(d, 'manifest.jsonl'), JSON.stringify(entry) + '\n');
  return entry;
}

async function listEntries(agentId) {
  try {
    const raw = await fsp.readFile(path.join(dirFor(agentId), 'manifest.jsonl'), 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function count(agentId) {
  return (await listEntries(agentId)).length;
}

/** Restore every file the agent touched in this chat to its pre-agent state. */
async function restore(agentId) {
  const entries = await listEntries(agentId);
  if (!entries.length) return { restored: [], message: 'No agent edits recorded for this chat.' };
  const seen = new Set();
  const restored = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    try {
      if (e.existed && e.backup) {
        const data = await fsp.readFile(e.backup);
        await fsp.mkdir(path.dirname(e.path), { recursive: true });
        await fsp.writeFile(e.path, data);
        restored.push({ path: e.path, action: 'restored' });
      } else {
        await fsp.rm(e.path, { force: true });
        restored.push({ path: e.path, action: 'deleted' });
      }
    } catch (err) {
      restored.push({ path: e.path, action: 'failed', error: String(err.message || err) });
    }
  }
  // Consume the manifest so a second restore is a no-op.
  try {
    await fsp.writeFile(path.join(dirFor(agentId), 'manifest.jsonl'), '');
  } catch {}
  return { restored, message: null };
}

module.exports = { snapshot, restore, count, listEntries };
