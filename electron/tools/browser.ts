const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// Lazy Playwright browser used by the agent's `browser` tool.
let pwVersion = null;
try {
  pwVersion = require('playwright/package.json').version;
} catch {}

let chromium = null;
try {
  chromium = require('playwright').chromium;
} catch {}

const state = {
  browser: null,
  context: null,
  page: null,
  headless: true,
};

const VIEWPORT = { width: 1280, height: 800 };

function available() {
  return !!chromium;
}

async function closeAll() {
  try {
    if (state.context) await state.context.close();
  } catch {}
  try {
    if (state.browser) await state.browser.close();
  } catch {}
  state.browser = null;
  state.context = null;
  state.page = null;
}

async function ensure({ headless = true } = {}) {
  if (!chromium) throw new Error('Playwright is not installed in Nova.');
  const needsLaunch =
    !state.browser ||
    (state.browser && typeof state.browser.isConnected === 'function' && !state.browser.isConnected()) ||
    state.headless !== headless ||
    !state.context;

  if (needsLaunch) {
    await closeAll();
    state.headless = headless;
    state.browser = await chromium.launch({ headless, args: ['--no-sandbox'] });
    if (typeof state.browser.on === 'function') {
      state.browser.on('disconnected', () => {
        state.browser = null;
        state.context = null;
        state.page = null;
      });
    }
    state.context = await state.browser.newContext({ viewport: VIEWPORT });
    if (typeof state.context.on === 'function') {
      state.context.on('close', () => {
        state.context = null;
        state.page = null;
      });
    }
  }
  return state;
}

async function getPage({ headless = true } = {}) {
  await ensure({ headless });
  try {
    if (!state.page || state.page.isClosed()) {
      state.page = await state.context.newPage();
    }
    return state.page;
  } catch {
    // If context or target was closed unexpectedly, re-create and retry
    await closeAll();
    await ensure({ headless });
    state.page = await state.context.newPage();
    return state.page;
  }
}

function status() {
  return {
    available: available(),
    playwrightVersion: pwVersion,
    launched: !!state.browser,
    headless: state.headless,
    url: state.page && !state.page.isClosed() ? state.page.url() : null,
  };
}

async function screenshotToFile(dir) {
  const page = state.page;
  if (!page || page.isClosed()) throw new Error('No browser page open. Use action "open" first.');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `browser_${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function act(action, params = {}, { headless = true, artifactsDir } = {}) {
  const page = await getPage({ headless });

  switch (action) {
    case 'open': {
      if (!params.url) throw new Error('url is required for open');
      const resp = await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return {
        url: page.url(),
        title: await page.title(),
        status: resp ? resp.status() : null,
      };
    }
    case 'click': {
      await page.click(params.selector, { timeout: 15000 });
      return { clicked: params.selector, url: page.url() };
    }
    case 'fill': {
      await page.fill(params.selector, params.text ?? '', { timeout: 15000 });
      return { filled: params.selector, chars: (params.text ?? '').length };
    }
    case 'press': {
      await page.keyboard.press(params.key, { timeout: 15000 });
      return { pressed: params.key, url: page.url() };
    }
    case 'text': {
      const text = await page.evaluate(() => document.body ? document.body.innerText : '');
      return { url: page.url(), title: await page.title(), text: text.slice(0, 8000) };
    }
    case 'screenshot': {
      const file = await screenshotToFile(artifactsDir || process.cwd());
      return { file };
    }
    case 'back': {
      await page.goBack({ timeout: 20000 }).catch(() => null);
      return { url: page.url() };
    }
    case 'close': {
      await closeAll();
      return { closed: true };
    }
    default:
      throw new Error(`Unknown browser action: ${action}`);
  }
}

module.exports = { act, status, closeAll, available, screenshotToFile, getPage, ensure };
