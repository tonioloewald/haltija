# Haltija

**Give AI agents eyes and hands in the browser.** Make any browser tab MCP-compatible.

- **See** the live DOM as a semantic tree — what's clickable, what's hidden and why, what inputs exist
- **Do** things — click buttons, fill forms, navigate, run JavaScript
- **Watch** what happens — console errors, DOM mutations, user actions, all as meaningful events

Unlike screenshot-based tools, Haltija works with the actual DOM. Unlike Playwright, it connects to your real browser — already logged in, same cookies, same bug you're looking at.

<!-- TODO: Replace with actual GIF showing: 1) bunx haltija launches app, 2) agent queries tree, 3) agent clicks something, 4) highlight shows result -->
![Haltija in action](docs/assets/demo.gif)

> *Haltija* (Finnish): a guardian spirit that watches over a place. In this case, your DOM.

---

## Quick Start

### Desktop App (Recommended)

```bash
bunx haltija
```

Launches a dedicated browser with the Haltija server embedded. Browse to any page — the widget auto-attaches and your agent can control it immediately. No bookmarklets, no CSP issues.

### Tell your agent

Paste this into your agent conversation:

> I have the `hj` browser tool. Run `hj tree` to see the page, `hj click <id>` to interact, and `hj docs` for help.

Or for Claude Code with MCP: `bunx haltija --setup-mcp`

---

## What Agents Can Do

```bash
# See the page
hj tree                          # Semantic DOM structure with ref IDs
hj screenshot                    # Visual capture with metadata
hj console                       # Recent errors and logs

# Interact
hj click 42                      # Click by ref (from tree output)
hj click 42 --diff               # Click and return what changed (DOM diff)
hj type 10 user@example.com      # Type text
hj key Escape                    # Keyboard input
hj key s --ctrl                  # Keyboard shortcuts

# Watch for changes
hj events                        # Aggregated semantic events

# Point things out (draws a visual box on the user's screen)
hj highlight 5 "Problem here"
```

Full API: `hj docs` — or `hj api` for complete reference

---

## Haltija vs. Playwright

Playwright is a mature, cross-browser automation framework with deep tooling (trace viewer, codegen, test runner, fixtures) and an official MCP that hands agents a structured accessibility snapshot. Reach for it when you want cross-browser coverage or a full test framework. Haltija aims at something narrower: letting an agent drive **a browser you're already running**, over plain HTTP — or spawn its own when you'd rather it did.

| | Haltija | Playwright (+ MCP) |
|---|---|---|
| Browser | Attach to your real, already-open browser — *or* spawn its own | Usually its own managed context; can connect to an existing browser over CDP |
| Cross-browser | ⚠️ Chromium only | ✅ Chromium, Firefox, WebKit |
| Session / auth | Uses your live logged-in session as-is | Fresh context by default; reusable via `storageState` / persistent context |
| How an agent drives it | Plain HTTP/REST — curl, any language, no client library | Playwright client library, or the MCP tools |
| Page model | DOM tree with stable ref IDs + `eval` | Accessibility-tree snapshot with ref IDs (MCP), or the full API in code |
| Interaction | Per-character, framework-triggering synthetic events you can steer live over HTTP | Trusted CDP-level input |
| Feedback when a step can't proceed | **Fails fast** — reports what's blocking it (missing / hidden / covered) right away | **Auto-waits to a timeout** (tens of seconds) — smooths over races, but a genuinely broken step burns the full timeout before failing |
| Test generation | record→replay → JSON tests | codegen → Playwright code |
| Debugging | Live widget, console capture, semantic events, click diff | Trace viewer — time-travel step snapshots |
| Embed in your app | ✅ Ship the widget inside your own product | Not designed for that |

**The short version:** they're complementary, and this project uses both — Playwright for cross-browser smoke checks, Haltija for the fast end-to-end pass. Reach for Haltija when you want to point an agent at the browser (and logged-in session) you already have, or embed agent-control into your own app — over nothing more than HTTP.

---

## Haltija vs. Claude in Chrome

Both let an agent drive a browser — they're built for different jobs. Because Haltija can either **spawn its own isolated browser** *or* **attach to your real one** (via a script tag / bookmarklet on a port you choose), it covers the axes a live-session-only tool can't.

| Axis | Haltija | Claude in Chrome |
|---|---|---|
| Setup / auth | ✅ `bunx haltija` — zero auth, self-spawns | ⚠️ Extension + claude.ai login + per-site permissions |
| How the agent invokes it | ✅ Plain `hj` CLI / REST — always available in a shell | ⚠️ MCP tools; must be loaded + extension connected |
| Project integration | ✅ *Is* your test harness — JSON tests (`hj test-suite`), record→replay, CI | ❌ None |
| Determinism / cost | ✅ DOM + `eval` with stable ref IDs — cheap text, scriptable, headless-CI-able | ⚠️ Has structured reads (page text, find-by-text) *and* vision/coordinate actions; the vision path is token-heavy and coordinate clicks less deterministic |
| Isolation | ✅ Own instance on its own port — never touches your browsing | ❌ Drives tabs in your live session |
| Real-browser fidelity (WebGL/3D, pixels) | ✅ Attach to a real GPU Chrome or the desktop app *(headless GPU is the one weak spot)* | ✅ Full real Chrome GPU |
| Authenticated / external sites | ✅ Inject into your logged-in browser on a chosen port *(one-time setup step)* | ✅ Native — already your logged-in profile |
| Flakiness / contention | ✅ A private port per project = dedicated instance *(a shared instance can still flake under contention)* | ⚠️ Depends on live browser + extension state |
| Screenshots | ✅ Native (desktop) or WebRTC `getDisplayMedia` (browser) | ✅ Vision-native |

**The short version:** reach for Claude in Chrome to glance at the tab you're already looking at; reach for Haltija when you want a browser your agent *controls* — reproducibly, cheaply, in CI, and as the regression harness your project already has.

---

## How It Works

```
Browser Tab          Server (Bun)         AI Agent
    │                    │                   │
    │◄── WebSocket ─────►│◄── REST API ─────►│
    │                    │                   │
    └─ Widget            └─ Routes messages  └─ curl / MCP / SDK
```

The widget (auto-injected by the desktop app) connects to a local server via WebSocket. Agents talk to the server via REST. No special libraries, just HTTP.

---

## Key Features

### Semantic Tree with Flags

The `/tree` endpoint doesn't dump raw HTML. It produces a semantic structure with actionable flags:

```
3: button "Submit" [interactive] [disabled]
```

Ref IDs (the numbers before `:`) let agents target elements efficiently without CSS selectors. Refs are stable within a page session — they survive DOM updates and re-renders as long as the element stays in the document.

### Shadow DOM & Iframe Piercing

Web Components with shadow DOM are invisible to most tools. Haltija flattens them into the same tree:

```bash
hj tree --shadow                 # Pierce shadow DOM boundaries
hj tree --frames                 # Include same-origin iframe content
```

No special selectors or `composedPath()` hacking required.

### Click with Diff

Agents often need to verify that an action worked. The `--diff` flag returns what changed:

```bash
hj click 42 --diff
# Returns: { added: ["#error-msg"], removed: [], changed: [...] }

hj click 42 --diff --delay 500   # Wait 500ms before capturing (default 100ms)
```

The agent knows immediately if the click triggered an error modal, loaded new content, or did nothing.

### Noise-Reduced Events

Raw DOM events are noise. Haltija aggregates them into intent:

| Raw Events | Semantic Event |
|------------|----------------|
| 18 keydown, 18 input | `"user typed 'hello@example.com'"` |
| 200 scroll events | `"user scrolled to #pricing"` |

96% noise reduction in real-world testing.

### Screenshots with Context

Screenshots include a chyron (title, URL, timestamp) so agents always know what they're looking at. Disable with `chyron: false` for clean captures.

### Multi-Window

Control multiple tabs. The focused tab receives untargeted commands; pass `?window=<id>` (REST) or `--window <id>` (CLI) to target a specific tab.

### Selection Tool

User drags to select UI elements. Selection persists visually until the agent retrieves it:

```bash
hj select-result                    # Returns selectors, HTML, bounding boxes
```

### Test Recording

Click record, use your app, get a JSON test:

```json
{
  "steps": [
    {"action": "type", "selector": "#email", "text": "user@example.com"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "assert", "type": "exists", "selector": ".dashboard"}
  ]
}
```

---

## Bring Your Own Browser (Advanced)

Want to control your daily driver — Chrome, Edge, Firefox — with your existing sessions and cookies?

```bash
bunx haltija --server
```

Then inject the widget into any page:

**Bookmarklet** — Visit `http://localhost:8700`, drag to toolbar, click on any page.

**Dev snippet** — Auto-disabled in production:
```javascript
/^localhost$|^127\./.test(location.hostname)&&import('http://localhost:8700/dev.js')
```

Your agent uses the same `hj` commands either way — it doesn't know or care which browser it's talking to.

---

## Embed Haltija in Your Own App

Building a tool, dev environment, or product that wants an agent eye built in? Run a haltija server on a port you choose and import the widget directly. Two flavours:

```js
// Visible — widget renders its own UI in the corner
import { inject } from 'haltija/component'
inject('ws://localhost:9123/ws/browser')

// Headless — widget is present but invisible; agent still has full control
inject('ws://localhost:9123/ws/browser', { mode: 'headless' })
```

Or via HTML, no JS required:

```html
<haltija-dev server="ws://localhost:9123/ws/browser"></haltija-dev>
```

Tell `hj` which server to talk to (per-shell):

```bash
# Named instance — recommended, no port juggling
haltija --name dashboard --server     # in one shell: register as "dashboard"
export HALTIJA_NAME=dashboard          # in your other shells
hj tree                                # finds dashboard via ~/.haltija/servers/

# Port-based — if you'd rather pin a number
haltija --port 9123 --server
export HALTIJA_PORT=9123
hj tree
```

If you don't pass `--port`, haltija tries 8700 first and falls back to a kernel-assigned ephemeral port.

**You usually don't need `--name` at all.** A server records the directory it was started in, so **plain `hj` inside a project reaches that project's server** — no flags, no environment variables. `--name` and `--port` are overrides for when you want to address a server from *outside* its directory. `hj where` shows which server a shell is targeting and why.

Haltija does keep a little state outside your project — a shared `hj` on your PATH and a registry of running servers. That's deliberate, and it's all logged: see [Housekeeping](#housekeeping--what-haltija-does-to-your-machine) below.

**Production embedding.** When haltija is reachable beyond loopback, gate it with a shared-secret token:

```bash
haltija --port 9123 --token $(openssl rand -hex 16) --server
```

```js
inject('ws://your-host:9123/ws/browser', { token: 'same-secret' })
```

```bash
HALTIJA_TOKEN=same-secret hj tree
```

The server rejects every REST/WebSocket request without a matching `X-Haltija-Token` (or `?token=` for WebSockets). This is a stub — provide your own TLS, key rotation, and per-agent identity if you need them.

---

## Installation

```bash
bunx haltija               # Bundled browser + embedded server (easiest start)
bunx haltija --server      # Server only — your browser, per-project dev/debug
npm install -g haltija     # Install globally

# Server options
haltija --https            # HTTPS mode
haltija --port 3000        # Custom port
haltija --name <proj>      # Register a per-project instance (hj --name <proj>)
haltija --token <secret>   # Require X-Haltija-Token on every request
haltija --headless         # For CI pipelines (no desktop app needed)
haltija --setup-mcp        # Configure Claude Desktop
```

**Which mode?** For day-to-day dev/debugging, run a per-project server
(`haltija --server --name <proj>`) and drive it with the `hj` CLI or your coding
agent — that's the paved path. For CI, `haltija --headless` runs a deterministic
headless Chromium with no desktop app required. A downloadable notarized desktop
app also exists but isn't required for either.

---

## Security

- Widget is always visible (no silent snooping)
- User can pause or kill connection anytime
- Localhost only by default
- HTTPS mode with auto-generated certs

---

## Housekeeping — what Haltija does to your machine

Haltija acts at **machine** scope on purpose. "Which `hj` does every shell on this box
run?" is not a question a per-project fix can answer — so a few things live outside your
project directory. All of it is opt-out, and **all of it leaves a receipt.**

**Everything Haltija does outside its own project is logged to
`~/.haltija/machine-actions.log`** (timestamped, with the version and the *directory of the
project that triggered it*) and announced on **stderr**. That matters because Haltija is
often a transitive dependency: if some other project's `test-browser` script spawned it,
you may not know what Haltija even is. The receipt tells you what happened, when, and which
project caused it.

**It installs `hj` into `~/.local/bin`.** One CLI, shared by every project. It will
**never overwrite a symlink** (if you point `hj` at your own build, that's yours) and
**never downgrade** a newer `hj` than the one it carries. `HALTIJA_NO_INSTALL=1` disables it.

**It registers itself in `~/.haltija/servers/`,** recording the directory it was started
in. That's what lets plain `hj` inside a project reach *that project's* server instead of
whichever browser happens to be focused somewhere else. The entry is removed on shutdown.
`hj where` shows what your shell is targeting and why.

**It stops haltija servers older than 1.4.0.** Those versions overwrite the shared
`~/.local/bin/hj` on every boot, so one stale server left running quietly hands every
project on your machine an old CLI. A 1.4.0+ server **asks** them to stop on startup
(`POST /shutdown`, which every haltija has understood since 0.1.7) and says so. It does
not go hunting for processes to kill. It is deliberately narrow:

- It only stops servers **below 1.4.0** — never a peer. Two projects on 1.4.0 and 1.4.1
  coexist; nothing kills anything once 1.3.x is gone.
- It **will not touch a running desktop app** (that would orphan a window you can see) —
  it tells you to quit and update it instead.
- It **asks rather than kills.** Retirement is an HTTP request to a server that already
  told us what it is — no process IDs, no `kill`. (An earlier draft resolved a port to a
  pid with `lsof` and signalled it; `lsof -i :PORT` also matches connected *clients*, so
  that would have killed your **browser**. Asking makes that whole class of mistake
  impossible.)
- On the rare fallback paths that must free a port without waiting, it signals only
  **listeners** that `ps` confirms are haltija — never something it cannot identify.

`HALTIJA_NO_RETIRE=1` disables it.

---

## Use Cases

- **AI pair programming** — Agent sees your actual app, not a description of it
- **Automated QA** — Agent explores, finds bugs, writes repro steps
- **Accessibility auditing** — Inspect ARIA across the whole page
- **UX crime detection** — Reference for 35+ anti-patterns (`hj docs ux-crimes`)
- **Support** — See exactly what customers see

---

## Documentation

```bash
hj docs                       # Quick start (plain text, LLM-friendly)
hj api                        # Full API reference (markdown)
hj --help                     # CLI subcommand reference
```

- [Full API Reference](./API.md) (auto-generated from schema)
- [Agent Prompt](docs/agent-prompt.md) — Copy-paste prompt for any AI agent
- [Recipes](docs/recipes.md) — Common workflows
- [CI Integration](docs/CI-INTEGRATION.md) — E2E testing with Haltija in GitHub Actions
- [Roadmap](docs/ROADMAP.md)

---

## 1.3.0-beta.8 — change of direction

Earlier 1.3 betas tried to support multiple agents on a single haltija server by issuing each widget a *session token* and routing requests by `X-Haltija-Session`. The model was load-bearing but leaky — six of the last fifteen commits before this release were firefighting session-isolation regressions.

beta.8 deletes the entire mechanism and replaces it with **process boundaries**: each project runs its own haltija server, and the agent talks to the right one by **port** or by **name**.

```bash
haltija --name dashboard --server     # one project, registers itself in ~/.haltija/servers/
HALTIJA_NAME=dashboard hj tree         # any shell can address it by name
```

What this means for you, depending on how you used 1.3.0-beta.7:

- **`bunx haltija` desktop app** — works the same; no migration needed. The outer "chrome" widget that lets the app inspect itself now lives on a separate internal port (8701) so it never appears in agent-facing window listings.
- **`HALTIJA_SESSION` / `--session` / `--secure` / the click-to-copy session badge** — gone. If you were setting `HALTIJA_SESSION` in your shell, replace it with `HALTIJA_NAME` (and start the server with `--name <foo>`) or `HALTIJA_PORT`.
- **`inject(url, { session })`** — the `session` option is removed. If you need auth, use `inject(url, { token })` (matches `haltija --token <secret>`); for embedding without auth, just `inject(url)` or `inject(url, { mode: 'headless' })`.
- **`hj-chrome` exclusion logic** — gone from the public REST API. To inspect the desktop app's outer UI from `hj`, target the internal port directly: `HALTIJA_PORT=8701 hj tree`.

Net code change: ~830 lines removed, ~150 added back for the simpler model. Test count went up (we now have integration coverage for the token stub, named instances, and auto-port fallback that the previous betas lacked).

The pre-revert state is preserved on the `multi-user-isolation` branch in case the multi-agent-on-one-server design ever needs revisiting.

---

## License

Apache 2.0
