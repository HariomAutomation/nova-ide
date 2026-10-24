'use strict';

/**
 * Gemini Web driver, powered by Playwright.
 *
 * The old path drove an offscreen Electron <webview> with hand-written JS
 * polling. Playwright does this better: real locators (getByRole), auto-waiting
 * instead of fixed sleeps, and a persistent browser profile so the Google
 * sign-in survives restarts.
 *
 * The page lives in a Playwright-managed Chromium, not in Nova's UI — the user
 * never sees it. Sign in once (a visible window), and after that it runs
 * headless.
 *
 * Locator rules followed here (stable > clever):
 *   - prefer getByRole / getByText
 *   - no XPath, no nth-child, no long CSS chains
 *   - never sleep; let Playwright wait
 */

const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { configRoot } = require('./tools/paths');

let chromium = null;
let pwVersion = null;
try {
  const pw = require('playwright');
  chromium = pw.chromium;
  pwVersion = require('playwright/package.json').version;
} catch {}

function getProfileDir() {
  return path.join(configRoot(), 'gemini-profile');
}
const GEMINI_URL = 'https://gemini.google.com/app';
const ANSWER_TIMEOUT_MS = 5 * 60 * 1000;

let ctx = null; // persistent context
let lastError = '';

function available() {
  return !!chromium;
}

function engineInfo() {
  return { available: available(), version: pwVersion, profile: getProfileDir(), running: !!ctx };
}

/* ------------------------------- launching ------------------------------- */

async function launchContext({ headless }) {
  const profileDir = getProfileDir();
  await fsp.mkdir(profileDir, { recursive: true });
  const base = {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    locale: 'en-IN',
  };
  try {
    return await chromium.launchPersistentContext(profileDir, base);
  } catch (e) {
    // No Playwright browser downloaded — fall back to the installed Chrome.
    lastError = `bundled chromium nahi mila (${e.message}); Chrome try kar raha hoon`;
    try {
      return await chromium.launchPersistentContext(profileDir, { ...base, channel: 'chrome' });
    } catch (e2) {
      const hint =
        'Koi browser nahi mila. Terminal me chalao: npx playwright install chromium ' +
        '(ya Google Chrome install karo), phir dobara try karo.';
      lastError = hint;
      throw new Error(`${hint} [${String((e2 && e2.message) || e2).slice(0, 140)}]`);
    }
  }
}

async function ensureContext({ headless = true } = {}) {
  if (!available()) throw new Error('Playwright available nahi hai (npm install chalao).');
  if (ctx) return ctx;
  ctx = await launchContext({ headless });
  ctx.on('close', () => {
    ctx = null;
  });
  return ctx;
}

async function close() {
  const c = ctx;
  ctx = null;
  try {
    if (c) await c.close();
  } catch {}
}

async function geminiPage(create = true) {
  const c = await ensureContext();
  for (const p of c.pages()) {
    if ((p.url() || '').includes('gemini.google.com')) return p;
  }
  if (!create) return null;
  const page = await c.newPage();
  await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return page;
}

/* ------------------------------ sign in once ------------------------------ */

/** Open a VISIBLE window so the user can sign in; the profile keeps it. */
async function openLogin() {
  if (!available()) return { ok: false, error: 'Playwright available nahi hai (npm install chalao).' };
  const wasRunning = !!ctx;
  await close();
  try {
    const c = await launchContext({ headless: false });
    const page = (await c.pages())[0] || (await c.newPage());
    await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Leave the window open; the profile is written on close.
    ctx = c;
    c.on('close', () => {
      ctx = null;
    });
    return { ok: true, opened: true, reused: wasRunning };
  } catch (e) {
    lastError = String((e && e.message) || e);
    return { ok: false, error: lastError };
  }
}

/* --------------------------------- asking --------------------------------- */

/** The composer. getByRole first (stable), CSS only as a last resort. */
function composerOf(page) {
  return page
    .getByRole('textbox')
    .last()
    .or(page.locator('rich-textarea [contenteditable="true"]').first())
    .or(page.locator('[contenteditable="true"]').first());
}

function sendButtonOf(page) {
  return page
    .getByRole('button', { name: /send message/i })
    .or(page.getByRole('button', { name: /^send$/i }))
    .or(page.locator('button[aria-label*="Send" i]').first());
}

async function status() {
  const out = { ok: false, engine: 'playwright', version: pwVersion, running: !!ctx, signedIn: false };
  if (!available()) {
    out.error = 'Playwright available nahi hai.';
    return out;
  }
  try {
    const page = await geminiPage(false);
    if (!page) {
      out.error = 'Gemini page abhi khula nahi hai.';
      return out;
    }
    out.url = page.url();
    const composer = composerOf(page);
    out.signedIn = (await composer.count()) > 0;
    out.ok = true;
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}

async function newChat() {
  const page = await geminiPage();
  const btn = page.getByRole('button', { name: /new chat/i }).first();
  try {
    await btn.click({ timeout: 4000 });
  } catch {
    await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await composerOf(page).waitFor({ state: 'visible', timeout: 30000 });
  return { ok: true };
}

/**
 * Send one prompt and stream the answer back.
 * Completion is decided by the page itself: the answer text stops growing.
 */
async function ask({ prompt, onDelta, signal } = {}) {
  if (!available()) throw new Error('Playwright available nahi hai (npm install chalao).');
  const page = await geminiPage();
  const composer = composerOf(page);
  await composer.waitFor({ state: 'visible', timeout: 45000 });
  await composer.click();

  const marker = String(prompt).trim().slice(-120);
  await page.evaluate(() => {
    window.__novaPw = { last: '', sent: 0 };
  });

  await composer.fill(prompt);
  const send = sendButtonOf(page);
  if ((await send.count()) > 0) {
    await send.click({ timeout: 8000 }).catch(async () => {
      await composer.press('Enter');
    });
  } else {
    await composer.press('Enter');
  }

  // Stream partial text to the caller.
  if (onDelta) {
    await page.exposeFunction('__novaPwDelta', (t) => {
      try {
        onDelta(t);
      } catch {}
    });
  }
  await page.evaluate(
    ({ marker, stream }) => {
      if (window.__novaPwTimer) clearInterval(window.__novaPwTimer);
      window.__novaPw = { last: '', marker };
      window.__novaPwTimer = setInterval(() => {
        try {
          const body = document.body ? document.body.innerText : '';
          const i = window.__novaPw.marker ? body.lastIndexOf(window.__novaPw.marker) : -1;
          if (i < 0) return;
          const ans = body.slice(i + window.__novaPw.marker.length).trim();
          if (!ans || ans === window.__novaPw.last) return;
          const grew = ans.startsWith(window.__novaPw.last);
          if (stream && window.__novaPwDelta) {
            window.__novaPwDelta(grew ? ans.slice(window.__novaPw.last.length) : '\n' + ans);
          }
          window.__novaPw.last = ans;
          window.__novaPw.at = Date.now();
        } catch {}
      }, 300);
    },
    { marker, stream: !!onDelta }
  );

  // Auto-wait: the answer exists and has been stable for ~1.2s.
  await page
    .waitForFunction(
      () => {
        const s = window.__novaPw;
        if (!s || !s.last) return false;
        return Date.now() - (s.at || 0) > 1200;
      },
      undefined,
      { timeout: ANSWER_TIMEOUT_MS, polling: 250 }
    )
    .catch(() => {});

  const answer = await page
    .evaluate(() => {
      if (window.__novaPwTimer) clearInterval(window.__novaPwTimer);
      return (window.__novaPw && window.__novaPw.last) || '';
    })
    .catch(() => '');

  if (signal && signal.aborted) {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    throw e;
  }
  return String(answer || '').trim();
}

const PROFILE_DIR = getProfileDir();

module.exports = {
  available,
  engineInfo,
  ensureContext,
  close,
  openLogin,
  ask,
  newChat,
  status,
  GEMINI_URL,
  PROFILE_DIR,
};
