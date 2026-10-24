/**
 * AIDX adapter test.
 *
 * The mock emits XML TEXT on a stream and the parser reads it back, so the parser is
 * genuinely in the path — the same discipline the AODB adapter test uses, and for
 * the same reason. The other thing checked here is the flight key: an AIDX event has
 * to resolve to the same flight id an AODB row produced, or the event silently
 * targets nothing.
 *
 * Run after a build: node test/aidx-adapter.mjs
 */

import assert from 'node:assert/strict';

import {
  parseAidx,
  buildAidxMessage,
  normaliseAidxStatus,
  flightKey,
  createMockAidxSource,
  collectEvents,
} from '../dist/adapters/aidx.js';

// ---- status vocabulary -------------------------------------------------------
assert.equal(normaliseAidxStatus('Delayed'), 'delayed');
assert.equal(normaliseAidxStatus('CANCELLED'), 'cancelled');
assert.equal(normaliseAidxStatus('Airborne'), 'departed');
assert.equal(normaliseAidxStatus('Landed'), 'arrived');
assert.equal(normaliseAidxStatus(''), null, 'an absent status is absent, not unknown');
assert.equal(normaliseAidxStatus(null), null);
assert.equal(normaliseAidxStatus('something new'), 'unknown', 'a status we do not know is reported as unknown');

// ---- the flight key ----------------------------------------------------------
assert.equal(flightKey('xy', '501', '2026-10-24'), 'XY501-2026-10-24', 'case and spacing are normalised');

// ---- one message -------------------------------------------------------------
const xml = buildAidxMessage({
  airline: 'XY',
  flightNumber: '501',
  departureDate: '2026-10-24',
  status: 'Delayed',
  scheduled: '2026-10-24T14:00:00.000Z',
  estimated: '2026-10-24T14:45:00.000Z',
  gate: 'B12',
  remark: 'Late inbound aircraft',
});

assert.equal(typeof xml, 'string', 'the mock emits text');
assert.match(xml, /<FlightLegNotifRQ/, 'and it is an AIDX notification');

const one = parseAidx(xml, { source: 'test' });
assert.equal(one.events.length, 1);
assert.deepEqual(one.unparsed, []);

const e = one.events[0];
assert.equal(e.flightId, 'XY501-2026-10-24', 'the event keys to the flight');
assert.equal(e.kind, 'gate-change', 'a message carrying a gate is a gate change');
assert.equal(e.status, 'delayed');
assert.equal(e.gate, 'B12');
assert.equal(e.delayMinutes, 45, 'the delay is computed from scheduled vs estimated');
assert.equal(e.note, 'Late inbound aircraft');
assert.equal(e.provenance.source, 'test');
assert.equal(e.previousGate, null, 'AIDX sends the new gate; the previous one is our history, not the feed');

// ---- kind is derived from what the message carries ---------------------------
const cancelled = parseAidx(buildAidxMessage({ airline: 'ZQ', flightNumber: '88', departureDate: '2026-10-24', status: 'Cancelled' })).events[0];
assert.equal(cancelled.kind, 'cancelled');
assert.equal(cancelled.gate, null);

const statusOnly = parseAidx(buildAidxMessage({ airline: 'ZQ', flightNumber: '88', departureDate: '2026-10-24', status: 'Boarding' })).events[0];
assert.equal(statusOnly.kind, 'status');
assert.equal(statusOnly.delayMinutes, null, 'no times means no delay, not a zero delay');

// ---- a leg we cannot key is reported, not dropped silently -------------------
const broken = parseAidx('<FlightLegNotifRQ><FlightLeg><LegData><FlightStatus>Delayed</FlightStatus></LegData></FlightLeg></FlightLegNotifRQ>');
assert.equal(broken.events.length, 0);
assert.equal(broken.unparsed.length, 1, 'a leg with no key is reported');
assert.match(broken.unparsed[0], /missing Airline/);

const empty = parseAidx('');
assert.equal(empty.events.length, 0);
assert.deepEqual(empty.unparsed, [], 'empty input is not an error');

// ---- entities survive the round trip -----------------------------------------
const withEntities = buildAidxMessage({ airline: 'XY', flightNumber: '1', departureDate: '2026-10-24', status: 'Delayed', remark: 'A & B <gate> "12"' });
const decoded = parseAidx(withEntities).events[0];
assert.equal(decoded.note, 'A & B <gate> "12"', 'entities are encoded on the way out and decoded on the way back');

// ---- the stream yields text, and the parser is in the path -------------------
const src = createMockAidxSource({
  legs: [
    { airline: 'XY', flightNumber: '501', departureDate: '2026-10-24' },
    { airline: 'ZQ', flightNumber: '88', departureDate: '2026-10-24' },
  ],
  seed: 5,
  messages: 20,
});

let raw = 0;
for await (const msg of src.stream()) {
  assert.equal(typeof msg, 'string', 'the stream yields message text, not events');
  assert.match(msg, /<FlightLegNotifRQ/);
  raw++;
}
assert.equal(raw, 20, 'the stream produces the requested number of messages');

const collected = await collectEvents(createMockAidxSource({
  legs: [{ airline: 'XY', flightNumber: '501', departureDate: '2026-10-24' }],
  seed: 5,
  messages: 20,
}).stream(), { source: 'test' });

assert.equal(collected.events.length, 20, 'every message became an event');
assert.deepEqual(collected.unparsed, []);
assert.ok(collected.events.every((x) => x.flightId === 'XY501-2026-10-24'));

// ---- determinism -------------------------------------------------------------
const a = await collectEvents(createMockAidxSource({ legs: [{ airline: 'XY', flightNumber: '501', departureDate: '2026-10-24' }], seed: 5, messages: 8 }).stream());
const b = await collectEvents(createMockAidxSource({ legs: [{ airline: 'XY', flightNumber: '501', departureDate: '2026-10-24' }], seed: 5, messages: 8 }).stream());
assert.deepEqual(a.events.map((x) => x.kind), b.events.map((x) => x.kind), 'same seed, same feed');

const kinds = [...new Set(collected.events.map((x) => x.kind))].sort();
// The demo's headline trigger is "delay this flight 45 min". If the feed never
// produces a delay event, that demo cannot be driven at all — so it is asserted.
assert.ok(kinds.includes('delay'), 'the feed must be able to produce a delay event');
assert.ok(kinds.includes('gate-change'), 'and a gate change');
console.log(`  ${collected.events.length} events from ${raw} messages`);
console.log(`  kinds seen: ${kinds.join(', ')}`);
console.log('aidx adapter: PASSED');
