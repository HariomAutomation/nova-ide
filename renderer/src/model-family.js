/**
 * Group configured models by the AI they belong to, so the picker shows one
 * entry per provider ("Gemini") instead of a row per model id.
 */

export const GEMINI_FREE_MODELS = [
  'gemini-2.5-flash',
  'gemini-3.8-flash',
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

/** Check if a model is an obsolete / legacy model that users usually don't want when latest models exist. */
export function isOldModel(id) {
  const s = String(id || '').toLowerCase();
  if (!s) return false;
  return /(^|[-_/])(llama-?[12]\b|llama2|gpt-3\.5|davinci|curie|babbage|ada|gemini-1\.0|claude-[12]\b)/i.test(s);
}

/**
 * Recency and capability score for ranking models:
 * Latest flagship models (e.g. 3.8, 3.3, 4o, R1, Sonnet) score highest.
 */
export function modelScore(id) {
  const s = String(id || '').toLowerCase();
  if (!s) return 0;
  if (isOldModel(s)) return -1000;

  let score = 0;
  // Explicit 'latest' tag
  if (/(^|[-_/.])latest([-_/.]|$)/i.test(s)) score += 600;

  // Major flagship & reasoning models
  if (/(^|[-_/.])(r1|deepseek-r1|reasoner|o3-mini|o1|gpt-4o|claude-3-7|sonnet|opus|coder)([-_/.]|$)/i.test(s)) {
    score += 150;
  }

  // Version numbers: major.minor
  const vMatch = s.match(/(?:llama|gemini|claude|gpt|qwen|gemma|mistral|dbrx|phi)?[-_ ]?v?(\d+)[._-](\d+)/i);
  if (vMatch) {
    const major = Number(vMatch[1]);
    const minor = Number(vMatch[2]);
    score += major * 100 + Math.min(minor, 9) * 10;
  } else {
    const singleMatch = s.match(/(?:llama|gpt|qwen|gemma|mistral|deepseek)[-_ ]?v?(\d+)\b/i);
    if (singleMatch) score += Number(singleMatch[1]) * 100;
  }

  // Parameter size (e.g. 70b > 32b > 27b > 14b > 8b > 7b)
  const sizeMatch = s.match(/\b(\d+)b\b/i);
  if (sizeMatch) {
    score += Math.min(Number(sizeMatch[1]) * 1.5, 120);
  }

  // Date stamps (e.g. 2025* > 2024*)
  const dateMatch = s.match(/\b(202\d)(\d{2})(\d{2})?\b/);
  if (dateMatch) {
    score += (Number(dateMatch[1]) - 2020) * 20 + Number(dateMatch[2]);
  }

  if (/preview|experimental|exp-/i.test(s)) score -= 15;
  return score;
}

export function sortModelsLatestFirst(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const idA = typeof a === 'string' ? a : (a && (a.id || a.model || a.label)) || '';
    const idB = typeof b === 'string' ? b : (b && (b.id || b.model || b.label)) || '';
    const diff = modelScore(idB) - modelScore(idA);
    if (diff !== 0) return diff;
    return idA.localeCompare(idB);
  });
}

/** Known recommended latest models per provider family. */
export const LATEST_RECOMMENDED_MODELS = {
  groq: [
    'llama-3.3-70b-versatile',
    'deepseek-r1-distill-llama-70b',
    'llama-3.1-8b-instant',
    'qwen-2.5-coder-32b',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],
  gemini: [
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
    'o1',
    'o1-mini',
  ],
  deepseek: [
    'deepseek-chat',
    'deepseek-reasoner',
  ],
  sarvam: [
    'sarvam-105b',
    'sarvam-30b',
  ],
};

/**
 * The selectable model ids inside one entry: a fetched list when we have one,
 * otherwise just the entry's own model.
 */
export function variantsOf(m) {
  if (m && Array.isArray(m.modelIds) && m.modelIds.length) {
    const raw = [...m.modelIds];
    if (m.model && !raw.includes(m.model) && isChatModel(m.model)) {
      raw.unshift(m.model);
    }
    const usable = raw.filter(isChatModel).filter((id) => !isOldModel(id));
    const list = usable.length ? usable : raw.filter(isChatModel);
    const finalIds = list.length ? list : raw;
    return finalIds.map((id) => ({ id, label: id }));
  }
  return [{ id: (m && m.model) || '', label: (m && (m.label || m.model)) || 'model' }];
}

/** Sorted variants with latest models first. */
export function sortedVariantsOf(m) {
  const vars = variantsOf(m);
  const fam = familyOf(m);
  const rec = LATEST_RECOMMENDED_MODELS[fam.key];
  if (rec && rec.length > 0) {
    const existingIds = new Set(vars.map((v) => v.id));
    const missing = rec.filter((r) => !existingIds.has(r) && isChatModel(r));
    // If variants were minimal or missed flagship models, inject recommended ones
    if (missing.length > 0 && vars.length <= 3) {
      const augmented = [...vars, ...missing.map((id) => ({ id, label: id }))];
      return sortModelsLatestFirst(augmented);
    }
  }
  return sortModelsLatestFirst(vars);
}

/** Get badge tag info for a model id (e.g. LATEST, REASONING, FAST, FREE). */
export function getModelBadge(id, defaultTag = '') {
  if (defaultTag) {
    const isFree = defaultTag.toLowerCase().includes('free');
    return { text: defaultTag, type: isFree ? 'free' : 'default' };
  }
  const s = String(id || '').toLowerCase();
  if (/(^|[-_/])(r1|deepseek-r1|reasoner|o3-mini|o1)([-_/]|$)/i.test(s)) {
    return { text: 'REASONING', type: 'reasoning' };
  }
  if (/(^|[-_/])(latest|3\.8|3\.3|4o)([-_/]|$)/i.test(s)) {
    return { text: 'LATEST', type: 'latest' };
  }
  if (/flash-lite|instant|mini/i.test(s)) {
    return { text: 'FAST', type: 'fast' };
  }
  if (/:free\b|free/i.test(s)) {
    return { text: 'FREE', type: 'free' };
  }
  return null;
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
  if (Array.isArray(entry.modelIds) && entry.modelIds.length) {
    return entry.model || entry.label || 'Model';
  }
  return entry.label || entry.model || 'Model';
}

/**
 * Models that cannot chat. Listing them leads to confusion and errors,
 * so prompt guards, TTS, audio, speech, embeddings, and non-chat models are dropped.
 */
export function isChatModel(id) {
  const s = String(id || '').toLowerCase();
  if (!s) return false;
  if (
    /(^|[-_/.])(tts|embedding|embeddings|embed|aqa|imagen|veo|whisper|dall-e|moderation|prompt-guard|safeguard|guardrail|shield|orpheus|audio|speech|transcribe|diarize|rerank|reranker|realtime)([-_/.]|$)/i.test(
      s
    )
  ) {
    if (s.includes('-image') && !s.includes('imagen')) return true;
    return false;
  }
  if (/prompt-guard|safeguard|guard-2-|guard-3-/i.test(s)) return false;
  return true;
}

/** Keep only the ids that can plausibly be used for chat, with latest models prioritized. */
export function chatModels(ids, { includeOld = false } = {}) {
  const list = Array.isArray(ids) ? ids : [];
  const usable = list.filter(isChatModel);
  const filtered = includeOld ? usable : usable.filter((id) => !isOldModel(id));
  const result = filtered.length > 0 ? filtered : usable;
  return sortModelsLatestFirst(result);
}

/**
 * Pick a reliable default free-tier chat model from a fetched list.
 */
export function preferredChatModel(ids, currentModel = '') {
  const usable = chatModels(ids);
  const cur = String(currentModel || '').trim();
  const isUnreliable = /argon|pro-exp|exp-|preview-0/i.test(cur);
  if (cur && !isUnreliable && (!usable.length || usable.includes(cur))) {
    return cur;
  }
  if (!usable.length) {
    return cur && !isUnreliable ? cur : '';
  }
  for (const pref of GEMINI_FREE_MODELS) {
    if (usable.includes(pref)) return pref;
  }
  const flash = usable.find((id) => /flash/i.test(id) && !/argon|exp|preview/i.test(id));
  if (flash) return flash;
  return usable[0] || (cur && !isUnreliable ? cur : '');
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
