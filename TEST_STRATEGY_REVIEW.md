# Nova IDE — Test Strategy Review

**Reviewer:** Senior SDET / QA engineer
**Build reviewed:** `main` @ `357532df` (fresh clone)
**Scope:** test strategy, flakiness risk, coverage gaps, and a concrete path to a real UI test layer

---

## 1. Verdict up front

The **unit layer is genuinely good** — 66 tests, fast, headless, meaningful assertions, and
they have caught real regressions (I watched the markdown-cell and streaming bugs get locked
down with tests). That is the hardest layer to build and it is already there.

The **UI layer does not exist yet**, and the scripts that look like it are not it. Everything
below is about closing that gap.

---

## 2. What the current suite actually is

| Suite | Lines | Kind | Touches the UI? |
|---|---|---|---|
| `test-regression.mjs` | 1439 | unit / integration, Node | no (by design — correct) |
| `test-sanity.mjs` | 111 | CDP script | **no** |
| `test-flow.mjs` | 111 | CDP script | screenshots only |
| `test-agent.mjs` | 244 | CDP script | **no** |
| `test-all.mjs` | 115 | runner (spawns Electron + the three above) | — |

**The core problem.** `test-agent.mjs` "verifies" the agent like this:

```js
const termState = await evaljs(
  `({ text: window.__novaStore.getState().termLines.map((l) => l.text).join('\n') })`
);
```

and then builds its verdict from a plain object of booleans:

```js
const checks = {
  wrote_hello_file: helloContent === 'hello from nova agent\nline2',
  terminal_panel: /TERM-OK/.test(termState.text || ''),
  ...
};
```

That is **store-level integration testing with a screenshot attached**. It reads application
state directly and never asks the UI to do anything. So a button that no longer calls its
handler, a dialog that never opens, a badge that renders the wrong text, a layout that
overlaps, a focus trap — all invisible to this suite. It goes green while the app is broken.

That is not a criticism of the author's effort; it is the natural shape of hand-rolled CDP
scripts. It is also why "the GUI tests pass" is not yet evidence that the GUI works.

---

## 3. Flakiness audit

I grepped the three UI scripts for the standard smells.

**Hardcoded sleeps — 11 occurrences.** The worst offenders:

| Location | Wait | Risk |
|---|---|---|
| `test-agent.mjs:169` | `await sleep(2500)` | an entire agent turn on a fixed timer |
| `test-agent.mjs:175` | `await sleep(1500)` | search results on a fixed timer |
| `test-agent.mjs:120` | `await sleep(700)` | tool execution |
| `test-agent.mjs:162` | `await sleep(400)` | approval state |
| `test-sanity.mjs:73`, `:87` | `await sleep(100)` × 2 | render settling |
| `test-flow.mjs:86` | `setTimeout(..., 300)` | navigation |

A fixed sleep is wrong on both ends: on a loaded CI box 2500 ms is too short (flake), on a
fast laptop it is pure dead time. The correct pattern is to poll the **end condition** —
Playwright's auto-waiting locators, or `expect.poll`. `Composer.waitForTurnToFinish()` in the
attached suite shows the pattern.

**Retries / polling — zero.** `grep -c "retry|retries|waitFor|poll"` returns `0` for all three
files. There is no wait-until-true anywhere; every wait is a blind timer.

**Assertions — hand-rolled.** No assertion library, no per-check isolation (one thrown error
aborts the file), no machine-readable output, no tags, no parallelisation. The verdict is a
booleans object plus `console.error`.

**Artifacts — screenshots only.** No **trace**, which is the single most valuable artifact for
a flaky UI test (DOM snapshots + network + console, replayable). No video, no console capture.

**Test isolation — broken, and this one is a bug, not a style issue.**

I seeded a clean profile and ran the repo's own suite:

```
before:  ~/.nova-ide/settings.json, ~/.nova-ide/keepme.txt
$ npm run test:regression        → 66/66 passed
after:   ~/.nova-ide/checkpoints/test-agent-1792320758903/1792320758908-z9z214.bak
         ~/.nova-ide/checkpoints/test-agent-1792320758903/manifest.jsonl
         ~/.nova-ide/checkpoints/test-agent-new-1792320758930/manifest.jsonl
         ~/.nova-ide/settings.json, ~/.nova-ide/keepme.txt
```

The suite writes into the developer's **real** config directory and leaves checkpoint backups
behind — accumulating on every run. There is no way to redirect the profile, because the app
hardcodes `path.join(os.homedir(), '.nova-ide')`.

**Fix (small, high leverage):** a `NOVA_HOME` (or `NOVA_CONFIG_DIR`) environment override
resolved in one place, plus cleanup in the test teardown. The attached `profile` fixture
depends on it and asserts it took effect, so the suite fails loudly rather than silently
polluting the real profile.

---

## 4. Coverage gaps, in priority order

**Gap 1 — No UI coverage at all.** Nothing clicks. This is the gap the whole review is about.

**Gap 2 — No main-process / IPC coverage.** `electron/main.js` owns the settings persistence,
the model list, OAuth flows, the terminal IPC and the automation scheduler. None of it is
tested, because it cannot be imported (it calls `require('electron')` at module scope and
touches `app` immediately). I could not test it either — which is exactly why it should be
extracted:

> Move each `ipcMain.handle('x', fn)` body into `electron/handlers/x.js` as a plain async
> function, and have `main.js` only wire the channel to it. Then the handler is a normal unit
> under test — no Electron, no display — and `main.js` becomes trivial wiring.

That single refactor converts the largest untested surface in the app into cheap, fast tests.

**Gap 3 — No contract tests against a real provider.** The mock LLM proves the loop; it cannot
prove that Gemini's `?key=` list endpoint, or an OpenAI-compatible `/models`, behaves as
assumed. A thin contract layer (record/replay a real response once, assert the parser) would
catch provider drift without needing a key in CI.

**Gap 4 — No performance guardrails.** The per-request payload is ~2,818 tokens, of which
**~2,353 are tool schemas (83%)** — and the agent pays it on every step. Nothing fails if that
doubles. A one-line assertion on the serialised tool-schema size would make it a tracked
budget instead of an invisible regression.

**Gap 5 — No accessibility checks.** Icon-only buttons with only a `title` are a testability
*and* an a11y problem. Adding `aria-label` and `data-testid` fixes both at once.

---

## 5. Target shape

```
        ▲  few    e2e/            Playwright + TS  ← NEW (this review)
       ╱ ╲               real UI: clicks, dialogs, badges, focus
      ╱───╲  some   integration/  handlers, IPC, git, MCP, providers  ← extract from main.js
     ╱─────╲
    ╱───────╲ many  unit/         66 tests today — keep and grow  ✅
```

The current suite is a **spike with no middle**: a lot of good unit tests, a few scripts that
look like E2E but assert at the unit level, and nothing that touches the screen.

---

## 6. What I attached

A drop-in Playwright + TypeScript suite (`nova-playwright-e2e.zip`):

- `playwright.config.ts` — trace on first retry, screenshot/video on failure, JUnit for CI.
- `e2e/fixtures.ts` — an isolated temp profile, the Electron app, the first window; fails
  loudly if `NOVA_HOME` is ignored.
- `e2e/pages/Composer.ts` — the composer with **real** locators taken from the markup, plus
  `waitForTurnToFinish()` which replaces the `sleep(2500)` pattern.
- `e2e/specs/agent-modes.spec.ts` — the mode badge must match what actually ran.
- `e2e/specs/approval.spec.ts` — Allow / Always / Deny through the real dialog.

**Verification status (honest):** `npx tsc --noEmit` passes clean under `strict`, and
`npx playwright test --list` discovers **5 tests in 2 files**. I could **not** execute them —
that needs a display and a real Electron window, which the environment I worked in does not
have. Expect to adjust a locator or two on the first real run.

---

## 7. Recommended order of work

| # | Action | Effort | Payoff |
|---|---|---|---|
| 1 | Add `NOVA_HOME` override + test cleanup | ~30 min | stops tests destroying real profiles |
| 2 | Add `data-testid` to transcript items, `aria-label` to icon buttons | ~1 h | makes the UI suite stable; fixes a11y |
| 3 | Land the Playwright suite and run it once on a real machine | ~1 h | the first real UI coverage |
| 4 | Replace the 11 hardcoded sleeps with condition waits | ~2 h | removes the main flake source |
| 5 | Extract `ipcMain` handlers into testable modules | ~1 day | covers the biggest untested surface |
| 6 | Add the tool-schema size budget test | ~15 min | guards the 83% cost centre |

Items 1–3 are a day's work and change the suite from "asserts the store" to "asserts the
app".

---

## 8. One thing to keep

The habit that has grown over the last few rounds — **every fix arrives with a test that
would have caught it** — is the single best signal in this repository. Keep that, and the
layers above will follow.
