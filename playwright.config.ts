import { defineConfig } from '@playwright/test';

/**
 * Playwright config for Nova IDE's Electron end-to-end suite.
 *
 * Why this exists: the current GUI scripts (scripts/test-sanity.mjs, test-flow.mjs,
 * test-agent.mjs) drive the app over CDP and read `window.__novaStore` directly.
 * They assert *store state*, not the UI — so no click, dialog, focus, layout or
 * rendering path is actually covered. Playwright's Electron support gives us real
 * UI interaction plus the debugging artifacts that make flakes fixable.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },

  // One Electron app instance per file; a single worker keeps the profile isolated.
  fullyParallel: false,
  workers: 1,

  // Retries exist to survive genuine infrastructure noise, not to hide flakes.
  // A flake that only passes on retry must still be triaged.
  retries: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e-results/html' }],
    ['junit', { outputFile: 'e2e-results/junit.xml' }], // CI gating
  ],

  use: {
    // The single most useful artifact for a flaky UI test.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  outputDir: 'e2e-results/artifacts',

  webServer: {
    command: `node scripts/mock-llm.mjs /tmp/nova-e2e-llm ${process.env.MOCK_PORT ?? 9977}`,
    url: `http://127.0.0.1:${process.env.MOCK_PORT ?? 9977}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
