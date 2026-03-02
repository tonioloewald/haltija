# Haltija: Browser Control for AI Agents

> **Auto-generated from `src/api-schema.ts`** - Do not edit directly.

You have access to a live browser tab. Use the `hj` command to see the DOM,
click elements, type text, run JavaScript, and watch for changes.

## Quick Start

```
hj status              # Check connection
hj tree                # See page structure (ref IDs for targeting)
hj click 42            # Click element by ref ID
hj click "#submit"     # Click by CSS selector
hj type 10 "hello"     # Type into input (realistic keystroke simulation)
hj key Enter           # Press keys
hj screenshot          # Capture page
hj --help              # All commands
```

## Commands by Category

### Status & Info

- `hj status` - Server status
- `hj stats` - Efficiency and usage statistics
- `hj version` - [Deprecated] Use /status instead
- `hj docs` - [Deprecated] Use /api instead
- `hj api` - Full API reference

### See the Page

- `hj tree [selector, depth, includeText, ...]` - Get DOM tree structure
- `hj query [ref, selector, all]` - Query DOM elements by selector
- `hj inspect [ref, selector, fullStyles, ...]` - Deep inspection of an element
- `hj inspectAll [ref, selector, limit, ...]` - Inspect multiple elements
- `hj find [text, tag, exact, ...]` - Find elements by text content
- `hj form [selector, includeDisabled, includeHidden, ...]` - Extract all form values as structured JSON

### Interact

- `hj click [ref, selector, text, ...]` - Click an element
- `hj type [ref, selector, text, ...]` - Type text into an element
- `hj key [key, ref, selector, ...]` - Send keyboard input
- `hj drag [ref, selector, deltaX, ...]` - Drag from an element
- `hj highlight [ref, selector, label, ...]` - Visually highlight an element
- `hj unhighlight` - Remove highlight
- `hj scroll [ref, selector, x, ...]` - Scroll to element or position
- `hj wait [ms, forElement, hidden, ...]` - Wait for time, element, or condition
- `hj call [ref, selector, method, ...]` - Call a method or get a property on an element

### Navigate

- `hj navigate [url, window]` - Navigate to a URL
- `hj refresh [soft, window]` - Refresh the page
- `hj location` - Get current URL and title

### Watch Events

- `hj events-watch [preset, categories]` - Start watching semantic events
- `hj events-unwatch` - Stop watching events
- `hj events` - Get captured semantic events
- `hj events-stats` - Get event aggregation statistics

### Watch DOM Changes

- `hj mutations-watch [root, childList, attributes, ...]` - Start watching DOM mutations
- `hj mutations-unwatch` - Stop watching mutations
- `hj mutations-status` - Get mutation watch status

### User Selection

- `hj select [action, window]` - Interactive element selection
- `hj select-start` - [Deprecated] Use /select with action:"start"
- `hj select-cancel` - [Deprecated] Use /select with action:"cancel"
- `hj select-status` - [Deprecated] Use /select with action:"status"
- `hj select-result` - [Deprecated] Use /select with action:"result"
- `hj select-clear` - [Deprecated] Use /select with action:"clear"

### Multiple Tabs

- `hj windows` - List connected windows
- `hj tabs-open [url]` - Open a new tab
- `hj tabs-close [window]` - Close a tab
- `hj tabs-focus [window]` - Focus a tab

### Record & Replay

- `hj recording [action, name, id, ...]` - Record user actions and generate tests
- `hj recording-start` - [Deprecated] Use /recording with action:"start"
- `hj recording-stop` - [Deprecated] Use /recording with action:"stop"
- `hj recording-generate [name]` - [Deprecated] Use /recording with action:"generate"
- `hj recordings` - [Deprecated] Use /recording with action:"list"

### Run Tests

- `hj test-run [test, format, stepDelay, ...]` - Run a JSON test
- `hj test-suite [tests, format, testDelay, ...]` - Run multiple tests
- `hj test-validate [test]` - Validate test without running

### Debug & Eval

- `hj console` - Get console output
- `hj eval [code, window]` - Execute JavaScript
- `hj fetch [url, window]` - Fetch a URL from within the tab context
- `hj screenshot [ref, selector, scale, ...]` - Capture a screenshot
- `hj snapshot [trigger, context]` - Capture page snapshot
- `hj video-start [maxDuration, window]` - Start video recording
- `hj video-stop [window]` - Stop video recording
- `hj video-status` - Check video recording status

## Tips

1. `hj tree` first — ref IDs are the fastest way to target elements
2. Selectors support `:text()` pseudo-selector: `hj click "button:text(Sign in)"`
3. `:text(/regex/i)` for regex matching: `hj click "a:text(/sign\s+up/i)"`
4. `hj events` shows what happened — aggregated semantic events, not raw DOM
5. `hj highlight 42 "Look here"` to show the user something
6. `hj recording start` survives page navigations — record OAuth flows, multi-page checkouts
7. `hj api` for the full API reference with all parameters

## CI / Headless

```bash
# Install deps (Ubuntu)
apt-get install -y xvfb jq libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2t64

# Start Haltija in CI mode (Electron + xvfb)
export PATH="$HOME/.local/bin:$PATH"
xvfb-run --auto-servernum bunx haltija@latest --ci &

# --ci waits for ready, then run tests
hj test-run tests/my-test.json
```

See docs/CI-INTEGRATION.md for complete examples.

## Test Runner

```
hj test-run tests/login.json       # Run a test
hj test-validate tests/login.json   # Validate format
hj test-suite tests/a.json tests/b.json  # Run multiple
```

Test steps: `navigate`, `click`, `type`, `check`, `key`, `wait`, `assert`, `eval`, `verify`

The `type` action uses realistic per-character keystroke simulation by default.
Add `"paste": true` for fast paste-style input (still framework-compatible).

## Full API Reference

Run `hj api` for complete endpoint docs with all parameters and examples.