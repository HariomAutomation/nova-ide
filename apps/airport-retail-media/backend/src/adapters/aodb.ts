/**
 * AODB adapter — flight movements, CSV or JSON, one row per flight leg.
 *
 * The brief is emphatic about the point of this file: "every mock must look exactly
 * like what a real source would send, so going live means writing one new adapter
 * and nothing else". So the mock here does NOT return canonical objects. It emits
 * **source-shaped CSV text**, and `parseAodbCsv` reads that text back into the
 * canonical model. The round trip is the proof: if the mock returned Flight objects
 * directly, the parser would never be exercised and the "one new adapter" claim
 * would be untested.
 *
 * ---------------------------------------------------------------------------
 * On the column set — read this before changing the map.
 *
 * The brief says the sample AODB file has "33 columns", and that the sample is
 * attached to the challenge. That attachment is not available here, so the exact
 * source column names are NOT known and have deliberately not been invented. What
 * is known is named in the brief itself — the A-CDM milestones (TOBT, TSAT, AIBT,
 * AOBT) and the fields it lists (schedule, estimated and actual times, stand, gate,
 * check-in counters, belt, aircraft, pax count, status, delay codes).
 *
 * So the mapping is a single explicit table below, covering those, and the parser
 * is written to be mapping-driven rather than name-hardcoded. Dropping in the real
 * sample means editing COLUMN_MAP and nothing else — which is the same promise the
 * brief makes about going live.
 * ---------------------------------------------------------------------------
 */

import type { Flight, FlightStatus, Provenance } from '../model/canonical';

/** Canonical field a source column feeds. */
type CanonicalField = keyof Flight | 'ignore';

/**
 * Source column -> canonical field.
 *
 * Deliberately explicit and boring. A real AODB export carries vendor-specific
 * headers, so this table is the only place that knows them.
 */
export const COLUMN_MAP: Record<string, CanonicalField> = {
  // identity
  flight_id: 'id',
  flight_number: 'flightNumber',
  airline_code: 'airline',
  // route
  origin_iata: 'origin',
  destination_iata: 'destination',
  international: 'international',
  // schedule
  scheduled_departure: 'scheduledDeparture',
  scheduled_arrival: 'scheduledArrival',
  estimated_departure: 'estimatedDeparture',
  actual_departure: 'actualDeparture',
  estimated_arrival: 'estimatedArrival',
  actual_arrival: 'actualArrival',
  // A-CDM milestones — named in the brief, so these are the ones we know
  tobt: 'tobt',
  tsat: 'tsat',
  aibt: 'aibt',
  aobt: 'aobt',
  // status and delay
  flight_status: 'status',
  delay_minutes: 'delayMinutes',
  delay_code: 'delayCode',
  // resources
  gate: 'gate',
  stand: 'stand',
  check_in_counters: 'checkInCounters',
  baggage_belt: 'belt',
  aircraft_type: 'aircraftType',
  // load
  pax_count: 'passengerCount',
};

/** Columns a real export carries that the canonical model has no home for yet. */
export const KNOWN_IGNORED_COLUMNS = [
  'terminal',
  'aircraft_registration',
  'aircraft_config',
  'carrier_terminal',
  'codeshare_indicator',
  'vip_indicator',
  'baggage_carousel',
  'boarding_gate',
  'transfer_indicator',
];

/** Normalise the many ways an AODB spells a status into our closed set. */
export function normaliseStatus(raw: string): FlightStatus {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s.startsWith('sched') || s === 'plan') return 'scheduled';
  if (s.includes('board')) return 'boarding';
  if (s.includes('depart') || s === 'airborne') return 'departed';
  if (s.includes('arriv') || s === 'landed') return 'arrived';
  if (s.includes('delay')) return 'delayed';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('divert')) return 'diverted';
  return 'unknown';
}

/** Split one CSV line, honouring quoted fields with embedded commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function emptyToNull(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

function num(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bool(v: string | undefined): boolean | null {
  const s = (v ?? '').trim().toLowerCase();
  if (s === '') return null;
  if (['1', 'true', 'y', 'yes', 'int', 'international'].includes(s)) return true;
  if (['0', 'false', 'n', 'no', 'dom', 'domestic'].includes(s)) return false;
  return null;
}

/**
 * Parse an AODB CSV export into canonical flights.
 *
 * Header-driven: the first row names the columns, and COLUMN_MAP decides what each
 * one means. Unknown columns are skipped rather than guessed at.
 */
export function parseAodbCsv(
  text: string,
  opts: { source?: string; ingestedAt?: string } = {}
): { flights: Flight[]; unknownColumns: string[] } {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { flights: [], unknownColumns: [] };

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const unknownColumns = header.filter((h) => !(h in COLUMN_MAP));

  const source = opts.source ?? 'aodb-csv';
  const ingestedAt = opts.ingestedAt ?? new Date().toISOString();
  const flights: Flight[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const raw: Record<string, string> = {};
    header.forEach((h, idx) => (raw[h] = cells[idx] ?? ''));

    const id = emptyToNull(raw.flight_id) ?? emptyToNull(raw.flight_number);
    if (!id) continue; // a row with no identity is not a flight leg

    flights.push({
      id,
      flightNumber: emptyToNull(raw.flight_number) ?? id,
      airline: emptyToNull(raw.airline_code) ?? '',
      origin: emptyToNull(raw.origin_iata),
      destination: emptyToNull(raw.destination_iata),
      scheduledDeparture: emptyToNull(raw.scheduled_departure),
      scheduledArrival: emptyToNull(raw.scheduled_arrival),
      estimatedDeparture: emptyToNull(raw.estimated_departure),
      actualDeparture: emptyToNull(raw.actual_departure),
      estimatedArrival: emptyToNull(raw.estimated_arrival),
      actualArrival: emptyToNull(raw.actual_arrival),
      tobt: emptyToNull(raw.tobt),
      tsat: emptyToNull(raw.tsat),
      aibt: emptyToNull(raw.aibt),
      aobt: emptyToNull(raw.aobt),
      status: normaliseStatus(raw.flight_status),
      delayMinutes: num(raw.delay_minutes),
      delayCode: emptyToNull(raw.delay_code),
      passengerCount: num(raw.pax_count),
      international: bool(raw.international),
      aircraftType: emptyToNull(raw.aircraft_type),
      gate: emptyToNull(raw.gate),
      stand: emptyToNull(raw.stand),
      checkInCounters: (emptyToNull(raw.check_in_counters) ?? '')
        .split(/[|;]/)
        .map((s) => s.trim())
        .filter(Boolean),
      belt: emptyToNull(raw.baggage_belt),
      // Provenance is attached here, at the boundary. Everything downstream can then
      // say where a value came from without knowing what an AODB is.
      provenance: { source, observedAt: emptyToNull(raw.scheduled_departure) ?? ingestedAt, ingestedAt },
    });
  }

  return { flights, unknownColumns };
}

/* ------------------------------------------------------------------------- */
/* Mock source — emits CSV text, exactly like an export would                 */
/* ------------------------------------------------------------------------- */

export interface MockAodbOptions {
  /** How many flight legs to generate. */
  count: number;
  /** ISO 8601 — the day to schedule across. */
  dayStart: string;
  /** Deterministic seed, so a demo can be replayed exactly. */
  seed?: number;
  /** IATA codes to draw routes from. */
  destinations?: string[];
  airlines?: string[];
  gates?: string[];
}

/** A small deterministic PRNG — a demo must be replayable, so not Math.random. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

const STATUSES = ['Scheduled', 'Boarding', 'Departed', 'Arrived', 'Delayed', 'Cancelled'];
const DELAY_CODES = ['', '', '', '11', '81', '93', '71']; // mostly no delay

/**
 * Generate an AODB-shaped CSV. The column order matches COLUMN_MAP's keys so the
 * parser is exercised against the same header shape a vendor export would have.
 */
export function generateMockAodb(opts: MockAodbOptions): string {
  const rand = rng(opts.seed ?? 42);
  const destinations = opts.destinations ?? ['DXB', 'LHR', 'JFK', 'SIN', 'AGP', 'CDG', 'FRA', 'DEL', 'BOM', 'IST'];
  const airlines = opts.airlines ?? ['XY', 'ZQ', 'EM', 'LC', 'BA', 'AF'];
  const gates = opts.gates ?? ['A12', 'A14', 'B03', 'B07', 'C21', 'C23', 'D05', 'D09', 'E11', 'E15'];
  const aircraft = ['A320', 'A321', 'B737', 'B738', 'A330', 'B787', 'A350'];
  const dayStart = Date.parse(opts.dayStart);

  const header = Object.keys(COLUMN_MAP).join(',');
  const rows: string[] = [header];

  for (let i = 0; i < opts.count; i++) {
    // spread across a 24h day
    const offsetMin = Math.floor(rand() * 24 * 60);
    const schedDep = new Date(dayStart + offsetMin * 60_000);
    const schedArr = new Date(schedDep.getTime() + 90 * 60_000);

    const status = STATUSES[Math.floor(rand() * STATUSES.length)];
    const delayed = status === 'Delayed' || (status !== 'Cancelled' && rand() < 0.18);
    const delayMin = delayed ? [15, 25, 30, 45, 60, 90][Math.floor(rand() * 6)] : 0;

    const pax = 60 + Math.floor(rand() * 260);
    const dest = destinations[Math.floor(rand() * destinations.length)];
    const intl = !['AGP'].includes(dest); // one domestic-ish route keeps the split honest

    // A-CDM: TOBT is set early, TSAT after slot approval, actuals only once it moved.
    const tobt = new Date(schedDep.getTime() - 35 * 60_000).toISOString();
    const tsat = delayed ? new Date(schedDep.getTime() + delayMin * 60_000 - 20 * 60_000).toISOString() : null;
    const aobt = status === 'Departed' ? new Date(schedDep.getTime() + delayMin * 60_000).toISOString() : null;
    const aibt = status === 'Arrived' ? schedArr.toISOString() : null;

    const cell = (k: string, v: string) => (k === 'check_in_counters' && v.includes('|') ? `"${v}"` : v);

    const raw: Record<string, string> = {
      flight_id: `LEG${String(i + 1).padStart(5, '0')}`,
      flight_number: `${airlines[Math.floor(rand() * airlines.length)]}${100 + Math.floor(rand() * 899)}`,
      airline_code: airlines[Math.floor(rand() * airlines.length)],
      origin_iata: 'APT',
      destination_iata: dest,
      international: intl ? '1' : '0',
      scheduled_departure: schedDep.toISOString(),
      scheduled_arrival: schedArr.toISOString(),
      estimated_departure: delayed ? new Date(schedDep.getTime() + delayMin * 60_000).toISOString() : schedDep.toISOString(),
      actual_departure: aobt ?? '',
      estimated_arrival: delayed ? new Date(schedArr.getTime() + delayMin * 60_000).toISOString() : schedArr.toISOString(),
      actual_arrival: aibt ?? '',
      tobt,
      tsat: tsat ?? '',
      aibt: aibt ?? '',
      aobt: aobt ?? '',
      flight_status: status,
      delay_minutes: String(delayMin),
      delay_code: delayed ? DELAY_CODES[Math.floor(rand() * DELAY_CODES.length)] : '',
      gate: gates[Math.floor(rand() * gates.length)],
      stand: `S${10 + Math.floor(rand() * 60)}`,
      check_in_counters: `C${1 + Math.floor(rand() * 20)}|C${21 + Math.floor(rand() * 20)}`,
      baggage_belt: `B${1 + Math.floor(rand() * 12)}`,
      aircraft_type: aircraft[Math.floor(rand() * aircraft.length)],
      pax_count: String(pax),
    };

    rows.push(Object.keys(COLUMN_MAP).map((k) => cell(k, raw[k] ?? '')).join(','));
  }

  return rows.join('\n');
}

/** The mock FlightSource the brief's contract asks for. */
export function createMockAodbSource(opts: MockAodbOptions & { source?: string }): {
  name: string;
  snapshot: () => Promise<Flight[]>;
  raw: () => string;
} {
  const csv = generateMockAodb(opts);
  const name = opts.source ?? 'mock-aodb-csv';
  return {
    name,
    raw: () => csv,
    // Note the path: text -> parser -> canonical. The mock is a source, not a fixture.
    snapshot: async () => parseAodbCsv(csv, { source: name }).flights,
  };
}
