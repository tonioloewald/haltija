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
I have Haltija running at http://localhost:8700 and I've injected the widget into my browser. You can control the browser using these endpoints:

- GET /status - Check connection and see connected browsers  
- GET /tree - Get the DOM structure of the current page
- POST /click - Click an element (body: { "selector": "#button-id" })
- POST /type - Type text (body: { "selector": "input", "text": "hello" })
- POST /eval - Run JavaScript in the browser

Try GET /status first to confirm we're connected.
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
curl http://localhost:8700/tree
```

## Troubleshooting

**Widget not appearing?**
- Some sites have strict CSP that blocks the widget
- Try the Haltija desktop app for universal compatibility

**Agent can't connect?**
- Make sure you clicked the bookmarklet after the page loaded
- Check that the widget shows a green status ring (connected)
