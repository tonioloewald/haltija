# Haltija Agent Quick-Start

Copy this prompt to give an AI agent browser control via Haltija.

---

## The Prompt

```
# Haltija - Browser Eyes & Hands

## What is this?
A server at http://localhost:8700 that connects you to browser tabs.
You can see what's on the page, click things, type text, and watch for changes.

## Why do you care?
Without this, you're blind - you can't see what the user sees.
With Haltija you can:
- See what's visible on the page (not just DOM structure)
- Click buttons, fill forms, navigate
- Know when things change (events, network errors)

## Quick start

1. Check server: curl http://localhost:8700/status
2. Find tabs: curl http://localhost:8700/windows
3. See what's there: curl -X POST http://localhost:8700/tree -d '{"selector":"body","mode":"actionable"}'
4. Do something: curl -X POST http://localhost:8700/click -d '{"selector":"button"}'

## Key endpoints

GET  /status               Health check
GET  /windows              List connected browser tabs
GET  /location?window=ID   Current URL of a tab
POST /tree                 See page structure (use mode:"actionable" for summary)
POST /find                 Find elements by text content
POST /click                Click an element (by selector or text)
POST /type                 Type into a field
POST /wait                 Wait for time or element to appear/disappear
POST /scroll               Smooth scroll to element or position
POST /highlight            Show user an element (label it in the browser!)
POST /call                 Call method or get property on element (cleaner than eval)
POST /eval                 Run arbitrary JavaScript (escape hatch)
GET  /events               Recent semantic events (clicks, typing, errors)
POST /screenshot           Capture page image (format/scale options)
GET  /select/result        Get elements the user has selected (see below)

## Understanding the page

### Option 1: Actionable summary (recommended)
Returns buttons, links, inputs, headings - what you can interact with:
```bash
curl -X POST http://localhost:8700/tree \
  -H "Content-Type: application/json" \
  -d '{"selector":"body", "mode":"actionable"}'
```

### Option 2: DOM tree
Returns hierarchical structure with visibility flags:
```bash
curl -X POST http://localhost:8700/tree \
  -H "Content-Type: application/json" \
  -d '{"selector":"body", "depth":3, "visibleOnly":true}'
```

### Option 3: Call method or property on element
When you need to call a method (like showPopover) or get a property (like value):
```bash
# Get input value
curl -X POST http://localhost:8700/call \
  -H "Content-Type: application/json" \
  -d '{"selector":"#email", "method":"value"}'

# Call a method
curl -X POST http://localhost:8700/call \
  -H "Content-Type: application/json" \
  -d '{"selector":"#my-popover", "method":"showPopover", "args":[]}'
```

### Option 4: Custom JavaScript
When you need something more complex:
```bash
curl -X POST http://localhost:8700/eval \
  -H "Content-Type: application/json" \
  -d '{"code":"document.querySelectorAll(\"button\").length"}'
```

## Taking action

### Find element by text (useful when you don't know the selector)
```bash
curl -X POST http://localhost:8700/find \
  -H "Content-Type: application/json" \
  -d '{"text":"Submit", "tag":"button"}'
```

Returns: `{found: true, selector: "...", element: {tag, text, id, ...}}`

### Click (by selector or text)
```bash
# By selector
curl -X POST http://localhost:8700/click \
  -H "Content-Type: application/json" \
  -d '{"selector":"#submit-btn"}'

# By text (more reliable for dynamic UIs)
curl -X POST http://localhost:8700/click \
  -H "Content-Type: application/json" \
  -d '{"text":"Submit", "tag":"button"}'
```

### Type
```bash
curl -X POST http://localhost:8700/type \
  -H "Content-Type: application/json" \
  -d '{"selector":"input[name=email]", "text":"user@example.com"}'
```

### Navigate
```bash
curl -X POST http://localhost:8700/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

### Screenshot
```bash
curl -X POST http://localhost:8700/screenshot \
  -H "Content-Type: application/json" \
  -d '{"format":"webp", "quality":0.8, "maxWidth":1280}'
```

Options:
- format: "png" (default), "webp", "jpeg"
- quality: 0.0-1.0 (for webp/jpeg)
- scale: 0.5 = half size
- maxWidth/maxHeight: constrain dimensions

Returns: `{image: "data:image/...", width, height, source}`

## Showing things to the user

**Important:** When you find something or want to explain what you're looking at, 
SHOW the user by highlighting it in their browser. Don't just describe it - point to it!

### Highlight an element
```bash
curl -X POST http://localhost:8700/highlight \
  -H "Content-Type: application/json" \
  -d '{"selector":"#login-btn", "label":"Click this to log in"}'
```

Options:
- selector: CSS selector of element to highlight
- label: Text shown next to the element (optional but recommended)
- color: CSS color for highlight border (default: #6366f1)
- duration: Auto-hide after N milliseconds (omit for permanent until /unhighlight)

### When to highlight
- When you find what the user asked about: "Here's the search box"
- When explaining a problem: "This button is disabled because..."
- When showing what you're about to click: "I'll click this Submit button"
- When pointing out issues: "This error message appeared"

### Remove highlight
```bash
curl -X POST http://localhost:8700/unhighlight
```

### Scroll to element
Smoothly scroll an element into view (with natural easing):
```bash
curl -X POST http://localhost:8700/scroll \
  -H "Content-Type: application/json" \
  -d '{"selector":"#pricing-section"}'
```

### Wait for async UI
```bash
# Wait for time
curl -X POST http://localhost:8700/wait \
  -H "Content-Type: application/json" \
  -d '{"ms":500}'

# Wait for element to appear
curl -X POST http://localhost:8700/wait \
  -H "Content-Type: application/json" \
  -d '{"forElement":".modal", "timeout":5000}'

# Wait for loading spinner to disappear
curl -X POST http://localhost:8700/wait \
  -H "Content-Type: application/json" \
  -d '{"forElement":".loading", "hidden":true}'
```

## Watching for changes

### Semantic events
Get meaningful events (clicks, typing, network errors) not raw DOM events:
```bash
curl http://localhost:8700/events
```

Events include:
- interaction:click - user clicked something
- input:typed - user finished typing  
- network:error - fetch request failed (4xx, 5xx, or network error)
- navigation:navigate - page changed

## User selection

The user can select elements in the browser using the widget's selection tool.
**Check this first** when the user asks you to look at something they've picked:

```bash
curl http://localhost:8700/select/result
```

Returns the elements the user has selected (highlighted in the browser).
If empty, the user hasn't selected anything yet.

Other selection endpoints:
- GET /select/status - Check if selection mode is active
- POST /select/clear - Clear the current selection

## Working with multiple tabs

1. List tabs: GET /windows
2. Target specific tab: add ?window=<id> to any endpoint
3. Or include "window":"<id>" in POST body

## Response format

All endpoints return:
```json
{"success": true, "data": ...}
// or
{"success": false, "error": "message"}
```

## More info

- Full API reference: GET /api
- Documentation: GET /docs/list
- Test page: http://localhost:8700/test
```

---

## Usage Notes

- The `mode:"actionable"` option for /tree is the fastest way to understand what's on a page
- `visibleOnly:true` filters out hidden elements (display:none, collapsed details, off-screen)
- /tree now shows live input values (value, checked) not just HTML attributes
- Use `ancestors:true` with /tree to see parent element context for deep elements
- /find and /click with text are more reliable than CSS selectors for dynamic UIs
- Use /wait to handle async UI updates after clicks (modals, spinners, etc.)
- The /events endpoint includes network errors - check it when something isn't working
- Use /eval for custom queries when the built-in endpoints aren't enough
