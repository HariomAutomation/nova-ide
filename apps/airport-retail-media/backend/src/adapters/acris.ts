/**
 * ACRIS adapter — ACI ACRIS / FIWARE Smart Data Models, NGSI-LD JSON.
 *
 * This is the third and last source, and it completes the spine:
 *
 *   AODB (schedule) + AIDX (live events) + ACRIS (queues) -> ZonePresence -> decision
 *
 * ACRIS supplies topology (terminals, zones, checkpoints) and the queue measurements
 * that tell ZonePresence how many people are stuck somewhere. Flights say who is in
 * a zone; ACRIS says how many are waiting to get into one.
 *
 * ---------------------------------------------------------------------------
 * The one thing that matters about NGSI-LD, and the reason this is not a thin
 * passthrough: values are WRAPPED. A queue length is not `140`, it is
 *
 *   "queueLength": { "type": "Property", "value": 140, "observedAt": "..." }
 *
 * and a link to another entity is not a string, it is
 *
 *   "checkpointId": { "type": "Relationship", "object": "urn:ngsi-ld:Checkpoint:..." }
 *
 * A parser that assumes plain values reads `undefined` for every field and produces
 * entities that look empty rather than broken — the worst kind of failure, because
 * nothing throws. So unwrapping is explicit, and an unwrapped value is reported when
 * the shape is not what we expect instead of being coerced.
 * ---------------------------------------------------------------------------
 */

import type { Checkpoint, Provenance, QueueMeasurement, Terminal, Zone } from '../model/canonical.js';

/** An NGSI-LD attribute as it arrives on the wire. */
export interface NgsiProperty<T = unknown> {
  type: 'Property';
  value: T;
  observedAt?: string;
}

export interface NgsiRelationship {
  type: 'Relationship';
  object: string;
  observedAt?: string;
}

export interface NgsiEntity {
  id: string;
  type: string;
  [attr: string]: unknown;
}

/** Read a Property's value, or null when the attribute is absent or mis-shaped. */
export function prop<T>(entity: NgsiEntity, name: string): T | null {
  const raw = entity[name];
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object' && raw !== null && (raw as NgsiProperty).type === 'Property') {
    return (raw as NgsiProperty<T>).value ?? null;
  }
  // A bare value where a Property was expected. NGSI-LD does not allow this, so it
  // is a source problem worth surfacing rather than silently accepting.
  return null;
}

/** Read a Relationship's target id, or null. */
export function rel(entity: NgsiEntity, name: string): string | null {
  const raw = entity[name];
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object' && raw !== null && (raw as NgsiRelationship).type === 'Relationship') {
    return (raw as NgsiRelationship).object ?? null;
  }
  if (typeof raw === 'string') return raw;
  return null;
}

/** When the source says this value was observed, if it says. */
export function observedAt(entity: NgsiEntity, name: string): string | null {
  const raw = entity[name];
  if (raw && typeof raw === 'object' && (raw as NgsiProperty).observedAt) {
    return (raw as NgsiProperty).observedAt as string;
  }
  return (entity.observedAt as string | undefined) ?? null;
}

/** Strip the `urn:ngsi-ld:<Type>:` prefix so ids match the rest of the system. */
export function shortId(id: string): string {
  const m = String(id).match(/^urn:ngsi-ld:[^:]+:(.*)$/);
  return m ? m[1] : String(id);
}

export interface AcrisParseResult {
  terminals: Terminal[];
  zones: Zone[];
  checkpoints: Checkpoint[];
  queues: QueueMeasurement[];
  /** Entities we could not read, reported rather than dropped silently. */
  unparsed: string[];
}

/**
 * Read an NGSI-LD batch into canonical topology and queue measurements.
 *
 * Accepts either an array of entities or a JSON-LD `@graph` wrapper, because real
 * ACRIS endpoints return both depending on the broker.
 */
export function parseAcris(
  input: unknown,
  opts: { source?: string; ingestedAt?: string; windowSeconds?: number } = {}
): AcrisParseResult {
  const source = opts.source ?? 'acris-ngsi';
  const ingestedAt = opts.ingestedAt ?? new Date().toISOString();
  const windowSeconds = opts.windowSeconds ?? 300;

  const out: AcrisParseResult = { terminals: [], zones: [], checkpoints: [], queues: [], unparsed: [] };

  let entities: NgsiEntity[] = [];
  if (Array.isArray(input)) entities = input as NgsiEntity[];
  else if (input && typeof input === 'object' && Array.isArray((input as { '@graph'?: unknown })['@graph'])) {
    entities = (input as { '@graph': NgsiEntity[] })['@graph'];
  } else if (input && typeof input === 'object') {
    entities = [input as NgsiEntity];
  } else {
    out.unparsed.push('input is neither an entity array nor an @graph wrapper');
    return out;
  }

  for (const e of entities) {
    if (!e || typeof e !== 'object' || !e.id || !e.type) {
      out.unparsed.push('entity without id or type');
      continue;
    }
    const id = shortId(e.id);
    const prov: Provenance = {
      source,
      observedAt: (e.observedAt as string) ?? observedAt(e, 'queueLength') ?? ingestedAt,
      ingestedAt,
    };

    switch (e.type) {
      case 'Terminal': {
        const name = prop<string>(e, 'name');
        if (!name) { out.unparsed.push(`${id}: Terminal without a name`); break; }
        out.terminals.push({ id, name, zoneIds: [] }); // zones link themselves to a terminal
        break;
      }
      case 'Zone': {
        const name = prop<string>(e, 'name');
        const terminalId = rel(e, 'terminalId') ?? rel(e, 'refTerminal');
        const kind = (prop<string>(e, 'zoneType') ?? prop<string>(e, 'kind') ?? 'retail').toLowerCase();
        if (!name) { out.unparsed.push(`${id}: Zone without a name`); break; }
        out.zones.push({
          id,
          name,
          terminalId: terminalId ? shortId(terminalId) : '',
          kind: normaliseZoneKind(kind),
          adjacentZoneIds: [],
        });
        break;
      }
      case 'Checkpoint': {
        const name = prop<string>(e, 'name');
        const zoneId = rel(e, 'zoneId') ?? rel(e, 'refZone');
        const open = prop<boolean>(e, 'open');
        if (!name) { out.unparsed.push(`${id}: Checkpoint without a name`); break; }
        out.checkpoints.push({
          id,
          name,
          zoneId: zoneId ? shortId(zoneId) : '',
          open: open === null ? true : open,
          provenance: prov,
        });
        break;
      }
      case 'QueueMeasurement': {
        const checkpointId = rel(e, 'checkpointId') ?? rel(e, 'refCheckpoint');
        if (!checkpointId) { out.unparsed.push(`${id}: QueueMeasurement with no checkpoint`); break; }
        const length = prop<number>(e, 'queueLength') ?? prop<number>(e, 'numPeopleInQueue');
        const wait = prop<number>(e, 'averageWaitSeconds') ?? prop<number>(e, 'waitTimeSeconds');
        out.queues.push({
          id,
          checkpointId: shortId(checkpointId),
          queueLength: typeof length === 'number' ? length : null,
          averageWaitSeconds: typeof wait === 'number' ? wait : null,
          windowStart: (e.observedAt as string) ?? prov.observedAt,
          windowSeconds: prop<number>(e, 'windowSeconds') ?? windowSeconds,
          provenance: prov,
        });
        break;
      }
      default:
        out.unparsed.push(`${id}: unhandled entity type "${e.type}"`);
    }
  }

  // Link zones to terminals now that both sides exist.
  const byTerminal = new Map<string, string[]>();
  for (const z of out.zones) {
    if (!z.terminalId) continue;
    byTerminal.set(z.terminalId, [...(byTerminal.get(z.terminalId) ?? []), z.id]);
  }
  out.terminals = out.terminals.map((t) => ({ ...t, zoneIds: byTerminal.get(t.id) ?? [] }));

  return out;
}

function normaliseZoneKind(raw: string): Zone['kind'] {
  const s = raw.toLowerCase();
  if (s.includes('gate')) return 'gate-area';
  if (s.includes('retail') || s.includes('shop')) return 'retail';
  if (s.includes('check')) return 'check-in';
  if (s.includes('security') || s.includes('immigration')) return 'security';
  if (s.includes('baggage') || s.includes('belt')) return 'baggage';
  if (s.includes('lounge')) return 'lounge';
  return 'retail';
}

/* ------------------------------------------------------------------------- */
/* Mock source — emits NGSI-LD JSON, exactly like a broker would               */
/* ------------------------------------------------------------------------- */

export interface MockAcrisOptions {
  terminals?: string[];
  /** Zones per terminal. */
  zonesPerTerminal?: number;
  seed?: number;
  observedAt?: string;
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

/** Wrap a value the way NGSI-LD does, so the mock cannot be mistaken for canonical. */
function p<T>(value: T, observedAt?: string): NgsiProperty<T> {
  return observedAt ? { type: 'Property', value, observedAt } : { type: 'Property', value };
}

function r(object: string): NgsiRelationship {
  return { type: 'Relationship', object };
}

/**
 * Generate an ACRIS batch as NGSI-LD JSON.
 *
 * Returns the wire shape, not canonical entities: `@graph`, `urn:ngsi-ld:` ids and
 * `{type, value}` wrappers all present. The test round-trips it through the parser,
 * which is the only way to be sure the unwrapping is right.
 */
export function generateMockAcris(opts: MockAcrisOptions = {}): { '@context': string; '@graph': NgsiEntity[] } {
  const rand = rng(opts.seed ?? 23);
  const terminals = opts.terminals ?? ['T1', 'T2'];
  const zonesPerTerminal = opts.zonesPerTerminal ?? 4;
  const observedAt = opts.observedAt ?? new Date().toISOString();

  const graph: NgsiEntity[] = [];
  const ZONE_KINDS = ['gate-area', 'retail', 'security', 'lounge'];

  for (const t of terminals) {
    graph.push({
      id: `urn:ngsi-ld:Terminal:${t}`,
      type: 'Terminal',
      name: p(`Terminal ${t}`, observedAt),
      observedAt,
    });

    for (let z = 0; z < zonesPerTerminal; z++) {
      const zoneId = `${t}-Z${z + 1}`;
      const kind = ZONE_KINDS[z % ZONE_KINDS.length];
      graph.push({
        id: `urn:ngsi-ld:Zone:${zoneId}`,
        type: 'Zone',
        name: p(`${kind} ${zoneId}`, observedAt),
        zoneType: p(kind, observedAt),
        terminalId: r(`urn:ngsi-ld:Terminal:${t}`),
        observedAt,
      });

      // a checkpoint per security zone, and a queue measurement for it
      if (kind === 'security') {
        const cpId = `${zoneId}-CP`;
        graph.push({
          id: `urn:ngsi-ld:Checkpoint:${cpId}`,
          type: 'Checkpoint',
          name: p(`Checkpoint ${cpId}`, observedAt),
          zoneId: r(`urn:ngsi-ld:Zone:${zoneId}`),
          open: p(rand() > 0.1, observedAt),
          observedAt,
        });
        graph.push({
          id: `urn:ngsi-ld:QueueMeasurement:${cpId}-${observedAt}`,
          type: 'QueueMeasurement',
          checkpointId: r(`urn:ngsi-ld:Checkpoint:${cpId}`),
          queueLength: p(Math.floor(rand() * 260), observedAt),
          averageWaitSeconds: p(120 + Math.floor(rand() * 600), observedAt),
          windowSeconds: p(300, observedAt),
          observedAt,
        });
      }
    }
  }

  return {
    '@context': 'https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld',
    '@graph': graph,
  };
}

/** The mock topology + presence source the brief's contract asks for. */
export function createMockAcrisSource(opts: MockAcrisOptions = {}): {
  name: string;
  raw: () => string;
  snapshot: () => Promise<AcrisParseResult>;
} {
  const batch = generateMockAcris(opts);
  const name = 'mock-acris-ngsi';
  const text = JSON.stringify(batch);
  return {
    name,
    raw: () => text,
    // text -> parser -> canonical, same as every other adapter
    snapshot: async () => parseAcris(JSON.parse(text), { source: name }),
  };
}
