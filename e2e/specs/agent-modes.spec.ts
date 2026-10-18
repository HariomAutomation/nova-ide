import { test, expect } from '../fixtures';
import { Composer } from '../pages/Composer';

/**
 * What this covers that nothing covered before:
 *
 * The mode badge (💬 Chat / ⚡ Agent) exists only in the rendered UI. The existing
 * CDP scripts read `window.__novaStore` and never look at the DOM, so a badge that
 * renders the wrong mode — or never renders — would still go green.
 *
 * Auto routing is the highest-risk feature in the app: chat mode strips the tools,
 * so a mis-route means the user asks for work and silently gets a chat reply.
 */

test.describe('agent mode routing (UI)', () => {
  test('a greeting renders a Chat badge and uses no tools', async ({ window }) => {
    const composer = new Composer(window);
    await composer.chooseMode('Auto');

    await composer.send('hi');
    await composer.waitForTurnToFinish();

    await expect(composer.modeBadge('chat')).toBeVisible();
    await expect(composer.lastReply).toContainText(/ASK-MODE-OK|hello/i);
    // No tool card may appear for a conversational turn.
    await expect(window.locator('.tool-card')).toHaveCount(0);
  });

  test('an instruction renders an Agent badge and actually calls a tool', async ({ window }) => {
    const composer = new Composer(window);
    await composer.chooseMode('Auto');

    await composer.send('create hello.txt');
    await composer.waitForTurnToFinish();

    await expect(composer.modeBadge('agent')).toBeVisible();
    await expect(window.locator('.tool-card').first()).toBeVisible();
  });

  test('the badge reflects the mode that actually ran, not the chip', async ({ window }) => {
    const composer = new Composer(window);

    // Force Chat while asking for real work: the badge must say Chat and no tool
    // may run — proving the badge reports what happened rather than what was asked.
    await composer.chooseMode('Chat');
    await composer.send('create never-created.txt');
    await composer.waitForTurnToFinish();

    await expect(composer.modeBadge('chat')).toBeVisible();
    await expect(window.locator('.tool-card')).toHaveCount(0);
  });
});
