/**
 * Group configured models by the AI they belong to, so the picker shows one
 * entry per provider ("Gemini") instead of a row per model id.
 */

function isGemini(m) {
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
