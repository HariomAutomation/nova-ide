# Cursor 3.24.18 — Reverse-engineering recon notes

Static observations from the locally installed Cursor (`/usr/share/cursor`, deb install).
Collected with REA on 2026-10-16. These notes are for learning/interoperability; no Cursor
code is copied into Nova IDE.

## Artifact identity

| Item | Value |
|---|---|
| Product | Cursor 3.24.18 |
| Commit | `be4c9e5350d77747b42cd467cbd3370a753d4640` |
| Shell | Electron (LICENSES.chromium.html present), VS Code fork |
| Main binary | `/usr/share/cursor/cursor` — ELF, 219,765,976 bytes, sha256 `0636c96f07de2c74a3eaf8692fc1743d81259c0bf66c8ebde7f7179211a8aff9` |
| App dir | `/usr/share/cursor/resources/app` (~121MB `out/`, ~227MB `extensions/`) |

## Electron fuses (`ev_4a204759ae35c323ec4be8602868a9c545df82f1637c1ef2c29af0e5957ab674`)

| Fuse | State |
|---|---|
| RunAsNode | enabled |
| EnableNodeCliInspectArguments | enabled |
| EnableNodeOptionsEnvironmentVariable | enabled |
| EnableCookieEncryption | disabled |
| EnableEmbeddedAsarIntegrityValidation | disabled |
| OnlyLoadAppFromAsar | disabled |
| GrantFileProtocolExtraPrivileges | enabled |

Derived implications: `ELECTRON_RUN_AS_NODE` honored, `--inspect` honored, app not restricted to
ASAR loading. This is how Cursor's own CLI and tooling can drive the binary.

## UI bundles (`resources/app/out/vs/workbench/`)

- `workbench.desktop.main.js` — 38 MB minified workbench bundle
- `workbench.glass.main.js` — 46 MB (Cursor's "Glass" UI layer)
- `workbench.anysphere-ui-automations.js` — 8.5 MB (Anysphere = Cursor's company)
- `workbench.xai-commerce-prepaid.js` — 1.1 MB (commerce/plan gating related)
- `contrib/composer/` — Composer (AI agent) webview runtime, visualization frames

Main process: `out/main.js` (2.7 MB, Microsoft-copyrighted VS Code base + Cursor additions).

## Cursor-specific extensions (21 of 117)

Agent runtime: `cursor-agent-exec`, `cursor-agent-host`, `cursor-agent-worker`,
`cursor-local-agent-runtime`. Platform: `cursor-socket` (backend link, evidence
`ev_fca7ee3967a58d692c26842b1d2c2292ed621a98167ea3d484f43ad43c2b6343`),
`cursor-file-service` (`ev_8b1070119d88d2f281c6abea74d77d8ebe408f9588ca0c869dcd243794a61fb2`),
`cursor-mcp`, `cursor-shadow-workspace`, `cursor-worktree-textmate`, `cursor-ndjson-ingest`,
`cursor-deeplink`, `cursor-checkout`, `cursor-commits`, `cursor-always-local`.
Code intelligence: `cursor-retrieval` (44 MB, local codebase index/search worker).
Automation: `cursor-browser-automation`, `cursor-computer-use`, `cursor-explorer`.

Extensions are webpack bundles; sourcemaps referenced against Cursor-internal hosts.

## Backend endpoints (strings from `out/main.js`)

- `https://api2.cursor.sh` — main API (primary, 4 refs)
- `https://api3.cursor.sh`
- `https://marketplace.cursorapi.com` — extension gallery (`extensionsGallery` in product.json)
- `https://api.origin.cursor.com` — staging variants present

## Why model choice is gated

The model picker options and allowed models are resolved against Cursor's backend
(`api2.cursor.sh`) tied to the account's plan. It is a server-side entitlement — not a
client bug — so the free plan shows a restricted set. Nova IDE sidesteps this by having
no backend: the user configures any OpenAI-compatible endpoint directly with their own key.

## Agent tool surface (v0.2 recon — bundle string survey)

Targeted `grep` over the shipped bundles confirms Cursor's agent tool surface and naming:

- `workbench.glass.main.js` → `read_file`, `delete_file`, `web_search`, `computer_use`,
  plus browser layer keys: `browser_mcp`, `browser_open`, `browser_use_enabled`,
  `browser_settings`, `browser_origin_allowlist`, `browser_integration_preference`,
  `browser_visibility`, `browser_tool`, `browser_protection`, `browser_navigation`, `browser_id`
- `cursor-agent-exec/dist` → `run_terminal_cmd`, `read_file`, `list_dir`
- `cursor-computer-use` / `cursor-browser-automation` extensions ship per-platform backends
  (e.g. a Windows sidecar with its own release manifest); Linux input injection is delegated
  to system tooling in the same shape Nova uses.
- `cursor-retrieval` (44 MB) is the local codebase index/search worker behind codebase search.

Nova mirrors this surface with original implementations: `read_file`, `list_dir`, `write_file`,
`edit_file`, `delete_file`, `grep_search`, `run_terminal_cmd`, `browser`
(Playwright actions incl. screenshot), `computer_use` (screenshot + input injection with
capability detection), and origin-allowlist-free by design since there is no Cursor backend.

## Method

- `inspect_electron_fuses` — fuse bytes + runtime implications
- `analyze_javascript_application` — static inventory/graph of extension bundles
- `strings`/filesystem survey + targeted bundle greps — endpoints, bundle layout, tool names
  (all read-only)

## Fresh REA re-run — 2026-10-17 (session `ses_eb7d7e751ffelSMIjAEAx0ulyC`)

Artifact unchanged since 2026-10-16 (same binary sha256 `0636…aff9`), so fuse evidence ID is
identical (`ev_4a2047…`). New evidence from this run:

- Fuses: `ev_4a204759ae35c323ec4be8602868a9c545df82f1637c1ef2c29af0e5957ab674`
- JS app graph (out/main.js path-bounded): `ev_82513e40e4f253059576fecb840faa0cc3c7e6d84ddca14f10579fa49e9a1927`
  (750 findings, 7 browser windows, 4 explicit web-preferences, 3 dynamic IPC main handlers,
  6 sender-validation observations, 1 utility process; inventory 13,922 files, 13,921
  unselected remain explicit unknowns)

### Fuses — complete 9-fuse table (previous notes listed only 7)

| # | Fuse | State |
|---|---|---|
| 0 | RunAsNode | enabled |
| 1 | EnableCookieEncryption | disabled |
| 2 | EnableNodeOptionsEnvironmentVariable | enabled |
| 3 | EnableNodeCliInspectArguments | enabled |
| 4 | EnableEmbeddedAsarIntegrityValidation | disabled |
| 5 | OnlyLoadAppFromAsar | disabled |
| 6 | LoadBrowserProcessSpecificV8Snapshot | disabled |
| 7 | GrantFileProtocolExtraPrivileges | enabled |
| 8 | WasmTrapHandlers | enabled |

Implications: `--inspect` honored, `ELECTRON_RUN_AS_NODE` honored, not restricted to
app.asar. Limitation (from evidence): ASAR-integrity enforcement is only provable on
macOS/Windows builds; the fuse byte alone doesn't establish Linux enforcement.

### Extension inventory — 117 bundled; 24 Cursor/Anysphere-specific

| Extension | Publisher | Version |
|---|---|---|
| cursor-agent-exec / cursor-agent-host / cursor-agent-worker | anysphere | 0.0.1 |
| cursor-local-agent-runtime, cursor-mcp, cursor-ndjson-ingest | anysphere | 0.0.1 |
| cursor-always-local, cursor-checkout, cursor-commits, cursor-deeplink, cursor-explorer | anysphere | 0.0.1 |
| cursor-resolver, cursor-resolver-helper, cursor-polyfills-remote, cursor-protobuf | anysphere | 0.0.1 |
| cursor-retrieval (local 44 MB codebase index/search worker) | anysphere | 0.0.1 |
| cursor-socket, cursor-file-service (backend link) | anysphere | 0.0.1 / 1.0.0 |
| cursor-browser-automation, cursor-computer-use | cursor | 1.0.0 |
| cursor-shadow-workspace (background buf-edit preview) | anysphere | 1.0.0 |
| worktree-textmate | everysphere | 0.0.1 |
| cursor-themes | (none) | 0.0.2 |

(vs the 2026-10-16 notes: `cursor-protobuf` and `cursor-themes` added to the specific set;
`worktree-textmate` is its actual name — published by "everysphere".)

### Endpoints — complete surface (out/main.js + three workbench bundles)

Primary:
- `https://api2.cursor.sh` — main API (8 refs); also `/updates` (updateUrl) and `/automations/webhook/`
- `https://api3.cursor.sh` — statsig event proxy `.../tev1/v1`
- `https://api4.cursor.sh` (4 refs)
- `https://api5.cursor.sh` — regional agent gateways: `agent.api5…`, `agent-gcpp-uswest…`,
  `agent-gcpp-eucentral…`, `agent-gcpp-apsoutheast…`, plus `agentn…` / `agentn-gcpp-*`
- `https://api.origin.cursor.com` + `/mcp` (3 refs), staging variants
  `api.origin-staging.cursor.com`, `staging.cursor.sh`, `dev-staging.cursor.sh`, `staging.cursor.com`

Auth / marketplace / delivery:
- `https://prod.authentication.cursor.sh` (2 refs)
- `https://marketplace.cursorapi.com` (6+ refs) and `marketplace.cursor.sh` /
  `staging-marketplace.cursor.sh`
- `https://repo42.cursor.sh` (4 refs)
- `https://downloads.cursor.com` (+ `/origin/install.sh`), `https://cursor.com/downloads`
- `https://cursor.blob.core.windows.net/remote-releases/${commit}/vscode-reh-${os}-${arch}.tar.gz`
  (remote server fetch, product.json `serverDownloadUrlTemplate`)
- `https://status.cursor.com/api/v2/{components.json, incidents/unresolved.json}`;
  `https://changelog.cursor.com`
- Official extension replacement map (product.json): `ms-*` extensions → `anysphere.*`
  (remote-ssh, remote-containers, remote-wsl, cursorpyright, cpptools, csharp)

High-frequency non-Cursor strings (docs/links only): `raw.githubusercontent.com` (452),
`cursor.com` (170), `googleapis.com` (52).

### Agent tool registry — per-model naming (cursor-agent-exec/dist/main.js)

Cursor's local agent normalizes tool names per model "version" (their internal model keys).
Same capability, three spellings:

| Capability | dsv3-1018 (snake) | haiku / cursor-0226 / dsv3-1205 / latest (Pascal) | gpt5-codex / codex-cloud |
|---|---|---|---|
| read file | `read_file` | `Read` | `ReadFile` |
| list dir | `list_dir` | `LS` | — |
| grep | `grep` | `Grep` | `rg` |
| codebase search | `codebase_search` | — | — |
| terminal | `run_terminal_cmd` | `Shell` | — |
| delete file | `delete_file` | `Delete` | — |
| notebook edit | `edit_notebook` | `EditNotebook` | — |
| todo plan | `todo_write` | `TodoWrite` | — |
| web search | `web_search` | `WebSearch` | — |
| X/Twitter search | `x_search` | `XSearch` | — |
| web fetch | `mcp_web_fetch` | `WebFetch` | — |
| image gen | `generate_image` | `GenerateImage` | — |
| video gen | `generate_video` | `GenerateVideo` | — |
| code lineage | `code_lineage` | `CodeLineage` | — |
| bugfix report | `mcp_report_bugfix_results` | `ReportBugfixResults` | — |
| computer use | `computer_use` (workbench.glass: 2 refs; exec: 1) | — | — |

File edits are not a single tool: outside `read_file`, edits flow through
`dist/diff-worker.js`, `unified-diff-worker.js`, `diff-patch-worker.js` (apply-diff pipeline),
plus conflict/truncate conflict handling strings.

Cursor agent-runtime extras observed live: `cursor-agent` CLI worker running against
`https://api2.cursor.sh … worker start --worker-dir <workspace> --name <ws>@<host>`
(background agent per workspace; NDJSON ingest + `agent-cli-state.json` in globalStorage).

### Dual-shaped tool registry finding (fresh, 2026-10-17)

The per-model switch maps above are the strongest evidence yet that Cursor's tool surface is
one capability set rendered through model-specific spellings. Nova's tool names
(`read_file`, `list_dir`, `grep_search`, `run_terminal_cmd`, `browser`, `computer_use`)
already sit inside this vocabulary; the deltas are the row-level gaps in the table above.
