/**
 * Small helpers for turning provider error text into something readable.
 * Kept out of the JSX so it can be unit tested.
 */

function hms(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${secs}s`;
}

/**
 * "17h24m8.276149635" -> "17h 24m"
 * "22680.179850251"   -> "6h 18m"   (a bare number is seconds)
 * "2m30.5"            -> "2m"
 */
export function formatRetry(raw) {
  const s = String(raw || '').split('.')[0];
  const h = Number((/(\d+)h/.exec(s) || [])[1] || 0);
  const m = Number((/(\d+)m/.exec(s) || [])[1] || 0);
  const sec = Number((/(\d+)s/.exec(s) || [])[1] || 0);
  if (h || m || sec) {
    const parts = [];
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (!h && !m && sec) parts.push(`${sec}s`);
    return parts.join(' ');
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? hms(n) : '';
}

/** Pull the reset time out of a quota error, formatted, or ''. */
export function retryWindow(text) {
  const t = String(text || '');
  const m = /retry in ([\dhm.]+)/i.exec(t) || /retryDelay[^\d]*([\d.]+)s/i.exec(t);
  return m ? formatRetry(m[1]) : '';
}

/** "Limit 7000, Requested 19502" -> { limit: 7000, requested: 19502 } */
export function sizeNumbers(text) {
  const t = String(text || '');
  const lim = /limit[:\s]+([\d,]{3,})/i.exec(t);
  const req = /requested[:\s]+([\d,]{3,})/i.exec(t);
  return {
    limit: lim ? Number(lim[1].replace(/,/g, '')) : 0,
    requested: req ? Number(req[1].replace(/,/g, '')) : 0,
  };
}
