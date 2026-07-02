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

## Why Not Playwright / Puppeteer?

| | Haltija | Playwright MCP |
|---|---------|----------------|
| **Browser** | Your real browser | Separate headless instance |
| **State** | Already logged in, cookies, extensions | Clean slate every time |
| **Setup** | `bunx haltija` | Install Playwright, configure MCP |
| **Protocol** | Simple REST/curl | Complex CDP |
| **Feedback** | "Button hidden by modal" | `TimeoutError: element not found` |
| **Visibility** | Watch it happen live | Background process |

Haltija connects to the browser you're already using. The one with the bug, the active session, and the weird cookie state. No reproduction script required.

---

## Haltija vs. Claude in Chrome

Both let an agent drive a browser — they're built for different jobs. Because Haltija can either **spawn its own isolated browser** *or* **attach to your real one** (via a script tag / bookmarklet on a port you choose), it covers the axes a live-session-only tool can't.

| Axis | Haltija | Claude in Chrome |
|---|---|---|
| Setup / auth | ✅ `bunx haltija` — zero auth, self-spawns | ⚠️ Extension + claude.ai login + per-site permissions |
| How the agent invokes it | ✅ Plain `hj` CLI / REST — always available in a shell | ⚠️ MCP tools; must be loaded + extension connected |
| Project integration | ✅ *Is* your test harness — JSON tests (`hj test-suite`), record→replay, CI | ❌ None |
| Determinism / cost | ✅ DOM + `eval` with stable ref IDs — cheap text, scriptable, headless-CI-able | ⚠️ Vision screenshots: token-heavy, coordinate clicks less deterministic |
| Isolation | ✅ Own instance on its own port — never touches your browsing | ❌ Drives tabs in your live session |
| Real-browser fidelity (WebGL/3D, pixels) | ✅ Attach to a real GPU Chrome or the desktop app *(headless GPU is the one weak spot)* | ✅ Full real Chrome GPU |
| Authenticated / external sites | ✅ Inject into your logged-in browser on a chosen port | ✅ Your logged-in profile |
| Flakiness / contention | ✅ One private port per project = dedicated instance | ⚠️ Depends on live browser + extension state |
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

If you don't pass `--port`, haltija tries 8700 first and falls back to a kernel-assigned ephemeral port — `--name` records whichever port it ends up on so `hj` can find it. A different shell can target a different project; there's no global state, just one named instance per haltija server.

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
