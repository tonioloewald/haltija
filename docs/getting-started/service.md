# Haltija Service

You're running the Haltija server. To give your AI agent browser control, you need to inject the widget into a web page using the bookmarklet.

## Quick Start

1. **Drag the bookmarklet** below to your bookmarks bar
2. **Open any website** in your browser
3. **Click the bookmarklet** to inject the Haltija widget
4. **Connect your AI agent** using the REST API at `http://localhost:8700`

## The Bookmarklet

Drag this to your bookmarks bar:

```bookmarklet
Haltija
```

Or copy this JavaScript URL and create a bookmark manually:

```js
javascript:(function(){var s=document.createElement('script');s.src='http://localhost:8700/inject.js';document.body.appendChild(s);})()
```

## For Your AI Agent

Give your agent this prompt to get started:

```prompt
I have Haltija running at http://localhost:8700. You can see and control my browser.

**Quick start:**
1. Check server: curl http://localhost:8700/status
2. Find tabs: curl http://localhost:8700/windows
3. See what's on page: curl -X POST http://localhost:8700/tree -d '{"selector":"body","mode":"actionable"}'
4. Do something: curl -X POST http://localhost:8700/click -d '{"selector":"button"}'

**Key endpoints:**
- GET /windows - list connected tabs
- GET /location?window=ID - current URL
- POST /tree - see page structure (use mode:"actionable" for summary of buttons/links/inputs)
- POST /click - click an element
- POST /type - type into a field
- POST /eval - run JavaScript (escape hatch)
- GET /events - recent events including network errors

**Tree options:**
- mode:"actionable" - returns buttons, links, inputs, headings (recommended)
- visibleOnly:true - filter out hidden elements
- depth:3 - how deep to traverse

**Target a specific tab:** Add ?window=<id> or include "window":"id" in POST body

All POST endpoints return: {"success": true, "data": ...} or {"success": false, "error": "..."}
```

For the full agent prompt with more examples, see [agent-prompt.md](../agent-prompt.md).

## Useful Commands

Start the server (if not already running):
```bash
bunx haltija
```

Check server status:
```bash
curl http://localhost:8700/status
```

Get the page structure:
```bash
curl -X POST http://localhost:8700/tree -H "Content-Type: application/json" -d '{"selector": "body", "depth": 3}'
```

## Troubleshooting

**Widget not appearing?**
- Some sites have strict CSP that blocks the widget
- Try the Haltija desktop app for universal compatibility

**Agent can't connect?**
- Make sure you clicked the bookmarklet after the page loaded
- Check that the widget shows a green status ring (connected)
