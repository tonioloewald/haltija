# CLAUDE.md

> **Shared engineering practices** live at
> **https://github.com/tonioloewald/tosijs-coding-practices** — and, when checked out beside
> this repo, at [`../tosijs-coding-practices`](../tosijs-coding-practices/README.md). Read that
> index first for the cross-project defaults (development, testing, code quality, performance,
> review, releasing, deployment, and the **observant** tosijs/tjs stack). This file records only
> what is **specific to or divergent from** those defaults — when they conflict, this file wins.
>
> Those docs are **living, not graven in stone.** Don't rewrite them unprompted, but do speak up:
> voice concerns, flag inconsistencies, and suggest improvements as you work. Continuous
> improvement is the goal — see the repo's `CONTRIBUTING.md`.


This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Haltija?

Haltija gives AI agents eyes and hands in the browser. Instead of guessing what's on screen, agents can see the actual DOM, click elements, type text, and watch for changes. The server exposes a REST API that routes commands to browser widgets connected via WebSocket.

## Agent Skill / Plugin

This repo ships a Claude Code **plugin** that teaches agents to use Haltija — both live
browser control and authoring/running the JSON regression tests via `hj test-suite`.

- Skill: `plugins/haltija-skill/skills/haltija/SKILL.md`
- Plugin manifest: `plugins/haltija-skill/.claude-plugin/plugin.json`
- Marketplace (repo root): `.claude-plugin/marketplace.json`

Install (anyone): `/plugin marketplace add <this-repo>` then
`/plugin install haltija-skill@haltija`. (Local testing: add the repo path instead of the
GitHub slug.) This is the **skill** path; the older MCP path is `bunx haltija --setup-mcp`.

**Keep the skill in sync with the tool.** When you add or change an `hj` command, a
test-step `action`, or an `assertion` type, update `SKILL.md` in the same change — the skill
is the agent-facing contract and silently drifts out of date otherwise. Bump
`plugin.json`'s `version` on a release (or omit it to let the git SHA drive updates).

## Build & Test Commands

```bash
# Build (compiles TypeScript, embeds assets, bundles component.js)
bun run build
bun run build:assets              # Regenerate src/embedded-assets.ts only

# Desktop app (Electron)
bun run electron                  # Full build + launch Electron
bun run electron:quick            # Launch Electron without rebuilding

# Unit tests (run with Bun)
bun run test                      # All unit tests — this is `bun test src/`
bun test src/server.test.ts       # Single test file
bun run test:server               # Shortcut for src/server.test.ts
bun run test:https                # Shortcut for src/https.test.ts
bun run test:both                 # Shortcut for src/both-mode.test.ts
bun run test:integration          # Integration tests (needs running desktop app)

# Note: bare `bun test` (no path) is NOT the unit suite. There is no bunfig.toml test
# root, so it also discovers tests/haltija.test.ts and apps/desktop/integration.test.ts,
# both of which need a live server and will fail without one. Always scope it: `bun run
# test`, or `bun test src/`.

# Integration tests (requires running haltija server)
bun test tests/haltija.test.ts    # Tests using haltija/test helper

# E2E tests (run with Playwright on Node.js - NOT Bun)
bun run test:e2e

# Run all tests (unit + E2E)
bun run test:all

# Desktop app integration test (against a running Haltija)
bun test apps/desktop/integration.test.ts

# Run server for development
bun run dist/server.js
# or
bunx haltija

# Server CLI options
haltija --https              # HTTPS mode (auto-generates certs)
haltija --both               # HTTP + HTTPS simultaneously
haltija --port 3000          # Custom port (sets HALTIJA_PORT)
haltija --name dashboard     # Register in ~/.haltija/servers/ for hj resolution
haltija --token <secret>     # Require X-Haltija-Token on every request
haltija --headless           # Playwright headless Chromium with auto-injection
haltija --ci                 # CI mode (Electron + wait + sandbox disabled)
haltija --wait-ready         # Block until server + browser fully connected
haltija --docs-dir ./docs    # Custom reference docs directory
# Without --port: tries 8700, falls back to a kernel-assigned ephemeral port

# hj CLI (agent-facing commands)
hj tree                       # DOM tree
hj click 42                   # Click element by ref ID
hj type 10 "hello"            # Type text into element
hj eval "1+1"                 # Eval JS in browser
hj status                     # Server status
hj where                      # Which server this shell targets + what's alive there (add --json)
hj --help                     # List all subcommands

# Targeting a project-specific server (per-shell)
export HALTIJA_NAME=dashboard # resolve via ~/.haltija/servers/dashboard.json
export HALTIJA_PORT=9123      # bypass the registry; talk to a port directly
export HALTIJA_TOKEN=secret   # required when server was started with --token
hj --name dashboard tree      # one-off name override
hj --port 9123 tree           # one-off port override
hj --token secret tree        # one-off token override
```

## Critical: Bun vs Playwright Test Separation

**Playwright runs on Node.js, not Bun.** This is the most common source of test failures:

- Unit tests (`*.test.ts`) use Bun APIs and run with `bun test`
- E2E tests use `.playwright.ts` suffix (e.g., `e2e.playwright.ts`, `mutation.playwright.ts`)
- Playwright tests CANNOT import Bun-only code - if you see "Cannot find package 'bun'" in Playwright, you're importing Bun-specific code
- `playwright.config.ts` uses `testMatch: '**/*.playwright.ts'` to only run Playwright tests

## Architecture

```
Browser Tab              Server (Bun)           AI Agent
    │                        │                      │
    │◄──── WebSocket ───────►│◄──── REST API ──────►│
    │                        │                      │
    └─ component.ts          └─ server.ts           └─ curl/MCP
       Widget in browser        Routes messages         Any HTTP client
```

### Key Source Files

| File | Purpose |
|------|---------|
| `src/server.ts` | HTTP/WebSocket server, REST endpoints, window tracking |
| `src/component.ts` | Browser widget (custom element `<haltija-dev>`) |
| `src/api-schema.ts` | Schema definitions for all endpoints (single source of truth) |
| `src/api-router.ts` | Schema-driven request routing |
| `src/api-handlers.ts` | Handler implementations for routed endpoints |
| `src/types.ts` | All TypeScript types (DevMessage, TestStep, SemanticEvent, etc.) |
| `src/text-selector.ts` | Custom `:text()` pseudo-selector parser (shared by component + tests) |
| `src/test-generator.ts` | Converts semantic events to test JSON |
| `src/test-formatters.ts` | Output formatting for test results (JSON, GitHub, human-readable) |
| `src/test.ts` | `haltija/test` helper — `HaltijaTestClient` for integration tests (requires running server) |
| `src/client.ts` | Typed REST client class (`DevChannelClient`) wrapping all server endpoints |
| `src/tasks.ts` | Kanban task board persistence as Markdown (`.haltija/tasks-*.md`) |
| `src/task-board.ts` | `<task-board>` web component — interactive kanban UI |
| `src/agent-shell.ts` | Spawns `claude -p` subprocesses, parses stream-JSON output |
| `src/terminal.ts` | Status registry, push notification buffer, command dispatch to tools |
| `src/codemirror-bundle.ts` | CodeMirror 6 entry point, bundled as IIFE for terminal file viewer |
| `src/embedded-assets.ts` | Auto-generated asset embeds (do not edit — run `bun run build:assets`) |

### `hj` CLI Architecture

The `bin/` directory mixes Node.js `.mjs` (runtime) and `.ts` (build-only) files:
- `hj.mjs` — CLI entry point, parses args and delegates to subcommands
- `cli-subcommand.mjs` — Translates subcommand invocations (e.g., `hj click 42`) into REST API calls against the running server, using a `COMMAND_HINTS` registry generated from `api-schema.ts` at build time
- `format-tree.mjs`, `format-events.mjs`, `format-test.mjs`, `format-network.mjs` — Render API responses for human-readable terminal output
- `tosijs-dev.mjs` — Entry point for the `haltija` binary (server launcher); `tosijs-dev.ts` is the source compiled into `dist/`
- `mcp-setup.mjs` — Entry point for `haltija-mcp-setup` / `bunx haltija --setup-mcp`
- `build-bookmarklet.ts`, `server.ts` — Build-time helpers, not shipped runtime

### Request Flow

1. Agent makes REST call (e.g., `POST /click {"selector": "#btn"}`)
2. Server validates against schema in `api-schema.ts`
3. Router in `api-router.ts` dispatches to handler
4. Handler calls `requestFromBrowser()` which sends WebSocket message to browser
5. Browser widget (`component.ts`) executes action and returns response
6. Response flows back through WebSocket → REST response

### Diff Mode

The `/click` and `/type` endpoints accept optional `diff: true` and `diffDelay` (ms, default 100) parameters. When enabled, the handler captures a DOM snapshot before the action, waits `diffDelay` ms after, then returns a semantic diff (`{ added, removed, changed, scrolled }`) alongside the normal response. This lets agents verify that an action had the intended effect.

### Ref ID System

The `/tree` endpoint assigns stable ref IDs (e.g., `1`, `42`) to elements. Interaction endpoints (`/click`, `/type`, `/key`) accept `ref` parameter as an alternative to `selector`:
- More efficient than CSS selectors (direct lookup vs DOM query)
- Survives DOM updates within same page load
- Use `ref: "1"` instead of `selector: "#btn"` when working with tree output

### Text Selectors

Haltija extends CSS selectors with custom pseudo-selectors for finding elements by visible text. These work everywhere a `selector` parameter is accepted (`/click`, `/type`, `/query`, `/inspect`, `/tree`, etc.):

| Pseudo-selector | Behavior |
|----------------|----------|
| `:text(str)` | Contains `str` (case-insensitive) |
| `:text-is(str)` | Exact match of `str` (case-insensitive) |
| `:has-text(str)` | Alias for `:text()` (Playwright compat) |
| `:text(/regex/)` | Matches regex (case-sensitive) |
| `:text(/regex/i)` | Matches regex (case-insensitive) |

Examples:
```
button:text(sign in)        # Button containing "sign in" (case-insensitive)
button:text(/Sign in/)      # Case-sensitive match
a:text(/docs|blog/i)        # Link containing "docs" or "blog"
h1:text-is(Dashboard)       # Exact text match
h1:text(/^Dashboard$/)      # Same thing via anchored regex
```

The base CSS selector (before `:text()`) is used to narrow candidates, then text filtering is applied. Quotes around the text are optional: `:text(foo)`, `:text("foo")`, and `:text('foo')` are equivalent.

Implementation: `src/text-selector.ts` (parser), `src/component.ts` (`resolveSelector`/`resolveSelectorAll`).

### Eval Semantics (`hj eval`, `POST /eval`, `eval` test step)

All three paths funnel into the same place: the code string is passed through the server verbatim
and run by `evalCode()` in `src/component.ts`. Async code works:

```bash
hj eval "document.title"                              # sync expression → its value
hj eval "fetch('/api').then(r => r.json())"           # returned Promise → resolved value
hj eval "await fetch('/api').then(r => r.json())"     # top-level await → resolved value
hj eval "const r = await fetch('/api'); return r.status"  # multi-statement → needs `return`
```

The same applies to `"action": "eval"` steps in test JSON.

**Why `evalCode` is a three-step ladder, not one `eval`:** direct `eval` never inherits an async
context (even though the calling method is `async`), so top-level `await` — and `return` — are
`SyntaxError`s. So it tries direct `eval` first, then retries inside an async IIFE in expression
position (preserves the completion value), then as a statement body (needs an explicit `return`).

The retry is deliberately gated on the code matching `/\b(await|return)\b/`. A *runtime*
`SyntaxError` (e.g. `JSON.parse('{')`) is indistinguishable from a parse failure at that point, and
retrying would re-run any side effects the code already had. Keep that guard if you touch this.

### Shadow DOM & Iframe Piercing

`/tree`, `/query`, and related lookups support optional `pierceShadow` and `pierceFrames` flags (CLI: `hj tree --shadow`, `hj tree --frames`). With these, the widget descends into open shadow roots and same-origin iframe documents and flattens them into the same tree / ref ID space. Use when targeting Web Components or framed content.

### Multi-Window Support

- Each browser tab gets a stable `windowId` (persisted in sessionStorage)
- Commands can target specific windows: `?window=<id>`
- `focusedWindowId` tracks which window receives untargeted commands
- `windows` Map tracks all connected windows with their state
- Window types: `tab`, `popup`, `iframe` (tracked via `windowType`)

### Chrome Widget on Internal Port

The Electron desktop app spawns *two* haltija servers: a public one on `HALTIJA_PORT` (default 8700) for content tabs, and an internal one on `HALTIJA_INTERNAL_PORT` (default 8701) that hosts the outer "chrome" widget — the haltija UI inspecting itself. The chrome widget never connects to the public server, so it never appears in agent listings on 8700; no exclusion logic needed.

To inspect the outer Haltija UI from `hj`, target the internal port:

```bash
HALTIJA_PORT=8701 hj tree
```

Same model for embedders: each project chooses a port, agents target it via `HALTIJA_PORT`. Process boundary is the isolation primitive.

### Auto-Launch

- `hj` auto-launches the Haltija Electron app when no browser windows are connected
- Only triggers for action commands (tree, click, etc.), not info commands (status, windows)
- **Only for the bare, unconfigured default (port 8700).** When the shell explicitly targets a private/project-owned instance (`--port`, `--name`, `HALTIJA_PORT`, `HALTIJA_NAME`), the Electron launch is suppressed — that server runs its own browser (bring-your-own-browser), and the standalone app can't connect to a custom port anyway. Instead `hj` prints a hint to attach a browser (inject the widget). This keeps private setups from accidentally spawning Electron.
- `--no-launch` flag to disable
- macOS only currently (`open -a Haltija`), checks `/Applications`, `~/Applications`, and Spotlight

### Schema-Driven API

Endpoints are defined in `api-schema.ts` using `tosijs-schema`:
- GET on a POST endpoint returns self-documenting schema
- POST validates body against schema before calling handler
- Schema generates MCP tool definitions for Claude Desktop
- `SCHEMA_FINGERPRINT` tracks API changes for cache invalidation

### Semantic Events

The "hindsight buffer" - aggregated events that capture user intent:
- "user typed 'hello@example.com'" not 18 keydown events
- Categories: `interaction`, `navigation`, `input`, `hover`, `scroll`, `mutation`, `console`, `focus`
- Presets: `minimal`, `interactive`, `detailed`, `debug`

## Adding New Endpoints

1. Define schema in `src/api-schema.ts` using the `endpoint()` helper
2. Add to `endpoints` registry at bottom of file
3. Add handler in `src/api-handlers.ts` if using schema-driven routing
4. For complex endpoints, may need fallback handling in `src/server.ts`
5. To deprecate: prefix summary with `[Deprecated]` and start description with `Deprecated: Use X instead` — the router auto-detects and adds deprecation headers

## Test JSON Format

Tests are pure JSON with atomic steps:
```json
{
  "version": 1,
  "name": "Login flow",
  "url": "http://localhost:3000",
  "steps": [
    {"action": "type", "selector": "#email", "text": "user@example.com"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "assert", "type": "exists", "selector": ".dashboard"}
  ]
}
```

Step types: `navigate`, `click`, `type`, `check`, `key`, `select`, `cut`, `copy`, `paste`, `wait`, `assert`, `eval`, `verify`, `tabs-open`, `tabs-close`, `tabs-focus`

`select`/`cut`/`copy`/`paste` are generated by the recorder and replayed as the corresponding DOM event dispatched at the step's `selector`. The runner fails on any unrecognized action (no silent pass).

### Template Variable Substitution

Test JSON files support `${VAR_NAME}` placeholders. When a test file is loaded, variables are resolved first from explicit CLI `vars`, then from `process.env`, and left as-is if unresolved. This allows environment-agnostic test files (e.g., `"url": "http://${HOST}:${PORT}"`). Implementation is in `bin/cli-subcommand.mjs` (`substituteVars`).

### Test Runner Behavior

- **`type`**: Uses realistic per-character keystroke simulation by default (native setter, keydown/input/keyup per character, focus/blur lifecycle). Add `"paste": true` for fast paste-style input that still triggers React/form framework validation. Add `"humanlike": false` for instant typing. `"typoRate"` is always 0 in tests.
- **`click`**: Uses realistic click simulation (scroll into view, mouseenter/mouseover/mousedown/mouseup/click sequence).
- **`check`**: For checkboxes/radios — uses realistic click. The recording system generates these.
- **`eval`**: Executes JavaScript in the browser. Async code is supported — see "Eval Semantics" above. Multi-statement code needs an explicit `return`.
- **`tabs-open`**: Opens a new tab (desktop app only). Optional `url` field.
- **`tabs-close`**: Closes a tab by `window` ID.
- **`tabs-focus`**: Focuses a tab by `window` ID. Updates server-side focus tracking.
- **`navigate`**: After navigation, waits for the specific window to reconnect (tracked by `windowId` + `browserId`). Works correctly with multiple tabs open.
- **`wait`** with `forWindow: true`: Polls until a new window/tab connects. Use after `tabs-open` to wait for the new tab's widget to initialize. Returns `newWindowId` in step context.
- **`assert` type `visible` / `hidden`**: "Rendered" semantics, not "on screen". Passes when `display != 'none'`, `visibility != 'hidden'`, and the element has non-zero width and height. Viewport position is intentionally NOT checked — headless CI's small default viewport often puts legitimate content below the fold, and that should not flake the test. If you actually need on-screen, prepend an `eval` step that calls `scrollIntoView()`.
- All interaction steps route through the same `performRealisticType`/`performRealisticClick` handlers as the REST API.

## Deployment paths (which mode, when)

Three ways Haltija runs, in priority order of where we invest:

1. **Private per-project server — the paved path for dev/debugging.** Run a haltija
   server scoped to your project (`bunx haltija --server --name <proj>`, or embed the
   widget on a port you pick) and drive it with the `hj` CLI or a coding agent (Claude
   Code) talking straight to the REST API. `hj where` shows which server a shell targets.
   This is where day-to-day agent-in-the-browser work happens.
2. **Purpose-built Electron app in CI — the killer CI story.** `haltija --headless` /
   `--ci` runs a headless Chromium with the widget auto-injected: deterministic, no DMG,
   ideal for running the JSON test fixtures in GitHub Actions. See `docs/CI-INTEGRATION.md`.
3. **Standalone notarized DMG — deprioritized.** The click-to-run desktop app (with its
   agent / terminal / file-browsing tabs) is no longer a focus: running Claude Code
   directly beats a bespoke harness for almost everything. Keep those tabs working since
   they may still prove useful, but don't invest until/unless they become a burden.
   **DMG building is not part of the standard beta loop** — build on demand only (see
   `AGENTS.md` → "Building a standalone DMG").

## Desktop App (Electron)

Located in `apps/desktop/`. The Electron shell:
- Strips CSP headers for universal compatibility
- Auto-injects widget on page load
- Provides native screenshot capture (Electron `capturePage`)
- Supports multi-tab browsing

### Screenshots (two capture paths)

`/screenshot` resolves differently depending on how the widget was loaded:
- **Desktop app** — uses Electron's native `capturePage`; no user gesture needed.
- **Bookmarklet / injected `dev.js`** — uses `getDisplayMedia`. The user clicks the
  🖥 button in the widget header once to grant a screen/tab/window share; the stream
  is kept alive so subsequent `/screenshot` calls grab frames with no re-prompt.
  Clicking 🖥 again (or the browser's "Stop sharing") ends the session. Before a grant,
  `/screenshot` returns a prompt-to-share message rather than an image.

## MCP Integration

Located in `apps/mcp/`. Provides Model Context Protocol tools for Claude Desktop:
- Generates tool definitions from `api-schema.ts`
- Translates MCP JSON-RPC to REST API calls
- Setup: `bunx haltija --setup-mcp`

## Build Artifacts

The build script (`scripts/build.ts`) generates:
1. `src/version.ts` - Auto-generated from `package.json` version (do not edit)
2. `dist/component.js` - Browser widget bundle (**IIFE**, auto-injecting). Served at `/component.js` and loaded via `<script>`. Also embedded into the server bundle (see below) and synced to the desktop app.
3. `dist/component.esm.js` - Browser widget as **ESM** with real exports (`inject`, `VERSION`, `DevChannel`). This is what `import … from 'haltija/component'` resolves to. Do not use it as a script tag (it won't auto-run).
4. `dist/server.js`, `dist/client.js`, `dist/index.js`, `dist/test.js` - Bun runtime modules. `server.js` embeds `dist/component.js` (via `embed-assets`) so it can serve `/component.js` even when no on-disk copy exists.
5. `dist/*.d.ts` - TypeScript declarations for every entry point, emitted by `tsc -p tsconfig.build.json --emitDeclarationOnly` (bun build does not emit types). `tsconfig.build.json` excludes `*.test.ts`. **The build is gated on this type check — any type error fails `bun run build`.** Run `bunx tsc -p tsconfig.build.json --emitDeclarationOnly` to see errors during development.
6. `apps/desktop/resources/component.js` - Synced copy for desktop app
7. `apps/mcp/src/endpoints.json` - MCP endpoint definitions from schema
8. `bin/hints.json` - CLI command hints generated from schema endpoints
9. `dist/hj.js` - Standalone hj CLI bundle (all deps inlined, shebang rewritten to `#!/usr/bin/env bun`)
10. `dist/codemirror.js` - CodeMirror 6 IIFE bundle for terminal file viewer (also copied to `apps/desktop/resources/`)
11. `API.md` - Auto-generated API reference (do not edit directly)
12. `DOCS.md` - Auto-generated hj CLI quick-start docs served at `/docs` (do not edit directly)
13. `llms.txt` - Auto-generated agent-discovery file ([llmstxt.org](https://llmstxt.org)) served at `/llms.txt` and shipped in the npm package (do not edit directly)

**Build ordering note:** the IIFE component (#2) is built *before* `embed-assets` so it can be embedded into the server bundle; `embed-assets` also embeds `llms.txt`. Don't reorder these steps.

## Version Management

Version is managed in `package.json` only. The build script generates `src/version.ts` automatically. Never edit `version.ts` directly.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `HALTIJA_PORT` | HTTP server port; if unset, server tries 8700 then ephemeral. Also read by `hj`. | — |
| `HALTIJA_NAME` | Register/look up the server under this name in `~/.haltija/servers/` | — |
| `HALTIJA_INTERNAL_PORT` | Internal server port for the desktop app's chrome widget | `8701` |
| `HALTIJA_TOKEN` | Shared-secret required on every REST + WebSocket request (off when unset) | — |
| `HALTIJA_DESKTOP` | Set by the Electron desktop app when it spawns the server (enables `__NEED_WINDOW__`) | — |
| `DEV_CHANNEL_PORT` | Legacy alias for `HALTIJA_PORT` | — |
| `DEV_CHANNEL_HTTPS_PORT` | HTTPS server port | `8701` |
| `DEV_CHANNEL_MODE` | `http`, `https`, or `both` | `http` |
| `DEV_CHANNEL_SNAPSHOTS_DIR` | Save test snapshots to disk (CI) | — |
| `DEV_CHANNEL_DOCS_DIR` | Custom docs directory | — |

### Instance Registry & cwd Routing

Every server registers itself in `~/.haltija/servers/<name>.json` as `{ name, port, pid, cwd, startedAt, auto? }`, cleaned up on `SIGINT`/`SIGTERM`/`exit`. Stale entries (pid no longer alive) are removed lazily on lookup. Implementation: `src/sessions.ts`.

- `haltija --name <foo>` registers under `foo`, so `hj --name <foo>` (or `HALTIJA_NAME=foo hj`) finds its port. Names are alphanumerics, dashes, underscores, dots only.
- **Unnamed servers auto-register under `auto-<port>`**, recording the directory they were started in. That's what powers cwd routing.

**cwd routing is the thing that keeps projects from stepping on each other.** `hj` resolves its target port as:

```
--port flag > --name/HALTIJA_NAME > HALTIJA_PORT > DEV_CHANNEL_PORT > cwd match > 8700 default
```

The cwd step picks the live server whose recorded `cwd` is the *nearest ancestor* of the shell's cwd, so plain `hj` run anywhere inside a project reaches that project's server with no flags and no env vars. Servers started at `/` or in `$HOME` are excluded from matching — they're ancestors of everything and would recapture every project. When `hj` falls back to 8700 while other servers are alive, it warns on stderr rather than silently driving the wrong browser.

Before this existed, every `hj` in every project resolved to 8700 and drove whatever tab was focused there. If you touch the resolution ladder, keep that failure mode in mind: **a misroute is silent and looks like a flaky test, not an error.**

The desktop app is deliberately **not** auto-registered (it owns the default port and is launched from an arbitrary directory, so its cwd says nothing about which project it serves).

### The `hj` binary on `~/.local/bin` is shared state

Servers auto-install `hj` into `~/.local/bin` on startup — a single global binary that every project on the machine runs. Two rules in `src/server.ts` keep that from becoming a last-server-to-boot-wins race (which is how a stale `bunx haltija@beta` ends up owning the `hj` of an unrelated, up-to-date project):

1. **A symlinked `hj` is never touched.** A symlink means someone deliberately pointed `hj` at their own build; clobbering it reverts their tooling under them. Developing on haltija? `ln -sf $PWD/dist/hj.js ~/.local/bin/hj` and every `bun run build` updates the `hj` you actually run.
2. **Install decisions compare file *contents*, not size.** Two builds can coincidentally share a byte count, which would strand a stale `hj` forever.

## CI / QA

Three GitHub Actions workflows run on push/PR to main:

- **`test-qa.yml`** — builds, launches Electron under xvfb, waits for server + browser connection,
  then runs the test JSON fixtures via `POST /test/run` (not `bun test`): `tests/playground.json`,
  `tests/homepage.json`. `tests/xinjs-spa.json` is non-blocking (external site). On failure it
  captures a snapshot + screenshot as artifacts.
- **`e2e.yml`** — runs the Playwright suites (`src/*.playwright.ts`); each spawns its own haltija
  server and injects the widget into a real Chromium page.
- **`docs-drift.yml`** — fails if the generated artifacts are stale relative to the schema. Any
  change to `src/api-schema.ts` **must** be followed by `bun run build` and a commit of the
  regenerated `API.md`, `DOCS.md`, `llms.txt`, `bin/hints.json`, and `apps/mcp/src/endpoints.json`,
  or CI goes red.

## Issue Tracking

- **`TODO.md`** — the roadmap and issue list (build/distribution items, multi-phase plans, known bugs). Keep it current as you work. See `AGENTS.md` for the session-completion workflow (the "landing the plane" steps culminating in `git push`).
- Two other files look like issue lists but aren't: `ROADMAP.md` (repo root) is mostly a log of completed phases plus a "Planned"/"Ideas Parking Lot" backlog, and `docs/ROADMAP.md` is a longer-horizon vision doc ("Roadmap to 11/10"). Neither is the work queue — day-to-day items belong in `TODO.md`.

## Related Docs

- `COMPONENT-PATTERNS.md` — Required reading before editing `component.ts`, `task-board.ts`, or any custom element. Covers stable-by-default rendering, shadow DOM encapsulation, animation gotchas (transitions need start points; can't animate `left`↔`right`), drag handling, console interception, and WebSocket reconnection with kill flags.
- `AGENTS.md` — Session workflow rules (issue tracking via `TODO.md`, mandatory push on session end).
- `docs/` — Hand-written reference docs (`agent-prompt.md`, `recipes.md`, `UX-CRIMES.md`, `CI-INTEGRATION.md`, `AGENTIC-IDE.md`, `REST-API.md`, `EXECUTIVE-SUMMARY.md`, `ROADMAP.md`, `getting-started/`). Distinct from the auto-generated `API.md` and `DOCS.md` at the repo root.
