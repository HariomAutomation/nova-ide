/**
 * ACRIS adapter test — and the first end-to-end check of the spine.
 *
 * Two things are proven here. First that the NGSI-LD unwrapping is right: values
 * arrive wrapped in {type, value} and a parser that assumes plain values reads
 * undefined for every field, producing entities that look empty rather than broken.
 * Second that the whole chain connects — ACRIS queues reach ZonePresence through the
 * same path flights do.
 *
 * Run after a build: node test/acris-adapter.mjs
 */

import assert from 'node:assert/strict';

import { parseAcris, prop, rel, shortId, generateMockAcris, createMockAcrisSource } from '../dist/adapters/acris.js';
import { computePresence } from '../dist/engine/presence.js';

// ---- unwrapping --------------------------------------------------------------
const wrapped = { id: 'urn:ngsi-ld:QueueMeasurement:q1', type: 'QueueMeasurement', queueLength: { type: 'Property', value: 140, observedAt: '2026-10-24T14:10:00.000Z' } };
assert.equal(prop(wrapped, 'queueLength'), 140, 'a Property is unwrapped to its value');
assert.equal(prop(wrapped, 'missing'), null, 'an absent attribute is null');
assert.equal(prop(wrapped, 'id'), null, 'a bare value where a Property was expected is refused, not coerced');

assert.equal(rel({ id: 'x', type: 'Z', ref: { type: 'Relationship', object: 'urn:ngsi-ld:Zone:Z1' } }, 'ref'), 'urn:ngsi-ld:Zone:Z1');
assert.equal(rel({ id: 'x', type: 'Z', ref: 'plain-string' }, 'ref'), 'plain-string', 'a bare string link is tolerated');
assert.equal(rel({ id: 'x', type: 'Z' }, 'ref'), null);

assert.equal(shortId('urn:ngsi-ld:Zone:T1-Z1'), 'T1-Z1');
assert.equal(shortId('already-short'), 'already-short');

// ---- the mock emits WIRE shape, not canonical --------------------------------
const batch = generateMockAcris({ terminals: ['T1'], zonesPerTerminal: 4, seed: 3, observedAt: '2026-10-24T14:10:00.000Z' });
assert.ok(batch['@graph'], 'the mock emits an @graph wrapper');
assert.ok(batch['@context'], 'and a JSON-LD context');
const sample = batch['@graph'].find((e) => e.type === 'QueueMeasurement');
assert.ok(sample, 'it produced a queue measurement');
assert.equal(typeof sample.queueLength, 'object', 'the value is WRAPPED, not plain');
assert.equal(sample.queueLength.type, 'Property');
assert.match(sample.checkpointId.object, /^urn:ngsi-ld:/, 'links are Relationships with urn targets');
assert.equal(typeof JSON.parse(JSON.stringify(batch)), 'object', 'and the whole thing is JSON-serialisable');

// ---- parsing ----------------------------------------------------------------
const parsed = parseAcris(batch, { source: 'test' });
assert.equal(parsed.terminals.length, 1);
assert.equal(parsed.zones.length, 4);
assert.ok(parsed.checkpoints.length >= 1, 'a security zone produced a checkpoint');
assert.equal(parsed.queues.length, parsed.checkpoints.length, 'one measurement per checkpoint');

const t1 = parsed.terminals[0];
assert.equal(t1.id, 'T1', 'urn prefix stripped');
assert.equal(t1.zoneIds.length, 4, 'zones link back to their terminal');
assert.equal(parsed.zones[0].terminalId, 'T1');
assert.ok(['gate-area', 'retail', 'security', 'lounge'].includes(parsed.zones[0].kind));

const q = parsed.queues[0];
assert.ok(typeof q.queueLength === 'number', 'the queue length is a real number after unwrapping');
assert.ok(q.queueLength >= 0 && q.queueLength <= 260);
assert.ok(typeof q.averageWaitSeconds === 'number');
assert.equal(q.windowSeconds, 300);
assert.equal(q.provenance.source, 'test');
assert.ok(parsed.checkpoints[0].zoneId.startsWith('T1-'), 'the checkpoint knows its zone');

// ---- input shapes ------------------------------------------------------------
assert.equal(parseAcris([{ id: 'urn:ngsi-ld:Terminal:A', type: 'Terminal', name: { type: 'Property', value: 'A' } }]).terminals.length, 1, 'a bare array works');
assert.equal(parseAcris({ id: 'urn:ngsi-ld:Terminal:A', type: 'Terminal', name: { type: 'Property', value: 'A' } }).terminals.length, 1, 'a single entity works');
const junk = parseAcris({ nope: true });
assert.equal(junk.terminals.length, 0);
assert.equal(junk.unparsed.length, 1, 'a shape we cannot read is reported');

const mixed = parseAcris([
  { id: 'urn:ngsi-ld:Weather:1', type: 'WeatherObserved' },
  { id: 'urn:ngsi-ld:Zone:Z', type: 'Zone' },
]);
assert.equal(mixed.unparsed.length, 2, 'an unhandled type and a nameless zone are both reported');
assert.ok(mixed.unparsed.some((u) => /unhandled entity type/.test(u)));

// ---- the spine: ACRIS reaches ZonePresence through the same path flights do ---
const src = createMockAcrisSource({ terminals: ['T1'], zonesPerTerminal: 4, seed: 3, observedAt: '2026-10-24T14:10:00.000Z' });
assert.equal(typeof src.raw(), 'string', 'the mock exposes wire text');
const snap = await src.snapshot();
assert.ok(snap.queues.length >= 1);

// Build presence from queues ALONE — no flights at all — and the security zone must
// still show people, because a queue is a crowd.
const presence = computePresence({
  at: '2026-10-24T14:10:00.000Z',
  flights: [],
  zones: snap.zones,
  gates: { get: () => undefined, gatesOf: () => [] },
  queues: snap.queues,
  checkpoints: snap.checkpoints,
});

const secZoneIds = snap.zones.filter((z) => z.kind === 'security').map((z) => z.id);
const withPeople = presence.filter((p) => p.estimatedCount > 0);
assert.ok(withPeople.length >= 1, 'queues alone put people in a zone');
assert.ok(withPeople.every((p) => secZoneIds.includes(p.zoneId)), 'and only in the zones that have a checkpoint');
assert.equal(presence.length, snap.zones.length, 'every zone still gets an entry');

console.log(`  ${snap.terminals.length} terminals, ${snap.zones.length} zones, ${snap.checkpoints.length} checkpoints, ${snap.queues.length} queue measurements`);
console.log(`  queue lengths: ${snap.queues.map((q) => q.queueLength).join(', ')}`);
console.log(`  presence from queues alone: ${withPeople.map((p) => `${p.zoneId}=${p.estimatedCount}`).join(', ')}`);
console.log('acris adapter: PASSED');
