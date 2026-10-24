/**
 * ZonePresence test.
 *
 * This is the signal every ad decision and every KPI is built on, so the checks
 * here are about the properties that make it trustworthy rather than about exact
 * numbers: the boarding curve, the blend of flights and queues, and — most
 * importantly — that it can say "I do not know" instead of inventing a zero.
 *
 * Run after a build: node test/presence.mjs
 */

import assert from 'node:assert/strict';

import {
  computePresence,
  proximityWeight,
  minutesToBoarding,
  stillFeeds,
  windowStart,
} from '../dist/engine/presence.js';

const AT = '2026-10-24T14:10:00.000Z';

// ---- the boarding curve ------------------------------------------------------
assert.equal(proximityWeight(10), 1, 'at the gate');
assert.equal(proximityWeight(15), 1);
assert.equal(proximityWeight(30), 0.8);
assert.equal(proximityWeight(60), 0.45);
assert.equal(proximityWeight(120), 0.2);
assert.equal(proximityWeight(300), 0.05, 'in the terminal, but not here yet');
assert.equal(proximityWeight(-5), 0, 'a flight that has gone contributes nobody');
// Monotonic: closer to boarding can never mean fewer people.
let prev = -1;
for (const m of [300, 180, 120, 90, 60, 45, 30, 20, 15, 10, 1]) {
  const w = proximityWeight(m);
  assert.ok(w >= prev, `weight must not fall as boarding approaches (${m} min)`);
  prev = w;
}
// An unknown departure time is "not yet gathering", not "everyone is here".
assert.equal(proximityWeight(null), 0.15);

// ---- time to boarding --------------------------------------------------------
const flight = {
  id: 'L1', flightNumber: 'XY100', airline: 'XY', origin: 'APT', destination: 'DXB',
  scheduledDeparture: '2026-10-24T15:00:00.000Z', scheduledArrival: null,
  estimatedDeparture: '2026-10-24T15:45:00.000Z', actualDeparture: null,
  estimatedArrival: null, actualArrival: null,
  tobt: null, tsat: null, aibt: null, aobt: null,
  status: 'delayed', delayMinutes: 45, delayCode: '81', passengerCount: 240,
  international: true, aircraftType: 'A320', gate: 'A12', stand: null,
  checkInCounters: [], belt: null,
  provenance: { source: 'test', observedAt: AT, ingestedAt: AT },
};
assert.equal(minutesToBoarding(flight, Date.parse(AT)), 95, 'estimated time wins over scheduled');
assert.equal(minutesToBoarding({ ...flight, estimatedDeparture: null }, Date.parse(AT)), 50, 'falls back to scheduled');
assert.equal(minutesToBoarding({ ...flight, estimatedDeparture: null, scheduledDeparture: null }, Date.parse(AT)), null);

// ---- what still counts as a crowd -------------------------------------------
assert.equal(stillFeeds({ ...flight, status: 'scheduled' }), true);
assert.equal(stillFeeds({ ...flight, status: 'delayed' }), true);
assert.equal(stillFeeds({ ...flight, status: 'cancelled' }), false, 'a cancelled flight is not a crowd');
assert.equal(stillFeeds({ ...flight, status: 'departed' }), false);
assert.equal(stillFeeds({ ...flight, status: 'arrived' }), false);

// ---- window bucketing rounds down, never to nearest -------------------------
assert.equal(windowStart('2026-10-24T14:14:59.000Z', 5), '2026-10-24T14:10:00.000Z');
assert.equal(windowStart('2026-10-24T14:10:00.000Z', 5), '2026-10-24T14:10:00.000Z');
assert.equal(windowStart('2026-10-24T14:09:59.000Z', 5), '2026-10-24T14:05:00.000Z');

// ---- the blend ---------------------------------------------------------------
const zones = [
  { id: 'gate-42', name: 'Gate 42', terminalId: 'T1', kind: 'gate-area', adjacentZoneIds: [] },
  { id: 'sec-north', name: 'Security North', terminalId: 'T1', kind: 'security', adjacentZoneIds: [] },
  { id: 'quiet', name: 'Quiet Zone', terminalId: 'T2', kind: 'retail', adjacentZoneIds: [] },
];
const gates = {
  get: (g) => ({ A12: 'gate-42', B07: 'gate-42' })[g],
  gatesOf: (z) => (z === 'gate-42' ? ['A12', 'B07'] : []),
};
const checkpoints = [{ id: 'cp1', name: 'North', zoneId: 'sec-north', open: true, provenance: flight.provenance }];

const flights = [
  flight,
  { ...flight, id: 'L2', flightNumber: 'ZQ88', destination: 'AGP', gate: 'B07', passengerCount: 180, international: true,
    estimatedDeparture: '2026-10-24T16:00:00.000Z', provenance: { source: 'test', observedAt: AT, ingestedAt: AT } },
  { ...flight, id: 'L3', gate: 'C99', passengerCount: 200, provenance: { source: 'test', observedAt: AT, ingestedAt: AT } }, // gate unknown to the map
  { ...flight, id: 'L4', gate: 'A12', passengerCount: 300, status: 'cancelled', provenance: { source: 'test', observedAt: AT, ingestedAt: AT } },
];

const queues = [
  { id: 'q1', checkpointId: 'cp1', queueLength: 140, averageWaitSeconds: 420, windowStart: AT, windowSeconds: 300, provenance: flight.provenance },
  { id: 'q2', checkpointId: 'missing', queueLength: 999, averageWaitSeconds: 1, windowStart: AT, windowSeconds: 300, provenance: flight.provenance },
];

const presence = computePresence({ at: AT, flights, zones, gates, queues, checkpoints });
const byZone = Object.fromEntries(presence.map((p) => [p.zoneId, p]));

assert.equal(presence.length, 3, 'every zone gets an entry');

// gate-42: XY100 at 95 min -> bucket <=120 -> 0.2 -> 240 x 0.2 = 48
//          ZQ88 at 110 min -> bucket <=120 -> 0.2 -> 180 x 0.2 = 36
//          48 + 36 = 84
assert.equal(byZone['gate-42'].estimatedCount, 84, 'both flights at the gate contribute');
assert.ok(byZone['gate-42'].internationalShare === 1, 'both legs are international');
assert.deepEqual(byZone['gate-42'].topDestinations.map((d) => d.destination), ['DXB', 'AGP']);
assert.ok(byZone['gate-42'].confidence > 0.5, 'two fresh legs is reasonably confident');
assert.ok(byZone['gate-42'].confidence < 1, 'but presence is never certain');

// sec-north: the queue, and only the queue
assert.equal(byZone['sec-north'].estimatedCount, 140, 'a queue is a crowd too');
// the queue at an unknown checkpoint must not be counted anywhere
assert.equal(presence.reduce((s, p) => s + p.estimatedCount, 0), 84 + 140, 'the orphan queue is dropped');

// quiet: nothing feeds it
assert.equal(byZone['quiet'].estimatedCount, 0);
assert.equal(byZone['quiet'].confidence, 0, 'no crowd is reported as no crowd, not a confident zero');
assert.deepEqual(byZone['quiet'].evidence, []);

// ---- staleness lowers confidence, and never raises it ------------------------
const staleFlights = flights.map((f) => ({ ...f, provenance: { ...f.provenance, ingestedAt: '2026-10-24T12:00:00.000Z' } }));
const stalePresence = computePresence({ at: AT, flights: staleFlights, zones, gates });
const stale = Object.fromEntries(stalePresence.map((p) => [p.zoneId, p]))['gate-42'];
assert.ok(stale.confidence < byZone['gate-42'].confidence, 'stale inputs must lower confidence');
assert.equal(stale.estimatedCount, byZone['gate-42'].estimatedCount, 'but the estimate itself is unchanged');

// ---- every input is traceable ------------------------------------------------
assert.ok(byZone['gate-42'].evidence.length >= 2, 'each contributing flight leaves its provenance');

console.log(`  gate-42: ${byZone['gate-42'].estimatedCount} pax, confidence ${byZone['gate-42'].confidence.toFixed(2)}, dwell ${byZone['gate-42'].dwellMinutes} min`);
console.log(`  sec-north: ${byZone['sec-north'].estimatedCount} pax from queues`);
console.log(`  quiet: ${byZone['quiet'].estimatedCount} pax, confidence ${byZone['quiet'].confidence}`);
console.log('presence: PASSED');
