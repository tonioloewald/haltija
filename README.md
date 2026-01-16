# Haltija

**Give AI agents eyes and hands in the browser.**

[Executive Summary](docs/EXECUTIVE-SUMMARY.md) - What Haltija is, who it's for, and where it's going.

<!-- TODO: Add side-by-side video demo -->

---

## What You Can Do Now

**"Fix this CSS bug"** - The agent sees your actual DOM, finds the selector mismatch, fixes it. Two minutes, not twenty.

**"Test the checkout flow"** - The agent clicks through your app, watches what happens, writes a test. No Playwright scripts to maintain.

**"What's wrong with this page?"** - Point at an area. The agent sees the elements, their structure, their accessibility issues.

**"Show me how to do X"** - Record yourself doing it. The agent watches, learns, can replay or generate tests.

**"Why is this broken for the customer?"** - See exactly what they see. Same browser, same state, same bug.

---

## How It Works

Your AI assistant can query your live browser:

```bash
curl localhost:8700/tree                    # See the DOM
curl -X POST localhost:8700/click -d '{"selector":"#submit"}'  # Click things
curl localhost:8700/events                  # Watch what happens
```

No screenshots. No copy-pasting HTML. The agent sees what you see.

---

## What Agents Can Do

**See the page**
```bash
curl localhost:8700/tree              # DOM structure
curl localhost:8700/query -d '{"selector":"button"}'  # Find elements
curl localhost:8700/inspect -d '{"selector":"#nav"}'  # Deep inspection
```

**Interact with it**
```bash
curl -X POST localhost:8700/click -d '{"selector":"#submit"}'
curl -X POST localhost:8700/type -d '{"selector":"#email","text":"user@example.com"}'
curl -X POST localhost:8700/scroll -d '{"selector":"#pricing","easing":"ease-out"}'
curl -X POST localhost:8700/navigate -d '{"url":"https://example.com"}'
```

**Watch what happens**
```bash
curl -X POST localhost:8700/events/watch -d '{"preset":"interactive"}'
curl localhost:8700/events  # "user typed email, clicked Submit, got error"
```

**Point things out to humans**
```bash
curl -X POST localhost:8700/highlight -d '{"selector":".bug","label":"Problem here"}'
curl -X POST localhost:8700/select/start  # User drags to select elements
curl localhost:8700/select/result         # Get what they selected
```

**Run tests**
```bash
curl -X POST localhost:8700/test/run -d @login-test.json
```

Full API: `curl localhost:8700/docs`

---

## Why Haltija?

Works on your **actual browser session** - not a separate headless instance.

| | Haltija | Playwright MCP |
|---|---------|----------------|
| **Browser** | Your real browser | Separate instance |
| **State** | Already logged in, cookies, extensions | Clean slate, script everything |
| **Localhost** | Just works | Port forwarding |
| **Visibility** | Watch it happen | Background process |
| **Setup** | `curl` | Install Playwright |

Same automation capabilities, but you're debugging your actual environment - the one with the bug, the weird extension, the specific login state. No reproduction steps needed.

---

## How to Use It

### 1. Start the server

```bash
bunx haltija
```

### 2. Connect your browser

**Option A: Bookmarklet** - Visit `http://localhost:8700`, drag the bookmarklet to your toolbar. Click it on any page.

**Option B: Dev snippet** - Add this to your app (auto-disabled in production):

```javascript
/^localhost$|^127\./.test(location.hostname)&&import('http://localhost:8700/dev.js')
```

**Option C: Desktop app** - Double-click Haltija.app. Works on any site, no CSP issues.

### 3. Give your agent the endpoint

```bash
curl localhost:8700/docs  # Everything the agent needs
```

---

## Key Features

### Semantic Events

Raw DOM events are noise. We aggregate them:

| Raw Events | Semantic Event |
|------------|----------------|
| 18 keydown, 18 input | `"user typed 'hello@example.com'"` |
| 200 scroll events | `"user scrolled to #pricing"` |
| mouseover spam | `"user hovered on Help for 1.2s"` |

**96% noise reduction** in real-world testing.

### Smart Selectors

We prioritize what engineers actually use:

1. ARIA labels: `button[aria-label="Close"]`
2. Form labels: `input labeled "Email"`
3. Text content: `button "Sign Up"`

Not: `div.flex.mt-4 > button.btn-primary`

### Multi-Window

Control multiple browser windows. OAuth flows, admin + customer side by side, popup testing.

```bash
curl localhost:8700/windows                    # List all
curl -X POST "localhost:8700/click?window=abc123" -d '{"selector":"#ok"}'
```

### Test Recording

Click record, use your app, get a test:

```json
{
  "name": "Login flow",
  "steps": [
    {"action": "type", "selector": "#email", "text": "user@example.com"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "assert", "type": "exists", "selector": ".dashboard"}
  ]
}
```

Tests are pure JSON. The AI understands intent, not brittle selectors.

### Selection Tool

User points at problematic UI:

```bash
curl -X POST localhost:8700/select/start  # User drags rectangle
curl localhost:8700/select/result         # Get selected elements
```

Returns selectors, HTML, bounding boxes - everything the agent needs to understand "this is bad."

---

## Installation

```bash
# Run directly
bunx haltija

# Or install globally
npm install -g haltija

# CLI options
haltija --https              # HTTPS mode
haltija --both               # HTTP + HTTPS
haltija --port 3000          # Custom port
haltija --headless           # Playwright mode for CI
haltija --docs-dir ./docs    # Custom reference docs
```

Works with Bun or Node.js.

---

## Architecture

```
Browser Tab          Server (Bun)         AI Agent
    │                    │                   │
    │◄── WebSocket ─────►│◄── REST API ─────►│
    │                    │                   │
    └─ Widget            └─ Routes messages  └─ Any HTTP client
```

No special libraries. Just HTTP.

---

## Security

- Widget is always visible (no silent snooping)
- User can pause or kill connection anytime
- Localhost only by default
- HTTPS mode with auto-generated certs

---

## Known Limitations

**Shadow DOM**: The `/tree` endpoint pierces shadow DOM by default. For click/type on shadow DOM elements, use `/eval`:

```bash
curl -X POST localhost:8700/eval -d '{
  "code": "document.querySelector(\"my-component\").shadowRoot.querySelector(\".btn\").click()"
}'
```

**React and Framework Antipatterns** (work in progress):
- Clickable divs with `onClick` but no button semantics
- Controlled inputs where React state doesn't sync with DOM events  
- Contenteditable rich text editors masquerading as inputs
- Custom select/dropdown widgets built from divs
- Form libraries that bypass native change events

Currently these may require `/eval` workarounds. We're working on automatic detection and handling so Haltija just does the right thing.

---

## Use Cases

- **AI pair programming** - Your assistant can actually see your app
- **Automated QA** - Agent explores, finds bugs, writes repro steps
- **Support automation** - See what customers see
- **Accessibility testing** - Inspect ARIA across the whole page
- **UX auditing** - Detects 35+ anti-patterns automatically

---

## License

Apache 2.0 with patent grant.

---

## Full Documentation

```bash
curl localhost:8700/docs      # Quick start guide
curl localhost:8700/api       # Full API reference with examples
```

Or see [API.md](./API.md) for the complete reference (auto-generated from schema).
