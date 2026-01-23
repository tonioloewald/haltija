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

```bash
bunx haltija
```

Launches a lightweight Electron shell with the Haltija server embedded. Browse to any page — the widget auto-attaches and your agent can control it immediately. When you close the app, the widget detaches cleanly.

For server-only mode (CI, remote, bookmarklet): `bunx haltija --server`

### Tell your agent

Paste this into your agent conversation:

> Haltija is running at http://localhost:8700. Use `curl http://localhost:8700/tree` to see the page structure, `curl http://localhost:8700/click -d '{"selector":"#btn"}'` to interact, and `curl http://localhost:8700/docs` for full API reference.

Or for Claude Code with MCP: `bunx haltija --setup-mcp`

---

## What Agents Can Do

```bash
# See the page
curl localhost:8700/tree                    # Semantic DOM structure
curl localhost:8700/screenshot              # Visual capture with metadata
curl localhost:8700/console                 # Recent errors and logs

# Interact
curl localhost:8700/click?selector=%23btn   # Click (GET works for simple cases)
curl -X POST localhost:8700/type -d '{"selector":"#email","text":"user@example.com"}'
curl localhost:8700/key?key=Escape          # Keyboard input

# Watch for changes
curl localhost:8700/events                  # Aggregated semantic events

# Point things out (draws a visual box on the user's screen)
curl -X POST localhost:8700/highlight -d '{"selector":".bug","label":"Problem here"}'
```

Full API: `curl localhost:8700/docs`

---

## Why Not Playwright / Puppeteer?

| | Haltija | Playwright MCP |
|---|---------|----------------|
| **Browser** | Your real browser | Separate headless instance |
| **State** | Already logged in, cookies, extensions | Clean slate every time |
| **Setup** | `bunx haltija` | Install Playwright, configure MCP |
| **Protocol** | Simple REST/curl | Complex CDP |
| **Visibility** | Watch it happen live | Background process |

Haltija connects to the browser you're already using. The one with the bug, the active session, and the weird cookie state. No reproduction script required.

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

```json
{ "tag": "button", "ref": "@3", "text": "Submit",
  "flags": { "interactive": true, "disabled": true } }
```

Ref IDs (`@1`, `@42`) let agents target elements efficiently without CSS selectors. Refs are stable within a page session — they survive DOM updates and re-renders as long as the element stays in the document.

### Noise-Reduced Events

Raw DOM events are noise. Haltija aggregates them into intent:

| Raw Events | Semantic Event |
|------------|----------------|
| 18 keydown, 18 input | `"user typed 'hello@example.com'"` |
| 200 scroll events | `"user scrolled to #pricing"` |

96% noise reduction in real-world testing.

### Screenshots with Context

Screenshots include a chyron (title, URL, timestamp) so agents always know what they're looking at. Disable with `chyron: false` for clean captures.

### Multi-Window & Session Affinity

Control multiple tabs. Session headers (`X-Haltija-Session`) give agents sticky window targeting — no need to specify window ID every call.

### Selection Tool

User drags to select UI elements. Selection persists visually until the agent retrieves it:

```bash
curl localhost:8700/select/result   # Returns selectors, HTML, bounding boxes
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

## Installation Options

```bash
# Desktop app (recommended - works on any site, no CSP issues)
bunx haltija

# Server only (for CI, bookmarklet, or remote usage)
bunx haltija --server

# With npx
npx haltija

# Install globally
npm install -g haltija

# CLI options
haltija --https              # HTTPS mode
haltija --port 3000          # Custom port
haltija --headless           # For CI pipelines
haltija --setup-mcp          # Configure Claude Desktop
```

### Connecting without the desktop app

**Bookmarklet** — Visit `http://localhost:8700`, drag to toolbar, click on any page.

**Dev snippet** — Auto-disabled in production:
```javascript
/^localhost$|^127\./.test(location.hostname)&&import('http://localhost:8700/dev.js')
```

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
- **UX crime detection** — Detects 35+ anti-patterns automatically
- **Support** — See exactly what customers see

---

## Documentation

```bash
curl localhost:8700/docs      # Quick start (plain text, LLM-friendly)
curl localhost:8700/api       # Full API reference (markdown)
```

- [Full API Reference](./API.md) (auto-generated from schema)
- [Agent Prompt](docs/agent-prompt.md) — Copy-paste prompt for any AI agent
- [Recipes](docs/recipes.md) — Common workflows
- [CI Integration](docs/CI-INTEGRATION.md) — Using Haltija in pipelines
- [Roadmap](docs/ROADMAP.md)

---

## License

Apache 2.0
