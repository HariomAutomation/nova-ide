/**
 * HTTP + SSE test.
 *
 * Starts the real server on an ephemeral port and drives it with real requests. The
 * part that matters: a client is subscribed to /api/events, an event is injected over
 * HTTP, and the decision must ARRIVE ON THE STREAM. A test that only checked the
 * inject response would not prove the demo works, because the demo is the stream.
 *
 * Run after a build: node test/server.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import http from 'node:http';
import { createApp } from '../dist/server/app.js';
import { emptyState } from '../dist/server/simulation.js';

const AT = '2026-10-24T14:10:00.000Z';

function world() {
  const state = emptyState();
  state.zones = [
    { id: 'gate-42', name: 'Gate 42', terminalId: 'T1', kind: 'gate-area', adjacentZoneIds: [] },
    { id: 'gate-10', name: 'Gate 10', terminalId: 'T1', kind: 'gate-area', adjacentZoneIds: [] },
  ];
  state.gateToZone = new Map([['A12', 'gate-42'], ['B07', 'gate-42'], ['C01', 'gate-10']]);
  state.screens = [
    { id: 'screen-g42', name: 'Gate 42', zoneId: 'gate-42', terminalId: 'T1', orientation: '16:9', resolution: null, online: true, lastHeartbeat: AT },
  ];
  state.flights = [{
    id: 'XY501-2026-10-24', flightNumber: 'XY501', airline: 'XY', origin: 'APT', destination: 'DXB',
    scheduledDeparture: '2026-10-24T15:00:00.000Z', scheduledArrival: null,
    estimatedDeparture: '2026-10-24T15:00:00.000Z', actualDeparture: null, estimatedArrival: null, actualArrival: null,
    tobt: null, tsat: null, aibt: null, aobt: null, status: 'scheduled', delayMinutes: 0, delayCode: null,
    passengerCount: 240, international: true, aircraftType: 'A320', gate: 'A12', stand: null,
    checkInCounters: [], belt: null, provenance: { source: 'test', observedAt: AT, ingestedAt: AT },
  }];
  state.campaigns = [];
  state.candidates = [
    { campaignId: 'perfume', advertiserId: 'df', zoneIds: ['gate-42'], status: 'active', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-11-01T00:00:00.000Z',
      target: { international: 0.2, holiday: 0.3 }, international: true, minAudience: 20, creativeApproved: true, brandSafetyOk: true,
      category: 'perfume', remainingBudgetMinorUnits: 500000, hourlyCapMinorUnits: null, spentThisHourMinorUnits: 0, isHomeAirline: false, triggers: { delay: 1.5 } },
    { campaignId: 'coffee', advertiserId: 'fb', zoneIds: ['gate-42'], status: 'active', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-11-01T00:00:00.000Z',
      target: { international: 0.3, holiday: 0.4 }, international: true, minAudience: 20, creativeApproved: true, brandSafetyOk: true,
      category: 'coffee', remainingBudgetMinorUnits: 500000, hourlyCapMinorUnits: null, spentThisHourMinorUnits: 0, isHomeAirline: false },
  ];
  state.checkpoints = [];
  state.queues = [];
  return state;
}

const state = world();
const app = createApp(state, { now: () => AT });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const port = (app.server.address()).port;
const base = `http://127.0.0.1:${port}`;

// ---- REST bootstrap ----------------------------------------------------------
const health = await (await fetch(`${base}/api/health`)).json();
assert.equal(health.ok, true);

const snap = await (await fetch(`${base}/api/state`)).json();
assert.equal(snap.flights.length, 1);
assert.equal(snap.screens.length, 1);
assert.equal(snap.zones.length, 2);
assert.equal(snap.time, AT, 'the injected clock is used');

// an unknown route is a clean 404, not a crash
const missing = await fetch(`${base}/api/nope`);
assert.equal(missing.status, 404);
assert.equal((await missing.json()).ok, false);

// ---- subscribe to the stream, THEN inject ------------------------------------
const received = [];
const controller = new AbortController();
const streamDone = (async () => {
  const res = await fetch(`${base}/api/events`, { signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(res.headers.get('x-accel-buffering'), 'no', 'proxies must be told not to buffer, or the demo looks frozen');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evLine = frame.split('\n').find((l) => l.startsWith('event: '));
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (evLine && dataLine) received.push({ type: evLine.slice(7), data: JSON.parse(dataLine.slice(6)) });
        if (received.some((m) => m.type === 'screen-decision')) return;
      }
    }
  } catch { /* aborted */ }
})();

// wait until the server sees the subscriber, so the inject cannot race the subscribe
for (let i = 0; i < 100 && app.subscriberCount() === 0; i++) await new Promise((r) => setTimeout(r, 10));
assert.equal(app.subscriberCount(), 1, 'the client is subscribed before we inject');

const injectRes = await fetch(`${base}/api/inject`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'delay', flightId: 'XY501-2026-10-24', minutes: 45 }),
});
const injectBody = await injectRes.json();
assert.equal(injectBody.ok, true);
assert.ok(injectBody.elapsedMs < 2000, 'the inject itself is well inside the briefs budget');
assert.deepEqual(injectBody.affectedZones, ['gate-42']);

await Promise.race([streamDone, new Promise((_, rej) => setTimeout(() => rej(new Error('no decision arrived on the stream')), 3000))]);
controller.abort();

// ---- what arrived on the stream ----------------------------------------------
const types = received.map((m) => m.type);
assert.ok(types.includes('flight-event'), 'the flight event was broadcast');
assert.ok(types.includes('presence-update'), 'presence was broadcast');
assert.ok(types.includes('screen-decision'), 'and the decision reached the client');
assert.ok(types.indexOf('flight-event') < types.indexOf('screen-decision'), 'in order');

const decision = received.find((m) => m.type === 'screen-decision').data;
assert.equal(decision.winnerId, 'perfume', 'the delay flipped the slot to the campaign that opted in');
assert.match(decision.winningReason, /audience match/i);

// ---- the audit trail endpoint the "why this ad?" panel reads ------------------
const audit = await (await fetch(`${base}/api/decision/screen-g42`)).json();
assert.equal(audit.screenId, 'screen-g42');
for (const k of ['timestamp', 'crowdProfile', 'candidates', 'winnerId', 'winningReason', 'evidence']) {
  assert.ok(k in audit, `audit record carries ${k}`);
}
assert.equal(audit.winnerId, 'perfume');
assert.equal((await fetch(`${base}/api/decision/nope`)).status, 404);

// ---- redemption ---------------------------------------------------------------
const bad = await fetch(`${base}/api/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
assert.equal(bad.status, 400, 'a missing code is refused');
const good = await (await fetch(`${base}/api/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ promoCode: 'perfume-AB12' }) })).json();
assert.equal(good.ok, true);
assert.equal(good.redemption.campaignId, 'perfume');

// a malformed body is a 400, not a crash
const junk = await fetch(`${base}/api/inject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' });
assert.equal(junk.status, 400);

// ---- static serving, including the traversal guard ----------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-'));
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ok</title>');
fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
fs.mkdirSync(path.join(dir, 'assets'));
fs.writeFileSync(path.join(dir, 'assets', 'a.css'), 'body{}');
fs.writeFileSync(path.join(path.dirname(dir), 'secret.txt'), 'do not serve me');

const app2 = createApp(world(), { staticDir: dir, now: () => AT });
await new Promise((r) => app2.server.listen(0, '127.0.0.1', r));
const base2 = `http://127.0.0.1:${(app2.server.address()).port}`;

assert.equal((await (await fetch(`${base2}/`)).text()).includes('<title>ok</title>'), true, 'index is served');
assert.equal((await fetch(`${base2}/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
assert.equal((await fetch(`${base2}/assets/a.css`)).headers.get('content-type'), 'text/css; charset=utf-8');
assert.equal((await (await fetch(`${base2}/some/spa/route`)).text()).includes('<title>ok</title>'), true, 'unknown paths fall back to index for client routing');

// Traversal must not escape the static root. Note fetch() normalises a literal
// "/../x" away before it is ever sent, so that case cannot reach the server — which
// is why the assertion below is on the PROPERTY that matters (the secret is never
// served) rather than on a status code for a request that never happens.
// fetch() and the WHATWG URL parser both normalise away "." and ".." segments —
// including percent-encoded ones — before a request is ever sent. So a traversal
// cannot be tested through fetch at all; it has to go out as a raw path on the wire.
const rawGet = (rawPath) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: (app2.server.address()).port, path: rawPath, method: 'GET' }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.end();
});

for (const rawPath of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/..%2fsecret.txt']) {
  const r = await rawGet(rawPath);
  assert.ok(!r.body.includes('do not serve me'), `the secret must not be served for ${rawPath} (got ${r.status})`);
}

// the file really is one level up, so the guard is doing something
assert.equal(fs.existsSync(path.join(path.dirname(dir), 'secret.txt')), true, 'the secret exists outside the root');

// api routes still win over static
assert.equal((await (await fetch(`${base2}/api/health`)).json()).ok, true);

await app.close();
await app2.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`  stream received: ${types.join(' -> ')}`);
console.log(`  inject round trip: ${injectBody.elapsedMs}ms, ${injectBody.messages} message(s) broadcast`);
console.log(`  static: index, assets, spa fallback, and traversal refused`);
console.log('server: PASSED');
