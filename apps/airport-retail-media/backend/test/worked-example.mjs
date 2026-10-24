/**
 * The brief's worked example, as a test.
 *
 * The brief says this scenario "must be reproducible in Demo", so it is the one
 * piece of the spec that can be checked rather than interpreted:
 *
 *   Gate 42 at 14:10. Flight XY501 to DXB (240 pax, delayed 45 min) plus
 *   ZQ88 to a beach destination (180 pax). Crowd leans holiday and family,
 *   57% international, median dwell 52 min.
 *
 *   Duty-free perfume, 15% off   -> plays
 *   Toy store, buy 2 get 1       -> next in rotation
 *   Business lounge day pass     -> filtered to other gates
 *
 * What this test asserts, and what it deliberately does not:
 *
 *   ASSERTED  the winner, the ordering, the filter and the reason for it, and the
 *             audit record's shape. These are the parts of the example that follow
 *             from the rules the brief states.
 *
 *   NOT ASSERTED  the published scores 0.86 / 0.52 / 0.21. The brief's own formula
 *             is AudienceMatch x TriggerBoost, and 0.71 x 1.5 is 1.065, not 0.86.
 *             The three numbers do not follow the stated formula, so pinning them
 *             would pin arithmetic nobody can derive. `scores()` below prints what
 *             the formula actually produces next to what the brief reports, so the
 *             gap stays visible instead of being quietly rounded away.
 *
 * Run after a build:  node test/worked-example.mjs
 */

import assert from 'node:assert/strict';

import { buildCrowdProfile } from '../dist/engine/crowd.js';
import { decide, audienceMatch, DELAY_TRIGGER_BOOST } from '../dist/engine/decision.js';

const AT = '2026-10-24T14:10:00.000Z';

// ---- the crowd the brief describes -----------------------------------------
// XY501 to DXB: 240 pax, delayed 45. ZQ88 to the beach: 180 pax. Both feed Gate 42,
// which is why proximityWeight is 1 for each — a gate area is fed by its own flights.
const profile = buildCrowdProfile({
  zoneId: 'gate-42',
  windowStart: AT,
  presence: [],
  contributing: [
    {
      passengerCount: 240,
      destination: 'DXB',
      origin: null,
      international: true,
      proximityWeight: 1,
      minutesToBoarding: 52,
      delayMinutes: 45,
      routeMix: { holiday: 0.6, business: 0.25, family: 0.3, age25to54: 0.5, international: 1 },
    },
    {
      passengerCount: 180,
      destination: 'AGP',
      origin: null,
      international: true,
      proximityWeight: 1,
      minutesToBoarding: 52,
      delayMinutes: 0,
      routeMix: { holiday: 0.55, family: 0.32, age25to54: 0.45, international: 1 },
    },
  ],
});

assert.equal(profile.estimatedCount, 420, 'both flights feed the zone');
assert.ok(profile.internationalShare > 0.5, 'the crowd leans international');
assert.equal(profile.medianDelayMinutes, 23, 'median of 45 and 0');

// ---- the three candidates ---------------------------------------------------
const campaigns = [
  {
    campaignId: 'perfume-15off',
    advertiserId: 'duty-free',
    zoneIds: ['gate-42', 'gate-41'],
    status: 'active',
    startAt: '2026-10-01T00:00:00.000Z',
    endAt: '2026-11-01T00:00:00.000Z',
    target: { international: 0.5, holiday: 0.6, age25to54: 0.5 },
    international: true,
    minAudience: 50,
    creativeApproved: true,
    brandSafetyOk: true,
    category: 'perfume',
    remainingBudgetMinorUnits: 500000,
    hourlyCapMinorUnits: null,
    spentThisHourMinorUnits: 0,
    isHomeAirline: false,
  },
  {
    campaignId: 'toy-buy2get1',
    advertiserId: 'toy-store',
    zoneIds: ['gate-42'],
    status: 'active',
    startAt: '2026-10-01T00:00:00.000Z',
    endAt: '2026-11-01T00:00:00.000Z',
    target: { family: 0.9, ageUnder12: 0.7 },
    international: null,
    minAudience: 20,
    creativeApproved: true,
    brandSafetyOk: true,
    category: 'toys',
    remainingBudgetMinorUnits: 200000,
    hourlyCapMinorUnits: null,
    spentThisHourMinorUnits: 0,
    isHomeAirline: false,
  },
  {
    // Deliberately placed elsewhere: this is the "filtered to other gates" case.
    campaignId: 'lounge-daypass',
    advertiserId: 'airline-lounge',
    zoneIds: ['gate-10', 'gate-11'],
    status: 'active',
    startAt: '2026-10-01T00:00:00.000Z',
    endAt: '2026-11-01T00:00:00.000Z',
    target: { businessCabin: 0.9, business: 0.8 },
    international: null,
    minAudience: 10,
    creativeApproved: true,
    brandSafetyOk: true,
    category: 'lounge',
    remainingBudgetMinorUnits: 300000,
    hourlyCapMinorUnits: null,
    spentThisHourMinorUnits: 0,
    isHomeAirline: false,
  },
];

const record = decide({
  screenId: 'screen-gate42-01',
  zoneId: 'gate-42',
  at: AT,
  profile,
  campaigns,
  minutesToBoarding: 52,
  medianDelayMinutes: profile.medianDelayMinutes,
  recentPlays: [],
  previousCategory: null,
  frequencyCap: 3,
  frequencyWindowMinutes: 30,
});

// ---- what the brief says must happen ----------------------------------------
const byId = Object.fromEntries(record.candidates.map((c) => [c.campaignId, c]));

assert.equal(record.winnerId, 'perfume-15off', 'the perfume campaign plays');
assert.equal(byId['lounge-daypass'].filteredBy, 'placement', 'the lounge is filtered out');
assert.match(byId['lounge-daypass'].reason, /other gates/i, 'and says why, in the briefs words');
assert.equal(byId['toy-buy2get1'].rank, 2, 'the toy store is next in rotation');
assert.equal(byId['toy-buy2get1'].filteredBy, null, 'and is not filtered');

// ---- the audit record shape the brief names ---------------------------------
for (const k of ['screenId', 'timestamp', 'crowdProfile', 'candidates', 'winnerId', 'winningReason', 'evidence']) {
  assert.ok(k in record, `audit record must carry ${k}`);
}
for (const c of record.candidates) {
  for (const k of ['campaignId', 'score', 'rank']) {
    assert.ok(k in c, `every candidate, filtered or not, carries ${k}`);
  }
}
assert.ok(record.evidence.length >= 0);
assert.match(record.winningReason, /perfume|audience match/i);

// ---- the arithmetic the brief states, next to the numbers it publishes ------
// Read the ENGINE's scores out of the record, not a re-derivation, so the table
// below shows what the system actually decided rather than what this test thinks.
const formula = {
  perfume: byId['perfume-15off'].score ?? 0,
  toy: byId['toy-buy2get1'].score ?? 0,
  lounge: byId['lounge-daypass'].score ?? 0,
};
const matchOf = {
  perfume: audienceMatch(profile, campaigns[0].target),
  toy: audienceMatch(profile, campaigns[1].target),
  lounge: audienceMatch(profile, campaigns[2].target),
};
const published = { perfume: 0.86, toy: 0.52, lounge: 0.21 };

console.log('  campaign        formula   brief   winner');
console.log(`  perfume         ${formula.perfume.toFixed(3)}     ${published.perfume}   ${record.winnerId === 'perfume-15off' ? 'yes' : 'no'}`);
console.log(`  toy store       ${formula.toy.toFixed(3)}     ${published.toy}   ${record.winnerId === 'toy-buy2get1' ? 'yes' : 'no'}`);
console.log(`  lounge daypass  ${formula.lounge.toFixed(3)}     ${published.lounge}   ${record.winnerId === 'lounge-daypass' ? 'yes' : 'no'}`);
console.log('');
console.log(`  audience matches: perfume ${matchOf.perfume.toFixed(3)}, toy ${matchOf.toy.toFixed(3)}, lounge ${matchOf.lounge.toFixed(3)} (lounge filtered before scoring)`);
console.log('');
console.log('  The winner, the order and the filter all match the brief.');
console.log('  The scores do not, and cannot be made to from the brief as written:');
console.log('  it states Match x Boost (0.71 x 1.5 = 1.065, not 0.86) AND it never says');
console.log('  which segment weights produce a 71% match. So the published numbers are');
console.log('  illustrative, and the thing worth building is the EXPLAINED decision,');
console.log('  which is what the audit record above carries.');

console.log('worked example: PASSED');
