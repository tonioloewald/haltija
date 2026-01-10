# tosijs-dev

Real-time communication bridge between AI agents and browser pages.

## What It Does

tosijs-dev lets AI agents (like Claude) see and interact with web pages:

- **Query the DOM** - Find elements, read their content and attributes
- **Click and type** - Interact with buttons, inputs, links
- **See console output** - Monitor logs, errors, warnings in real-time
- **Execute JavaScript** - Run arbitrary code in the browser context
- **Record sessions** - Capture user interactions for replay/testing

## Quick Start

### 1. Start the server

```bash
# From anywhere
bunx tosijs-dev

# Or with custom port
bunx tosijs-dev 3000
```

The CLI shows you everything you need:
- Test page URL
- Bookmarklet to copy
- REST API endpoints
- Path to documentation

### 2. Open the test page

Visit `http://localhost:8700/` to see the test page with the widget.

### 3. Or inject into any page

Copy the bookmarklet from the CLI output, create a bookmark, and paste it as the URL. Click it on any page to inject the widget.

## Setup in Your Project

### Option A: Script tag

```html
<script src="http://localhost:8700/component.js"></script>
<tosijs-dev server="ws://localhost:8700/ws/browser"></tosijs-dev>
```

### Option B: Bookmarklet

```javascript
javascript:(function(){fetch('http://localhost:8700/inject.js').then(r=>r.text()).then(eval)})();
```

### Option C: Dev server integration

Add to your dev server's HTML template:

```html
<!-- Only in development -->
<script src="http://localhost:8700/component.js"></script>
<tosijs-dev></tosijs-dev>
```

## REST API Reference

All endpoints support CORS and return JSON.

### Status & Messages

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Server status (connected browsers/agents, buffered messages) |
| `/messages?since=N` | GET | Get buffered messages since timestamp N |
| `/console?since=N` | GET | Get console entries since timestamp N |

### DOM Queries

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/query` | POST | `{selector, all?}` | Query DOM elements (basic info) |
| `/inspect` | POST | `{selector}` | Deep inspect single element |
| `/inspectAll` | POST | `{selector, limit?}` | Deep inspect multiple elements |

**Query Response (basic):**
```json
{
  "success": true,
  "data": {
    "tagName": "button",
    "id": "submit",
    "className": "btn primary",
    "textContent": "Submit",
    "attributes": {"id": "submit", "class": "btn primary"}
  }
}
```

**Inspect Response (detailed):**
```json
{
  "selector": "body > form > button#submit",
  "tagName": "button",
  "classList": ["btn", "primary"],
  "box": { "x": 100, "y": 200, "width": 120, "height": 40, "visible": true },
  "offsets": { "offsetTop": 200, "offsetLeft": 100, "scrollTop": 0 },
  "text": { "innerText": "Submit", "value": null },
  "attributes": { "id": "submit", "class": "btn primary", "type": "submit" },
  "dataset": { "testId": "submit-btn" },
  "properties": { "disabled": false, "hidden": false, "isCustomElement": false },
  "hierarchy": { "parent": "form#login", "children": 1, "depth": 4 },
  "styles": { "display": "inline-block", "visibility": "visible" }
}
```

### Visual Highlighting

Point at elements visually - great for debugging and screenshots.

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/highlight` | POST | `{selector, label?, color?, duration?}` | Highlight an element |
| `/unhighlight` | POST | - | Remove highlight |

```bash
# Highlight with custom label and color
curl -X POST http://localhost:8700/highlight \
  -H "Content-Type: application/json" \
  -d '{"selector": "#login-form", "label": "Bug is here!", "color": "#ef4444"}'

# Auto-hide after 3 seconds
curl -X POST http://localhost:8700/highlight \
  -H "Content-Type: application/json" \
  -d '{"selector": ".error", "label": "Error message", "duration": 3000}'
```

CSS variables for theming:
- `--tosijs-highlight` - Border color
- `--tosijs-highlight-bg` - Background (10% opacity)
- `--tosijs-highlight-glow` - Glow effect (30% opacity)

### Interactions

All interaction endpoints automatically scroll the element into view first.

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/click` | POST | `{selector: string}` | Click an element (full mouse lifecycle) |
| `/type` | POST | `{selector: string, text: string}` | Type into an input |
| `/drag` | POST | `{selector, deltaX, deltaY, duration?}` | Drag an element |
| `/eval` | POST | `{code: string}` | Execute JavaScript |

**Click** fires the full mouse event lifecycle: `mouseenter` → `mouseover` → `mousemove` → `mousedown` → `mouseup` → `click`

**Drag** simulates a realistic drag operation:
```bash
# Drag element 100px right and 50px down over 300ms (default)
curl -X POST http://localhost:8700/drag \
  -H "Content-Type: application/json" \
  -d '{"selector": ".draggable", "deltaX": 100, "deltaY": 50}'

# Faster drag (100ms)  
curl -X POST http://localhost:8700/drag \
  -d '{"selector": ".handle", "deltaX": -200, "deltaY": 0, "duration": 100}'
```

### Navigation

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/refresh` | POST | `{hard?: boolean}` | Refresh the page |
| `/navigate` | POST | `{url: string}` | Navigate to URL |
| `/location` | GET | - | Get current location |

### DOM Mutation Watching

Watch for DOM changes in real-time - useful for verifying UI updates.

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/mutations/watch` | POST | `{root?, debounce?, childList?, attributes?}` | Start watching |
| `/mutations/unwatch` | POST | - | Stop watching |
| `/mutations/status` | GET | - | Check if watching |

```bash
# Start watching with 50ms debounce
curl -X POST http://localhost:8700/mutations/watch \
  -H "Content-Type: application/json" \
  -d '{"debounce": 50}'

# Mutations appear in /messages as channel: "mutations", action: "batch"
curl http://localhost:8700/messages
```

**Mutation Batch:**
```json
{
  "channel": "mutations",
  "action": "batch",
  "payload": {
    "timestamp": 1234567890,
    "count": 5,
    "summary": { "added": 2, "removed": 0, "attributeChanges": 3 },
    "notable": [
      { "type": "added", "selector": "#new-item", "tagName": "div" },
      { "type": "attribute", "selector": "#btn", "attribute": "disabled" }
    ]
  }
}
```

### Recording

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/recording/start` | POST | `{name: string}` | Start recording session |
| `/recording/stop` | POST | - | Stop and return recording |

### Build Events

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/build` | POST | `{type, message?, file?, line?}` | Publish build event |

## For AI Agents

### Connecting

The tosijs-dev server must be running, and a browser must have the widget injected.

```bash
# Check if ready
curl http://127.0.0.1:8700/status
# {"browsers":1,"agents":0,"bufferedMessages":3}
```

### Finding Elements

```bash
# Find by selector
curl -X POST http://127.0.0.1:8700/query \
  -H "Content-Type: application/json" \
  -d '{"selector": "#login-button"}'

# Find all matching elements
curl -X POST http://127.0.0.1:8700/query \
  -H "Content-Type: application/json" \
  -d '{"selector": ".error-message", "all": true}'
```

### Interacting

```bash
# Click a button
curl -X POST http://127.0.0.1:8700/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "#submit"}'

# Type into an input
curl -X POST http://127.0.0.1:8700/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "#email", "text": "user@example.com"}'

# Execute JavaScript
curl -X POST http://127.0.0.1:8700/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "document.title"}'
```

### Monitoring

```bash
# Get console output
curl http://127.0.0.1:8700/console

# Get recent messages
curl http://127.0.0.1:8700/messages
```

### Inspecting Elements

```bash
# Deep inspection with box model, properties, hierarchy
curl -X POST http://localhost:8700/inspect \
  -H "Content-Type: application/json" \
  -d '{"selector": "xin-tabs"}'

# Returns: box dimensions, visibility, attributes, dataset,
# properties (disabled, checked, aria-*), hierarchy, computed styles
```

### Visual Pointing

```bash
# Highlight an element to show the user
curl -X POST http://localhost:8700/highlight \
  -H "Content-Type: application/json" \
  -d '{"selector": "#problem-area", "label": "This is the bug!"}'

# Use different colors for different purposes
curl -X POST http://localhost:8700/highlight \
  -H "Content-Type: application/json" \
  -d '{"selector": ".success", "color": "#22c55e", "label": "Fixed!"}'

# Clear when done
curl -X POST http://localhost:8700/unhighlight
```

### Watching for Changes

```bash
# Start watching DOM mutations
curl -X POST http://localhost:8700/mutations/watch \
  -H "Content-Type: application/json" \
  -d '{"debounce": 100}'

# Do something (click, type, etc.)
curl -X POST http://localhost:8700/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "#submit"}'

# Check what changed
curl http://localhost:8700/messages | jq '.[] | select(.channel=="mutations")'

# Stop watching
curl -X POST http://localhost:8700/mutations/unwatch
```

### Typical Workflow

1. **Check connection**: `GET /status` - ensure `browsers >= 1`
2. **Understand the page**: `POST /inspect` on key elements
3. **Explore structure**: Find custom elements, interactive elements
4. **Point at things**: Use `/highlight` to show user what you're looking at
5. **Watch for changes**: Start `/mutations/watch` before interactions
6. **Interact**: Use `/click`, `/type`, `/eval` as needed
7. **Verify results**: Check mutations, query DOM, read console

### Tips for Agents

- **Always check `/status` first** - if `browsers: 0`, ask the user to inject the widget
- **Use `/inspect` over `/query`** - much more useful information
- **Highlight what you're discussing** - helps the user follow along
- **Watch mutations during interactions** - know exactly what changed
- **Use specific selectors** - IDs are best, then unique classes
- **Check results** - After clicking/typing, verify the action worked
- **Use eval sparingly** - Prefer `/query` and `/click` when possible

## Widget Controls

The widget appears in the bottom-right corner:

- **Status indicator** - Green = connected, Yellow = connecting, Orange = paused, Red = disconnected
- **Error count** - Shows number of console errors (if any)
- **REC indicator** - Shows when recording is active
- **Pause button (⏸/▶)** - Temporarily stop responding to agent commands
- **Minimize button (─)** - Slide widget to bottom-left corner (⌥Tab to toggle)
- **Kill button (✕)** - Completely disconnect and remove the widget

The widget can be dragged anywhere on the page. When minimized, it animates to the bottom-left corner and back.

**Security**: The widget always shows when an agent sends commands - no silent snooping.

## Tab Switching

Only one browser tab is active at a time. When you inject the widget into a new tab, the previous tab's widget automatically deactivates. This lets you jump between tabs to change context.

## Running Tests

```bash
# Server unit tests
bun test packages/tosijs-dev/src/server.test.ts

# End-to-end Playwright tests
cd packages/tosijs-dev && bunx playwright test

# Browser tests (in console after injecting widget)
DevChannel.runTests()
```

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐     REST API     ┌─────────────┐
│   Browser   │◄──────────────────►│   Server    │◄────────────────►│    Agent    │
│  Component  │    (real-time)     │  (Bun.js)   │   (curl/fetch)   │  (Claude)   │
└─────────────┘                    └─────────────┘                  └─────────────┘
      │                                   │
      ├─ Intercepts console               ├─ Routes messages
      ├─ Handles DOM queries              ├─ Buffers recent messages
      ├─ Dispatches events                ├─ Manages connections
      └─ Records sessions                 └─ Serves static files
```

## Configuration

Environment variables:

- `DEV_CHANNEL_PORT` - Server port (default: 8700)

Component attributes:

- `server` - WebSocket URL (default: `ws://localhost:8700/ws/browser`)

## License

MIT
