import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The composer, as the user sees it.
 *
 * Locators use the app's real attributes (verified against
 * renderer/src/components/AgentMain.jsx) — placeholder text and `title` attributes.
 *
 * Testability note for the team: icon-only buttons currently expose only a `title`.
 * `getByTitle` works, but `getByRole('button', { name: … })` is the accessible,
 * rename-proof locator. Adding `aria-label` to the composer buttons (and
 * `data-testid` to the transcript items) is the single highest-value testability
 * change in this codebase.
 */
export class Composer {
  constructor(private readonly page: Page) {}

  /** The prompt box. */
  get input(): Locator {
    return this.page.getByPlaceholder('Plan, Build, / for skills, @ for context');
  }

  get sendButton(): Locator {
    return this.page.getByTitle('Send (Enter)');
  }

  get stopButton(): Locator {
    return this.page.getByTitle('Stop');
  }

  /** The Auto / Agent / Chat chip. */
  get modeChip(): Locator {
    return this.page.getByTitle(/^Execution mode:/);
  }

  /** Transcript bubbles carrying a mode badge. */
  modeBadge(mode: 'chat' | 'agent'): Locator {
    return this.page.locator(`.turn-mode-badge.${mode}`);
  }

  /** The last assistant reply in the transcript. */
  get lastReply(): Locator {
    return this.page.locator('.chat-msg.assistant').last();
  }

  async send(text: string): Promise<void> {
    await this.input.fill(text);
    await this.sendButton.click();
  }

  async chooseMode(mode: 'Auto' | 'Agent' | 'Chat'): Promise<void> {
    await this.modeChip.click();
    await this.page.locator(`[data-testid="mode-option-${mode.toLowerCase()}"]`).click();
    await expect(this.modeChip).toContainText(mode);
  }

  /**
   * Wait until the agent has actually finished.
   *
   * This replaces the `await sleep(2500)` pattern in scripts/test-agent.mjs.
   * A fixed sleep is a flake generator: too short on a loaded CI box, wasted time
   * on a fast one. Polling on the real end condition is correct on both.
   */
  async waitForTurnToFinish(): Promise<void> {
    await expect(this.stopButton).toBeHidden({ timeout: 60_000 });
    await expect(this.input).toBeVisible();
  }
}
