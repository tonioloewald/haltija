# Haltija App

You're running Haltija in the desktop app. This gives you a browser with superpowers - the Haltija widget is automatically injected into every page you visit, bypassing security restrictions that would normally block it.

## Quick Start

1. **Navigate to any website** using the address bar above
2. **Look for the widget** in the bottom-right corner (the elf icon)
3. **Connect your AI agent** using the REST API at `http://localhost:8700`

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
- GET /status - check connection, list tabs
- GET /windows - list connected tabs with IDs
- GET /location?window=ID - current URL
- GET /endpoints - compact JSON list of all capabilities
- POST /tree - see page structure (use mode:"actionable" for summary of buttons/links/inputs)
- POST /click - click an element
- POST /type - type into a field
- POST /scroll - smooth scroll to element or position
- POST /highlight - show the user an element (with optional label)
- POST /wait - wait for element to appear/disappear or fixed delay
- POST /eval - run JavaScript (escape hatch)
- POST /screenshot - capture page image (see options below)
- GET /events - recent events including network errors
- GET /console - recent console logs/errors
- GET /select/result - get elements user has selected in browser

**Screenshot options:**
- format: "png" (default), "webp", "jpeg"
- quality: 0.0-1.0 (for webp/jpeg, default 0.8)
- scale: 0.5 = half size (saves bandwidth)
- maxWidth/maxHeight: constrain dimensions (great for vision models)
- selector: capture specific element instead of full page

Example: curl -X POST http://localhost:8700/screenshot -d '{"scale":0.5,"format":"webp"}'

**Wait for async UI:**
- curl -X POST http://localhost:8700/wait -d '{"forElement":".modal"}'           # Wait for element
- curl -X POST http://localhost:8700/wait -d '{"forElement":".loading","hidden":true}'  # Wait for disappear
- curl -X POST http://localhost:8700/wait -d '{"ms":500}'                         # Simple delay

**Showing things to the user:**
When explaining something or pointing out an issue, use /highlight to visually show the user:
- curl -X POST http://localhost:8700/highlight -d '{"selector":"#login-btn","label":"Click here"}'
- curl -X POST http://localhost:8700/highlight -d '{"selector":".error","label":"This is the problem","color":"#ef4444"}'
The highlight stays until you call /unhighlight or set a duration in ms.

**Target a specific tab:** Add ?window=<id> or include "window":"id" in POST body

All POST endpoints return: {"success": true, "data": ...} or {"success": false, "error": "..."}
```

For the full agent prompt with more examples, see [agent-prompt.md](../agent-prompt.md).

## Useful Commands

Check if the server is running:
```bash
curl http://localhost:8700/status
```

Get the page structure:
```bash
curl -X POST http://localhost:8700/tree -d '{"selector": "body", "depth": 3}'
```

Take a screenshot:
```bash
curl -X POST http://localhost:8700/screenshot -d '{"scale": 0.5}'
```

Click a button:
```bash
curl -X POST http://localhost:8700/click -d '{"selector": "button"}'
```

## Keyboard Shortcuts

- **Cmd+T** - New tab
- **Cmd+W** - Close tab
- **Cmd+1-9** - Switch to tab
- **Cmd+L** - Focus address bar
- **Cmd+R** - Refresh page
