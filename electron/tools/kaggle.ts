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

module.exports = { listCompetitions, kaggleAuth, KAGGLE_SETUP_STEPS };
