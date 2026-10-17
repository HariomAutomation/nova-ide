/**
 * Which configured models should the picker offer?
 *
 * A model is usable when it is the active one, when it is a session-based
 * provider (Gemini Web, Cloud Code - they authenticate through a sign-in, not
 * an API key), or when it has an API key.
 */
export const SESSION_AUTHS = ['gemini-web', 'cloudcode'];

export function isModelUsable(m, activeModelId) {
  if (!m) return false;
  if (m.id === activeModelId) return true;
  if (SESSION_AUTHS.includes(m.auth)) return true;
  return String(m.apiKey || '').trim().length > 0;
}

export function usableModels(models, activeModelId) {
  return (Array.isArray(models) ? models : []).filter((m) => isModelUsable(m, activeModelId));
}
