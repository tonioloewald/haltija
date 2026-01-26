# Haltija Service

You're running the Haltija server. To give your AI agent browser control, inject the widget into a web page.

## Quick Start

1. **Drag the bookmarklet** below to your bookmarks bar
2. **Open any website** in your browser
3. **Click the bookmarklet** to inject the widget
4. **Use hj commands** to control the browser

## The Bookmarklet

Drag this to your bookmarks bar:

```bookmarklet
Haltija
```

Or copy this JavaScript URL manually:

```js
javascript:(function(){var s=document.createElement('script');s.src='http://localhost:8700/inject.js';document.body.appendChild(s);})()
```

## For Your AI Agent

Give your agent this prompt:

```
I have Haltija running. Use the hj command to control my browser:

hj status              # Check connection
hj tree                # See page structure
hj click <ref>         # Click by ref ID from tree
hj click "#selector"   # Click by CSS selector
hj type <ref> "text"   # Type into input
hj key Enter           # Press keys
hj screenshot          # Capture page
hj docs                # Full command reference

Example workflow:
1. hj tree              # See what's on page
2. hj click 42          # Click element with ref 42
3. hj type 15 "hello"   # Type into input ref 15
```

## Commands

```bash
# Check status
hj status              # Server running?
hj windows             # Browser tabs connected?

# See the page  
hj tree                # DOM structure with ref IDs
hj tree -d 5           # Deeper tree
hj console             # Browser console output

# Interact
hj click 42            # Click by ref
hj click "#submit"     # Click by selector
hj type 10 "hello"     # Type text
hj key Enter           # Press key
hj key s --ctrl        # Keyboard shortcut

# Navigate
hj navigate example.com
hj refresh
hj location

# Show the user
hj highlight 5 "Look here"
hj unhighlight

# Capture
hj screenshot
hj events              # Recent activity
```

Run `hj --help` for all commands, or `hj docs` for full reference.

## Troubleshooting

**Widget not appearing?**
- Some sites have strict CSP that blocks the widget
- Try the Haltija desktop app: `bunx haltija`

**Agent can't connect?**
- Click the bookmarklet after the page loads
- Check widget shows green status (connected)
- Run `hj status` to verify server

## REST API

For direct HTTP integration, see [REST-API.md](../REST-API.md).
