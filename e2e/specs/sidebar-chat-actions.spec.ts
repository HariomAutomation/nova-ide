import { test, expect } from '../fixtures';
import { Composer } from '../pages/Composer';

test.describe('sidebar chat actions (hover, pin, delete)', () => {
  test('hovering on a chat row reveals pin, rename, delete actions and clicking pin/delete works', async ({ window }) => {
    const composer = new Composer(window);
    await composer.chooseMode('Chat');
    await composer.send('hi');
    await composer.waitForTurnToFinish();

    // The chat should now appear in the sidebar under repositories/chats
    const chatRow = window.locator('[data-testid="sb-chat-row"]').first();
    await expect(chatRow).toBeVisible();

    // Hover over the chat row to reveal actions
    await chatRow.hover();

    const actions = chatRow.locator('.sb-chat-actions');
    await expect(actions).toBeVisible();

    const pinBtn = chatRow.locator('[data-testid="chat-pin-btn"]');
    const deleteBtn = chatRow.locator('[data-testid="chat-delete-btn"]');

    // Clicking pin pins the chat (pin indicator becomes visible)
    await pinBtn.click();
    await expect(pinBtn).toHaveClass(/pinned/);
    await expect(chatRow.locator('.sb-pin')).toBeVisible();

    // Clicking unpin unpins the chat
    await pinBtn.click();
    await expect(pinBtn).not.toHaveClass(/pinned/);
    await expect(chatRow.locator('.sb-pin')).toHaveCount(0);

    // Clicking delete removes the chat from the sidebar
    await deleteBtn.click();
    await expect(chatRow).toHaveCount(0);
  });
});
