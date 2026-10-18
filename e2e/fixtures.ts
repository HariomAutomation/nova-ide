import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Fixtures for Nova IDE.
 *
 * Test isolation is the whole point of the `profile` fixture. Today the app always
 * uses `~/.nova-ide`, so every test run writes into the developer's real settings,
 * memory and checkpoints (verified: `npm run test:regression` leaves
 * `~/.nova-ide/checkpoints/test-agent-<id>/` behind on a clean machine). That makes
 * tests order-dependent and destructive.
 *
 * Required app change (3 lines, in electron/main.js + the config helpers):
 *
 *     const CONFIG_ROOT = process.env.NOVA_HOME || path.join(os.homedir(), '.nova-ide');
 *
 * and use CONFIG_ROOT everywhere `path.join(os.homedir(), '.nova-ide')` appears today.
 * Until that lands, this fixture still writes the profile into a temp dir but the app
 * will ignore it — the `profile` fixture asserts that the override actually took
 * effect so the suite fails loudly instead of silently polluting the real profile.
 */

const CONFIG_DIR_ENV = 'NOVA_HOME';

export type NovaFixtures = {
  /** A throwaway config directory, removed after the test. */
  profile: string;
  /** The running Electron app. */
  app: ElectronApplication;
  /** The first window, loaded and ready for interaction. */
  window: Page;
};

export const test = base.extend<NovaFixtures>({
  profile: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-e2e-'));
    mkdirSync(join(dir, 'checkpoints'), { recursive: true });

    // Seed a deterministic profile: one model pointed at the in-repo mock LLM,
    // approvals ON so a test can decide for itself when to assert the dialog.
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify(
        {
          models: [
            {
              id: 'mock',
              label: 'Mock LLM',
              baseUrl: `http://127.0.0.1:${process.env.MOCK_PORT ?? 9977}/v1`,
              apiKey: 'mock-key',
              model: 'mock-model',
            },
          ],
          activeModelId: 'mock',
          agentSettings: { maxSteps: 12, autoApproveEdit: true, autoApproveTerminal: true, externalFileProtection: false },
        },
        null,
        2
      )
    );

    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },

  app: async ({ profile }, use) => {
    const app = await electron.launch({
      args: ['.', '--no-sandbox'],
      env: { ...process.env, [CONFIG_DIR_ENV]: profile },
    });

    // Fail fast and clearly if the app is still using the real profile — otherwise
    // the suite would quietly write into ~/.nova-ide and still go green.
    const resolved = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    if (!String(resolved).startsWith(profile)) {
      await app.close();
      throw new Error(
        `Nova ignored ${CONFIG_DIR_ENV}=${profile} (it used ${resolved}). ` +
          `Add the CONFIG_ROOT override in electron/main.js before trusting this suite.`
      );
    }

    await use(app);
    await app.close();
  },

  window: async ({ app }, use) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expect(win.locator('body')).toBeVisible();
    await use(win);
  },
});

export { expect };
