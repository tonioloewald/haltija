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
POST /click                Click an element
POST /type                 Type into a field  
POST /eval                 Run arbitrary JavaScript (escape hatch)
GET  /events               Recent semantic events (clicks, typing, errors)
POST /screenshot           Capture page image (format/scale options)

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

### Option 3: Custom JavaScript
When you need something specific:
```bash
curl -X POST http://localhost:8700/eval \
  -H "Content-Type: application/json" \
  -d '{"code":"document.querySelectorAll(\"button\").length"}'
```

## Taking action

### Click
```bash
curl -X POST http://localhost:8700/click \
  -H "Content-Type: application/json" \
  -d '{"selector":"#submit-btn"}'
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
- The /events endpoint includes network errors - check it when something isn't working
- Use /eval for custom queries when the built-in endpoints aren't enough
