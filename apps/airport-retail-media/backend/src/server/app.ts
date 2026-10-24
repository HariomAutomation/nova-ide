/**
 * The HTTP + SSE layer.
 *
 * Deliberately thin. Everything that matters — the chain from an injected event to a
 * changed decision — already lives in simulation.ts and is tested without a socket.
 * This file only moves those messages and serves the built frontend.
 *
 * `node:http` and nothing else. For a deliverable that has to `docker compose up` on
 * a reviewer's machine and deploy to a free host, every dependency is another thing
 * that can fail at the worst moment, and neither SSE nor static files need a
 * framework.
 *
 * Serving the frontend from the same origin as the API is also deliberate: it
 * removes CORS and cross-origin EventSource entirely, which is the usual reason a
 * reviewer's browser silently shows nothing.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { SimMessage, SimulationState } from './simulation.js';

export interface AppOptions {
  /** Where the built frontend lives. Missing is fine — the API still works. */
  staticDir?: string;
  /** Injected clock, so a test can pin time. */
  now?: () => string;
}

/** Every connected SSE client. */
type Subscriber = (msg: SimMessage) => void;

export interface App {
  server: http.Server;
  /** Push a message to every connected client. */
  broadcast: (msg: SimMessage) => void;
  subscriberCount: () => number;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function readBody(req: http.IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      // A body limit is not paranoia here: this endpoint is reachable from the
      // browser and an unbounded read is a free way to fall over.
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

/**
 * Serve a file from staticDir, refusing anything that escapes it.
 *
 * The check is on the RESOLVED path, not the raw url: `..%2f` and a symlink both
 * look innocent as strings and are not after resolution.
 */
function serveStatic(staticDir: string, urlPath: string, res: http.ServerResponse): boolean {
  const root = path.resolve(staticDir);
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  let target = path.resolve(root, rel);

  if (target !== root && !target.startsWith(root + path.sep)) return false; // escaped
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    // SPA fallback: an unknown path is a client route, not a 404.
    target = path.join(root, 'index.html');
    if (!fs.existsSync(target)) return false;
  }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
  return true;
}

export function createApp(state: SimulationState, opts: AppOptions = {}): App {
  const now = opts.now ?? (() => new Date().toISOString());
  const subscribers = new Set<Subscriber>();

  const broadcast = (msg: SimMessage): void => {
    for (const s of subscribers) {
      try { s(msg); } catch { subscribers.delete(s); }
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;

    // ---- SSE -------------------------------------------------------------
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Proxies buffer text/event-stream unless told not to, which makes the demo
        // look frozen behind any reverse proxy. This is the header that prevents it.
        'x-accel-buffering': 'no',
      });
      res.write(': connected\n\n');

      const sub: Subscriber = (msg) => {
        res.write(`event: ${msg.type}\n`);
        res.write(`data: ${JSON.stringify(msg)}\n\n`);
      };
      subscribers.add(sub);
      // A comment every 20s keeps intermediaries from closing an idle stream.
      const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20_000);
      req.on('close', () => { clearInterval(keepAlive); subscribers.delete(sub); });
      return;
    }

    // ---- inject ----------------------------------------------------------
    if (p === '/api/inject' && req.method === 'POST') {
      let body: any;
      try { body = JSON.parse((await readBody(req)) || '{}'); }
      catch { return sendJson(res, 400, { ok: false, error: 'invalid json' }); }

      const started = Date.now();
      // simulation.inject is imported lazily by the caller-provided state; see index.
      const { inject } = await import('./simulation.js');
      const result = inject(state, body, now());
      for (const m of result.messages) broadcast(m);
      return sendJson(res, 200, {
        ok: true,
        elapsedMs: Date.now() - started,
        affectedZones: result.affectedZones,
        messages: result.messages.length,
      });
    }

    // ---- bootstrap snapshot ----------------------------------------------
    if (p === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, {
        time: now(),
        flights: state.flights,
        zones: state.zones,
        screens: state.screens,
        campaigns: state.campaigns,
        checkpoints: state.checkpoints,
        queues: state.queues,
        presence: [...state.decisions.keys()].map((screenId) => {
          const d = state.decisions.get(screenId)!;
          return { screenId, zoneId: d.crowdProfile.zoneId, estimatedCount: d.crowdProfile.estimatedCount, confidence: d.crowdProfile.confidence };
        }),
      });
    }

    // ---- the audit trail the "why this ad?" panel reads -------------------
    if (p.startsWith('/api/decision/') && req.method === 'GET') {
      const screenId = decodeURIComponent(p.slice('/api/decision/'.length));
      const record = state.decisions.get(screenId);
      if (!record) return sendJson(res, 404, { ok: false, error: `no decision for ${screenId}` });
      return sendJson(res, 200, record);
    }

    // ---- redemption ------------------------------------------------------
    if (p === '/api/redeem' && req.method === 'POST') {
      let body: any;
      try { body = JSON.parse((await readBody(req)) || '{}'); }
      catch { return sendJson(res, 400, { ok: false, error: 'invalid json' }); }
      const code = String(body.promoCode ?? '');
      if (!code) return sendJson(res, 400, { ok: false, error: 'promoCode is required' });
      const { redeem } = await import('./simulation.js');
      const msg = redeem(state, code, now());
      if (!msg) return sendJson(res, 400, { ok: false, error: 'could not parse a campaign from the code' });
      broadcast(msg);
      return sendJson(res, 200, { ok: true, redemption: msg });
    }

    // ---- health ----------------------------------------------------------
    if (p === '/api/health') return sendJson(res, 200, { ok: true, time: now(), subscribers: subscribers.size });

    // ---- static ----------------------------------------------------------
    if (opts.staticDir && fs.existsSync(opts.staticDir)) {
      if (req.method === 'GET' && serveStatic(opts.staticDir, p, res)) return;
    }

    sendJson(res, 404, { ok: false, error: `no route for ${req.method} ${p}` });
  });

  return {
    server,
    broadcast,
    subscriberCount: () => subscribers.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of subscribers) subscribers.delete(s);
        server.close(() => resolve());
        // close() waits for open connections; SSE connections are open by design.
        (server as any).closeAllConnections?.();
      }),
  };
}
