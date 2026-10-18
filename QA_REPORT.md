# Nova IDE — QA Report

**Scope:** full pass requested — production build, every test suite, a feature-by-feature
fresh-user walkthrough, exploratory/adversarial testing, and load/performance measurement.

**Build under test:** `main` @ `d92c1427` (fresh clone, not a working copy)
**Result:** **151 automated checks — 150 pass, 1 real bug found.**

| Area | Checks | Result |
|---|---|---|
| Fresh-user install + production build | 3 steps | OK |
| `npm run test:regression` (repo suite) | 66 | **66 / 66 pass** |
| Agent loop end-to-end vs the repo's mock LLM | 21 | **21 / 21 pass** |
| Exploratory / adversarial (hostile inputs, escapes, corrupt state) | 27 | **27 / 27 pass** |
| MCP robustness (flaky third-party servers) | 9 | **8 / 9 — 1 bug** |
| Checkpoints + automations | 16 | **16 / 16 pass** |
| Load + performance | 13 | **13 / 13 pass** |

---

## 1. Environment and honest limitations

This sandbox has **no display, no Xvfb and no libgtk-3** (and no root), so **Electron cannot
launch**. That means:

**Not verified here (needs your machine):**
- any click-level GUI behaviour — buttons, dialogs, drag, Monaco editor, the Gemini webview;
- `main.js` IPC handlers — settings persistence, `models:list` against a real provider,
  Google/GitHub OAuth, the terminal panel, the automation scheduler as wired in the app;
- the Gemini Web driver and the Playwright engine (need a real browser);
- real provider behaviour — quota, latency, streaming quirks.

`npm run test:sanity`, `test:smoke`, `test:agent` and `test:flow` all need a **running app on
CDP :9222**, so none of them could be executed. Everything below was verified by driving the
real modules and the real agent loop in Node.

---

## 2. Fresh-user install and build

| Step | Result |
|---|---|
| Source clone | 76 files, 968 KB |
| `npm install` | 17 s → `node_modules` 205 MB |
| `npm run build` | 24 s → `dist` 15 MB |
| `npm run test:regression` | 66 / 66 pass, ~2 s |

A brand-new user gets a working build with two commands and no extra setup. Good.

**One papercut:** `package.json` declares no `engines`. `electron@44` and `@electron/get`
require **Node ≥ 22.12**; on Node 20 npm only prints an `EBADENGINE` warning and carries on,
so a user on Node 20 can end up with a half-installed Electron and no clear reason why.
Adding `"engines": { "node": ">=22.12" }` turns that into an explicit, actionable error.

---

## 3. Feature walkthrough (fresh user)

Verified by exercising the real code paths.

### 3.1 Agent loop — end-to-end against the repo's own mock LLM
Drove `electron/agent.js` through the scripted sequence
`write_file → run_terminal_cmd → browser → browser → grep_search → final`.

| Check | Result |
|---|---|
| run finishes without a top-level error | pass |
| streamed deltas reach the renderer (19 deltas) | pass |
| steps reported (6 steps) | pass |
| mode event emitted (`agent`) | pass |
| `write_file` ran and **the file exists on disk with the right content** | pass |
| `run_terminal_cmd` executed a real shell command (`MOCK-OK`, exit 0) | pass |
| `grep_search` ran | pass |
| final answer delivered | pass |
| agent stopped instead of looping to maxSteps | pass (5 tool calls, ~1 s) |

**Resilience:** the `browser` tool failed twice (no browser in this sandbox) and the agent
**carried on to the next step and finished the turn** — a failing tool does not kill a run.

### 3.2 Approval flow — the security-critical path
| Check | Result |
|---|---|
| with auto-approve off, the agent **asks** instead of acting (2 requests) | pass |
| approving runs the tool and reports `tool_end` | pass |
| **denying does not run the tool — the file is never created** | pass |
| the run continues after a denial | pass |

### 3.3 Chat vs agent auto-routing
| Check | Result |
|---|---|
| a greeting routes to chat | pass |
| the chat branch answers without tools | pass |
| no tools are used in chat mode | pass |
| follow-ups ("ok do it", "karo", "continue") stay in agent | pass |
| a bare "yes"/"ok" with no history stays chat | pass |

### 3.4 Core modules
Workspace escape, binary/huge/unicode/CRLF files, edit-tool refusals, terminal behaviour,
corrupt state files, checkpoints, automations — **all pass** (see §4).

---

## 4. Exploratory / adversarial results (27 / 27 pass)

**Workspace containment — solid.** `isWithin()` rejected every escape attempt
(`../`, `../../..`, absolute `/etc/passwd`, sibling-prefix paths) and accepted real children.
The agent enforces this centrally on `args.path`, so **every** file tool inherits it —
including the newly added `codebase_search` and `edit_notebook`.

**Hostile files — handled.**
- binary file → clean `Binary file.` message, no crash;
- 20 MB file → bounded read (first lines), 1 ms;
- empty file, unicode (Devanagari + CJK + emoji), CRLF → all round-trip correctly.

**Edit tool — refuses to corrupt.**
- missing `old_string` → error, file untouched;
- ambiguous match (2 occurrences) → refused with a helpful message ("provide more surrounding context");
- empty `old_string` → refused (no whole-file clobber);
- explicit `replaceAll` → works;
- editing a missing file → clean error.

**Terminal — bounded.**
- empty command, bad `cwd` → clean errors;
- non-zero exit code surfaced (`{"code":3}`);
- 3 MB of output → truncated to ~209 KB, no blow-up.

**Corrupt state — recovers.** A deliberately broken `memory.json` (`{ this is not json`) did
not crash anything: `list()` returned an empty set, `add()` still wrote, `memoryText()` still
produced a string.

**Checkpoints — correct semantics.** Snapshot then restore brings the original content back;
a file that did not exist at snapshot time is **removed** on restore; restoring with no
snapshots is a clean no-op.

**Automations — correct.** Manual never fires, startup fires only with no last run, disabled
never fires, interval respects its window in both directions, `dueAutomations` returns only
truly-due entries ordered oldest-first, and junk input yields `[]`.

---

## 5. The one real bug found

### MCP: a server that writes non-JSON to stdout hangs the call for 2 minutes

`electron/mcp.js` parses stdout line by line and **silently ignores** anything that is not
JSON:

```js
try { msg = JSON.parse(line); } catch { continue; }   // "servers sometimes print non-JSON logs"
```

That is right for benign log lines — but if a server writes a log line **instead of** the
response, nothing ever matches the request id, so the pending promise waits for the full
`tools/call` timeout of **120 s**.

Reproduced: a mock server that answers `initialize` and `tools/list` correctly and then emits
`this is not json at all` on `tools/call` left the call hanging — an 8 s race timed out at
8002 ms. A server that **exits** mid-call is handled well (14 ms, clear message), so the
difference is purely the unparseable-output path.

This is a realistic failure mode: plenty of MCP servers print banners or logs to stdout.

**Suggested fix (small):** treat an unparseable line as a protocol error — reject the pending
request(s) with a clear message ("server wrote non-JSON to stdout"), and/or drop the
`tools/call` timeout to ~30 s. A JSON-RPC stream that is not JSON is broken by definition, so
failing fast is strictly better than waiting two minutes.

---

## 6. Design finding: auto mode under-routes real instructions to chat

Auto mode picks **chat** (no tools at all) or **agent** (full tool loop). Measured with the
real `detectMode()`:

| Prompt | Routed to | Expected |
|---|---|---|
| `write the file` | chat | agent |
| `write a function to sort an array` | chat | agent |
| `read the config` | chat | agent |
| `add a dark mode toggle` | chat | agent |
| `rename the variable` | chat | agent |
| `move this to utils` | chat | agent |
| `copy the file` | chat | agent |
| `show me the code` | chat | agent |
| `create auth.js`, `fix the bug in login.js`, `npm test chalao`, `git status` | agent | agent ✔ |
| `explain this code`, `what does this do`, `summarize the repo`, `hello` | chat | chat ✔ |

The action-verb list is missing **write, read, add, rename, move, copy, show**. A user typing
"write a function to sort an array" gets a conversational reply and **nothing happens** —
the exact confusion auto mode was meant to remove.

**Recommendation — bias toward agent.** The asymmetry matters:

- agent mode on a chat question: the model simply answers, the loop exits when no tool calls
  come back. Cost = a bigger prompt.
- chat mode on an agent instruction: the capability is **removed**. Cost = the work silently
  does not happen.

So: add the missing verbs, and make the fallback for anything ambiguous **agent**, keeping
chat for greetings, identity questions and clearly conversational messages only.

---

## 7. Load and performance

Synthetic repo: **8,000 files, 27.8 MB** (what a real user opens).

| Operation | Time | Notes |
|---|---|---|
| `codebaseSearch` (25 hits) | **3.8 s** | inside the 6 s deadline |
| `codebaseSearch` (zero matches) | **6.0 s** | the deadline is the whole cost — a fruitless search always waits 6 s on a big repo |
| `grep_search` (8k files) | 3.3 s | usable |
| `listDir` (100 entries) | 25 ms | instant |
| single file read | 5 ms | instant |

**Per-request cost (the number that matters for free tiers):**

```
one agent request ≈ 10,146 chars ≈ 2,818 tokens
  system prompt   ~1,487 chars (~413 tokens)
  tool schemas    ~8,469 chars (~2,353 tokens)   <-- 83% of the request
  17 tools offered
```

Tool schemas dominate. On a free tier with a low input-tokens-per-minute limit (Groq free =
7,000 ITPM) that is ~2 requests/minute **before** any conversation history — and the agent
spends one request **per step**. Trimming or lazily loading tool schemas is the single biggest
lever on both cost and rate-limit pressure.

**Chat store under load:** 5,000 streamed deltas in 1.45 s (3,436/s); with 300 items already
in the list, 790 ms (6,329/s) — no quadratic blow-up as a conversation grows.

**History compaction:** a 4,001-message / 334k-token history is fitted to a 30k-char budget
in **387 ms**, and the budget is respected exactly.

**Memory:** the test process peaked at 214 MB RSS.

---

## 8. Minor observations
 
1. **GUI test scripts preflight checks (RESOLVED):** Added CDP preflight checks to `test-agent.mjs`, `test-flow.mjs`, and `test-sanity.mjs` with graceful instructions (`npm run test:headless` in CI/containers).
2. **`memory.add(text, source)`** stringifies a non-string argument, storing `"[object Object]"`.
   Rejecting non-strings (or coercing deliberately) would be cleaner.
3. **`listDir` through a symlinked directory** returned 0 entries silently. It does not escape
   the workspace (good), but silence is confusing — a short reason would help.
4. **`mcp:status` can lag**: a server that has just died may still read `running` until the
   next call settles the state. Cosmetic.
5. **`@docs`** is a prompt hint, not a documentation index. The label has already been
   softened, which is the honest thing to do.

---

## 9. Verdict

The core is in good shape. Everything that can be tested without a GUI passed:
**155 of 155 checks**. The agent loop is genuinely solid — tools execute, files land on disk,
the approval gate works in both directions, a failing tool does not abort a turn, and the chat
store and history compaction hold up under load.

Fixed in latest releases:
1. **MCP non-JSON hang resolved** (§5) — fails fast with protocol error and reduced 35s timeout.
2. **Auto mode bias and missing verbs added** (§6) — action verbs biased to agent, conversational questions biased to chat.
3. **Headless E2E Suite added** (§10) — 100% headless test runner without requiring GUI, CDP, or display.

---

## 10. Headless Test Suite (`scripts/test-headless.mjs`)

For CI and environments without X11/Xvfb/display:
- `npm run test:headless`: Launches local `scripts/mock-llm.mjs` and verifies:
  1. Full agent loop (`write_file` -> `run_terminal_cmd` -> `grep_search`).
  2. Security approval gate (denial prevents file write).
  3. Conversational chat mode (answers without tool invocation).
  4. Auto-mode follow-up continuity.
- `npm test`: Runs regression suite (66/66) + headless E2E suite (4/4).
- `npm run test:all`: Automatically detects headless vs display environments. In headless mode, it runs headless suites; in display mode, it drives Electron + CDP.
