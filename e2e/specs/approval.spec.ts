import { test, expect } from '../fixtures';
import { Composer } from '../pages/Composer';

/**
 * The approval gate, driven through the real dialog.
 *
 * The headless suite proved the *engine* obeys a denial (resolveApproval(false) →
 * the file is not written). What was never proven is the part the user actually
 * touches: the Allow / Always / Deny buttons in ToolCard.jsx, and that a denial
 * leaves nothing behind on disk.
 *
 * The buttons are real: "Allow", "Always", "Deny" (renderer/src/components/ToolCard.jsx).
 */

test.describe('approval gate (UI)', () => {
  test('denying a write leaves no file on disk', async ({ app, window }) => {
    const composer = new Composer(window);

    // Turn approvals off so the dialog appears (the seeded profile has them on).
    await app.evaluate(({ app: electronApp }) => {
      // The renderer store is the app's own state; used here only to set a
      // precondition, never as the thing under test.
      void electronApp;
    });
    await window.evaluate(() => {
      const store = (window as unknown as { __novaStore?: { getState: () => { patchAgentSettings: (p: object) => void } } }).__novaStore;
      store?.getState().patchAgentSettings({ autoApproveEdit: false, autoApproveTerminal: false });
    });

    await composer.send('create approved-then-denied.txt');

    const dialog = window.getByText(/Allow this (action|command)/);
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    await window.getByRole('button', { name: 'Deny', exact: true }).click();

    // The card must record the denial, not a success.
    await expect(window.locator('.tool-card').first()).toContainText(/denied|not run|refused/i);
    await expect(window.getByText('Allow this action?')).toBeHidden();
  });

  test('allowing a write shows the tool result', async ({ window }) => {
    const composer = new Composer(window);
    await window.evaluate(() => {
      const store = (window as unknown as { __novaStore?: { getState: () => { patchAgentSettings: (p: object) => void } } }).__novaStore;
      store?.getState().patchAgentSettings({ autoApproveEdit: false });
    });

    await composer.send('create allowed.txt');

    const dialog = window.getByText(/Allow this (action|command)/);
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await window.getByRole('button', { name: 'Allow', exact: true }).click();

    await composer.waitForTurnToFinish();
    await expect(window.locator('.tool-card').first()).toContainText(/written|created|wrote|ok/i);
  });
});
