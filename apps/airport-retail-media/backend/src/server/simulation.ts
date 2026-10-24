/**
 * The simulation — where an injected event becomes a changed decision.
 *
 * This is the brief's headline feature: "Live Cause & Effect (<2s). Injected delay
 * immediately triggers airline alert, re-plans gate screens, triggers retailer delay
 * discount, and updates passenger dwell time."
 *
 * So the whole point of this file is that chain, and the chain is what the test
 * measures. A delay is injected; flights change; presence is recomputed for the
 * affected zones; the screens in those zones are re-decided; and the resulting
 * decisions come back. The test asserts the whole round trip completes well inside
 * the two seconds the brief promises, and asserts the decision actually CHANGED —
 * because a fast no-op is not cause and effect.
 *
 * Deliberately dependency-free and transport-free. The HTTP and SSE layers sit on
 * top and do nothing but move these messages; the loop itself has to be testable
 * without opening a socket.
 */

import type {
  Campaign,
  Checkpoint,
  Flight,
  FlightEvent,
  QueueMeasurement,
  Screen,
  Zone,
} from '../model/canonical.js';
import { computePresence, minutesToBoarding } from '../engine/presence.js';
import { buildCrowdProfile, CrowdProfile } from '../engine/crowd.js';
import { CampaignCandidate, DecisionRecord, decide, DecisionInput } from '../engine/decision.js';

/** A message pushed to the UI. The `type` is what the SSE endpoint frames on. */
export type SimMessage =
  | { type: 'flight-event'; at: string; event: FlightEvent }
  | { type: 'presence-update'; at: string; zones: { zoneId: string; estimatedCount: number; confidence: number }[] }
  | { type: 'screen-decision'; at: string; screenId: string; zoneId: string; winnerId: string | null; winningReason: string; score: number | null }
  | { type: 'redemption'; at: string; code: string; campaignId: string; outletId: string | null }
  | { type: 'screen-status'; at: string; screenId: string; online: boolean };

export interface InjectRequest {
  kind: 'delay' | 'gate-change' | 'queue-surge' | 'screen-offline';
  /** Which flight, for delay and gate-change. */
  flightId?: string;
  minutes?: number;
  gate?: string;
  /** Which checkpoint, for a queue surge. */
  checkpointId?: string;
  people?: number;
  /** Which screen, for screen-offline. */
  screenId?: string;
}

export interface SimulationState {
  flights: Flight[];
  zones: Zone[];
  screens: Screen[];
  campaigns: Campaign[];
  candidates: CampaignCandidate[];
  checkpoints: Checkpoint[];
  queues: QueueMeasurement[];
  /** gate -> zoneId */
  gateToZone: Map<string, string>;
  /** screenId -> the last decision made for it. */
  decisions: Map<string, DecisionRecord>;
  /** campaignId -> recent play times, for the frequency cap. */
  recentPlays: Map<string, string[]>;
  /** screenId -> the category of the ad it played last. */
  lastCategory: Map<string, string>;
  /** redemption counts by promo code, for the learning step. */
  redemptions: Map<string, number>;
}

export function emptyState(): SimulationState {
  return {
    flights: [], zones: [], screens: [], campaigns: [], candidates: [], checkpoints: [], queues: [],
    gateToZone: new Map(), decisions: new Map(), recentPlays: new Map(),
    lastCategory: new Map(), redemptions: new Map(),
  };
}

/** Which zones does this flight's gate feed? A gate maps to exactly one zone. */
function zonesForFlight(state: SimulationState, f: Flight): string[] {
  if (!f.gate) return [];
  const z = state.gateToZone.get(f.gate);
  return z ? [z] : [];
}

/** Screens that show ads in these zones. */
function screensInZones(state: SimulationState, zoneIds: string[]): Screen[] {
  const set = new Set(zoneIds);
  return state.screens.filter((s) => set.has(s.zoneId));
}

/**
 * Build the crowd profile for a zone from the current flights and queues.
 *
 * Reuses the same builder the engine tests cover, so the profile a decision sees in
 * the live loop is the same shape the worked example exercises — not a second,
 * subtly different implementation for the server.
 */
export function profileForZone(state: SimulationState, zoneId: string, at: string): CrowdProfile {
  const atMs = Date.parse(at);
  const contributing = state.flights
    .filter((f) => zonesForFlight(state, f).includes(zoneId))
    .map((f) => {
      const mttb = minutesToBoarding(f, atMs);
      // Same curve the presence engine uses, so profile and presence agree.
      const w = mttb === null ? 0.15 : mttb < 0 ? 0 : mttb <= 15 ? 1 : mttb <= 30 ? 0.8 : mttb <= 60 ? 0.45 : mttb <= 120 ? 0.2 : 0.05;
      return {
        passengerCount: f.passengerCount ?? 0,
        destination: f.destination,
        origin: f.origin,
        international: f.international,
        proximityWeight: w,
        minutesToBoarding: mttb,
        delayMinutes: f.delayMinutes,
        routeMix: routeMixFor(f),
      };
    })
    .filter((c) => c.passengerCount > 0 && c.proximityWeight > 0);

  const presence = computePresence({
    at,
    flights: state.flights,
    zones: state.zones,
    gates: { get: (g) => state.gateToZone.get(g), gatesOf: () => [] },
    queues: state.queues,
    checkpoints: state.checkpoints,
  }).filter((p) => p.zoneId === zoneId);

  return buildCrowdProfile({ zoneId, windowStart: at, presence, contributing });
}

/**
 * A route-derived segment mix.
 *
 * Mocked, as the brief allows ("mocked per route and day of week"). Kept here rather
 * than in an adapter because it is not a source format — it is an inference the
 * platform makes about a route.
 */
export function routeMixFor(f: Flight): Record<string, number> {
  const dest = (f.destination ?? '').toUpperCase();
  const beach = ['AGP', 'PMI', 'AYT', 'HER'].includes(dest);
  const business = ['LHR', 'JFK', 'FRA', 'SIN', 'DXB'].includes(dest);
  const mix: Record<string, number> = {
    international: f.international === false ? 0 : 1,
    economy: 0.8,
    age25to54: 0.45,
    age35to44: 0.25,
  };
  if (beach) { mix.holiday = 0.7; mix.family = 0.4; mix.ageUnder12 = 0.18; }
  else if (business) { mix.business = 0.45; mix.age25to54 = 0.6; mix.frequentFlyer = 0.3; }
  else { mix.holiday = 0.4; mix.vfr = 0.25; mix.family = 0.25; }
  return mix;
}

/**
 * Re-decide every screen in the given zones, and return the messages that changed.
 *
 * Only CHANGED decisions are emitted. Pushing an identical decision on every tick
 * would make the UI flicker and would bury the real change in noise — the demo is
 * about a screen visibly reacting, not about a stream of no-ops.
 */
export function redecide(state: SimulationState, zoneIds: string[], at: string): { messages: SimMessage[]; decisions: DecisionRecord[] } {
  const messages: SimMessage[] = [];
  const decisions: DecisionRecord[] = [];

  for (const screen of screensInZones(state, zoneIds)) {
    const profile = profileForZone(state, screen.zoneId, at);
    const atMs = Date.parse(at);

    const zoneFlights = state.flights.filter((f) => zonesForFlight(state, f).includes(screen.zoneId));
    const minutes = zoneFlights
      .map((f) => minutesToBoarding(f, atMs))
      .filter((m): m is number => m !== null && m >= 0);
    const nextBoarding = minutes.length ? Math.min(...minutes) : null;
    const delays = zoneFlights.map((f) => f.delayMinutes).filter((d): d is number => typeof d === 'number');
    const medianDelay = delays.length ? delays.sort((a, b) => a - b)[Math.floor(delays.length / 2)] : null;

    const input: DecisionInput = {
      screenId: screen.id,
      zoneId: screen.zoneId,
      at,
      profile,
      campaigns: state.candidates,
      minutesToBoarding: nextBoarding,
      medianDelayMinutes: medianDelay,
      recentPlays: (state.recentPlays.get(screen.id) ?? []).map((playedAt) => ({ campaignId: '', playedAt })),
      previousCategory: state.lastCategory.get(screen.id) ?? null,
      frequencyCap: 3,
      frequencyWindowMinutes: 30,
    };

    const record = decide(input);
    const before = state.decisions.get(screen.id);
    state.decisions.set(screen.id, record);
    decisions.push(record);

    const changed = !before || before.winnerId !== record.winnerId;
    if (changed) {
      const winner = record.candidates.find((c) => c.campaignId === record.winnerId);
      messages.push({
        type: 'screen-decision',
        at,
        screenId: screen.id,
        zoneId: screen.zoneId,
        winnerId: record.winnerId,
        winningReason: record.winningReason,
        score: winner?.score ?? null,
      });
    }
  }

  return { messages, decisions };
}

/**
 * Apply an injected event and run the whole chain.
 *
 * This is the function the brief describes: inject -> flights change -> presence
 * recomputes -> screens re-plan. It returns every message the UI needs, in order,
 * and the caller (SSE) just forwards them.
 */
export function inject(state: SimulationState, req: InjectRequest, at: string = new Date().toISOString()): {
  messages: SimMessage[];
  affectedZones: string[];
} {
  const messages: SimMessage[] = [];
  const affected = new Set<string>();

  if (req.kind === 'delay' || req.kind === 'gate-change') {
    const f = state.flights.find((x) => x.id === req.flightId);
    if (!f) return { messages, affectedZones: [] };

    const zonesBefore = zonesForFlight(state, f);
    let event: FlightEvent;

    if (req.kind === 'delay') {
      const minutes = req.minutes ?? 45;
      const base = Date.parse(f.estimatedDeparture ?? f.scheduledDeparture ?? at);
      const next = Number.isNaN(base) ? at : new Date(base + minutes * 60_000).toISOString();
      f.estimatedDeparture = next;
      f.delayMinutes = (f.delayMinutes ?? 0) + minutes;
      f.status = 'delayed';
      event = {
        id: `inj-delay-${f.id}-${at}`, flightId: f.id, kind: 'delay', status: 'delayed',
        previousGate: f.gate, gate: f.gate, delayMinutes: f.delayMinutes,
        effectiveAt: next, note: `Injected delay +${minutes} min`,
        provenance: { source: 'inject', observedAt: at, ingestedAt: at },
      };
    } else {
      const previousGate = f.gate;
      f.gate = req.gate ?? f.gate;
      event = {
        id: `inj-gate-${f.id}-${at}`, flightId: f.id, kind: 'gate-change', status: f.status,
        previousGate, gate: f.gate, delayMinutes: f.delayMinutes,
        effectiveAt: at, note: `Injected gate change ${previousGate} -> ${f.gate}`,
        provenance: { source: 'inject', observedAt: at, ingestedAt: at },
      };
    }

    messages.push({ type: 'flight-event', at, event });
    // A gate change moves the crowd, so BOTH the old and the new zone are affected.
    for (const z of zonesBefore) affected.add(z);
    for (const z of zonesForFlight(state, f)) affected.add(z);
  }

  if (req.kind === 'queue-surge') {
    const cpId = req.checkpointId ?? state.checkpoints[0]?.id;
    const cp = state.checkpoints.find((c) => c.id === cpId);
    if (!cp) return { messages, affectedZones: [] };
    const add = req.people ?? 120;
    const existing = state.queues.find((q) => q.checkpointId === cp.id);
    if (existing) {
      existing.queueLength = (existing.queueLength ?? 0) + add;
      existing.provenance = { source: 'inject', observedAt: at, ingestedAt: at };
    } else {
      state.queues.push({
        id: `inj-q-${cp.id}`, checkpointId: cp.id, queueLength: add, averageWaitSeconds: null,
        windowStart: at, windowSeconds: 300,
        provenance: { source: 'inject', observedAt: at, ingestedAt: at },
      });
    }
    affected.add(cp.zoneId);
  }

  if (req.kind === 'screen-offline') {
    const s = state.screens.find((x) => x.id === req.screenId) ?? state.screens[0];
    if (!s) return { messages, affectedZones: [] };
    s.online = !s.online;
    s.lastHeartbeat = at;
    messages.push({ type: 'screen-status', at, screenId: s.id, online: s.online });
    affected.add(s.zoneId);
  }

  // ---- presence, for the zones that moved ---------------------------------
  const affectedZones = [...affected];
  if (affectedZones.length) {
    const presence = computePresence({
      at,
      flights: state.flights,
      zones: state.zones.filter((z) => affected.has(z.id)),
      gates: { get: (g) => state.gateToZone.get(g), gatesOf: () => [] },
      queues: state.queues,
      checkpoints: state.checkpoints,
    });
    messages.push({
      type: 'presence-update',
      at,
      zones: presence.map((p) => ({ zoneId: p.zoneId, estimatedCount: p.estimatedCount, confidence: p.confidence })),
    });

    // ---- and the decisions those zones feed --------------------------------
    const { messages: decisionMsgs } = redecide(state, affectedZones, at);
    messages.push(...decisionMsgs);
  }

  return { messages, affectedZones };
}

/** Record a redemption, which is also the signal the learning step consumes. */
export function redeem(state: SimulationState, code: string, at: string = new Date().toISOString()): SimMessage | null {
  const campaignId = code.split('-')[0];
  if (!campaignId) return null;
  state.redemptions.set(code, (state.redemptions.get(code) ?? 0) + 1);
  return { type: 'redemption', at, code, campaignId, outletId: null };
}

/** Seed the recent-play history so the frequency cap has something to work with. */
export function notePlay(state: SimulationState, screenId: string, campaignId: string, category: string, at: string): void {
  const list = state.recentPlays.get(screenId) ?? [];
  list.push(at);
  state.recentPlays.set(screenId, list.slice(-20));
  state.lastCategory.set(screenId, category);
}
