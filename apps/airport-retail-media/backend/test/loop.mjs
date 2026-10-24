/**
 * The live loop test — the brief's headline feature, measured.
 *
 * "Live Cause & Effect (<2s). Injected delay immediately triggers airline alert,
 * re-plans gate screens, triggers retailer delay discount, and updates passenger
 * dwell time."
 *
 * So this test does three things the brief actually asks for:
 *   1. injects a delay and asserts the whole chain runs (flight -> presence -> decision)
 *   2. asserts the DECISION CHANGED — a fast no-op is not cause and effect
 *   3. measures the wall clock against the two seconds promised
 *
 * Run after a build: node test/loop.mjs
 */

import assert from 'node:assert/strict';

import { emptyState, inject, redeem, redecide, notePlay, profileForZone } from '../dist/server/simulation.js';

const AT = '2026-10-24T14:10:00.000Z';

/** A small world: one gate zone with one screen, two flights, three campaigns. */
function world() {
  const state = emptyState();
  state.zones = [
    { id: 'gate-42', name: 'Gate 42', terminalId: 'T1', kind: 'gate-area', adjacentZoneIds: [] },
    { id: 'gate-10', name: 'Gate 10', terminalId: 'T1', kind: 'gate-area', adjacentZoneIds: [] },
  ];
  state.gateToZone = new Map([['A12', 'gate-42'], ['B07', 'gate-42'], ['C01', 'gate-10']]);
  state.screens = [
    { id: 'screen-g42', name: 'Gate 42 Screen', zoneId: 'gate-42', terminalId: 'T1', orientation: '16:9', resolution: { width: 1920, height: 1080 }, online: true, lastHeartbeat: AT },
    { id: 'screen-g10', name: 'Gate 10 Screen', zoneId: 'gate-10', terminalId: 'T1', orientation: '16:9', resolution: null, online: true, lastHeartbeat: AT },
  ];
  state.flights = [
    {
      id: 'XY501-2026-10-24', flightNumber: 'XY501', airline: 'XY', origin: 'APT', destination: 'DXB',
      scheduledDeparture: '2026-10-24T15:00:00.000Z', scheduledArrival: null,
      estimatedDeparture: '2026-10-24T15:00:00.000Z', actualDeparture: null, estimatedArrival: null, actualArrival: null,
      tobt: null, tsat: null, aibt: null, aobt: null,
      status: 'scheduled', delayMinutes: 0, delayCode: null, passengerCount: 240,
      international: true, aircraftType: 'A320', gate: 'A12', stand: null, checkInCounters: [], belt: null,
      provenance: { source: 'test', observedAt: AT, ingestedAt: AT },
    },
    {
      id: 'ZQ88-2026-10-24', flightNumber: 'ZQ88', airline: 'ZQ', origin: 'APT', destination: 'AGP',
      scheduledDeparture: '2026-10-24T16:30:00.000Z', scheduledArrival: null,
      estimatedDeparture: '2026-10-24T16:30:00.000Z', actualDeparture: null, estimatedArrival: null, actualArrival: null,
      tobt: null, tsat: null, aibt: null, aobt: null,
      status: 'scheduled', delayMinutes: 0, delayCode: null, passengerCount: 180,
      international: true, aircraftType: 'A321', gate: 'B07', stand: null, checkInCounters: [], belt: null,
      provenance: { source: 'test', observedAt: AT, ingestedAt: AT },
    },
  ];
  // The lounge is placed elsewhere, so it is the "filtered to other gates" case.
  state.campaigns = [];
  state.candidates = [
    {
      campaignId: 'perfume', advertiserId: 'duty-free', zoneIds: ['gate-42'], status: 'active',
      startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-11-01T00:00:00.000Z',
      target: { international: 0.2, holiday: 0.3, age25to54: 0.2 }, international: true, minAudience: 20,
      creativeApproved: true, brandSafetyOk: true, category: 'perfume',
      remainingBudgetMinorUnits: 500000, hourlyCapMinorUnits: null, spentThisHourMinorUnits: 0, isHomeAirline: false,
      triggers: { delay: 1.5 },
    },
    {
      campaignId: 'coffee', advertiserId: 'f&b', zoneIds: ['gate-42'], status: 'active',
      startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-11-01T00:00:00.000Z',
      target: { international: 0.3, holiday: 0.4, age25to54: 0.25 }, international: true, minAudience: 20,
      creativeApproved: true, brandSafetyOk: true, category: 'coffee',
      remainingBudgetMinorUnits: 500000, hourlyCapMinorUnits: null, spentThisHourMinorUnits: 0, isHomeAirline: false,
      // no triggers: the coffee shop does not care about delays
    },
  ];
  state.checkpoints = [{ id: 'cp1', name: 'North', zoneId: 'gate-10', open: true, provenance: { source: 'test', observedAt: AT, ingestedAt: AT } }];
  state.queues = [];
  return state;
}

// ---- the baseline decision ---------------------------------------------------
const state = world();
const baseline = redecide(state, ['gate-42'], AT);
const baseDecision = baseline.decisions.find((d) => d.screenId === 'screen-g42');
assert.ok(baseDecision, 'the screen got a decision');

// With no delay firing, both campaigns score the same and one of them wins.
assert.ok(baseDecision.winnerId, 'something plays');
const baseWinner = baseDecision.winnerId;
// The scenario only means anything if the delay is what flips it: coffee must win
// on merit first, otherwise "the winner changed" would be luck rather than cause.
assert.equal(baseWinner, 'coffee', 'coffee wins before the delay, on audience match alone');

// ---- inject the delay, and time it ------------------------------------------
const t0 = performance.now();
const result = inject(state, { kind: 'delay', flightId: 'XY501-2026-10-24', minutes: 45 }, AT);
const elapsed = performance.now() - t0;

// the chain ran: an event, then presence, then a decision
const types = result.messages.map((m) => m.type);
assert.ok(types.includes('flight-event'), 'the delay produced a flight event');
assert.ok(types.includes('presence-update'), 'presence was recomputed for the affected zone');
assert.ok(types.includes('screen-decision'), 'and the screen was re-decided');
assert.ok(types.indexOf('flight-event') < types.indexOf('presence-update'), 'in that order');
assert.ok(types.indexOf('presence-update') < types.indexOf('screen-decision'), 'and that order');
assert.deepEqual(result.affectedZones, ['gate-42']);

// the flight actually changed
const f = state.flights.find((x) => x.id === 'XY501-2026-10-24');
assert.equal(f.status, 'delayed');
assert.equal(f.delayMinutes, 45);
assert.equal(f.estimatedDeparture, '2026-10-24T15:45:00.000Z', 'the estimate moved by 45 minutes');

// ---- CAUSE AND EFFECT: the decision actually changed ------------------------
const after = state.decisions.get('screen-g42');
assert.equal(after.winnerId, 'perfume', 'the delay hands the slot to the campaign that opted into it');
assert.notEqual(after.winnerId, baseWinner, 'the winner CHANGED — a fast no-op would not be cause and effect');

const perfume = after.candidates.find((c) => c.campaignId === 'perfume');
const coffee = after.candidates.find((c) => c.campaignId === 'coffee');
assert.equal(perfume.triggerBoost, 1.5, 'perfume opted into the delay trigger');
assert.equal(coffee.triggerBoost, 1, 'coffee did not, and is not swept up in it');
assert.ok((perfume.score ?? 0) > (coffee.score ?? 0), 'which is why it wins');
assert.match(after.winningReason, /audience match/i);
// the audit trail names the trigger, so the "why this ad?" panel has something to show
assert.match(perfume.reason, /x 1\.5/);

// ---- the two seconds the brief promises -------------------------------------
assert.ok(elapsed < 2000, `the chain took ${elapsed.toFixed(1)}ms, the brief promises under 2000ms`);
assert.ok(elapsed < 250, `and in practice it is far quicker: ${elapsed.toFixed(1)}ms`);

// ---- a gate change moves the crowd, so BOTH zones are affected ---------------
const s2 = world();
const moved = inject(s2, { kind: 'gate-change', flightId: 'XY501-2026-10-24', gate: 'C01' }, AT);
assert.deepEqual(moved.affectedZones.sort(), ['gate-10', 'gate-42'], 'the old gate zone and the new one both moved');
assert.equal(s2.flights[0].gate, 'C01');

// ---- a queue surge reaches presence -----------------------------------------
const s3 = world();
const surged = inject(s3, { kind: 'queue-surge', checkpointId: 'cp1', people: 150 }, AT);
const presenceMsg = surged.messages.find((m) => m.type === 'presence-update');
assert.ok(presenceMsg, 'a queue surge updates presence');
assert.equal(presenceMsg.zones.find((z) => z.zoneId === 'gate-10').estimatedCount, 150, 'the queue is the crowd');

// ---- screen offline toggles and is reported ----------------------------------
const s4 = world();
const off = inject(s4, { kind: 'screen-offline', screenId: 'screen-g42' }, AT);
assert.equal(off.messages[0].type, 'screen-status');
assert.equal(s4.screens.find((x) => x.id === 'screen-g42').online, false);

// ---- injecting at a flight that does not exist is a no-op, not a crash -------
const s5 = world();
const nothing = inject(s5, { kind: 'delay', flightId: 'NOPE', minutes: 10 }, AT);
assert.deepEqual(nothing.messages, []);
assert.deepEqual(nothing.affectedZones, []);

// ---- redemption ---------------------------------------------------------------
const s6 = world();
const msg = redeem(s6, 'perfume-AB12', AT);
assert.equal(msg.type, 'redemption');
assert.equal(s6.redemptions.get('perfume-AB12'), 1);

// ---- profile is derived from the same flights presence uses -------------------
const prof = profileForZone(state, 'gate-42', AT);
assert.ok(prof.estimatedCount > 0);
assert.ok(prof.internationalShare === 1, 'both legs are international');
assert.ok(prof.confidence > 0);

console.log(`  chain: ${types.join(' -> ')}`);
console.log(`  winner: ${baseWinner} -> ${after.winnerId}  (perfume boost ${perfume.triggerBoost}, coffee ${coffee.triggerBoost})`);
console.log(`  elapsed: ${elapsed.toFixed(1)}ms  (brief promises < 2000ms)`);
console.log('loop: PASSED');
