/**
 * Challenge workflow — the backend for using Nova on a real contest.
 *
 * The idea: a challenge brief is just another kind of requirement set, so it gets
 * the same treatment as security findings — ingested once, stored per workspace,
 * tracked item by item, and only then packaged for submission. The agent works
 * against the checklist instead of against a wall of markdown.
 *
 * Three pieces:
 *   spec      — pull a challenge (TopCoder URL/id, or a pasted brief) and turn it
 *               into a requirement checklist
 *   checklist — per-workspace store with per-item status, so progress is visible
 *   packaging — bundle the deliverables into a zip, dependency-free
 *
 * The zip writer is hand-rolled on purpose: no archiver dependency, deterministic
 * output, and it can be verified with the system `unzip`.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { configRoot } = require('./paths');

type ItemStatus = 'pending' | 'generating' | 'done' | 'verified' | 'skipped';

const ITEM_STATUSES: ItemStatus[] = ['pending', 'generating', 'done', 'verified', 'skipped'];

interface ReqItem {
  id: string;
  text: string;
  group: string;
  status: ItemStatus;
  note: string;
  updatedAt: string | null;
}

interface ChallengeSpec {
  workspace: string;
  source: string;
  id: string | null;
  name: string;
  url: string | null;
  tags: string[];
  track: string | null;
  deadlines: { phase: string; at: string }[];
  items: ReqItem[];
  createdAt: string;
  updatedAt: string | null;
}

/* ============================== spec ingest ============================== */

const TOPCODER_API = 'https://api.topcoder.com/v6/challenges';

/** Accepts a full challenge URL, or a bare id. Returns null when it is neither. */
export function parseChallengeId(input: string): string | null {
  const s = String(input || '').trim();
  if (!s) return null;
  const url = s.match(/topcoder\.com\/challenges\/([0-9a-fA-F-]{8,})/);
  if (url) return url[1];
  // a bare uuid
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) return s;
  // legacy numeric challenge id
  if (/^\d{5,9}$/.test(s)) return s;
  return null;
}

/** A short, stable id for a checklist line. */
function itemId(group: string, text: string): string {
  return crypto.createHash('sha1').update(`${group}|${text}`).digest('hex').slice(0, 12);
}

/** Lines that look like a requirement rather than prose. */
const NUMBERED = /^\s*(?:0?(\d{1,3}))[).]\s+(.+?)\s*$/;
const BULLET = /^\s*[*\-+]\s+(.+?)\s*$/;
const HEADER = /^\s*(?:#{1,6}\s+(.+?)|\*\*(.+?)\*\*)\s*:?\s*$/;

/** Noise that appears in challenge briefs but is not a requirement. */
const NOISE = /^(how to compete|you (can|may|should) submit|if your submission wins|new to studio|please read|note:|notes about|we will|you must watch|pm and copilot)/i;

/**
 * Turn a challenge description (markdown) into checklist items, grouped by the
 * nearest preceding heading. Numbered entries win over bullets when both match.
 */
export function extractRequirements(description: string): { text: string; group: string }[] {
  const lines = String(description || '').split('\n');
  const out: { text: string; group: string }[] = [];
  const seen = new Set<string>();
  let group = 'General';

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const h = HEADER.exec(line);
    if (h) {
      const title = (h[1] || h[2] || '').trim();
      // A heading is a group, not a requirement — unless it is a requirement line
      // like "**FINAL SUBMISSION REQUIREMENTS**" followed by the items.
      if (title) group = title.replace(/[*_`]/g, '').replace(/:+\s*$/, '').trim().slice(0, 80);
      continue;
    }

    if (NOISE.test(line.replace(/^[\s*\-]+/, ''))) continue;

    const n = NUMBERED.exec(line);
    const b = n ? null : BULLET.exec(line);
    const text = ((n && n[2]) || (b && b[1]) || '').trim();
    if (!text) continue;
    if (text.length < 3 || text.length > 400) continue;
    if (/^https?:\/\//i.test(text)) continue;

    const key = `${group}|${text}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, group });
  }

  return out;
}

/**
 * Fetch a challenge from the TopCoder API and shape it for the checklist.
 * `fetchImpl` is injectable so this is testable without the network.
 */
export async function fetchChallenge(
  id: string,
  opts: { fetchImpl?: any; timeoutMs?: number } = {}
): Promise<{ ok: boolean; error?: string; challenge?: any }> {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'no fetch available' };
  const timeoutMs = opts.timeoutMs || 20000;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${TOPCODER_API}/${encodeURIComponent(id)}`, {
      signal: ctrl ? ctrl.signal : undefined,
      headers: { accept: 'application/json' },
    });
    if (!res || !res.ok) return { ok: false, error: `TopCoder API returned HTTP ${res && res.status}` };
    const j = await res.json();
    if (!j || !j.name) return { ok: false, error: 'unexpected API shape (no name)' };

    const phases = Array.isArray(j.phases) ? j.phases : [];
    const deadlines = phases
      .filter((p: any) => p && p.name && (p.scheduledEndDate || p.actualEndDate))
      .map((p: any) => ({ phase: String(p.name), at: String(p.scheduledEndDate || p.actualEndDate) }));

    const meta = Array.isArray(j.metadata) ? j.metadata : [];
    const fileTypes = (meta.find((m: any) => m && m.name === 'fileTypes') || {}).value;

    return {
      ok: true,
      challenge: {
        id: String(j.id || id),
        name: String(j.name),
        description: String(j.description || ''),
        url: `https://www.topcoder.com/challenges/${j.id || id}`,
        tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
        // The track decides whether this is work Nova can actually deliver.
        // A Design challenge wants a Figma file, which no agent here can author.
        track: (j.track && (j.track.track || j.track.name)) || null,
        deadlines,
        submissionEndDate: j.submissionEndDate ? String(j.submissionEndDate) : null,
        registrants: Number(j.numOfRegistrants || 0),
        submissions: Number(j.numOfSubmissions || 0),
        fileTypes: fileTypes ? String(fileTypes) : null,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `fetch failed: ${(e && e.message) || e}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Can Nova actually deliver this challenge? Design contests want a Figma file
 * (.fig) — no agent here can author one, so say so up front rather than letting
 * the checklist imply the work is doable.
 */
export function deliverability(track: string | null | undefined): { ok: boolean; note: string } {
  const t = String(track || '').toLowerCase().trim();
  if (!t) return { ok: true, note: 'Track not stated — check the brief.' };
  if (t.includes('design')) {
    return {
      ok: false,
      note:
        'This is a DESIGN challenge. The deliverable is a Figma (.fig) file, which Nova cannot author, and winners must hand over source files plus final fixes. Prefer a Development, QA, Data Science or Ideation challenge — Nova can deliver those end to end.',
    };
  }
  return { ok: true, note: `${track} — within what Nova can deliver.` };
}

/**
 * What a submission typically needs, per track — beyond the deliverables the brief
 * lists. Losing on a technicality (no deployment guide, a patch without an email,
 * no reproduction steps) is far more common than losing on the work itself.
 *
 * These are deliberately general: they are a starting checklist drawn from how
 * TopCoder briefs are written, not challenge-specific facts. Mark an item skipped
 * when it does not apply.
 */
const SUBMISSION_PLAYBOOKS: { match: RegExp; items: string[] }[] = [
  {
    match: /develop|software|backend|frontend|full[- ]?stack|api|node|react|java|python/i,
    items: [
      'Deliver as a git patch or a repo/branch link — most development briefs ask for one',
      'The patch carries a user email, or the reviewer cannot apply it',
      'A short deployment / setup guide so a reviewer can actually run it',
      'Tests, or a note explaining why there are none',
      'A README: what was built, the key decisions, and anything left unfinished',
    ],
  },
  {
    match: /qa|quality|bug|defect|test/i,
    items: [
      'Each defect as its own numbered entry — not one blob',
      'Steps to reproduce, written the way a reviewer would follow them',
      'Expected vs actual behaviour for each defect',
      'Evidence: a screenshot or recording per defect',
      'Severity and category (functional, UI, UX/usability, accessibility, content)',
    ],
  },
  {
    match: /data science|data-science|machine learning|ml\b/i,
    items: [
      'The notebook or script that produces the result, runnable end to end',
      'The trained model, or the exact command that reproduces it',
      'A written summary: approach, what was tried, what worked and what did not',
      'The metrics the brief says it will score, measured the same way',
    ],
  },
  {
    match: /design|figma|penpot/i,
    items: [
      'Read the brief and list the exact screens/states it names — the count is usually scored',
      'Lay out one board per screen at the size the brief implies (1440 wide for desktop)',
      'Set up tokens first: colours, type scale, spacing. One source, reused everywhere',
      'Build the screens as structure, then the states the brief asks for (empty, error, loading)',
      'Export the deliverable format the brief demands (.fig, .penpot, PNG) — the format is a hard requirement',
      'If the format is .fig, the design must be finished in Figma by hand; Nova can only give structure',
    ],
  },
  {
    match: /kaggle/i,
    items: [
      'Read the Evaluation section of the competition page and write down the exact metric (RMSE, LogLoss, AUC, F1...) — the whole job is optimising that one number',
      'Accept the competition rules on the site, or the API returns 401/404 for it',
      'Download the data (train/test/sample_submission) into ./data and confirm the shapes',
      'Build a local cross-validation that scores the SAME metric the leaderboard does',
      'Baseline first: a simple model end to end, scored locally, before any tuning',
      'submission.csv must have exactly the required columns/rows — check it against sample_submission.csv',
      'No nulls and no index column in the submission unless the sample has one',
      'Submit, record the public score, then improve one thing at a time',
    ],
  },
  {
    match: /ideation|concept|idea/i,
    items: [
      'A single document (the brief usually caps the format — PDF/DOCX/slides)',
      'Answer every scored question the brief lists, in its order',
      'Justify why your approach beats the current process, if asked',
      'Cost, timeline and skills required, if the brief asks for them',
    ],
  },
];

/** The playbook items for a track, shaped like extracted requirements. */
export function submissionRequirements(track: string | null | undefined): { text: string; group: string }[] {
  const t = String(track || '');
  for (const pb of SUBMISSION_PLAYBOOKS) {
    if (pb.match.test(t)) return pb.items.map((text) => ({ text, group: 'Submission requirements' }));
  }
  return [];
}

/** Statuses that mean the challenge is not worth looking at yet. */
const DEAD_STATUSES = ['new', 'pending_approval', 'cancelled', 'draft', 'completed', 'deleted'];

/**
 * List the challenges that are actually worth taking on.
 *
 * Defaults to the tracks Nova can deliver end to end — the whole point is to
 * point the work at challenges that can be finished, not to hand back a list
 * that includes a Figma contest.
 *
 * `fetchImpl` is injectable so this is testable without the network.
 */
export async function listChallenges(
  opts: { fetchImpl?: any; tracks?: string[]; deliverableOnly?: boolean; limit?: number; timeoutMs?: number } = {}
): Promise<{ ok: boolean; error?: string; challenges: any[] }> {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'no fetch available', challenges: [] };
  const timeoutMs = opts.timeoutMs || 20000;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${TOPCODER_API}?perPage=100&page=1`, {
      signal: ctrl ? ctrl.signal : undefined,
      headers: { accept: 'application/json' },
    });
    if (!res || !res.ok) return { ok: false, error: `TopCoder API returned HTTP ${res && res.status}`, challenges: [] };
    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw && raw.data) ? raw.data : [];
    if (!arr.length) return { ok: true, challenges: [] };

    const wanted = Array.isArray(opts.tracks) && opts.tracks.length
      ? opts.tracks.map((t) => String(t).toLowerCase())
      : null;

    // The API can return the same challenge twice (e.g. an ACTIVE row and a NEW
    // duplicate). Keep one per name, preferring the row that has real activity.
    const byName = new Map<string, any>();
    for (const c of arr) {
      if (!c || !c.name) continue;
      const status = String(c.status || '').toLowerCase();
      if (DEAD_STATUSES.includes(status)) continue;
      const track = (c.track && (c.track.track || c.track.name)) || null;
      const item = {
        id: String(c.id || ''),
        name: String(c.name),
        track,
        status: c.status || null,
        url: `https://www.topcoder.com/challenges/${c.id}`,
        endsAt: c.submissionEndDate ? String(c.submissionEndDate) : null,
        registrants: Number(c.numOfRegistrants || 0),
        submissions: Number(c.numOfSubmissions || 0),
        deliverable: deliverability(track).ok,
      };
      const prev = byName.get(item.name);
      const better = !prev || (item.status === 'ACTIVE' && prev.status !== 'ACTIVE') || item.registrants > prev.registrants;
      if (better) byName.set(item.name, item);
    }

    let out = [...byName.values()];
    if (opts.deliverableOnly !== false) out = out.filter((c) => c.deliverable);
    if (wanted) out = out.filter((c) => wanted.some((w) => String(c.track || '').toLowerCase().includes(w)));
    // soonest deadline first, undated last
    out.sort((a, b) => {
      if (!a.endsAt && !b.endsAt) return a.name.localeCompare(b.name);
      if (!a.endsAt) return 1;
      if (!b.endsAt) return -1;
      return String(a.endsAt).localeCompare(String(b.endsAt));
    });
    if (opts.limit && opts.limit > 0) out = out.slice(0, opts.limit);
    return { ok: true, challenges: out };
  } catch (e: any) {
    return { ok: false, error: `fetch failed: ${(e && e.message) || e}`, challenges: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Pull the competition ref out of a Kaggle URL. Returns null if it is not one. */
export function parseKaggleRef(input: string): string | null {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = s.match(/kaggle\.com\/(?:competitions|c)\/([A-Za-z0-9._-]+)/);
  if (m) return m[1];
  return null;
}

/* ============================== deadlines ============================== */

/** "3d 5h", "4h 12m", "12m" — short, and never negative. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * How long is left on a deadline, and how urgent is it.
 *
 * The thresholds are deliberately blunt — the point is to make the agent act
 * (or stop) rather than to be precise: under 6 hours is critical, under a day is
 * soon. A deadline with no parseable date is reported as unknown, not as closed.
 */
export function timeRemaining(
  deadlineIso: string | null | undefined,
  now: Date = new Date()
): { known: boolean; closed: boolean; ms: number; human: string; urgency: 'closed' | 'critical' | 'soon' | 'normal' | 'unknown' } {
  if (!deadlineIso) return { known: false, closed: false, ms: 0, human: 'no deadline', urgency: 'unknown' };
  const t = Date.parse(String(deadlineIso));
  if (Number.isNaN(t)) return { known: false, closed: false, ms: 0, human: 'no deadline', urgency: 'unknown' };
  const ms = t - now.getTime();
  if (ms <= 0) return { known: true, closed: true, ms, human: 'closed', urgency: 'closed' };
  const HOUR = 3600 * 1000;
  const urgency = ms < 6 * HOUR ? 'critical' : ms < 24 * HOUR ? 'soon' : 'normal';
  return { known: true, closed: false, ms, human: formatDuration(ms), urgency };
}

/**
 * The next deadline that has not passed, plus every deadline with its remaining
 * time — so a caller can say "closes in 4h" and also see the phases after it.
 */
export function deadlineSummary(
  deadlines: { phase: string; at: string }[] | null | undefined,
  now: Date = new Date()
): { next: { phase: string; at: string; human: string; urgency: string } | null; all: { phase: string; at: string; human: string; urgency: string; closed: boolean }[] } {
  const list = (Array.isArray(deadlines) ? deadlines : [])
    .filter((d) => d && d.at)
    .map((d) => {
      const r = timeRemaining(d.at, now);
      return { phase: String(d.phase || 'deadline'), at: String(d.at), human: r.human, urgency: r.urgency, closed: r.closed };
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const open = list.filter((d) => !d.closed);
  return { next: open.length ? open[0] : null, all: list };
}

/* ============================ checklist store ============================ */

function specPath(workspace: string): string {
  const key = crypto.createHash('sha1').update(path.resolve(workspace || process.cwd())).digest('hex').slice(0, 16);
  return path.join(configRoot(), 'challenges', `${key}.json`);
}

async function readSpec(workspace: string): Promise<ChallengeSpec | null> {
  try {
    const raw = await fs.readFile(specPath(workspace), 'utf8');
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.items)) return j;
  } catch {
    /* missing or corrupt */
  }
  return null;
}

async function writeSpec(spec: ChallengeSpec): Promise<ChallengeSpec> {
  const file = specPath(spec.workspace);
  await fs.mkdir(path.dirname(file), { recursive: true });
  spec.updatedAt = new Date().toISOString();
  await fs.writeFile(file, JSON.stringify(spec, null, 2), 'utf8');
  return spec;
}

/** Save (or replace) the challenge spec + its checklist for a workspace. */
export async function saveSpec(
  workspace: string,
  input: { source?: string; id?: string | null; name: string; url?: string | null; tags?: string[]; track?: string | null; deadlines?: any[]; description?: string; requirements?: { text: string; group?: string }[] }
): Promise<ChallengeSpec> {
  const ws = path.resolve(workspace || process.cwd());
  const prev = await readSpec(ws);
  const extracted =
    input.requirements ||
    extractRequirements(input.description || '').map((r) => ({ text: r.text, group: r.group }));
  // Track-aware submission requirements ride along with the brief's own items, so
  // "add a deployment guide" is tracked exactly like "build the product page".
  const reqs = [...extracted, ...submissionRequirements(input.track)];

  // Keep the status of items that already existed — re-ingesting a spec must not
  // wipe the work already done against it.
  const prevById = new Map((prev ? prev.items : []).map((i) => [i.id, i]));

  const items: ReqItem[] = reqs.map((r) => {
    const group = r.group || 'General';
    const id = itemId(group, r.text);
    const old = prevById.get(id);
    return {
      id,
      text: r.text,
      group,
      status: old ? old.status : 'pending',
      note: old ? old.note : '',
      updatedAt: old ? old.updatedAt : null,
    };
  });

  const spec: ChallengeSpec = {
    workspace: ws,
    source: input.source || 'manual',
    id: input.id || null,
    name: input.name,
    url: input.url || null,
    tags: input.tags || [],
    track: input.track || (prev ? prev.track : null) || null,
    deadlines: Array.isArray(input.deadlines) ? input.deadlines : [],
    items,
    createdAt: (prev && prev.createdAt) || new Date().toISOString(),
    updatedAt: null,
  };
  return writeSpec(spec);
}

export async function listSpec(workspace: string): Promise<ChallengeSpec | null> {
  return readSpec(path.resolve(workspace || process.cwd()));
}

export async function setItem(
  workspace: string,
  id: string,
  patch: { status?: string; note?: string } = {}
): Promise<{ ok?: boolean; error?: string; item?: ReqItem }> {
  const spec = await readSpec(path.resolve(workspace || process.cwd()));
  if (!spec) return { error: 'no challenge spec saved for this workspace' };
  const item = spec.items.find((i) => i.id === id || i.id.startsWith(id));
  if (!item) return { error: `no checklist item matching ${id}` };
  if (patch.status) {
    if (!ITEM_STATUSES.includes(patch.status as ItemStatus)) {
      return { error: `status must be one of ${ITEM_STATUSES.join(', ')}` };
    }
    item.status = patch.status as ItemStatus;
  }
  if (typeof patch.note === 'string') item.note = patch.note.slice(0, 2000);
  item.updatedAt = new Date().toISOString();
  await writeSpec(spec);
  return { ok: true, item };
}

export function progress(spec: ChallengeSpec | null): { total: number; done: number; byStatus: Record<string, number>; complete: boolean } {
  const byStatus: Record<string, number> = { pending: 0, generating: 0, done: 0, verified: 0, skipped: 0 };
  if (!spec) return { total: 0, done: 0, byStatus, complete: false };
  for (const i of spec.items) if (i.status in byStatus) byStatus[i.status] += 1;
  const done = byStatus.done + byStatus.verified + byStatus.skipped;
  return { total: spec.items.length, done, byStatus, complete: spec.items.length > 0 && done === spec.items.length };
}

/* =============================== packaging =============================== */

function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, date };
}

/**
 * A minimal store-only (uncompressed) zip. No dependency, deterministic, and
 * readable by any unzip tool. Compression would not buy anything here — the
 * payloads are small and correctness matters more.
 */
export function zipStore(entries: { name: string; data: Buffer }[]): Buffer {
  const { time, date } = dosDateTime(new Date());
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const crc = zlib.crc32(data) >>> 0;
    const size = data.length;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); // store
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + size;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/**
 * Bundle files into a submission zip. Refuses to pack while checklist items are
 * still open — a submission with a missing deliverable is the most common way to
 * lose a challenge.
 */
export async function pack(
  workspace: string,
  opts: { files?: string[]; outPath?: string; force?: boolean } = {}
): Promise<{ ok: boolean; error?: string; path?: string; bytes?: number; files?: string[]; blocked?: string[] }> {
  const ws = path.resolve(workspace || process.cwd());
  const spec = await readSpec(ws);

  if (!opts.force && spec) {
    const p = progress(spec);
    if (!p.complete) {
      return {
        ok: false,
        error: `checklist is not complete (${p.done}/${p.total}) — finish the items or pass force to pack anyway`,
        blocked: spec.items.filter((i) => i.status === 'pending' || i.status === 'generating').map((i) => `${i.id} ${i.text}`),
      };
    }
  }

  const list = Array.isArray(opts.files) && opts.files.length ? opts.files : [];
  if (!list.length) return { ok: false, error: 'no files to pack' };

  const entries: { name: string; data: Buffer }[] = [];
  for (const f of list) {
    const abs = path.isAbsolute(f) ? f : path.join(ws, f);
    let data: Buffer;
    try {
      data = await fs.readFile(abs);
    } catch (e: any) {
      return { ok: false, error: `cannot read ${f}: ${(e && e.message) || e}` };
    }
    // keep the path relative to the workspace so the zip is portable
    const rel = path.relative(ws, abs).split(path.sep).join('/');
    entries.push({ name: rel.startsWith('..') ? path.basename(abs) : rel, data });
  }

  const outPath = opts.outPath || path.join(ws, 'submission.zip');
  const buf = zipStore(entries);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
  return { ok: true, path: outPath, bytes: buf.length, files: entries.map((e) => e.name) };
}

module.exports = {
  parseChallengeId,
  formatDuration,
  timeRemaining,
  deadlineSummary,
  parseKaggleRef,
  listChallenges,
  deliverability,
  submissionRequirements,
  extractRequirements,
  fetchChallenge,
  saveSpec,
  listSpec,
  setItem,
  progress,
  zipStore,
  pack,
  ITEM_STATUSES,
};
