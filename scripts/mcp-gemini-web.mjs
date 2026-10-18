#!/usr/bin/env node
/**
 * Nova — Gemini Web MCP server.
 *
 * Exposes the Gemini web app (the account signed in to Nova's Gemini tab) as an
 * MCP tool, `ask_gemini`, so an agent running on any model can consult Gemini.
 *
 * It does not drive the browser itself: the running Nova IDE owns the webview
 * and the driver, and this process talks to Nova over a localhost bridge
 * (POST /gemini/ask). Nova writes the port + token to
 * ~/.nova-ide/gemini-bridge.json on startup.
 *
 * Speaks newline-delimited JSON-RPC 2.0 over stdio.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configRoot } from '../electron/tools/paths.js';

export const SERVER_INFO = { name: 'nova-gemini-web', version: '1.0.0' };
export const PROTOCOL_VERSION = '2024-11-05';

export const TOOLS = [
  {
    name: 'ask_gemini',
    description:
      "Ask the Gemini web app (the Google account signed in to Nova's Gemini tab) a question and get its answer as text. Useful for a second opinion, current information, or drafting. Requires Nova IDE to be running with the Gemini tab signed in.",
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The question or instruction to send to Gemini.' },
        threadKey: {
          type: 'string',
          description: 'Optional conversation key — reuse the same key to keep context inside one Gemini chat.',
        },
      },
      required: ['prompt'],
    },
  },
];

export function bridgePath() {
  return process.env.NOVA_GEMINI_BRIDGE_FILE || path.join(configRoot(), 'gemini-bridge.json');
}

export function readBridge() {
  try {
    const j = JSON.parse(fs.readFileSync(bridgePath(), 'utf8'));
    if (j && j.port && j.token) return j;
  } catch {}
  return null;
}

/** Ask Nova to drive Gemini. Injectable fetch keeps this testable. */
export async function askGemini(args, fetchImpl = fetch) {
  const info = readBridge();
  if (!info) {
    return {
      error:
        'Nova ka bridge nahi mila. Nova IDE khula hai? (Expected ~/.nova-ide/gemini-bridge.json)',
    };
  }
  const prompt = String((args && args.prompt) || '').trim();
  if (!prompt) return { error: 'prompt is required.' };
  let res;
  try {
    res = await fetchImpl(`http://127.0.0.1:${info.port}/gemini/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nova-token': info.token },
      body: JSON.stringify({ prompt, threadKey: (args && args.threadKey) || 'mcp:gemini-web' }),
    });
  } catch (e) {
    return { error: `Nova bridge se baat nahi hui: ${e.message}` };
  }
  const j = await res.json().catch(() => ({}));
  if (j && j.text) return { text: String(j.text) };
  return { error: (j && j.error) || `bridge HTTP ${res.status}` };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Pure dispatcher — one JSON-RPC message in, one reply out (or null). */
export async function handle(msg, deps = {}) {
  if (!msg || typeof msg !== 'object') return null;
  const ask = deps.askGemini || askGemini;
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return null;
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const name = params && params.name;
    if (name !== 'ask_gemini') return rpcError(id, -32602, `Unknown tool: ${name}`);
    const out = await ask((params && params.arguments) || {});
    if (out && out.error) {
      return rpcResult(id, { isError: true, content: [{ type: 'text', text: String(out.error) }] });
    }
    return rpcResult(id, { content: [{ type: 'text', text: String(out.text || '') }] });
  }

  if (id === undefined) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

const isMain = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (!line) continue;
      let msg = null;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        const reply = await handle(msg);
        if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
      } catch (e) {
        if (msg && msg.id !== undefined) {
          process.stdout.write(`${JSON.stringify(rpcError(msg.id, -32603, String((e && e.message) || e)))}\n`);
        }
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
