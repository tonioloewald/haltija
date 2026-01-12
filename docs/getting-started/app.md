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

**Check connection:**
curl http://localhost:8700/status

**List all open tabs:**
curl http://localhost:8700/windows

**Get current page info:**
curl http://localhost:8700/location

**See the DOM structure:**
curl -X POST http://localhost:8700/tree -H "Content-Type: application/json" -d '{"selector": "body", "depth": 3}'

**Click an element:**
curl -X POST http://localhost:8700/click -H "Content-Type: application/json" -d '{"selector": "#button-id"}'

**Type text:**
curl -X POST http://localhost:8700/type -H "Content-Type: application/json" -d '{"selector": "input", "text": "hello"}'

**Run JavaScript:**
curl -X POST http://localhost:8700/eval -H "Content-Type: application/json" -d '{"code": "document.title"}'

**Open a new tab:**
curl -X POST http://localhost:8700/tabs/open -H "Content-Type: application/json" -d '{"url": "https://example.com"}'

**Target a specific tab:** Add ?window=<id> to any endpoint (get IDs from /windows)

All POST endpoints return: {"success": true, "data": ...} or {"success": false, "error": "..."}

Start with /status to confirm we're connected, then /windows to see open tabs.
```

## Useful Commands

Check if the server is running:
```bash
curl http://localhost:8700/status
```

Get the page structure:
```bash
curl -X POST http://localhost:8700/tree -H "Content-Type: application/json" -d '{"selector": "body", "depth": 3}'
```

Click a button:
```bash
curl -X POST http://localhost:8700/click -H "Content-Type: application/json" -d '{"selector": "button"}'
```

## Keyboard Shortcuts

- **Cmd+T** - New tab
- **Cmd+W** - Close tab
- **Cmd+1-9** - Switch to tab
- **Cmd+L** - Focus address bar
- **Cmd+R** - Refresh page
