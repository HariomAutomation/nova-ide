'use strict';

/**
 * Voice input fallback.
 *
 * Chromium's built-in speech recognition needs a Google speech key that
 * Electron builds do not ship, so it often fails with a network error. When
 * that happens Nova records the audio and transcribes it with a provider you
 * configure:
 *
 *   - 'gemini'  : Google AI Studio key, Gemini transcribes the audio inline
 *   - 'openai'  : any Whisper-compatible /audio/transcriptions endpoint
 *                 (OpenAI, Groq, self-hosted faster-whisper, …)
 */

const PROMPT =
  'Transcribe the following audio exactly as spoken. Output ONLY the transcription text, no commentary, no quotes.';

function normalizeBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

/** Whisper-compatible endpoint: multipart POST /audio/transcriptions. */
async function transcribeOpenAI({ baseUrl, apiKey, model, buffer, mimeType }) {
  const base = normalizeBase(baseUrl);
  if (!/^https?:\/\//.test(base)) return { error: 'Voice: sahi http(s) base URL daalo (Settings → Agents → Voice).' };
  const url = `${base}/audio/transcriptions`;
  const boundary = `nova${Date.now().toString(36)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model || 'whisper-1'}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
      `Content-Type: ${mimeType || 'audio/webm'}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, buffer, tail]);
  const headers: Record<string, string> = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body });
  } catch (e) {
    return { error: `Transcribe request failed: ${e.message}` };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) return { error: `Transcribe HTTP ${res.status}: ${text.slice(0, 200)}` };
  try {
    const j = JSON.parse(text);
    return { text: String(j.text || '').trim() };
  } catch {
    return { text: text.trim() };
  }
}

/** Gemini (AI Studio key) with the audio sent inline. */
async function transcribeGemini({ apiKey, model, buffer, mimeType }) {
  if (!apiKey) return { error: 'Voice: Gemini ke liye AI Studio API key chahiye (Settings → Agents → Voice).' };
  const m = String(model || 'gemini-3.7-flash').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    m
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inlineData: { mimeType: mimeType || 'audio/webm', data: buffer.toString('base64') } },
        ],
      },
    ],
  };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { error: `Gemini transcribe failed: ${e.message}` };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) return { error: `Gemini HTTP ${res.status}: ${text.slice(0, 200)}` };
  try {
    const j = JSON.parse(text);
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const out = parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
    return { text: out };
  } catch (e) {
    return { error: `Gemini reply parse nahi hua: ${e.message}` };
  }
}

/**
 * @param {{ base64: string, mimeType?: string, settings?: object }} payload
 */
async function transcribe({ base64, mimeType, settings }) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) return { error: 'Voice: koi audio nahi mila.' };
  const provider = s.provider === 'gemini' ? 'gemini' : s.provider === 'openai' ? 'openai' : 'auto';

  if (provider === 'gemini') return transcribeGemini({ apiKey: s.apiKey, model: s.model, buffer, mimeType });
  if (provider === 'openai') {
    return transcribeOpenAI({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, buffer, mimeType });
  }
  // auto: prefer a Whisper-compatible endpoint when one is configured
  if (s.baseUrl) return transcribeOpenAI({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, buffer, mimeType });
  if (s.apiKey) return transcribeGemini({ apiKey: s.apiKey, model: s.model, buffer, mimeType });
  return { error: 'Voice: Settings → Agents → Voice me provider + key set karo.' };
}

module.exports = { transcribe, transcribeOpenAI, transcribeGemini };
