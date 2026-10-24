/**
 * Crowd profiling — what the system believes about the people in front of a screen.
 *
 * The brief is specific about the shape: a per-zone, per-5-minute aggregate over
 * segments, and explicitly "never individual person data". That is a design
 * constraint, not a privacy footnote — it is why this is a distribution and not a
 * list of travellers, and why every field here is a share or a count.
 */

import type { Provenance, ZonePresence } from '../model/canonical';

/**
 * The segment vocabulary the campaign targets are written against.
 *
 * Kept as a closed union rather than free strings so a typo in a campaign target
 * fails to compile instead of silently matching nothing — a campaign that matches
 * no segment looks exactly like a campaign that is simply losing.
 */
export type SegmentKey =
  // trip purpose
  | 'holiday'
  | 'business'
  | 'vfr'
  | 'student'
  | 'religious'
  // party type
  | 'solo'
  | 'couple'
  | 'family'
  | 'group'
  // age bands
  | 'ageUnder12'
  | 'age12to17'
  | 'age18to24'
  | 'age25to34'
  | 'age35to44'
  | 'age45to54'
  | 'age55plus'
  // cabin and spend
  | 'economy'
  | 'premiumEconomy'
  | 'businessCabin'
  | 'frequentFlyer'
  // reach
  | 'international'
  | 'domestic';

export const SEGMENT_KEYS: SegmentKey[] = [
  'holiday', 'business', 'vfr', 'student', 'religious',
  'solo', 'couple', 'family', 'group',
  'ageUnder12', 'age12to17', 'age18to24', 'age25to34', 'age35to44', 'age45to54', 'age55plus',
  'economy', 'premiumEconomy', 'businessCabin', 'frequentFlyer',
  'international', 'domestic',
];

/** A crowd profile for one zone over one 5-minute window. */
export interface CrowdProfile {
  zoneId: string;
  /** ISO 8601, start of the window. */
  windowStart: string;
  /** Estimated people in the zone. */
  estimatedCount: number;
  /** Share of the crowd in each segment, 0..1. Absent means zero, not unknown. */
  segments: Partial<Record<SegmentKey, number>>;
  topDestinations: { destination: string; count: number }[];
  topOrigins: { origin: string; count: number }[];
  /** Share travelling internationally, 0..1. */
  internationalShare: number;
  /** Median minutes until boarding across the crowd. */
  medianDwellMinutes: number | null;
  /** Median delay in minutes across flights feeding this zone. */
  medianDelayMinutes: number | null;
  /** 0..1 — how far to trust this. Low when inputs are stale or thin. */
  confidence: number;
  /** Every input, so a decision can be traced back to it. */
  evidence: Provenance[];
}

/** Read a segment share, treating "absent" as zero rather than undefined. */
export function share(profile: CrowdProfile, key: SegmentKey): number {
  const v = profile.segments[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Build a crowd profile from presence estimates plus the flights feeding a zone.
 *
 * The brief derives presence as `pax count × gate proximity weight`, so proximity
 * is a parameter here rather than something baked in — a gate-area zone weights its
 * own gate heavily, a retail zone a concourse spread.
 */
export function buildCrowdProfile(input: {
  zoneId: string;
  windowStart: string;
  presence: ZonePresence[];
  /** Flights contributing to this zone, with how strongly each contributes. */
  contributing: {
    passengerCount: number;
    destination: string | null;
    origin: string | null;
    international: boolean | null;
    /** 0..1 — how much of this flight is in this zone. */
    proximityWeight: number;
    minutesToBoarding: number | null;
    delayMinutes: number | null;
    /** Route-derived segment mix, mocked per route and day of week. */
    routeMix: Partial<Record<SegmentKey, number>>;
  }[];
}): CrowdProfile {
  const evidence: Provenance[] = [];
  for (const p of input.presence) evidence.push(...p.evidence);

  let estimatedCount = 0;
  const destCounts = new Map<string, number>();
  const originCounts = new Map<string, number>();
  // Segment shares are weighted by how many people each flight actually puts here,
  // not averaged per flight — otherwise a 20-pax hop would count as much as a 300.
  const segmentWeighted: Partial<Record<SegmentKey, number>> = {};
  let internationalWeighted = 0;
  let totalWeight = 0;
  const dwells: number[] = [];
  const delays: number[] = [];

  for (const f of input.contributing) {
    const here = f.passengerCount * f.proximityWeight;
    if (here <= 0) continue;
    estimatedCount += here;
    totalWeight += here;

    if (f.destination) destCounts.set(f.destination, (destCounts.get(f.destination) ?? 0) + here);
    if (f.origin) originCounts.set(f.origin, (originCounts.get(f.origin) ?? 0) + here);
    if (f.international === true) internationalWeighted += here;
    if (typeof f.minutesToBoarding === 'number') dwells.push(f.minutesToBoarding);
    if (typeof f.delayMinutes === 'number') delays.push(f.delayMinutes);

    for (const [k, v] of Object.entries(f.routeMix)) {
      const key = k as SegmentKey;
      segmentWeighted[key] = (segmentWeighted[key] ?? 0) + (v ?? 0) * here;
    }
  }

  const segments: Partial<Record<SegmentKey, number>> = {};
  if (totalWeight > 0) {
    for (const k of SEGMENT_KEYS) {
      const w = segmentWeighted[k];
      if (typeof w === 'number' && w > 0) segments[k] = w / totalWeight;
    }
  }

  const internationalShare = totalWeight > 0 ? internationalWeighted / totalWeight : 0;
  // domestic is the complement — the two must sum to 1 or the profile lies
  if (totalWeight > 0) segments.domestic = 1 - internationalShare;

  // Confidence is driven by whether we have anything to go on at all. A zone with
  // no contributing flights is not "0% confidence in a crowd", it is no crowd.
  const confidence = totalWeight > 0 ? Math.min(1, 0.4 + 0.6 * Math.min(1, totalWeight / 200)) : 0;

  return {
    zoneId: input.zoneId,
    windowStart: input.windowStart,
    estimatedCount: Math.round(estimatedCount),
    segments,
    topDestinations: top(destCounts, 3).map((t) => ({ destination: t.key, count: t.count })),
    topOrigins: top(originCounts, 3).map((t) => ({ origin: t.key, count: t.count })),
    internationalShare,
    medianDwellMinutes: median(dwells),
    medianDelayMinutes: median(delays),
    confidence,
    evidence,
  };
}

function top(m: Map<string, number>, n: number): { key: string; count: number }[] {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count: Math.round(count) }));
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
