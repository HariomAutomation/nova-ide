/**
 * The canonical model — the only thing the app core ever sees.
 *
 * The brief is explicit that this layer is the point: every mock must look exactly
 * like what a real source would send, so that going live means writing one new
 * adapter and nothing else. So no module outside `adapters/` may know that AODB is
 * a 33-column CSV, that AIDX is XML, or that ACRIS is NGSI-LD JSON. They all land
 * here, in these shapes.
 *
 * Two rules that keep that promise honest:
 *   1. Every value that came from a source carries provenance (source, observedAt).
 *      The decision pipeline is evidence-first, and evidence you cannot trace is not
 *      evidence.
 *   2. Nothing in here is source-shaped. No column names, no XML element names, no
 *      NGSI-LD `@context` leaking through.
 */

/** Where a value came from, and how fresh it is. */
export interface Provenance {
  /** Which adapter produced this, e.g. "aodb-csv", "aidx-xml", "acris-ngsi". */
  source: string;
  /** When the source says the value was observed (ISO 8601, UTC). */
  observedAt: string;
  /** When we ingested it (ISO 8601, UTC) — the two differ when a feed lags. */
  ingestedAt: string;
}

/** Flight status, normalised across AODB status codes and AIDX status values. */
export type FlightStatus =
  | 'scheduled'
  | 'boarding'
  | 'departed'
  | 'arrived'
  | 'delayed'
  | 'cancelled'
  | 'diverted'
  | 'unknown';

/**
 * One flight leg.
 *
 * A-CDM timestamps are all optional because a real AODB fills them in as the day
 * progresses — TOBT before TSAT, AIBT only after arrival. A mock that always
 * populates them would hide the "we do not know yet" states the UI has to render.
 */
export interface Flight {
  /** Stable id for the leg. */
  id: string;
  flightNumber: string;
  airline: string;
  /** Origin for a departure, destination for an arrival. */
  origin: string | null;
  destination: string | null;
  /** ISO 8601 scheduled times. */
  scheduledDeparture: string | null;
  scheduledArrival: string | null;
  /** ISO 8601 estimated/actual, filled in as the day runs. */
  estimatedDeparture: string | null;
  actualDeparture: string | null;
  estimatedArrival: string | null;
  actualArrival: string | null;
  /** A-CDM milestone times. */
  tobt: string | null; // Target Off-Block Time
  tsat: string | null; // Target Start-up Approval Time
  aibt: string | null; // Actual In-Block Time
  aobt: string | null; // Actual Off-Block Time
  status: FlightStatus;
  /** Minutes late, negative when early. Null when not yet known. */
  delayMinutes: number | null;
  /** IATA delay code when the source supplies one. */
  delayCode: string | null;
  /** How many passengers are on this leg — drives every ZonePresence estimate. */
  passengerCount: number | null;
  /** True for non-Schengen/international legs; used for crowd composition. */
  international: boolean | null;
  aircraftType: string | null;
  gate: string | null;
  stand: string | null;
  checkInCounters: string[];
  belt: string | null;
  provenance: Provenance;
}

/** A gate, and what is assigned to it right now. */
export interface GateAssignment {
  gate: string;
  terminal: string;
  flightId: string | null;
  /** ISO 8601, when the assignment is valid from. */
  from: string | null;
  to: string | null;
  provenance: Provenance;
}

/** Aircraft type reference data — seat capacity drives pax estimates. */
export interface AircraftType {
  code: string;
  manufacturer: string | null;
  model: string | null;
  seatCapacity: number | null;
}

/**
 * A real-time update to a leg — the AIDX shape, normalised.
 *
 * This is the message that makes the demo work: a delay or gate change arrives
 * here, and everything downstream re-plans within the promised two seconds.
 */
export interface FlightEvent {
  id: string;
  flightId: string;
  /** What changed. */
  kind: 'status' | 'gate-change' | 'delay' | 'time-update' | 'cancelled';
  status: FlightStatus | null;
  previousGate: string | null;
  gate: string | null;
  delayMinutes: number | null;
  /** ISO 8601 — when the change takes effect. */
  effectiveAt: string | null;
  /** Free text from the source, for the incident/audit trail. */
  note: string | null;
  provenance: Provenance;
}

/** A terminal in the airport. */
export interface Terminal {
  id: string;
  name: string;
  /** Zones belonging to it. */
  zoneIds: string[];
}

/**
 * A zone: a concourse, a gate area, a retail cluster.
 *
 * Zones are where people are, so zones are what ads are matched against.
 */
export interface Zone {
  id: string;
  name: string;
  terminalId: string;
  /** What kind of space this is — a gate area behaves differently from retail. */
  kind: 'gate-area' | 'retail' | 'check-in' | 'security' | 'baggage' | 'lounge';
  /** Zone ids this one is adjacent to; used for dwell and flow estimation. */
  adjacentZoneIds: string[];
}

/** A checkpoint (security, immigration) and its current state. */
export interface Checkpoint {
  id: string;
  name: string;
  zoneId: string;
  open: boolean;
  provenance: Provenance;
}

/**
 * A queue measurement — the ACRIS contribution.
 *
 * ZonePresence blends this with flight-derived estimates: queues tell you how many
 * people are stuck somewhere, flights tell you who they are.
 */
export interface QueueMeasurement {
  id: string;
  checkpointId: string;
  /** People waiting right now. */
  queueLength: number | null;
  /** Average wait in seconds. */
  averageWaitSeconds: number | null;
  /** ISO 8601 — the start of the window this measures. */
  windowStart: string;
  /** Window length in seconds (ACRIS entities are windowed). */
  windowSeconds: number;
  provenance: Provenance;
}

/* ------------------------------------------------------------------------- */
/* The derived signal everything depends on                                   */
/* ------------------------------------------------------------------------- */

/**
 * Passenger presence in a zone, over a 5-minute window.
 *
 * This is the single most important entity in the system: the brief says every ad
 * decision and every dashboard KPI uses it. It is DERIVED, not sourced — computed
 * from flights at nearby gates and ACRIS queue data — so it is not an adapter
 * output, and it carries the provenance of its inputs rather than its own.
 */
export interface ZonePresence {
  zoneId: string;
  /** ISO 8601, start of the 5-minute window. */
  windowStart: string;
  /** Estimated passengers in the zone during the window. */
  estimatedCount: number;
  /** Where they are going, most common first. */
  topDestinations: { destination: string; count: number }[];
  /** Where they are from. */
  topOrigins: { origin: string; count: number }[];
  /** Share travelling internationally, 0..1. */
  internationalShare: number;
  /** Estimated minutes they will stay in the zone. */
  dwellMinutes: number | null;
  /** 0..1 — how much to trust this estimate. Low when inputs are stale or absent. */
  confidence: number;
  /** The inputs this was computed from, so a decision can be traced back. */
  evidence: Provenance[];
}

/* ------------------------------------------------------------------------- */
/* Platform-owned entities (no external standard)                             */
/* ------------------------------------------------------------------------- */

export interface Screen {
  id: string;
  name: string;
  zoneId: string;
  terminalId: string;
  /** Physical orientation drives which creative format fits. */
  orientation: '16:9' | '9:16' | 'other';
  resolution: { width: number; height: number } | null;
  online: boolean;
  /** ISO 8601 of the last heartbeat; staleness is an incident. */
  lastHeartbeat: string | null;
}

export interface Advertiser {
  id: string;
  name: string;
  /** "retailer" | "airline" | "brand" — drives which persona sees it. */
  kind: 'retailer' | 'airline' | 'brand';
}

export interface Outlet {
  id: string;
  advertiserId: string;
  name: string;
  zoneId: string;
  /** "duty-free" | "f&b" | "lounge" ... */
  category: string;
}

export interface Creative {
  id: string;
  campaignId: string;
  name: string;
  /** Language tag, so the two-language requirement is data, not a hack. */
  language: string;
  /** Which orientation it was authored for. */
  orientation: '16:9' | '9:16' | 'other';
  /** Where the asset lives, relative to the app. */
  assetPath: string | null;
  approval: 'pending' | 'approved' | 'rejected';
  brandSafetyNotes: string | null;
}

export interface Campaign {
  id: string;
  advertiserId: string;
  name: string;
  /** Which zones it may run in. Empty means anywhere. */
  zoneIds: string[];
  /** The audience it is trying to reach. */
  target: CampaignTarget;
  /** ISO 8601 booking window. */
  startAt: string;
  endAt: string;
  /** Offer shown on the creative, if any. */
  offer: string | null;
  creativeIds: string[];
  status: 'draft' | 'active' | 'paused' | 'ended';
}

/** The audience description the matcher scores a crowd against. */
export interface CampaignTarget {
  /** Destinations to prioritise, e.g. ["DXB"]. Empty means any. */
  destinations: string[];
  /** Origins to prioritise. Empty means any. */
  origins: string[];
  /** Prefer international (true) or domestic (false). Null means either. */
  international: boolean | null;
  /** Only run when at least this many people are in front of the screen. */
  minAudience: number;
  /** Only run within this many minutes of the relevant departure. */
  withinMinutesOfDeparture: number | null;
}

export interface PromoCode {
  id: string;
  campaignId: string;
  code: string;
  /** ISO 8601 — the countdown the passenger screen shows. */
  expiresAt: string;
  /** Cap, so a runaway code is visible rather than silent. */
  maxRedemptions: number | null;
  /** Shareable codes let one passenger hand a code to family. */
  shareable: boolean;
}

export interface Impression {
  id: string;
  screenId: string;
  campaignId: string;
  creativeId: string;
  /** ISO 8601, when it played. */
  playedAt: string;
  /** Seconds on screen. */
  durationSeconds: number;
  /** The decision that chose it, so the "why this ad?" panel can explain it. */
  decisionId: string;
}

export interface Redemption {
  id: string;
  promoCodeId: string;
  campaignId: string;
  outletId: string | null;
  /** ISO 8601. */
  redeemedAt: string;
  /** Money attributed, in minor units, to avoid float drift. */
  amountMinorUnits: number | null;
}

/* ------------------------------------------------------------------------- */
/* Adapter contract                                                           */
/* ------------------------------------------------------------------------- */

/**
 * The contract every source implements.
 *
 * The brief names this shape directly (`FlightSource.stream(): AsyncIterable`) and
 * says switching to live must be one config value. So the interface is fixed here,
 * each source ships a `mock` implementation and a `live` stub, and selection is a
 * single env value — never an `if` scattered through the core.
 */
export interface FlightSource {
  readonly name: string;
  /** Every leg known at start-up, for the first render. */
  snapshot(): Promise<Flight[]>;
  /** Subsequent updates, forever. */
  stream(): AsyncIterable<FlightEvent>;
}

export interface PresenceSource {
  readonly name: string;
  snapshot(): Promise<QueueMeasurement[]>;
  stream(): AsyncIterable<QueueMeasurement>;
}

export interface TopologySource {
  readonly name: string;
  terminals(): Promise<Terminal[]>;
  zones(): Promise<Zone[]>;
  checkpoints(): Promise<Checkpoint[]>;
}

/** A source that can be switched by config. `live` may be a not-implemented stub. */
export interface SwitchableSource<T> {
  mock(): T;
  live(): T;
}
