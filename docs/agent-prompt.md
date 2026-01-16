# Haltija Agent Quick-Start

Copy this prompt to give an AI agent browser control via Haltija.

---

## The Prompt

```
# Haltija - Browser Understanding

## What is this?
You can see this page as a semantic structure - what's clickable, what's hidden and why, what inputs exist. Not screenshots, not HTML dumps. The page as an agent should see it.

A server at http://localhost:8700 connects you to browser tabs.

## What you can see
- **Semantic tree**: elements with flags like `interactive`, `hidden`, `hiddenReason`
- **Why things are hidden**: "display:none" vs "off-screen" vs "zero-size"
- **Form state**: current input values, which fields are required/disabled
- **What's actionable**: buttons, links, inputs - not noise

## What you can do
- Click buttons, fill forms, navigate
- Watch for changes (console errors, DOM mutations)
- Take screenshots (webp, scaled down for efficiency)
- Highlight elements to show the user what you mean

## Quick start

1. Check server: curl http://localhost:8700/status
2. Find tabs: curl http://localhost:8700/windows
3. See what's there: curl -X POST http://localhost:8700/tree -d '{"selector":"body","mode":"actionable"}'
4. Do something: curl -X POST http://localhost:8700/click -d '{"selector":"button"}'

## Key endpoints

### See the page
GET  /status               Is it working? How many tabs connected?
GET  /windows              List connected browser tabs
GET  /location             Current URL and title
POST /tree                 **Semantic page structure** (flags: interactive, hidden, hiddenReason)
POST /find                 Find elements by text content
POST /inspect              Deep inspection of one element (styles, ARIA, geometry)

### Debug
GET  /console              **Recent console logs/errors** - check this when things break
POST /screenshot           **Capture page image** (use scale:0.5, format:"webp" for efficiency)
GET  /events               Recent semantic events (clicks, typing, network errors)

### Do things
POST /click                Click element (by selector or text)
POST /type                 Type into a field
POST /scroll               Smooth scroll to element
POST /highlight            **Show user what you mean** - label elements in their browser!
POST /wait                 Wait for element to appear/disappear

### Escape hatches
POST /eval                 Run arbitrary JavaScript
POST /call                 Call method or get property on element

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
