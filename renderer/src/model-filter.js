/**
 * Which configured models should the picker offer?
 *
 * A model is usable when it is the active one, when it is a session-based
 * provider (Gemini Web, Cloud Code - they authenticate through a sign-in, not
 * an API key), or when it has an API key.
 */
export const SESSION_AUTHS = ['cloudcode'];

// The Gemini web-app provider is retired: its models are hidden everywhere.
export const RETIRED_AUTHS = ['gemini-web'];

export function isModelUsable(m, activeModelId) {
  if (!m) return false;
  if (RETIRED_AUTHS.includes(m.auth)) return false;
  if (m.id === activeModelId) return true;
  if (SESSION_AUTHS.includes(m.auth)) return true;
  return String(m.apiKey || '').trim().length > 0;
}

export function usableModels(models, activeModelId) {
  return (Array.isArray(models) ? models : []).filter((m) => isModelUsable(m, activeModelId));
}
