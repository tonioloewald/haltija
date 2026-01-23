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
- **Ref IDs**: every element gets a stable ref (e.g. `@3`, `@42`) — use `{"ref":"@3"}` instead of selectors when possible. Refs survive DOM updates within the same page.
- **Why things are hidden**: "display:none" vs "off-screen" vs "zero-size"
- **Form state**: current input values, which fields are required/disabled
- **What's actionable**: buttons, links, inputs - not noise

## What you can do
- Click buttons, fill forms, navigate
- Watch for changes (console errors, DOM mutations)
- Take screenshots (webp, scaled down for efficiency)
- Highlight elements to show the user what you mean

## Workflow

1. **Inspect**: GET /tree to see what's on the page
2. **Plan**: find the target element's `ref` or selector, check flags.interactive is true
3. **Act**: click/type/navigate
4. **Verify**: GET /tree or /events or /console to confirm the result

## Quick start

1. Check server: curl http://localhost:8700/status
2. See the page: curl http://localhost:8700/tree
3. Check for errors: curl http://localhost:8700/console
4. Take screenshot: curl http://localhost:8700/screenshot

## Endpoints

All endpoints work with GET (sensible defaults). Use POST to pass options.

### See the page (all GET)
/status              Is it working? How many tabs?
/tree                **Semantic page structure** - flags: interactive, hidden, hiddenReason
/console             **Recent console logs/errors** - check when things break
/screenshot          **Capture page** - add ?scale=0.5 for smaller images
/location            Current URL and title
/windows             Connected browser tabs
/events              Recent semantic events (clicks, typing, errors)

### Inspect deeper (POST with selector)
/inspect             Deep inspection of one element: POST {"selector":"#btn"}
/query               Quick element lookup: POST {"selector":"input"}

### Do things (GET or POST)
/click               Click element: POST {"ref":"@3"} or {"selector":"#btn"} or {"text":"Submit"}
/type                Type text: POST {"ref":"@10", "text":"hello"} or /type?selector=input&text=hello
/key                 Keyboard input: /key?key=Escape or /key?key=s&ctrlKey=true
/scroll              Scroll to element: POST {"selector":"#section"}
/highlight           **Show user what you mean**: POST {"selector":"#btn", "label":"Click here"}
/navigate            Go to URL: POST {"url":"https://..."}

### Escape hatches (POST)
/eval                Run JavaScript: POST {"code":"document.title"}
/call                Call method on element: POST {"selector":"#el", "method":"focus", "args":[]}

## Understanding the page

### Quick overview (just GET)
```bash
curl http://localhost:8700/tree
```

### With options (POST)
```bash
# Only visible elements, deeper tree
curl -X POST http://localhost:8700/tree -d '{"visibleOnly":true, "depth":5}'

# Specific section
curl -X POST http://localhost:8700/tree -d '{"selector":"form", "depth":-1}'
```

### Get element property/call method
```bash
# Get input value
curl -X POST http://localhost:8700/call -d '{"selector":"#email", "method":"value"}'

# Call a method
curl -X POST http://localhost:8700/call -d '{"selector":"dialog", "method":"showModal", "args":[]}'
```

### Custom JavaScript
```bash
curl -X POST http://localhost:8700/eval -d '{"code":"document.querySelectorAll(\"button\").length"}'
```

## Taking action

### Click
```bash
# By ref (preferred - stable, from /tree output)
curl -X POST http://localhost:8700/click -d '{"ref":"@42"}'

# By text (good for generic buttons)
curl -X POST http://localhost:8700/click -d '{"text":"Submit", "tag":"button"}'

# By selector (fallback - brittle if DOM changes)
curl -X POST http://localhost:8700/click -d '{"selector":"#submit-btn"}'
```

### Type
```bash
# By ref (preferred)
curl -X POST http://localhost:8700/type -d '{"ref":"@10", "text":"user@example.com"}'

# By selector
curl -X POST http://localhost:8700/type -d '{"selector":"input[name=email]", "text":"user@example.com"}'
```

### Keyboard shortcuts
```bash
curl "http://localhost:8700/key?key=Escape"              # Close modal
curl "http://localhost:8700/key?key=Enter"               # Submit form
curl "http://localhost:8700/key?key=s&ctrlKey=true"      # Ctrl+S save
curl "http://localhost:8700/key?key=Tab"                 # Tab to next field
curl "http://localhost:8700/key?key=ArrowDown&repeat=3"  # Navigate list
```

### Navigate
```bash
curl -X POST http://localhost:8700/navigate -d '{"url":"https://example.com"}'
```

### Screenshot (GET for full page, POST for options)
```bash
curl http://localhost:8700/screenshot                              # Full page
curl http://localhost:8700/screenshot?scale=0.5                    # Half size
curl -X POST http://localhost:8700/screenshot -d '{"selector":"#chart"}'  # Element only
```

## Showing things to the user

**Important:** When you find something, SHOW the user by highlighting it in their browser!

```bash
# Highlight with label
curl -X POST http://localhost:8700/highlight -d '{"selector":"#login-btn", "label":"Click here"}'

# Remove highlight  
curl http://localhost:8700/unhighlight
```

### Wait for async UI
```bash
curl -X POST http://localhost:8700/wait -d '{"forElement":".modal"}'           # Wait for element
curl -X POST http://localhost:8700/wait -d '{"forElement":".loading", "hidden":true}'  # Wait for disappear
```

## Watching for changes

```bash
curl http://localhost:8700/events    # Recent user actions
curl http://localhost:8700/console   # Console logs/errors
```

## User selection

If the user selected something in the browser:
```bash
curl http://localhost:8700/select/result
```

## Multiple tabs

If you're not sure which tab you're controlling:
```bash
curl http://localhost:8700/windows   # Shows all connected tabs with IDs, URLs, titles
```

Response includes which tab is focused and hints about targeting. To target a specific tab:
```bash
curl http://localhost:8700/tree?window=abc123   # Query params work on any endpoint
curl -X POST http://localhost:8700/click -d '{"selector":"#btn", "window":"abc123"}'  # Or in body
```

## More info

GET /api for full reference, GET /docs/list for documentation.
```

---

## Tips

- GET /tree, /console, /screenshot work without parameters - start there
- /tree shows flags like `interactive`, `hidden`, `hiddenReason` - look for these
- /console shows errors - check it when things don't work
- Use `ref` from the tree (e.g. `{"ref":"@3"}`) instead of CSS selectors when possible
- Use /click with `text` instead of selectors for dynamic UIs
- Use /wait after clicks that trigger async updates (modals, loaders)
- click, type, key, scroll all support GET with query params for simple cases

## Troubleshooting

- **Clicked but nothing happened?** Check /console for JS errors. You may have clicked a wrapper `<div>` — try the child `<button>` or parent `<a>` instead.
- **Can't find the element?** It might be hidden (check `flags.hidden`), off-screen (needs scroll), or inside a modal/dialog that hasn't opened yet.
- **Element not interactive?** Some apps use clickable `<div>` instead of `<button>`. Try /eval as a fallback: `{"code":"document.querySelector('#el').click()"}`
- **Form not submitting?** React/Vue apps often need the input event, not just setting value. Use /type which fires proper events.
- **Layout looks wrong?** Use /screenshot for visual confirmation.
