import { test, expect } from '../fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * End-to-end verification of settings UI and disk persistence.
 *
 * Covers:
 * 1. Opening Settings modal via store or menu.
 * 2. Navigating to the Agents settings tab.
 * 3. Toggling an agent setting (e.g., Submit with Ctrl + Enter) using real DOM click.
 * 4. Verifying that the setting was persisted to disk in the isolated temp profile.
 * 5. Closing the modal cleanly via Esc / Close button.
 */

test.describe('settings and profile persistence (UI)', () => {
  test('toggling a setting updates UI and persists to isolated disk profile', async ({ profile, window }) => {
    // Open settings modal to 'agents' tab
    await window.evaluate(() => {
      const store = (window as unknown as { __novaStore?: { getState: () => { setSettingsOpen: (v: boolean, tab: string) => void } } }).__novaStore;
      store?.getState().setSettingsOpen(true, 'agents');
    });

    const overlay = window.locator('.settings-overlay');
    await expect(overlay).toBeVisible();

    // Verify Agents tab header
    await expect(window.locator('.settings-content-head h1')).toHaveText('Agents');

    // Find the "Submit with Ctrl + Enter" switch row
    const ctrlEnterRow = window.locator('.srow').filter({ hasText: 'Submit with Ctrl + Enter' });
    const switchBtn = ctrlEnterRow.getByRole('switch');
    await expect(switchBtn).toBeVisible();

    // Check initial state (default is false)
    const initialChecked = await switchBtn.getAttribute('aria-checked');
    expect(initialChecked).toBe('false');

    // Click switch
    await switchBtn.click();
    await expect(switchBtn).toHaveAttribute('aria-checked', 'true');

    // Verify persistence to the isolated profile on disk
    const settingsPath = join(profile, 'settings.json');
    await expect.poll(() => {
      try {
        const raw = readFileSync(settingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed?.agentSettings?.submitWithCtrlEnter;
      } catch {
        return false;
      }
    }, { timeout: 5000 }).toBe(true);

    // Close the settings modal using the close button
    const closeBtn = window.getByTitle('Close (Esc)');
    await closeBtn.click();
    await expect(overlay).toBeHidden();
  });
});
