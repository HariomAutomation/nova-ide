/**
 * Turn provider HTTP errors into messages that actually tell the user what to do.
 * Especially Google: 429 with "limit: 0" means the model is paid-tier only,
 * a plain 429 means the free-tier quota is used up for the day.
 */
/**
 * Google reports how long to wait in an error detail:
 *   "retryDelay":"22680.179850251s"
 * Turn that into something a person can read.
 */
function parseRetryDelay(raw) {
  const m = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(raw || '');
  if (!m) return '';
  const secs = Math.round(parseFloat(m[1]));
  if (!Number.isFinite(secs) || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const min = Math.round((secs % 3600) / 60);
  if (h >= 1) return `${h}h ${min}m`;
  if (min >= 1) return `${min}m`;
  return `${secs}s`;
}

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
    const reset = parseRetryDelay(raw);
    const zeroLimit = /limit:\s*0\b/.test(raw);
    const perDay = /per[_ ]?day/i.test(raw); // "PerDay" in Google's metric name too
    const perMinute = /per[_ ]?minute/i.test(raw);
    if (status === 429 && zeroLimit) {
      hint =
        '\n\n💡 Is model ka free quota 0 hai (limit: 0) — Google ise sirf paid billing pe deta hai. ' +
        'Koi free model chuno (jaise gemini-2.5-flash / gemini-flash-latest) ya billing enable karo.';
    } else if (status === 429 && perDay) {
      hint =
        `\n\n💡 Is model ka free-tier DAILY quota khatam hai${reset ? ` — ${reset} me reset hoga` : ''}. ` +
        'Doosre model pe switch karo (limits per-model hote hain), ya reset ka wait karo.';
    } else if (status === 429 && perMinute) {
      hint = '\n\n💡 Per-minute rate limit lag gaya — ek minute ruk ke dobara bhejo.';
    } else if (status === 429) {
      hint =
        `\n\n💡 Free-tier quota / rate limit lag gaya${reset ? ` — ${reset} me reset hoga` : ''}. ` +
        'Doosra model try karo ya billing enable karo.';
    }
    if (status === 429) {
      hint +=
        '\n💡 Yaad rakho: agent me har "step" = ek API request, to ek message bhi kai requests le sakta hai. ' +
        'Preview/experimental models ka free quota bahut chhota (ya 0) hota hai.' +
        '\n💡 Ye quota aapki API KEY ka hai. Gemini ka web app (gemini.google.com) — jo Google AI Pro subscription se ' +
        'chalta hai — isse alag hai aur chalta rehta hai. AI Pro API access nahi deta: API ke liye AI Studio key ' +
        'chahiye (free tier ke limits ke saath) ya us project me billing enable karni padegi.' +
        '\n💡 Free alternative: Groq (console.groq.com) ka free tier kaafi generous hai, aur OpenRouter pe ":free" ' +
        'models milte hain — dono Nova me Settings → Models se add ho jaate hain.';
    }
    if (status === 401 || status === 403) {
      hint = '\n\n💡 API key / permissions check karo — key sahi hai? us project me Gemini API enabled hai?';
    } else if (status === 404 && /models\//.test(msg)) {
      hint = '\n\n💡 Model ID galat lag raha hai — Settings -> Models -> ⇅ Fetch se exact model ID pick karo.';
    } else if (status === 503 || /high demand|spikes in demand/i.test(raw)) {
      hint = '\n\n💡 Google servers pe temporary high demand / traffic spike hai (503 Service Unavailable). Kuch seconds me ↻ Retry karein ya doosra model chuno.';
    } else if (status >= 500 && status < 600) {
      hint = `\n\n💡 Google servers pe temporary error hai (${status} ${statusText || ''}). Kuch der me Retry karein.`;
    } else if (status === 400) {
      hint = '\n\n💡 Model request parameters ya input invalid hain (400 Bad Request).';
    }
  } else if (status === 413 || /payload too large|request too large|itpm/i.test(raw)) {
    const lim = /limit[:\s]+([\d,]{3,})/i.exec(raw);
    const req = /requested[:\s]+([\d,]{3,})/i.exec(raw);
    hint =
      `\n\n💡 Request is model ke limit se bada hai${lim ? ` (limit ${lim[1]} tokens)` : ''}${req ? ` — request ${req[1]} tokens ki thi` : ''}. ` +
      'Nova context chhota karke dobara try karta hai; phir bhi na chale to chhote-context wale model pe switch karo, ' +
      'ya provider ka paid tier le lo (Groq free tier ka ITPM kam hai).';
  } else if (status === 401 || status === 403) {
    hint = '\n\n💡 API key check karo (Settings -> Models).';
  } else if (status === 404) {
    hint = '\n\n💡 Base URL / model ID check karo — ⇅ Fetch se list dekh lo.';
  } else if (status === 503 || /high demand/i.test(raw)) {
    hint = '\n\n💡 Provider servers pe temporary overload hai (503). Kuch seconds baad Retry karein.';
  } else if (status >= 500 && status < 600) {
    hint = `\n\n💡 Provider server error (${status} ${statusText || ''}) — kuch der me Retry karein.`;
  } else if (status === 400) {
    hint = '\n\n💡 Request parameters invalid hain (400 Bad Request).';
  }

  const first = `HTTP ${status}${statusText ? ' ' + statusText : ''}: ${msg}`;
  return (first + hint).slice(0, 1800);
}

module.exports = { describeHttpError };
