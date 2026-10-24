/**
 * Kaggle competitions — the second provider for the challenge workflow.
 *
 * A Kaggle competition is the same shape as a TopCoder challenge: a brief, a
 * deadline, a metric, and a submission that gets scored. So it reuses the same
 * checklist store, the same packaging, and the same "can Nova deliver this?"
 * judgement. Only the discovery + spec source differ, which is what this file is.
 *
 * Why Kaggle is a better fit than a design contest: the deliverable is CODE plus
 * a score. It is reproducible, it is owned by whoever wrote it, and the judge is
 * a metric rather than a human's taste.
 *
 * Auth (either works):
 *   KAGGLE_API_TOKEN   -> Authorization: Bearer KGAT_...
 *   KAGGLE_USERNAME + KAGGLE_KEY -> HTTP Basic
 * The list endpoint is called without auth first; a 401 is reported as
 * `authRequired` with the setup steps rather than as a crash.
 *
 * `fetchImpl` is injectable so this is tested without the network.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const KAGGLE_API = 'https://www.kaggle.com/api/v1';

export interface KaggleCompetition {
  ref: string;
  title: string;
  category: string | null;
  deadline: string | null;
  reward: string | null;
  teamCount: number;
  userHasEntered: boolean;
  userRank: number | null;
  url: string;
}

export const KAGGLE_SETUP_STEPS = [
  'kaggle.com -> your account -> Settings -> API -> Create New Token',
  'That downloads kaggle.json (or shows a KGAT_ token).',
  'Set KAGGLE_API_TOKEN to the token, or set KAGGLE_USERNAME and KAGGLE_KEY.',
  'Competitions also need the rules accepted on the competition page, and a verified account, before the API returns data.',
];

/** The Authorization header, if any credentials are configured. */
export function kaggleAuth(env: any = process.env): { header: string; scheme: string } | null {
  const token = String((env && env.KAGGLE_API_TOKEN) || '').trim();
  if (token) return { header: `Bearer ${token}`, scheme: 'token' };
  const user = String((env && env.KAGGLE_USERNAME) || '').trim();
  const key = String((env && env.KAGGLE_KEY) || '').trim();
  if (user && key) {
    return { header: `Basic ${Buffer.from(`${user}:${key}`).toString('base64')}`, scheme: 'basic' };
  }
  return null;
}

/** Kaggle returns a compact row; shape it into the same fields the UI uses. */
function shape(c: any): KaggleCompetition {
  const ref = String((c && (c.ref || c.competitionName || c.slug)) || '').trim();
  return {
    ref,
    title: String((c && (c.title || c.name)) || ref),
    category: c && c.category ? String(c.category) : null,
    deadline: c && c.deadline ? String(c.deadline) : null,
    reward: c && c.reward ? String(c.reward) : null,
    teamCount: Number((c && (c.teamCount || c.team_count)) || 0),
    userHasEntered: Boolean(c && c.userHasEntered),
    userRank: c && c.userRank ? Number(c.userRank) : null,
    url: `https://www.kaggle.com/competitions/${ref}`,
  };
}

/**
 * List Kaggle competitions, soonest deadline first when asked to.
 * `search` matches the same way `kaggle competitions list -s` does.
 */
export async function listCompetitions(
  opts: { search?: string; category?: string; sortBy?: string; page?: number; limit?: number; fetchImpl?: any; env?: any; timeoutMs?: number } = {}
): Promise<{ ok: boolean; error?: string; authRequired?: boolean; steps?: string[]; competitions: KaggleCompetition[] }> {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'no fetch available', competitions: [] };

  const params = new URLSearchParams();
  params.set('group', 'general');
  params.set('category', opts.category || 'all');
  params.set('sortBy', opts.sortBy || 'earliestDeadline');
  params.set('page', String(opts.page || 1));
  if (opts.search) params.set('search', String(opts.search));

  const auth = kaggleAuth(opts.env || process.env);
  const headers: any = { accept: 'application/json' };
  if (auth) headers.authorization = auth.header;

  const timeoutMs = opts.timeoutMs || 20000;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${KAGGLE_API}/competitions/list?${params.toString()}`, {
      signal: ctrl ? ctrl.signal : undefined,
      headers,
    });
    if (res && res.status === 401) {
      return {
        ok: false,
        authRequired: true,
        error: 'Kaggle rejected the request (401).',
        steps: KAGGLE_SETUP_STEPS,
        competitions: [],
      };
    }
    if (!res || !res.ok) {
      return { ok: false, error: `Kaggle API returned HTTP ${res && res.status}`, competitions: [] };
    }
    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw && raw.competitions) ? raw.competitions : [];
    let out = arr.map(shape).filter((c: KaggleCompetition) => c.ref);
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 20;
    out = out.slice(0, limit);
    return { ok: true, competitions: out };
  } catch (e: any) {
    return { ok: false, error: `fetch failed: ${(e && e.message) || e}`, competitions: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ------------------------------ data + submissions ------------------------------ */

/**
 * List the files a competition provides (train.csv, test.csv,
 * sample_submission.csv ...).
 * GET competitions/data/list/{ref} — the same call `kaggle competitions files` makes.
 */
export async function listDataFiles(
  ref: string,
  opts: { fetchImpl?: any; env?: any; timeoutMs?: number } = {}
): Promise<{ ok: boolean; error?: string; authRequired?: boolean; steps?: string[]; files: any[] }> {
  const r = await kaggleJson(`competitions/data/list/${encodeURIComponent(ref)}`, opts);
  if (!r.ok) return { ok: false, error: r.error, authRequired: r.authRequired, steps: r.steps, files: [] };
  const arr = Array.isArray(r.data) ? r.data : [];
  return {
    ok: true,
    files: arr.map((f: any) => ({
      name: String((f && f.name) || ''),
      bytes: Number((f && (f.totalBytes || f.total_bytes)) || 0),
      createdAt: (f && (f.creationDate || f.creation_date)) || null,
    })).filter((f: any) => f.name),
  };
}

/**
 * Download one competition file to disk.
 * GET competitions/data/download/{ref}/{fileName} — fails if the competition's
 * rules have not been accepted.
 */
export async function downloadDataFile(
  ref: string,
  fileName: string,
  destPath: string,
  opts: { fetchImpl?: any; env?: any; timeoutMs?: number } = {}
): Promise<{ ok: boolean; error?: string; authRequired?: boolean; steps?: string[]; path?: string; bytes?: number }> {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'no fetch available' };
  const auth = kaggleAuth(opts.env || process.env);
  const headers: any = { accept: '*/*' };
  if (auth) headers.authorization = auth.header;
  const timeoutMs = opts.timeoutMs || 180000;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const url = `${KAGGLE_API}/competitions/data/download/${encodeURIComponent(ref)}/${encodeURIComponent(fileName)}`;
    const res = await fetchImpl(url, { signal: ctrl ? ctrl.signal : undefined, headers });
    if (res && res.status === 401) return { ok: false, authRequired: true, error: 'Kaggle rejected the request (401).', steps: KAGGLE_SETUP_STEPS };
    if (!res || !res.ok) return { ok: false, error: `Kaggle API returned HTTP ${res && res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, buf);
    return { ok: true, path: destPath, bytes: buf.length };
  } catch (e: any) {
    return { ok: false, error: `download failed: ${(e && e.message) || e}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A competition's submissions, newest first — this is how the score is read back
 * after submitting. GET competitions/submissions/list/{ref}?page=1
 */
export async function listSubmissions(
  ref: string,
  opts: { page?: number; fetchImpl?: any; env?: any; timeoutMs?: number } = {}
): Promise<{ ok: boolean; error?: string; authRequired?: boolean; steps?: string[]; submissions: any[] }> {
  const r = await kaggleJson(`competitions/submissions/list/${encodeURIComponent(ref)}?page=${opts.page || 1}`, opts);
  if (!r.ok) return { ok: false, error: r.error, authRequired: r.authRequired, steps: r.steps, submissions: [] };
  const arr = Array.isArray(r.data) ? r.data : [];
  return {
    ok: true,
    submissions: arr.map((s: any) => ({
      fileName: (s && (s.fileName || s.file_name)) || null,
      date: (s && s.date) || null,
      description: (s && s.description) || null,
      status: (s && s.status) || null,
      publicScore: s && s.publicScore != null ? s.publicScore : null,
      privateScore: s && s.privateScore != null ? s.privateScore : null,
    })),
  };
}

/** Shared JSON GET with the Kaggle auth + 401 handling. */
async function kaggleJson(
  relPath: string,
  opts: { fetchImpl?: any; env?: any; timeoutMs?: number } = {}
): Promise<{ ok: boolean; error?: string; authRequired?: boolean; steps?: string[]; data?: any }> {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'no fetch available' };
  const auth = kaggleAuth(opts.env || process.env);
  const headers: any = { accept: 'application/json' };
  if (auth) headers.authorization = auth.header;
  const timeoutMs = opts.timeoutMs || 30000;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${KAGGLE_API}/${relPath}`, { signal: ctrl ? ctrl.signal : undefined, headers });
    if (res && res.status === 401) return { ok: false, authRequired: true, error: 'Kaggle rejected the request (401).', steps: KAGGLE_SETUP_STEPS };
    if (!res || !res.ok) return { ok: false, error: `Kaggle API returned HTTP ${res && res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e: any) {
    return { ok: false, error: `fetch failed: ${(e && e.message) || e}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Submit a prediction file to a competition.
 *
 * The flow is three calls, not one — verified against the Kaggle client source,
 * because the obvious guess (`/submissions/url/{ref}/{fileName}`) is wrong and
 * fails at runtime:
 *
 *   1. POST competitions/{ref}/submissions/url/{contentLength}/{lastModifiedDateUtc}
 *      multipart fileName        -> { createUrl, token }
 *   2. PUT <createUrl> with the raw file body
 *      (legacy: when the response carries `isComplete`, the createUrl instead
 *       encodes guid/length/timestamp and the file goes to
 *       POST competitions/submissions/upload/{guid}/{len}/{ts})
 *   3. POST competitions/submissions/submit/{ref}
 *      multipart blobFileTokens=<token>, submissionDescription=<msg>
 *
 * Note where the file NAME goes: in the body, not the path. The path carries the
 * byte length and the last-modified time in seconds.
 *
 * This writes to a competition, so it is the caller's job to have confirmed it.
 */
export async function submitPrediction(
  ref: string,
  filePath: string,
  description: string,
  opts: { fetchImpl?: any; env?: any; timeoutMs?: number; fileName?: string } = {}
): Promise<{ ok: boolean; error?: string; authRequired?: boolean; steps?: string[]; submission?: any; token?: string; via?: string }> {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'no fetch available' };

  let buf: Buffer;
  let stat: any;
  try {
    buf = await fs.readFile(filePath);
    stat = await fs.stat(filePath);
  } catch (e: any) {
    return { ok: false, error: `cannot read submission file: ${(e && e.message) || e}` };
  }
  if (!buf.length) return { ok: false, error: 'submission file is empty' };

  const contentLength = buf.length;
  const lastModifiedSec = Math.floor(stat.mtimeMs / 1000);
  const fileName = opts.fileName || path.basename(filePath);

  const auth = kaggleAuth(opts.env || process.env);
  const authHeader: any = auth ? { authorization: auth.header } : {};
  const timeoutMs = opts.timeoutMs || 180000;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

  const fail = (r: any) => {
    if (r && r.status === 401) return { ok: false as const, authRequired: true, error: 'Kaggle rejected the request (401).', steps: KAGGLE_SETUP_STEPS };
    return { ok: false as const, error: `Kaggle API returned HTTP ${r && r.status}` };
  };

  try {
    // ---- step 1: ask for an upload location -------------------------------
    const fd1 = new FormData();
    fd1.append('fileName', fileName);
    const r1 = await fetchImpl(
      `${KAGGLE_API}/competitions/${encodeURIComponent(ref)}/submissions/url/${contentLength}/${lastModifiedSec}`,
      { method: 'POST', headers: authHeader, body: fd1, signal: ctrl ? ctrl.signal : undefined }
    );
    if (!r1 || !r1.ok) return fail(r1);
    const info = await r1.json();
    const createUrl = info && info.createUrl;
    if (!createUrl) return { ok: false, error: 'Kaggle did not return an upload url' };

    // ---- step 2: upload the bytes ----------------------------------------
    let token = info.token;
    let via = 'put';
    if (info.isComplete !== undefined) {
      // legacy shape: createUrl carries /<guid>/<length>/<timestamp>
      const parts = String(createUrl).split('/').reverse();
      if (parts.length >= 3) {
        via = 'legacy';
        const fd2 = new FormData();
        // TS's DOM lib types BlobPart narrower than reality: a Buffer is a valid
        // BlobPart at runtime, so the cast is a lib-typing artifact, not a fix-up.
        fd2.append('file', new Blob([buf as any]), fileName);
        const r2 = await fetchImpl(
          `${KAGGLE_API}/competitions/submissions/upload/${parts[0]}/${parts[1]}/${parts[2]}`,
          { method: 'POST', headers: authHeader, body: fd2, signal: ctrl ? ctrl.signal : undefined }
        );
        if (!r2 || !r2.ok) return fail(r2);
        const up = await r2.json();
        token = (up && up.token) || token;
      }
    } else {
      const r2 = await fetchImpl(createUrl, { method: 'PUT', body: buf, signal: ctrl ? ctrl.signal : undefined });
      if (!r2 || !r2.ok) return fail(r2);
    }
    if (!token) return { ok: false, error: 'Kaggle did not return an upload token' };

    // ---- step 3: submit --------------------------------------------------
    const fd3 = new FormData();
    fd3.append('blobFileTokens', String(token));
    fd3.append('submissionDescription', String(description || ''));
    const r3 = await fetchImpl(`${KAGGLE_API}/competitions/submissions/submit/${encodeURIComponent(ref)}`, {
      method: 'POST',
      headers: authHeader,
      body: fd3,
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!r3 || !r3.ok) return fail(r3);
    const out = await r3.json().catch(() => ({}));
    return { ok: true, submission: out, token: String(token), via };
  } catch (e: any) {
    return { ok: false, error: `submit failed: ${(e && e.message) || e}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { listCompetitions, kaggleAuth, KAGGLE_SETUP_STEPS, listDataFiles, downloadDataFile, listSubmissions, submitPrediction };
