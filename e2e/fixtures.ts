import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Fixtures for Nova IDE.
 *
 * Test isolation is guaranteed via the `profile` fixture. Nova's centralized
 * `configRoot()` in `electron/tools/paths.js` respects `NOVA_HOME`, redirecting
 * settings, checkpoints, memory, and Electron's userData to an isolated temp directory.
 *
 * This fixture seeds a clean profile and verifies that the app actually bound to
 * the temp directory on launch (loudly failing if any pollution occurs).
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
          // Note on externalFileProtection: disabled here so the mock LLM's target directory
          // (/tmp/nova-e2e-llm) auto-approves writes without pausing test turns. External-file
          // protection itself is tested explicitly in approval.spec.ts and the regression suite.
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
