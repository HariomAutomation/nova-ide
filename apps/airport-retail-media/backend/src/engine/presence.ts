/**
 * ZonePresence — the derived signal the whole system runs on.
 *
 * The brief is unambiguous: "It is computed from flights at nearby gates (pax count
 * x time to boarding) and ACRIS queue data. Every ad decision and every dashboard
 * KPI uses it."
 *
 * So this file is where the raw sources become the one thing worth knowing: how many
 * people are in a zone, who they are, and for how long, over a 5-minute window.
 *
 * Three decisions worth stating, because they are the difference between a signal
 * and a guess:
 *
 *   1. It is DERIVED, not sourced. ZonePresence is not an adapter output; it carries
 *      the provenance of its inputs so a decision can be traced back through it.
 *
 *   2. Time to boarding is a curve, not a switch. A flight boarding in 90 minutes has
 *      almost nobody at the gate; one boarding in 10 minutes has nearly all of them.
 *      Modelling that as a step function would make presence jump and the demo look
 *      broken at the moment it should look smart.
 *
 *   3. Confidence is reported, and it is allowed to be low. A zone fed by one stale
 *      flight is not the same as a zone fed by six fresh ones, and the UI needs to
 *      be able to say so. An estimate that cannot express doubt is not evidence.
 */

import type {
  Checkpoint,
  Flight,
  Provenance,
  QueueMeasurement,
  Zone,
  ZonePresence,
} from '../model/canonical';

/** How a gate maps into a zone. Supplied by the topology source, not guessed. */
export interface GateZoneMap {
  /** gate -> zoneId */
  get(gate: string): string | undefined;
  /** zoneId -> gates */
  gatesOf(zoneId: string): string[];
}

export interface PresenceInput {
  /** ISO 8601 — the moment to compute for. */
  at: string;
  /** Window length in minutes. The brief fixes this at 5. */
  windowMinutes?: number;
  flights: Flight[];
  zones: Zone[];
  gates: GateZoneMap;
  /** ACRIS queue measurements. Optional: presence must still work without them. */
  queues?: QueueMeasurement[];
  checkpoints?: Checkpoint[];
  /** Feed lag beyond this makes an input count as stale for confidence. */
  staleAfterMinutes?: number;
}

const DEFAULT_WINDOW = 5;
const DEFAULT_STALE_AFTER = 15;

/**
 * How much of a flight's passengers are in the gate zone right now.
 *
 * Rises as boarding approaches and falls away again once the flight has gone.
 * `minutesToBoarding` is null when the time is not known yet, which is a real state
 * on a real AODB — an unknown departure time is treated as "not yet gathering"
 * rather than as "everyone is here".
 */
export function proximityWeight(minutesToBoarding: number | null): number {
  if (minutesToBoarding === null) return 0.15;
  if (minutesToBoarding < 0) return 0; // already gone
  if (minutesToBoarding <= 15) return 1; // at the gate
  if (minutesToBoarding <= 30) return 0.8;
  if (minutesToBoarding <= 60) return 0.45;
  if (minutesToBoarding <= 120) return 0.2;
  return 0.05; // in the terminal, but not here yet
}

/** Minutes until this flight's departure, from the best time the AODB gave us. */
export function minutesToBoarding(f: Flight, atMs: number): number | null {
  const iso = f.estimatedDeparture ?? f.scheduledDeparture;
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.round((t - atMs) / 60_000);
}

/** Is this flight still worth counting? Cancelled and departed legs are not a crowd. */
export function stillFeeds(f: Flight): boolean {
  return f.status !== 'cancelled' && f.status !== 'departed' && f.status !== 'arrived';
}

function topN(m: Map<string, number>, n: number, key: 'destination' | 'origin') {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ [key]: k, count: Math.round(v) }) as { destination?: string; origin?: string; count: number }) as any;
}

/**
 * Compute presence for every zone.
 *
 * Flights contribute through their gate; queues contribute through their checkpoint.
 * Both are blended into one count, because a person waiting at security and a person
 * at a gate are both a person in front of a screen somewhere.
 */
export function computePresence(input: PresenceInput): ZonePresence[] {
  const atMs = Date.parse(input.at);
  const windowMinutes = input.windowMinutes ?? DEFAULT_WINDOW;
  const staleAfter = input.staleAfterMinutes ?? DEFAULT_STALE_AFTER;

  const checkpointsById = new Map((input.checkpoints ?? []).map((c) => [c.id, c]));
  const zonesById = new Map(input.zones.map((z) => [z.id, z]));

  // ---- flight contribution, per zone -------------------------------------
  interface Acc {
    flightCount: number;
    passengerWeight: number;
    intlWeight: number;
    totalWeight: number;
    destinations: Map<string, number>;
    origins: Map<string, number>;
    dwell: number[];
    evidence: Provenance[];
    staleCount: number;
  }
  const acc = new Map<string, Acc>();
  const blank = (): Acc => ({
    flightCount: 0, passengerWeight: 0, intlWeight: 0, totalWeight: 0,
    destinations: new Map(), origins: new Map(), dwell: [], evidence: [], staleCount: 0,
  });

  for (const f of input.flights) {
    if (!stillFeeds(f)) continue;
    if (!f.gate) continue;
    const zoneId = input.gates.get(f.gate);
    if (!zoneId || !zonesById.has(zoneId)) continue;

    const mttb = minutesToBoarding(f, atMs);
    const w = proximityWeight(mttb);
    if (w <= 0) continue;

    const pax = f.passengerCount;
    if (pax === null || pax <= 0) continue;

    const here = pax * w;
    const a = acc.get(zoneId) ?? blank();
    a.flightCount += 1;
    a.passengerWeight += here;
    a.totalWeight += here;
    if (f.international === true) a.intlWeight += here;
    if (f.destination) a.destinations.set(f.destination, (a.destinations.get(f.destination) ?? 0) + here);
    if (f.origin) a.origins.set(f.origin, (a.origins.get(f.origin) ?? 0) + here);
    if (mttb !== null && mttb >= 0) a.dwell.push(mttb);
    a.evidence.push(f.provenance);

    const ageMin = (atMs - Date.parse(f.provenance.ingestedAt)) / 60_000;
    if (Number.isFinite(ageMin) && ageMin > staleAfter) a.staleCount += 1;

    acc.set(zoneId, a);
  }

  // ---- queue contribution, per zone --------------------------------------
  for (const q of input.queues ?? []) {
    const cp = checkpointsById.get(q.checkpointId);
    if (!cp || !zonesById.has(cp.zoneId)) continue;
    const waiting = q.queueLength;
    if (waiting === null || waiting <= 0) continue;

    const a = acc.get(cp.zoneId) ?? blank();
    a.passengerWeight += waiting;
    a.totalWeight += waiting;
    a.evidence.push(q.provenance);
    acc.set(cp.zoneId, a);
  }

  // ---- shape it -----------------------------------------------------------
  const out: ZonePresence[] = [];
  for (const z of input.zones) {
    const a = acc.get(z.id);
    if (!a) {
      // A zone with nothing feeding it is not "0% confident in a crowd" — there is
      // no crowd. Saying so is more useful than a confident zero.
      out.push({
        zoneId: z.id,
        windowStart: input.at,
        estimatedCount: 0,
        topDestinations: [],
        topOrigins: [],
        internationalShare: 0,
        dwellMinutes: null,
        confidence: 0,
        evidence: [],
      });
      continue;
    }

    // Confidence: more flights is better, stale inputs are worse, and it never
    // reaches 1 because presence is always an estimate.
    const freshness = a.flightCount > 0 ? 1 - a.staleCount / a.flightCount : 1;
    const breadth = Math.min(1, a.flightCount / 4);
    const confidence = Math.max(0, Math.min(0.95, (0.35 + 0.45 * breadth) * freshness));

    const dwells = a.dwell.slice().sort((x, y) => x - y);
    const medianDwell = dwells.length
      ? (dwells.length % 2 ? dwells[(dwells.length - 1) / 2] : Math.round((dwells[dwells.length / 2 - 1] + dwells[dwells.length / 2]) / 2))
      : null;

    out.push({
      zoneId: z.id,
      windowStart: input.at,
      estimatedCount: Math.round(a.passengerWeight),
      topDestinations: topN(a.destinations, 3, 'destination'),
      topOrigins: topN(a.origins, 3, 'origin'),
      internationalShare: a.totalWeight > 0 ? a.intlWeight / a.totalWeight : 0,
      dwellMinutes: medianDwell,
      confidence,
      evidence: a.evidence,
    });
  }

  return out;
}

/**
 * A 5-minute window start, so every caller buckets identically.
 *
 * Rounding down (not to nearest) matters: a window must never include data from
 * after its own start, or two windows computed a second apart would disagree.
 */
export function windowStart(atIso: string, windowMinutes = DEFAULT_WINDOW): string {
  const t = Date.parse(atIso);
  if (Number.isNaN(t)) return atIso;
  const size = windowMinutes * 60_000;
  return new Date(Math.floor(t / size) * size).toISOString();
}
