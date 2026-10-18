import { test, expect } from '../fixtures';
import { Composer } from '../pages/Composer';

/**
 * Browser tool execution & screenshot rendering test.
 *
 * Covers:
 * 1. Agent executing the `browser` tool (page navigation + title extraction).
 * 2. Agent capturing a browser screenshot via Playwright.
 * 3. Rendering of the screenshot data URL inside the transcript tool card (<img class="tool-image">).
 * 4. Verification that browser tools run without crashing the renderer or Electron main process.
 */

test.describe('browser tool and visual artifacts (UI)', () => {
  test('agent drives browser, captures screenshot, and renders image card', async ({ window }) => {
    const composer = new Composer(window);
    await composer.chooseMode('Agent');

    await composer.send('browse test page and take a screenshot');
    await composer.waitForTurnToFinish();

    // Verify browser tool cards are rendered
    const browserCards = window.locator('.tool-card[data-tool-name="browser"]');
    await expect(browserCards.first()).toBeVisible({ timeout: 15_000 });

    // The first browser card was the 'open' action which loaded Nova Test Page
    await expect(browserCards.first()).toContainText('Nova Test Page');

    // The second browser card was 'screenshot', which must render the image preview
    const toolImage = window.locator('.tool-card img.tool-image');
    await expect(toolImage).toBeVisible();
    await expect(toolImage).toHaveAttribute('alt', 'tool output');

    // Verify final reply acknowledges completion
    await expect(composer.lastReply).toContainText(/screenshot|Chromium/i);
  });
});
