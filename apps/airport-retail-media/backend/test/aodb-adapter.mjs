/**
 * AODB adapter test.
 *
 * The point of this file is the round trip. The brief's promise is that going live
 * means writing one new adapter and nothing else — and that promise is only real if
 * the mock behaves like a SOURCE, not like a fixture. So the mock emits CSV text,
 * and this test parses that text back through the same parser a real vendor export
 * would go through. If the mock returned Flight objects directly, the parser would
 * never run and the promise would be untested.
 *
 * Run after a build: node test/aodb-adapter.mjs
 */

import assert from 'node:assert/strict';

import {
  generateMockAodb,
  parseAodbCsv,
  splitCsvLine,
  normaliseStatus,
  createMockAodbSource,
  COLUMN_MAP,
  KNOWN_IGNORED_COLUMNS,
} from '../dist/adapters/aodb.js';

const DAY = '2026-10-24T00:00:00.000Z';

// ---- the mock emits text, not objects ---------------------------------------
const csv = generateMockAodb({ count: 40, dayStart: DAY, seed: 7 });
assert.equal(typeof csv, 'string', 'the mock must emit source-shaped text');

const lines = csv.split('\n');
assert.equal(lines.length, 41, 'header plus one row per flight');
assert.equal(lines[0], Object.keys(COLUMN_MAP).join(','), 'the header follows the column map');

// ---- the parser reads it back ------------------------------------------------
const { flights, unknownColumns } = parseAodbCsv(csv, { source: 'test' });
assert.equal(flights.length, 40, 'every row becomes a leg');
assert.deepEqual(unknownColumns, [], 'the mock only emits columns the map knows');

const f = flights[0];
assert.match(f.id, /^LEG\d{5}$/, 'identity survives');
assert.match(f.flightNumber, /^[A-Z]{2}\d{3}$/, 'flight number survives');
assert.equal(f.origin, 'APT');
assert.ok(f.destination && f.destination.length === 3, 'destination survives');
assert.ok(typeof f.passengerCount === 'number' && f.passengerCount >= 60, 'pax count survives as a number');
assert.ok(typeof f.international === 'boolean', 'international is a boolean, not the string "1"');
assert.ok(f.checkInCounters.length >= 1, 'the pipe-separated counters became an array');
assert.ok(f.tobt, 'TOBT is populated');
assert.ok(['scheduled', 'boarding', 'departed', 'arrived', 'delayed', 'cancelled', 'diverted', 'unknown'].includes(f.status));
assert.equal(f.provenance.source, 'test', 'provenance is attached at the boundary');
assert.ok(f.provenance.ingestedAt, 'and carries when we ingested it');

// A-CDM honesty: a leg that has not moved must NOT claim an actual time.
const notDeparted = flights.find((x) => x.status !== 'departed');
if (notDeparted) assert.equal(notDeparted.aobt, null, 'no actual off-block time before departure');

// ---- status normalisation ----------------------------------------------------
assert.equal(normaliseStatus('Scheduled'), 'scheduled');
assert.equal(normaliseStatus('BOARDING'), 'boarding');
assert.equal(normaliseStatus('Airborne'), 'departed');
assert.equal(normaliseStatus('Landed'), 'arrived');
assert.equal(normaliseStatus('Diverted to FRA'), 'diverted');
assert.equal(normaliseStatus(''), 'unknown');
assert.equal(normaliseStatus('something else entirely'), 'unknown');

// ---- the CSV splitter is not naive -------------------------------------------
assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
assert.deepEqual(splitCsvLine('"x,y",z'), ['x,y', 'z'], 'a comma inside quotes is not a separator');
assert.deepEqual(splitCsvLine('"he said ""hi""",z'), ['he said "hi"', 'z'], 'escaped quotes survive');

// ---- determinism: a demo must be replayable ---------------------------------
assert.equal(generateMockAodb({ count: 10, dayStart: DAY, seed: 7 }), generateMockAodb({ count: 10, dayStart: DAY, seed: 7 }), 'same seed, same day');
assert.notEqual(generateMockAodb({ count: 10, dayStart: DAY, seed: 8 }), generateMockAodb({ count: 10, dayStart: DAY, seed: 7 }), 'different seed, different day');

// ---- the source wrapper goes text -> parser -> canonical --------------------
const src = createMockAodbSource({ count: 12, dayStart: DAY, seed: 3 });
assert.equal(src.name, 'mock-aodb-csv');
assert.equal(typeof src.raw(), 'string', 'raw() exposes the source text');
const snap = await src.snapshot();
assert.equal(snap.length, 12);
assert.ok(snap.every((x) => x.provenance.source === 'mock-aodb-csv'));

// ---- the ignored columns are named, not silently dropped --------------------
assert.ok(KNOWN_IGNORED_COLUMNS.length > 0, 'real exports carry columns we do not model yet, and they are listed');

console.log(`  ${flights.length} legs parsed from ${lines.length - 1} CSV rows`);
console.log(`  statuses seen: ${[...new Set(flights.map((x) => x.status))].sort().join(', ')}`);
const pax = flights.map((x) => x.passengerCount).filter((n) => typeof n === 'number');
console.log(`  pax range: ${Math.min(...pax)}..${Math.max(...pax)}  (n=${pax.length})`);
console.log('aodb adapter: PASSED');
