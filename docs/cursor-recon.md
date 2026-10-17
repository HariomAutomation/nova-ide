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
