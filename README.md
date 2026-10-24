# Nova IDE

An autonomous AI IDE built from scratch — **with your own API keys and full model choice**.

The point: no plan gates. You bring any OpenAI-compatible endpoint — **Gemini free tier**,
OpenCode Zen, OpenRouter, OmniRoute, Sarvam AI, DeepSeek, Groq, Ollama,
LM Studio, OpenAI, or anything custom — and pick the model yourself. Nova ships a **lean,
junk-free default list** (Gemini free family + OpenCode Zen); everything else is an opt-in preset.

## Contest workflows (TopCoder, Kaggle, Penpot)

Nova can take a contest end to end — ingest the brief, turn it into a tracked
checklist, produce the deliverable, and package or submit it. Three tracks:

| track | live against the real service? |
|---|---|
| **Kaggle** | yes — submit + score read-back verified |
| **Penpot** | yes — a generated file imports into production Penpot |
| **TopCoder** | not yet — tested, but never run against an open contest |

See **[docs/contests.md](docs/contests.md)** for the flows, the credential setup, the
Kaggle submit sequence, and an honest account of what has and has not been proven.

## Features (v0.2)

### Agent-first UI
The center area **is** the agent — a modern home with a big composer, repo chips
and quick suggestions. The left sidebar has **New Chat / Search / Automations / Customize**,
your repositories and recent chats (persisted across restarts). The right panel is an
optional **Ask** assistant (`View → Assistant Panel`). Switch between the agent and the code
editor with **Ctrl+Shift+A** or the **IDE ↗ / Agent ↗** pills. Light theme by default
(`View → Theme` toggles), with clean, sleek styling.

### Agent mode (the big one)
The agent is an autonomous loop with real tools:

| Tool | What it does | Approval |
|---|---|---|
| `list_dir` | List folders | auto |
| `read_file` | Read files (numbered lines, pagination) | auto |
| `grep_search` | Regex search across the workspace | auto |
| `write_file` | Create/overwrite files | edit (auto by default) |
| `edit_file` | Exact search/replace edits | edit (auto by default) |
| `delete_file` | Delete files | edit (auto by default) |
| `run_terminal_cmd` | Run shell commands (`bash -lc`) | **asks** (can auto-approve) |
| `browser` | Drive a real Chromium via Playwright: `open`, `click`, `fill`, `press`, `text`, `screenshot`, `back`, `close` | browser (auto by default) |
| `computer_use` | Screenshot the desktop + move/click/type/key | **asks** (can auto-approve) |
| `web_search` | Search the web (DuckDuckGo, no key needed) | web (auto by default) |
| `web_fetch` | Fetch a URL as readable text (docs, READMEs) | web (auto by default) |
| `mcp_list_tools` | Discover tools of big MCP servers (bridge mode) | auto |

- Tool calls show up as cards in the conversation: status, arguments, collapsible output, screenshots inline.
- Approvals: Allow / Always / Deny directly in the card. "Always" persists to settings.
- Files the agent edits reload live in the editor (if the tab is clean).
- Recent chats are persisted; reopening one replays its transcript and keeps context.
- Any model with OpenAI-style function calling works (Gemini 3.x, DeepSeek, GPT-4o, Llama 3.x, …).
- **Smart error cards** — if a request fails, the chat shows a diagnosis card (quota exhausted,
  wrong key, "free tier is app-only", network) with the actual fix and, where possible,
  one-click model switch + auto-retry.

### Free upgrades Cursor charges for (v0.3)
- **MCP client + one-click Addons** — Customize → *Featured Addons*: **REA** (Reverse Engineer
  Anything — Ghidra/Frida/decompile/memory, 207 tools), **LeanToken** (token-bounded repo
  exploration, 9 tools) **Penpot** (free/open-source design tool — read the focused Penpot page
  and turn designs into code; paste the MCP URL from Penpot → Integrations → MCP Server, or use the
  local server) and **Eraser** (diagram-as-code, remote MCP at app.eraser.io). Any other stdio MCP server: `~/.nova-ide/mcp.json`. **Bridge mode**:
  servers with 40+ tools don't bloat every request — the agent discovers them with
  `mcp_list_tools` and calls them by exact name, so context (and cost) stays small.
- **Web search & fetch** — `web_search` (DuckDuckGo, no API key) and `web_fetch` built in.
- **Project rules** — `NOVA.md` or `.nova/rules/*.md` in the repo are loaded into the agent's
  system prompt automatically.
- **Skills** — `~/.nova-ide/skills/<name>/SKILL.md`; type `/` in the composer to insert one.
- **Checkpoints** — every agent edit is snapshotted; `⋯ → Restore files` undoes the agent's
  edits for that chat.
- **Automations** — save a prompt and re-run it as an agent task later (sidebar → Automations).
- **Settings → Agents** — Cursor-style page: run modes (Auto-Review / Allowlist / Full Auto),
  approvals allowlist (edits, terminal, browser, desktop, MCP), read access, file-deletion and
  external-file protection, queue/interrupt for new messages, Ctrl+Enter submit, max steps.

### Editor & shell
- **Monaco** editor (VS Code core), 40+ languages, tabs, dirty indicators
- **Search panel** — workspace-wide regex search (ripgrep-style), click a hit to jump to the line
- **Terminal panel** (Ctrl+`) — run commands in the workspace, live output
- **Inline AI edit (Ctrl+K)** — select code, describe a change, preview, Accept/Reject
- **Ask panel** — plain streaming chat with an "include active file" toggle
- **Menu bar** (File/Edit/View/Help) + status bar with model, terminal and folder chips

### Models
- **Lean by default**: `gemini-3.7-flash` (free, verified), `gemini-3.1-flash-lite` (free),
  `gemini-3.5-flash` (free), `gemini-web` (your Google account via the embedded Gemini tab),
  and **OpenCode Zen** (your key). No clutter of half-working paid presets; use **+ presets**
  in Settings only if you want them.
- **⚡ Test connection (two-phase, honest)** — paste your key, hit Test:
  1. the live `/models` list is fetched instantly (all versions show as clickable pills,
     "(all N versions dikhaao)") and a sensible chat model is auto-picked;
  2. a real **1-token chat ping** verifies the key can actually chat — badges are
     trust-worthy: `✓ Connected — N models` (green), `△ Models list mili — N models` + the
     endpoint's own error (amber, e.g. Zen free tier is built as app-only → `FreeTierError`
     truth while the model list still shows), or `✗ <reason>` (red).
- One-click presets: **Gemini Flash (free)**, **Gemini 4 (Argon)**, OpenRouter,
  **OpenCode Zen**, **OmniRoute (self-host)**, **Sarvam AI**, DeepSeek, Groq, OpenAI,
  Ollama, LM Studio — plus custom endpoints
- **⇅ Fetch models** — paste your key, pull the live model list from the endpoint, pick from the
  dropdown (no need to memorize model IDs)
- Multiple models, pick the active one in one click
- Keys stored locally (`~/.config/Nova IDE/settings.json`, removed entries park their key in
  `keyVault` so re-adding a preset restores it), only sent to the provider you configured

## Run

```bash
cd nova-ide
npm install
npm start        # builds renderer, then launches Electron
```

Dev mode with hot reload:

```bash
npm run dev:renderer          # terminal 1 — Vite at :5173
NOVA_DEV_SERVER=http://localhost:5173 npm run app   # terminal 2
```

## First steps

1. `Ctrl+,` → **Models** → **Gemini Flash (free)** is already in the list — paste your free
   AI Studio key → **⚡ Test connection** → "✓ Connected — N models" (sab versions pills me
   dikh jayenge). Ya apni key ke saath koi bhi provider add karo → Same Test flow.
2. `Ctrl+O` to open a folder
3. Type a task in the center composer, e.g. *"Create a snake game in Python and run it to
   check for errors"* — the agent reads/writes files, runs commands, drives the browser
4. **Ctrl+Shift+A** to flip to the editor; `Ctrl+K` edits a selection with AI

## GPU warnings on Linux (Wayland)

These lines are Chromium's, not Nova's, and they are harmless noise:

```
ERROR:vaapi_wrapper.cc:1801] vaInitialize failed: unknown libva error
ERROR:wayland_surface_factory.cc:249] '--ozone-platform=wayland' is not compatible
  with Vulkan. Consider switching to '--ozone-platform=x11' or disabling Vulkan
Warning: maxDynamicUniformBuffersPerPipelineLayout artificially reduced ...
```

On a Wayland session Chromium picks a backend that conflicts with Vulkan and then fails VA-API
init. Nova now asks Chromium for the right ozone platform and turns Vulkan/VA-API off **on Wayland
only**, which removes the first two lines and the software-rendering fallback behind them.

If the window ever comes up blank or flickers, start Nova with hardware acceleration off:

```bash
NOVA_GPU=off npm start      # no GPU acceleration at all
NOVA_GPU=keep npm start     # do not touch Chromium's defaults
```

## Computer use (desktop control) — Linux notes

`computer_use` needs a screenshot tool and an input-injection tool:

**Actions** — `screenshot`, `move`, `click`, `double_click`, `right_click`, `drag`, `scroll`,
`type`, `key`, `wait`. It runs as an **observe → act → observe** loop: every input action returns a
**fresh screenshot** automatically (opt out with `return_screenshot:false`) and reports the screen
size, so the model can verify the effect of each step before choosing the next one. Coordinates are
clamped to the detected screen. `drag` and `scroll` need `xdotool` (ydotool has no equivalent).

- **Screenshots** — auto-detected chain: `xdg-desktop-portal` (Wayland), `gnome-screenshot`,
  `grim` (wlroots), `scrot`, GNOME Shell D-Bus.
  On GNOME Wayland the portal shows a **"Share" dialog per capture** (platform security —
  click it and the screenshot is taken). On X11 it works silently.
- **Input on X11/XWayland** — `xdotool`. This machine already has a user-space copy at
  `~/.local/bin/xdotool` with `libxdo.so.3` in `~/.local/lib` (Nova adds that to
  `LD_LIBRARY_PATH` automatically). For a system-wide install: `sudo apt install xdotool`.
- **Input on Wayland (native apps)** — `sudo apt install ydotool` and enable the `ydotoold`
  user service; ydotool injects at the kernel uinput level. xdotool only reaches XWayland
  windows, not Wayland-native apps.

Settings → **Computer** shows what Nova detected and a test screenshot button.

## Browser tool

Uses Playwright Chromium. Nova is bundled with `playwright` and reuses the usual
`~/.cache/ms-playwright` browser cache; if the browser is missing, run:

```bash
npx playwright install chromium
```

Settings → **Browser** can launch a test page, show a screenshot, and toggle headless/visible.

## Where settings live

- Models + keys + agent/browser prefs: `~/.config/Nova IDE/settings.json`
- MCP servers: `~/.nova-ide/mcp.json` (the Addons UI writes here)
- Skills: `~/.nova-ide/skills/*/SKILL.md`
- Checkpoints (undo agent edits): `~/.nova-ide/checkpoints/`
- Agent artifacts (browser screenshots, desktop captures): `~/.nova-ide/artifacts/`

## Automated testing (dev)

```bash
# terminal 1
npx electron . --no-sandbox --remote-debugging-port=9222

# terminal 2
node scripts/verify-app.mjs 9222   # page title, DOM preview, console errors, screenshot
node scripts/test-flow.mjs 9222    # open folder/file, edit, settings modal, AI error path
node scripts/test-ask.mjs 9222     # Ask panel e2e (streaming, typing, reply) vs mock LLM
node scripts/test-agent.mjs 9222   # full agent e2e against the bundled mock LLM:
                                   #   write_file -> run_terminal_cmd (approval flow) ->
                                   #   browser open + screenshot -> grep_search -> final answer,
                                   #   plus terminal panel and search UI checks
```

`test-agent.mjs` is fully deterministic — it spawns `scripts/mock-llm.mjs`
(a tiny OpenAI SSE server with scripted tool calls) and needs **no API key**.
Screenshots land in `/tmp/opencode/*.png`.

## Project layout

```
electron/             Electron main process + preload (CJS)
  main.js             window, app:// protocol, fs IPC, search, terminal, AI + agent IPC
  agent.js            agent loop: tool schemas, streaming tool-calls, approvals
  preload.js          contextBridge API -> window.nova
  tools/
    fsTools.js        list/read/write/edit/delete + workspace search
    terminal.js       runCommand (spawn bash, streams output)
    browser.js        Playwright Chromium wrapper (lazy, headless toggle)
    computer.js       desktop screenshot + input injection (gnome-tools/xdotool/ydotool)
renderer/             React + Vite UI
  src/                store (zustand), agent main view + composer, sidebar (chat/files/search),
                      tool cards, terminal, search, menubar, settings tabs, monaco setup
scripts/
  verify-app.mjs      CDP smoke test
  test-flow.mjs       CDP functional test (editor/settings/ask)
  test-agent.mjs      CDP agent e2e (deterministic, mock LLM)
  mock-llm.mjs        scripted OpenAI-SSE mock server with tool calls
docs/
  cursor-recon.md     Reverse-engineering notes on Cursor 3.24.18 (REA analysis)
```

## Automated testing (Sanity, Smoke, Regression, E2E)

Run the full automated suite in one command:

```bash
npm run test:all
```

Or individual test suites:

```bash
npm run test:regression   # Core backend: fsTools, checkpoints, terminal, web, agent rules, heuristics (19/19 pass)
npm run test:sanity       # UI & Store sanity via CDP (views, themes, settings defaults, window)
npm run test:smoke        # File opening, Monaco editor typing, dirty state, error handling
npm run test:agent        # End-to-end agent loop (tool execution, approvals, Playwright browser, grep, search)
```

## Cursor IDE Parity (Free vs Paid)

| Feature | Cursor IDE (Paid $20-$40/mo) | Nova IDE (100% Free) |
|---|---|---|
| **Composer / Agent Loop** | Gated behind monthly quota & paid sub | **Free & unlimited** multi-step agent with bash, browser & files |
| **Model Choice** | Locked to Cursor servers (`api2.cursor.sh`) | **Full freedom**: Gemini free tier, Gemini Web, OpenCode Zen (BYOK), Ollama, DeepSeek, Groq, OpenAI, etc. |
| **Gemini 4 Access** | Requires paid credits | **Free** via embedded `gemini.google.com/app` session partition |
| **Tab / Inline Autocomplete** | Paid Copilot++ feature | **Built-in** via Monaco `registerInlineCompletionsProvider` |
| **`@` Context Mentions** | `@files`, `@git`, `@terminal`, `@web`, `@codebase` | **Built-in** in Composer (`@git`, `@terminal`, `@web`, `@codebase`, `@files`) |
| **Project Rules** | `.cursorrules`, `.cursor/rules/*.mdc` | **Auto-loaded** (`.cursorrules`, `.cursor/rules/*.mdc`, `NOVA.md`, `AGENTS.md`) |
| **Checkpoints & Undo** | Paid checkpointing | **Built-in** automatic snapshot & rollback (`checkpoints.js`) |
| **Web Search & Fetch** | Counts against paid requests | **Free & unlimited** via DuckDuckGo HTML parser & direct fetch |
| **MCP Integration** | Supported | **Built-in** with featured one-click addons (REA, LeanToken, Penpot) |
| **Cloud Code provider** | — | **Experimental**: Gemini via Google's Cloud Code backend (what Antigravity uses) with your own Google account — no API key, real function calling. Undocumented API; a normal API key stays the reliable route |
| **Memory** | — | **Built-in** long-term notes (`~/.nova-ide/memory.json`); injected into the system prompt every turn, for every model, and the agent can add notes with the `remember` tool |

## Roadmap

- [x] Agent mode with file/terminal/browser/computer tools
- [x] Terminal panel (command runner)
- [x] Agent-first UI (Cursor-2026 layout), light/dark themes, persisted recent chats
- [x] MCP client + one-click Addons (REA, LeanToken) with token-saving bridge mode
- [x] Web search / web fetch, project rules, skills, checkpoints, automations
- [x] Tab autocomplete (inline completion provider with heuristics & LLM stream)
- [x] Gemini 4 Web session integration (`gemini.google.com/app`)
- [x] Cursor `@` mentions (`@git`, `@terminal`, `@web`, `@codebase`)
- [x] `.cursorrules` and `.cursor/rules/*.mdc` auto-loading
- [x] Comprehensive test matrix (Sanity, Smoke, Regression, E2E)
- [x] Contest workflows — TopCoder briefs, Kaggle submit loop, Penpot design authoring
- [ ] Full PTY terminal (node-pty + xterm.js)
- [ ] Cmd/Ctrl+P quick open
- [ ] Diff review UI for agent edits (Monaco diff editor)
- [ ] LSP integration (diagnostics, go-to-definition)
