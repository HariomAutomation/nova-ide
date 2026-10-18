/**
 * Group configured models by the AI they belong to, so the picker shows one
 * entry per provider ("Gemini") instead of a row per model id.
 */

export const GEMINI_FREE_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

export function isGemini(m) {
  if (!m) return false;
  const url = String(m.baseUrl || '').toLowerCase();
  return (
    m.auth === 'gemini-web' ||
    m.auth === 'cloudcode' ||
    url.includes('generativelanguage.googleapis.com') ||
    url.includes('googleapis.com')
  );
}

/** A rough version number so the newest model sorts first (3.7 > 3.1). */
export function versionOf(m) {
  const s = `${m.model || ''} ${m.label || ''}`;
  const hit = s.match(/(\d+)\s*[.\-_]\s*(\d+)/);
  if (hit) return Number(hit[1]) + Number(hit[2]) / 100;
  const one = s.match(/\b(\d{1,2})\b/);
  return one ? Number(one[1]) : 0;
}

export function familyOf(m) {
  const url = String(m.baseUrl || '').toLowerCase();
  if (isGemini(m)) return { key: 'gemini', label: 'Gemini' };
  if (url.includes('openrouter')) return { key: 'openrouter', label: 'OpenRouter' };
  if (url.includes('opencode')) return { key: 'opencode', label: 'OpenCode Zen' };
  if (url.includes('groq')) return { key: 'groq', label: 'Groq' };
  if (url.includes('deepseek')) return { key: 'deepseek', label: 'DeepSeek' };
  if (url.includes('openai.com')) return { key: 'openai', label: 'OpenAI' };
  if (url.includes('sarvam')) return { key: 'sarvam', label: 'Sarvam' };
  if (url.includes('localhost') || url.includes('127.0.0.1')) return { key: 'local', label: 'Local' };
  return { key: `other:${m.label || m.model || m.id}`, label: m.label || m.model || 'Model' };
}

/** [{ key, label, models: [...] }] with models newest-first inside each family. */
export function groupModels(models) {
  const byKey = new Map();
  for (const m of Array.isArray(models) ? models : []) {
    const f = familyOf(m);
    if (!byKey.has(f.key)) byKey.set(f.key, { key: f.key, label: f.label, models: [] });
    byKey.get(f.key).models.push(m);
  }
  for (const g of byKey.values()) {
    g.models.sort((a, b) => versionOf(b) - versionOf(a) || String(a.label || '').localeCompare(String(b.label || '')));
  }
  return [...byKey.values()];
}

/** The newest model of a family (what "just give me the latest" means). */
export function latestOf(models) {
  const sorted = [...(Array.isArray(models) ? models : [])].sort((a, b) => versionOf(b) - versionOf(a));
  return sorted[0] || null;
}

/**
 * The selectable model ids inside one entry: a fetched list when we have one,
 * otherwise just the entry's own model.
 */
export function variantsOf(m) {
  if (m && Array.isArray(m.modelIds) && m.modelIds.length) {
    return m.modelIds.map((id) => ({ id, label: id }));
  }
  return [{ id: (m && m.model) || '', label: (m && (m.label || m.model)) || 'model' }];
}

/** How many rows a family will actually render. */
export function variantCount(entries) {
  return (Array.isArray(entries) ? entries : []).reduce((n, m) => n + variantsOf(m).length, 0);
}

/**
 * The picker opens upward from the composer, so its height must fit the space
 * above it — otherwise the top of the list is clipped off-screen.
 * @param {number} anchorTop distance from the viewport top to the chip
 */
export function pickerMaxHeight(anchorTop, min = 220, max = 460) {
  const t = Number(anchorTop);
  if (!Number.isFinite(t)) return max;
  return Math.max(min, Math.min(max, Math.round(t - 24)));
}

/** What the composer chip should say for the active entry. */
export function chipLabel(entry) {
  if (!entry) return 'Select Model…';
  // With a fetched list the interesting thing is which model is chosen, not the
  // provider label the entry was created with.
  if (Array.isArray(entry.modelIds) && entry.modelIds.length) {
    return entry.model || entry.label || 'Model';
  }
  return entry.label || entry.model || 'Model';
}

/**
 * Models that cannot chat. Listing them just leads people to pick one and get a
 * confusing failure, so they are dropped from a fetched list.
 */
export function isChatModel(id) {
  const s = String(id || '').toLowerCase();
  if (!s) return false;
  return !/(^|[-_])(tts|embedding|embeddings|aqa|imagen|veo|whisper|dall-e|moderation)([-_]|$)/.test(s);
}

/** Keep only the ids that can plausibly be used for chat. */
export function chatModels(ids) {
  const list = Array.isArray(ids) ? ids : [];
  return list.filter(isChatModel);
}

/**
 * Pick a reliable default free-tier chat model from a fetched list (avoiding
 * experimental/paid-only models like gemini-4-argon when a stable Flash model
 * is available).
 */
export function preferredChatModel(ids, currentModel = '') {
  const usable = chatModels(ids);
  const cur = String(currentModel || '').trim();
  const isUnreliable = /argon|pro-exp|exp-|preview-0/i.test(cur);
  if (cur && !isUnreliable && (!usable.length || usable.includes(cur))) {
    return cur;
  }
  for (const pref of GEMINI_FREE_MODELS) {
    if (usable.includes(pref)) return pref;
  }
  const flash = usable.find((id) => /flash/i.test(id) && !/argon|exp|preview/i.test(id));
  if (flash) return flash;
  return usable[0] || (cur && !isUnreliable ? cur : GEMINI_FREE_MODELS[0]);
}

/**
 * Build one-click fallback choices for ErrorCard when the active model hits a
 * per-model quota / rate limit (e.g. gemini-4-argon 429). Includes sibling
 * variants from activeModel.modelIds (and standard Gemini free-tier models on
 * a Gemini key) as well as other configured providers.
 */
export function fallbackChoices(models, activeModelId, limit = 4) {
  const list = Array.isArray(models) ? models : [];
  const active = list.find((m) => m && m.id === activeModelId) || null;
  const out = [];
  const seen = new Set();

  const add = (id, model, label) => {
    const mStr = String(model || '').trim();
    if (!id || !mStr) return;
    const key = `${id}:${mStr}`;
    if (seen.has(key)) return;
    if (active && id === active.id && mStr === String(active.model || '').trim()) return;
    seen.add(key);
    out.push({ id, model: mStr, label: label || mStr });
  };

  if (active && active.apiKey && active.auth !== 'gemini-web' && active.auth !== 'cloudcode') {
    const rawVariants = Array.isArray(active.modelIds) ? chatModels(active.modelIds) : [];
    const pool = isGemini(active)
      ? [...GEMINI_FREE_MODELS.filter((g) => !rawVariants.length || rawVariants.includes(g)), ...GEMINI_FREE_MODELS, ...rawVariants]
      : rawVariants;

    const scored = [...new Set(pool)].sort((a, b) => {
      const rank = (s) => {
        const idx = GEMINI_FREE_MODELS.indexOf(s);
        if (idx >= 0) return idx;
        if (/:free\b/i.test(s)) return 10;
        if (/flash-lite|mini|instant/i.test(s) && !/exp|preview|argon/i.test(s)) return 15;
        if (/flash/i.test(s) && !/exp|preview|argon/i.test(s)) return 20;
        if (/argon|exp|preview/i.test(s)) return 90;
        return 50;
      };
      return rank(a) - rank(b);
    });

    for (const mid of scored) {
      add(active.id, mid, mid);
      if (out.length >= limit) break;
    }
  }

  for (const m of list) {
    if (!m || m.id === activeModelId) continue;
    if (!m.apiKey || m.auth === 'gemini-web' || m.auth === 'cloudcode') continue;
    if (String(m.baseUrl || '').includes('localhost')) continue;
    const best = Array.isArray(m.modelIds) && m.modelIds.length ? preferredChatModel(m.modelIds, m.model) : m.model;
    const label = m.label && m.label !== best ? `${m.label} (${best})` : m.label || best;
    add(m.id, best, label);
    if (out.length >= limit + 2) break;
  }

  return out.slice(0, limit);
}
