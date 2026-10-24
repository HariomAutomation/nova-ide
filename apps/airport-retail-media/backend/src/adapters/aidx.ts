/**
 * AIDX adapter — IATA AIDX real-time flight-leg notifications.
 *
 * This is the feed that makes the demo's headline feature possible. The brief's
 * "live cause and effect (<2s)" starts here: a delay or gate change arrives as an
 * AIDX message, and everything downstream re-plans from it. So the mock pushes
 * **real XML text** on a stream, exactly as a feed would, and the parser reads that
 * text back — same discipline as the AODB adapter, and for the same reason: a mock
 * that hands over FlightEvent objects would leave the parser untested and the "one
 * new adapter" promise unproven.
 *
 * ---------------------------------------------------------------------------
 * On the parser. There is no XML parser in the Node standard library, and pulling a
 * dependency in for one message shape is not worth it. What follows is a TARGETED
 * reader for the elements this message carries, not a general XML parser — it does
 * not do namespaces, entities beyond the basics, CDATA, or attribute inheritance.
 * It is written to be honest about that rather than to look more general than it is,
 * and it fails loudly on the parts it cannot handle instead of guessing.
 *
 * The real message is `IATA_AIDX_FlightLegNotifRQ`, whose relevant shape is:
 *
 *   <FlightLegNotifRQ>
 *     <FlightLeg>
 *       <FlightKey>
 *         <Airline>XY</Airline><FlightNumber>501</FlightNumber>
 *         <DepartureDate>2026-10-24</DepartureDate>
 *       </FlightKey>
 *       <LegData>
 *         <FlightStatus>Delayed</FlightStatus>
 *         <LegDeparture>
 *           <ScheduledDateTime>...</ScheduledDateTime>
 *           <EstimatedDateTime>...</EstimatedDateTime>
 *           <AirportResources><Departure><Gate>B12</Gate></Departure></AirportResources>
 *         </LegDeparture>
 *       </LegData>
 *     </FlightLeg>
 *   </FlightLegNotifRQ>
 * ---------------------------------------------------------------------------
 */

import type { FlightEvent, FlightStatus, Provenance } from '../model/canonical.js';

/** Pull the text of the first `<tag>` inside a fragment, or null. */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  const inner = m[1].trim();
  return inner === '' ? null : decodeEntities(inner);
}

/** The few entities a real feed actually uses. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeEntities(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** AIDX status vocabulary -> the canonical closed set. */
export function normaliseAidxStatus(raw: string | null): FlightStatus | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (s === '') return null;
  if (s.startsWith('sched')) return 'scheduled';
  if (s.includes('boarding')) return 'boarding';
  if (s.includes('departed') || s.includes('airborne')) return 'departed';
  if (s.includes('arrived') || s.includes('landed')) return 'arrived';
  if (s.includes('delay')) return 'delayed';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('divert')) return 'diverted';
  return 'unknown';
}

/**
 * The flight id this adapter keys on.
 *
 * AODB rows carry an explicit leg id; AIDX identifies a leg by airline + number +
 * date. Both must resolve to the SAME id or an event would not find its flight, so
 * the composition is written once, here, and mirrored by the AODB adapter's id when
 * a live AIDX feed replaces the mock. That mismatch is the single most likely way
 * for this integration to fail silently, so it is stated rather than assumed.
 */
export function flightKey(airline: string, flightNumber: string, departureDate: string): string {
  return `${airline.trim().toUpperCase()}${flightNumber.trim()}-${departureDate.trim()}`;
}

export interface ParseResult {
  events: FlightEvent[];
  /** Messages the targeted reader could not make sense of. Reported, not swallowed. */
  unparsed: string[];
}

/**
 * Read an AIDX batch into canonical events.
 *
 * A single notification carries one or more `<FlightLeg>` blocks; each becomes one
 * event, because the pipeline consumes events, not documents.
 */
export function parseAidx(xml: string, opts: { source?: string; ingestedAt?: string } = {}): ParseResult {
  const source = opts.source ?? 'aidx-xml';
  const ingestedAt = opts.ingestedAt ?? new Date().toISOString();
  const events: FlightEvent[] = [];
  const unparsed: string[] = [];

  const legs = String(xml).match(/<FlightLeg(?:\s[^>]*)?>[\s\S]*?<\/FlightLeg>/gi) ?? [];
  if (!legs.length) {
    if (String(xml).trim()) unparsed.push('no <FlightLeg> blocks found');
    return { events, unparsed };
  }

  legs.forEach((leg, i) => {
    const airline = tag(leg, 'Airline');
    const number = tag(leg, 'FlightNumber');
    const date = tag(leg, 'DepartureDate');
    if (!airline || !number || !date) {
      unparsed.push(`leg ${i}: missing Airline/FlightNumber/DepartureDate, cannot key it to a flight`);
      return;
    }

    const status = normaliseAidxStatus(tag(leg, 'FlightStatus'));
    const gate = tag(leg, 'Gate');
    const estimated = tag(leg, 'EstimatedDateTime');
    const scheduled = tag(leg, 'ScheduledDateTime');

    // What KIND of change is this? The pipeline routes on this, so it is derived
    // from what the message actually contains rather than from a field the feed
    // does not always send.
    let kind: FlightEvent['kind'] = 'time-update';
    if (status === 'cancelled') kind = 'cancelled';
    else if (gate) kind = 'gate-change';
    else if (status === 'delayed') kind = 'delay';
    else if (status) kind = 'status';

    let delayMinutes: number | null = null;
    if (scheduled && estimated) {
      const a = Date.parse(scheduled);
      const b = Date.parse(estimated);
      if (!Number.isNaN(a) && !Number.isNaN(b)) delayMinutes = Math.round((b - a) / 60_000);
    }

    const provenance: Provenance = { source, observedAt: estimated ?? scheduled ?? ingestedAt, ingestedAt };

    events.push({
      id: `evt-${i}-${flightKey(airline, number, date)}`,
      flightId: flightKey(airline, number, date),
      kind,
      status,
      previousGate: null, // AIDX sends the new gate; the previous one is our own history
      gate,
      delayMinutes,
      effectiveAt: estimated ?? null,
      note: tag(leg, 'Remark') ?? tag(leg, 'FlightStatusRemark'),
      provenance,
    });
  });

  return { events, unparsed };
}

/* ------------------------------------------------------------------------- */
/* Mock feed — emits XML text, on a stream                                    */
/* ------------------------------------------------------------------------- */

export interface MockAidxOptions {
  /** Legs the mock feed may send events for. */
  legs: { airline: string; flightNumber: string; departureDate: string }[];
  /** Deterministic seed, so a demo replays exactly. */
  seed?: number;
  /** How many messages the stream produces before it stops. Infinity to keep going. */
  messages?: number;
  /** Milliseconds between messages. 0 makes a test run instantly. */
  intervalMs?: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

/** Build one `IATA_AIDX_FlightLegNotifRQ` message, as text. */
export function buildAidxMessage(input: {
  airline: string;
  flightNumber: string;
  departureDate: string;
  status: string;
  scheduled?: string | null;
  estimated?: string | null;
  gate?: string | null;
  remark?: string | null;
}): string {
  const esc = encodeEntities;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<FlightLegNotifRQ xmlns="http://www.iata.org/IATA/2015/00/2018.1/AIDX">',
    '  <FlightLeg>',
    '    <FlightKey>',
    `      <Airline>${esc(input.airline)}</Airline>`,
    `      <FlightNumber>${esc(input.flightNumber)}</FlightNumber>`,
    `      <DepartureDate>${esc(input.departureDate)}</DepartureDate>`,
    '    </FlightKey>',
    '    <LegData>',
    `      <FlightStatus>${esc(input.status)}</FlightStatus>`,
    '      <LegDeparture>',
    input.scheduled ? `        <ScheduledDateTime>${esc(input.scheduled)}</ScheduledDateTime>` : '',
    input.estimated ? `        <EstimatedDateTime>${esc(input.estimated)}</EstimatedDateTime>` : '',
    input.gate ? `        <AirportResources><Departure><Gate>${esc(input.gate)}</Gate></Departure></AirportResources>` : '',
    '      </LegDeparture>',
    input.remark ? `      <Remark>${esc(input.remark)}</Remark>` : '',
    '    </LegData>',
    '  </FlightLeg>',
    '</FlightLegNotifRQ>',
  ].filter((l) => l !== '').join('\n');
}

/**
 * A mock AIDX feed.
 *
 * `stream()` yields message TEXT, not events, so the parser is in the path. That is
 * the whole point of the contract: swapping in the live feed means replacing this
 * function and nothing else.
 */
export function createMockAidxSource(opts: MockAidxOptions): {
  name: string;
  stream: () => AsyncIterable<string>;
} {
  const name = 'mock-aidx-xml';
  const messages = opts.messages ?? 12;
  const intervalMs = opts.intervalMs ?? 0;
  const rand = rng(opts.seed ?? 11);

  const STATUSES = ['Delayed', 'Boarding', 'Departed', 'Cancelled', 'Scheduled'];
  const GATES = ['B12', 'B14', 'C21', 'C23', 'D05', 'A12'];

  async function* gen(): AsyncIterable<string> {
    for (let i = 0; i < messages; i++) {
      const leg = opts.legs[Math.floor(rand() * opts.legs.length)];
      if (!leg) break;
      const status = STATUSES[Math.floor(rand() * STATUSES.length)];
      const sched = `${leg.departureDate}T14:00:00.000Z`;
      const delay = status === 'Delayed' ? [15, 30, 45, 60][Math.floor(rand() * 4)] : 0;
      const est = new Date(Date.parse(sched) + delay * 60_000).toISOString();
      yield buildAidxMessage({
        airline: leg.airline,
        flightNumber: leg.flightNumber,
        departureDate: leg.departureDate,
        status,
        scheduled: sched,
        estimated: est,
        // A gate is only present when the message IS a gate change. Sending one on
        // every message makes every event a gate-change and the delay/status kinds
        // never occur — which would break the demo's headline trigger ("delay this
        // flight 45 min") because a delay event would never be produced.
        gate: status === 'Cancelled' || rand() > 0.4 ? null : GATES[Math.floor(rand() * GATES.length)],
        remark: status === 'Delayed' ? 'Late inbound aircraft' : null,
      });
      if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return { name, stream: gen };
}

/** Parse a whole stream of messages into events. */
export async function collectEvents(
  messages: AsyncIterable<string>,
  opts: { source?: string; ingestedAt?: string } = {}
): Promise<ParseResult> {
  const events: FlightEvent[] = [];
  const unparsed: string[] = [];
  for await (const msg of messages) {
    const r = parseAidx(msg, opts);
    events.push(...r.events);
    unparsed.push(...r.unparsed);
  }
  return { events, unparsed };
}
