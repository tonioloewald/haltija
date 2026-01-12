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

**Check connection:**
curl http://localhost:8700/status

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

All POST endpoints return: {"success": true, "data": ...} or {"success": false, "error": "..."}

Start with /status to confirm we're connected, then /location to see what page I'm on.
```

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
