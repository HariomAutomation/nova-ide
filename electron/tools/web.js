'use strict';

/**
 * Web tools for the Nova agent: web_fetch + web_search.
 * No API keys needed — DuckDuckGo's HTML endpoint is used for search.
 */

const MAX_TEXT = 40000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) NovaIDE/0.2 Chrome/120 Safari/537.36';

async function fetchText(url, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const ct = res.headers.get('content-type') || '';
    const body = await res.text();
    return { body, ct, url: res.url || url };
  } finally {
    clearTimeout(t);
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function webFetch(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) {
    return { ok: false, text: `web_fetch needs an http(s) URL, got: ${u || '(empty)'}` };
  }
  try {
    const { body, ct, url: finalUrl } = await fetchText(u);
    const isHtml = /html|xml/i.test(ct) || /^\s*</.test(body.slice(0, 200));
    const text = isHtml ? stripHtml(body) : body;
    const truncated = text.length > MAX_TEXT;
    return {
      ok: true,
      url: finalUrl,
      text: `Content of ${finalUrl} (${isHtml ? 'html→text' : ct || 'text'}${truncated ? ', truncated' : ''}):\n\n${text.slice(0, MAX_TEXT)}`,
    };
  } catch (e) {
    return { ok: false, text: `web_fetch failed: ${e.message}` };
  }
}

function parseDdgHtml(body, count) {
  const results = [];
  const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [];
  let sm;
  while ((sm = snippetRe.exec(body))) snippets.push(stripHtml(sm[1]));
  let m;
  let i = 0;
  while ((m = blockRe.exec(body)) && results.length < count) {
    let href = m[1];
    const dd = /[?&]uddg=([^&]+)/.exec(href);
    if (dd) {
      try {
        href = decodeURIComponent(dd[1]);
      } catch {}
    }
    if (href.startsWith('//')) href = 'https:' + href;
    results.push({ title: stripHtml(m[2]).slice(0, 160), url: href, snippet: (snippets[i] || '').slice(0, 300) });
    i++;
  }
  return results;
}

function parseDdgLite(body, count) {
  const results = [];
  const re = /<a[^>]*class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(body)) && results.length < count) {
    results.push({ title: stripHtml(m[2]).slice(0, 160), url: m[1], snippet: '' });
  }
  return results;
}

async function webSearch(query, count = 6) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, text: 'web_search needs a query.' };
  const n = Math.max(1, Math.min(Number(count) || 6, 10));
  let results = [];
  let err = null;
  try {
    const { body } = await fetchText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q));
    results = parseDdgHtml(body, n);
  } catch (e) {
    err = e;
  }
  if (!results.length && !err) {
    try {
      const { body } = await fetchText('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q));
      results = parseDdgLite(body, n);
    } catch (e) {
      err = e;
    }
  }
  if (err && !results.length) return { ok: false, text: `web_search failed: ${err.message}` };
  if (!results.length) return { ok: true, text: `No web results found for "${q}".` };
  const text = results
    .map((r, i) => `${i + 1}. ${r.title || '(untitled)'}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
    .join('\n\n');
  return { ok: true, text: `Web search results for "${q}":\n\n${text}`, results };
}

module.exports = { webFetch, webSearch };
