# Haltija App

You're running Haltija in the desktop app. This gives you a browser with superpowers - the Haltija widget is automatically injected into every page you visit, bypassing security restrictions that would normally block it.

## Quick Start

1. **Navigate to any website** using the address bar above
2. **Look for the widget** in the bottom-right corner (the elf icon)
3. **Connect your AI agent** using the REST API at `http://localhost:8700`

## For Your AI Agent

Give your agent this prompt to get started:

```prompt
I have Haltija running at http://localhost:8700. You can control the browser using these endpoints:

- GET /status - Check connection and see connected browsers
- GET /tree - Get the DOM structure of the current page
- POST /click - Click an element (body: { "selector": "#button-id" })
- POST /type - Type text (body: { "selector": "input", "text": "hello" })
- POST /eval - Run JavaScript in the browser

Try GET /status first to confirm we're connected.
```

## Useful Commands

Check if the server is running:
```bash
curl http://localhost:8700/status
```

Get the page structure:
```bash
curl http://localhost:8700/tree
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
