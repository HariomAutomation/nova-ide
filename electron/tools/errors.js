/**
 * Turn provider HTTP errors into messages that actually tell the user what to do.
 * Especially Google: 429 with "limit: 0" means the model is paid-tier only,
 * a plain 429 means the free-tier quota is used up for the day.
 */
function describeHttpError(url, status, statusText, text) {
  const raw = (text || '').replace(/\s+/g, ' ').slice(0, 700);
  let msg = raw;
  try {
    const j = JSON.parse(text || '[]');
    const err = Array.isArray(j) ? j[0] && j[0].error : j && j.error;
    if (err && err.message) msg = err.message;
  } catch {}

  let hint = '';
  const isGoogle = /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(url || '');
  if (isGoogle) {
    if (status === 429 && /limit: 0/.test(raw)) {
      hint =
        '\n\n💡 Ye model aapki key ke tier me available nahi hai — Google iske liye paid billing maangta hai. ' +
        'Google Cloud me billing enable karo (free trial se start kar sakte ho) ya koi free model try karo (jaise gemini-3.8-flash).';
    } else if (status === 429) {
      hint = '\n\n💡 Free-tier quota khatam / rate limit. Thodi der me retry karo, ya billing enable karo unlimited ke liye.';
    } else if (status === 401 || status === 403) {
      hint = '\n\n💡 API key / permissions check karo — key sahi hai? us project me Gemini API enabled hai?';
    } else if (status === 404 && /models\//.test(msg)) {
      hint = '\n\n💡 Model ID galat lag raha hai — Settings -> Models -> ⇅ Fetch se exact model ID pick karo.';
    }
  } else if (status === 401 || status === 403) {
    hint = '\n\n💡 API key check karo (Settings -> Models).';
  } else if (status === 404) {
    hint = '\n\n💡 Base URL / model ID check karo — ⇅ Fetch se list dekh lo.';
  }

  const first = `HTTP ${status}${statusText ? ' ' + statusText : ''}: ${msg}`;
  return (first + hint).slice(0, 1800);
}

module.exports = { describeHttpError };
