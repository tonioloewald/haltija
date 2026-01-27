# Haltija App

You're running Haltija in the desktop app. This gives you a browser with superpowers - the Haltija widget is automatically injected into every page you visit, bypassing security restrictions that would normally block it.

## Quick Start

1. **Navigate to any website** using the address bar above
2. **Look for the widget** in the bottom-right corner (the elf icon)
3. **Connect your AI agent** using the REST API at `http://localhost:8700`

## For Your AI Agent

Give your agent this prompt to get started:

```prompt
I have Haltija running. Use the hj command to control my browser.

hj status              # Check connection
hj tree                # See page structure (with ref IDs)
hj click 42            # Click element by ref ID
hj click "#selector"   # Click by CSS selector
hj type 10 "hello"     # Type into input
hj key Enter           # Press keys
hj screenshot          # Capture page
hj docs                # Quick start guide
hj api                 # Full API reference
hj --help              # All commands
```

## Useful Commands

```bash
hj status              # Server running?
hj tree                # DOM structure with ref IDs
hj tree -d 5           # Deeper tree
hj click 42            # Click by ref
hj click "#submit"     # Click by selector
hj type 10 "hello"     # Type text
hj key Enter           # Press key
hj screenshot          # Capture page
hj highlight 5 "Here"  # Show the user
hj events              # Recent activity
hj docs                # Quick start
hj api                 # Full API reference
```

## Keyboard Shortcuts

- **Cmd+T** - New tab
- **Cmd+W** - Close tab
- **Cmd+1-9** - Switch to tab
- **Cmd+L** - Focus address bar
- **Cmd+R** - Refresh page
