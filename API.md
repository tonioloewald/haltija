# Haltija API Reference

> **Auto-generated from `src/api-schema.ts`** - Do not edit directly.

The API is self-documenting: `GET` any `POST` endpoint to see its schema.

---

## DOM Inspection

### `POST /tree`

**Get DOM tree structure**

Returns hierarchical view of page elements. Best for understanding page structure before interacting.

Response structure:
  { tag, id?, classes?, attrs?, text?, children?, flags?: { interactive, hidden, hasAria, ... } }

Flags help identify interactive elements (buttons, inputs) and hidden content.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string,null | Root element selector |
| `depth` | number,null | Max depth (-1 = unlimited, default 3) |
| `includeText` | boolean,null | Include text content (default true) |
| `visibleOnly` | boolean,null | Only visible elements (default false) |
| `pierceShadow` | boolean,null | Pierce shadow DOM (default false) |
| `compact` | boolean,null | Minimal output (default false) |
| `window` | string,null | Target window ID |

**Examples:**

- **overview**: Quick page overview
  ```json
  {"depth":2}
  ```
- **form-only**: Full form structure
  ```json
  {"selector":"form","depth":-1}
  ```
- **visible-buttons**: Find visible interactive elements
  ```json
  {"selector":"body","visibleOnly":true,"depth":4}
  ```

---

### `POST /query`

**Query DOM elements by selector**

Quick element lookup. Returns basic info: tagName, id, className, textContent, attributes.

Use this to check if an element exists before clicking/typing. For detailed info, use /inspect instead.

Response: { tagName, id, className, textContent, attributes: {...} }

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string | CSS selector *(required)* |
| `all` | boolean,null | Return all matches (default false = first only) |

**Examples:**

- **by-id**: Find element by ID
  ```json
  {"selector":"#submit-btn"}
  ```
- **by-text**: Find button by text
  ```json
  {"selector":"button:contains(\"Save\")"}
  ```
- **all-inputs**: Find all text inputs
  ```json
  {"selector":"input[type=\"text\"]","all":true}
  ```

---

### `POST /inspect`

**Deep inspection of an element**

Get everything about ONE element: geometry, computed styles, ARIA attributes, scroll position, visibility state.

Response includes:
  - box: { x, y, width, height, visible }
  - text: { innerText, value, placeholder }
  - properties: { disabled, checked, hidden, role, ariaLabel, ... }
  - styles: { display, visibility, opacity, ... }
  - hierarchy: { parent, children count, depth }

Use before clicking to verify element is visible and enabled.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string | CSS selector *(required)* |
| `window` | string,null | Target window ID |

**Examples:**

- **check-button**: Verify button is clickable
  ```json
  {"selector":"#submit"}
  ```
- **check-input**: Get input state and value
  ```json
  {"selector":"input[name=\"email\"]"}
  ```

---

### `POST /inspectAll`

**Inspect multiple elements**

Deep inspection of ALL elements matching selector (up to limit).

Same detailed info as /inspect, but for multiple elements. Great for:
  - Finding all buttons/links on a page
  - Checking which form fields are required
  - Listing all interactive elements

Response: array of inspection objects

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string | CSS selector *(required)* |
| `limit` | number,null | Max elements (default 10) |
| `window` | string,null | Target window ID |

**Examples:**

- **all-buttons**: Find all clickable buttons
  ```json
  {"selector":"button, [role=\"button\"]","limit":20}
  ```
- **form-fields**: List all form inputs
  ```json
  {"selector":"input, select, textarea"}
  ```
- **nav-links**: Get navigation links
  ```json
  {"selector":"nav a","limit":15}
  ```

---

## Interaction

### `POST /click`

**Click an element**

Scrolls element into view, then performs full click sequence: mouseenter, mouseover, mousedown, mouseup, click.

Automatically fails if element is not found or is disabled. Check response.success to verify.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string | CSS selector of element to click *(required)* |
| `window` | string,null | Target window ID |

**Examples:**

- **by-id**: Click button by ID
  ```json
  {"selector":"#submit"}
  ```
- **by-class**: Click by class
  ```json
  {"selector":".btn-primary"}
  ```
- **by-text**: Click by button text
  ```json
  {"selector":"button:contains(\"Save\")"}
  ```
- **by-role**: Click by ARIA
  ```json
  {"selector":"[role=\"button\"][aria-label=\"Close\"]"}
  ```

---

### `POST /type`

**Type text into an element**

Focus element and type text character by character. 

Human-like mode (default) adds realistic delays and occasional typos that get corrected.
Use humanlike: false for instant typing in tests.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string | CSS selector of input/textarea *(required)* |
| `text` | string | Text to type *(required)* |
| `humanlike` | boolean,null | Human-like delays (default true) |
| `typoRate` | number,null | Typo probability 0-1 (default 0.03) |
| `minDelay` | number,null | Min ms between keys (default 50) |
| `maxDelay` | number,null | Max ms between keys (default 150) |
| `window` | string,null | Target window ID |

**Examples:**

- **email**: Type email address
  ```json
  {"selector":"#email","text":"user@example.com"}
  ```
- **password**: Type password
  ```json
  {"selector":"input[type=\"password\"]","text":"secret123"}
  ```
- **fast-test**: Instant typing for tests
  ```json
  {"selector":"input","text":"hello","humanlike":false}
  ```
- **by-label**: Find by ARIA label
  ```json
  {"selector":"input[aria-label=\"Search\"]","text":"query"}
  ```

---

### `POST /drag`

**Drag from an element**

Simulates drag gesture: mousedown on element, mousemove by delta, mouseup.

Good for: sliders, resize handles, drag-and-drop reordering, range inputs.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string | CSS selector of drag handle *(required)* |
| `deltaX` | number,null | Horizontal distance in pixels |
| `deltaY` | number,null | Vertical distance in pixels |
| `duration` | number,null | Drag duration in ms (default 300) |
| `window` | string,null | Target window ID |

**Examples:**

- **slider-right**: Move slider right
  ```json
  {"selector":".slider-handle","deltaX":100}
  ```
- **resize**: Resize element
  ```json
  {"selector":".resize-handle","deltaX":50,"deltaY":50}
  ```
- **reorder**: Drag item down in list
  ```json
  {"selector":".drag-item","deltaY":80}
  ```

---

### `POST /highlight`

**Visually highlight an element**

Draw attention to an element with colored border and optional label.

Great for showing users what you found or pointing out issues. Use /unhighlight to remove.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string | CSS selector *(required)* |
| `label` | string,null | Label text to show |
| `color` | string,null | CSS color (default #6366f1) |
| `duration` | number,null | Auto-hide after ms (omit for manual) |
| `window` | string,null | Target window ID |

**Examples:**

- **point-out**: Show user where to click
  ```json
  {"selector":"#login-btn","label":"Click here"}
  ```
- **error-red**: Highlight error in red
  ```json
  {"selector":".error","label":"Problem","color":"#ef4444"}
  ```
- **temporary**: Auto-hide after 3s
  ```json
  {"selector":"button","duration":3000}
  ```

---

### `POST /unhighlight`

**Remove highlight**

Remove any active highlight overlay created by /highlight.

---

### `POST /scroll`

**Scroll to element or position**

Smooth scroll with natural easing. Multiple modes:

- selector: Scroll element into view (most common)
- x/y: Scroll to absolute position
- deltaX/deltaY: Scroll relative to current position

At least one of selector, x, y, deltaX, or deltaY must be provided.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string,null | CSS selector to scroll into view |
| `x` | number,null | Absolute X position in pixels |
| `y` | number,null | Absolute Y position in pixels |
| `deltaX` | number,null | Relative horizontal scroll in pixels |
| `deltaY` | number,null | Relative vertical scroll in pixels |
| `duration` | number,null | Animation duration in ms (default 500) |
| `easing` | string,null | Easing function: ease-out (default), ease-in-out, linear |
| `block` | string,null | Vertical alignment: center (default), start, end, nearest |
| `window` | string,null | Target window ID |

**Examples:**

- **to-element**: Scroll pricing section into view
  ```json
  {"selector":"#pricing"}
  ```
- **to-top**: Scroll to top of page
  ```json
  {"y":0}
  ```
- **to-bottom**: Scroll to footer
  ```json
  {"selector":"footer"}
  ```
- **down-500**: Scroll down 500px
  ```json
  {"deltaY":500}
  ```
- **slow-scroll**: Slow animated scroll
  ```json
  {"selector":"#section","duration":1000,"easing":"ease-in-out"}
  ```

---

## Navigation

### `POST /navigate`

**Navigate to a URL**

Navigate the browser to a new URL. Waits for page load to complete.

Use /location after to verify navigation succeeded.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `url` | string | URL to navigate to *(required)* |
| `window` | string,null | Target window ID |

**Examples:**

- **full-url**: Navigate to full URL
  ```json
  {"url":"https://example.com/login"}
  ```
- **relative**: Navigate to relative path
  ```json
  {"url":"/dashboard"}
  ```

---

### `POST /refresh`

**Refresh the page**

Reload the current page. Use hard: true to bypass cache.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `hard` | boolean,null | Bypass cache (default false) |
| `window` | string,null | Target window ID |

**Examples:**

- **soft**: Normal refresh
  ```json
  {}
  ```
- **hard**: Bypass cache
  ```json
  {"hard":true}
  ```

---

### `GET /location`

**Get current URL and title**

Returns current page info.

Response: { url, title, pathname, search, hash }

Use after /navigate to verify you're on the expected page.

---

## Mutation Watching

### `POST /mutations/watch`

**Start watching DOM mutations**

Begin capturing DOM changes: elements added/removed, attributes changed, text modified.

Presets filter out framework noise:
- smart (default): Auto-detects React, Tailwind, etc.
- minimal: Only element add/remove
- none: Everything (noisy)

Get captured mutations via /mutations/status.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `root` | string,null | Root selector to watch (default body) |
| `childList` | boolean,null | Watch child additions/removals (default true) |
| `attributes` | boolean,null | Watch attribute changes (default true) |
| `characterData` | boolean,null | Watch text content changes (default false) |
| `subtree` | boolean,null | Watch all descendants (default true) |
| `debounce` | number,null | Debounce ms (default 100) |
| `preset` | string,null | Filter preset: smart, xinjs, b8rjs, tailwind, react, minimal, none |
| `filters` | ,null | Custom filter configuration |
| `pierceShadow` | boolean,null | Watch inside shadow DOM (default false) |

**Examples:**

- **default**: Watch all DOM changes with smart filtering
  ```json
  {}
  ```
- **form-only**: Watch form for new elements
  ```json
  {"root":"form","preset":"minimal"}
  ```
- **react-app**: Filter React internals
  ```json
  {"preset":"react"}
  ```

---

### `POST /mutations/unwatch`

**Stop watching mutations**

Stop capturing DOM mutations. Call this when done to free resources.

---

### `GET /mutations/status`

**Get mutation watch status**

Check if mutation watching is active and get captured mutations.

Response: { watching: boolean, mutations: [...], summary: { added, removed, changed } }

---

## Event Watching

### `POST /events/watch`

**Start watching semantic events**

Begin capturing high-level user actions. Events are aggregated and meaningful:
- "user typed 'hello@example.com'" not 18 keydown events
- "user clicked Submit" not mousedown/mouseup/click

Presets control verbosity:
- minimal: clicks, submits, navigation only
- interactive: + hovers on buttons, form changes (recommended)
- detailed: + all element interactions
- debug: everything

Categories: interaction, navigation, input, hover, scroll, mutation, focus, console

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `preset` | string,null | Verbosity: minimal, interactive, detailed, debug |
| `categories` | array,null | Specific categories to watch |

**Examples:**

- **default**: Recommended for most use cases
  ```json
  {"preset":"interactive"}
  ```
- **minimal**: Only clicks and navigation
  ```json
  {"preset":"minimal"}
  ```
- **custom**: Specific categories
  ```json
  {"categories":["interaction","input","console"]}
  ```

---

### `POST /events/unwatch`

**Stop watching events**

Stop capturing semantic events. Events buffer is cleared.

---

### `GET /events`

**Get captured semantic events**

Returns buffered events since watch started.

Response: { events: [{ type, timestamp, category, target?, payload }], since, count }

Event types: interaction:click, input:typed, navigation:navigate, hover:dwell, scroll:stop, etc.

---

### `GET /events/stats`

**Get event aggregation statistics**

Shows noise reduction metrics.

Response: { rawEvents, semanticEvents, reductionPercent, byCategory: {...} }

Typically see 90%+ reduction (e.g., 2000 raw events → 80 semantic events).

---

## Debug & Eval

### `GET /console`

**Get console output**

Returns captured console.log/warn/error/info from the page.

Response: { entries: [{ level, message, timestamp, stack? }] }

Great for debugging - check for errors after actions fail.

---

### `POST /eval`

**Execute JavaScript**

Run arbitrary JavaScript in the browser context. Returns the result.

The code runs in the page's context with access to window, document, etc.
Return values are JSON-serialized. Promises are awaited.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `code` | string | JavaScript code to execute *(required)* |
| `window` | string,null | Target window ID |

**Examples:**

- **get-title**: Get page title
  ```json
  {"code":"document.title"}
  ```
- **count-items**: Count elements
  ```json
  {"code":"document.querySelectorAll(\".item\").length"}
  ```
- **get-value**: Get input value
  ```json
  {"code":"document.querySelector(\"#email\").value"}
  ```
- **check-state**: Check auth state
  ```json
  {"code":"window.localStorage.getItem(\"token\") !== null"}
  ```
- **scroll-position**: Get scroll position
  ```json
  {"code":"({ x: window.scrollX, y: window.scrollY })"}
  ```

---

### `POST /screenshot`

**Capture a screenshot**

Capture the page or a specific element as base64 PNG/WebP/JPEG.

Response: { success, image: "data:image/png;base64,...", width, height, source }

Source indicates capture method: "electron" (best), "html2canvas", or "viewport-only".

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string,null | Element to capture (omit for full page) |
| `scale` | number,null | Scale factor (default 1) |
| `maxWidth` | number,null | Max width in pixels |
| `maxHeight` | number,null | Max height in pixels |

**Examples:**

- **full-page**: Capture entire page
  ```json
  {}
  ```
- **element**: Capture specific element
  ```json
  {"selector":"#chart"}
  ```
- **thumbnail**: Small thumbnail
  ```json
  {"scale":0.5,"maxWidth":400}
  ```

---

### `POST /snapshot`

**Capture page snapshot**

Capture current page state for debugging.

Includes: DOM tree, console logs, viewport size, scroll position, URL, timestamp.

Response: { snapshot: { url, title, viewport, dom, console, timestamp } }

Great for debugging test failures - call this when something goes wrong.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `trigger` | string,null | What triggered the snapshot (e.g., "manual", "test-failure") |
| `context` | ,null | Additional context about the snapshot |

**Examples:**

- **manual**: Manual debug snapshot
  ```json
  {"trigger":"manual"}
  ```
- **test-fail**: Capture after test failure
  ```json
  {"trigger":"test-failure","context":{"step":3,"error":"Element not found"}}
  ```

---

## Selection Tool

### `POST /select/start`

**Start interactive selection**

Let user drag to select a region on the page.

After calling this, the user can draw a rectangle on the page.
Call /select/result to get the elements within the selection.

Response: { success: true, message: "Selection mode active" }

---

### `POST /select/cancel`

**Cancel selection mode**

Exit selection mode without capturing. Use if user changed their mind.

---

### `GET /select/status`

**Check if selection is active**

Check whether selection mode is currently active.

Response: { active: boolean, hasResult: boolean }

---

### `GET /select/result`

**Get selection result**

After user completes selection, returns the region and elements within.

Response: { bounds: { x, y, width, height }, elements: [{ selector, tagName, text, ... }] }

Use the selectors from this response in subsequent /click or /type calls.

---

### `POST /select/clear`

**Clear selection result**

Clear any stored selection result. Use before starting a new selection.

---

## Windows & Tabs

### `GET /windows`

**List connected windows**

Returns all connected browser windows/tabs with IDs, URLs, and titles.

Response: { windows: [{ id, url, title, focused }] }

Use window IDs in other endpoints (e.g., /click, /tree) to target specific tabs.

---

### `POST /tabs/open`

**Open a new tab**

Desktop app only. Opens a new tab with optional URL.

If url is omitted, opens a blank tab. The new tab gets the widget auto-injected.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `url` | string,null | URL to open |

**Examples:**

- **blank**: Open blank tab
  ```json
  {}
  ```
- **with-url**: Open tab with URL
  ```json
  {"url":"https://example.com"}
  ```

---

### `POST /tabs/close`

**Close a tab**

Desktop app only. Closes the specified tab by window ID.

Get window IDs from /windows endpoint.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `window` | string | Window ID to close *(required)* |

**Examples:**

- **close**: Close specific tab
  ```json
  {"window":"window-abc123"}
  ```

---

### `POST /tabs/focus`

**Focus a tab**

Desktop app only. Brings the specified tab to front.

Useful when working with multiple tabs to ensure the right one is visible.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `window` | string | Window ID to focus *(required)* |

**Examples:**

- **focus**: Bring tab to front
  ```json
  {"window":"window-abc123"}
  ```

---

## Recording

### `POST /recording/start`

**Start recording user actions**

Begin capturing user interactions as semantic events.

The recording captures clicks, typing, navigation, and more.
Use /recording/stop to finish, then /recording/generate to create a test.

---

### `POST /recording/stop`

**Stop recording**

Stop capturing user actions.

Response: { events: [...], duration: ms, eventCount: n }

After stopping, use /recording/generate to convert events to a test.

---

### `POST /recording/generate`

**Generate test from recording**

Converts recorded semantic events into a JSON test file.

The generated test can be run with /test/run or saved for later use.

Response: { test: { version, name, url, steps: [...] } }

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `name` | string,null | Test name |

**Examples:**

- **named**: Generate with custom name
  ```json
  {"name":"Login flow test"}
  ```
- **default**: Generate with auto-generated name
  ```json
  {}
  ```

---

### `GET /recordings`

**List saved recordings**

List all saved recordings on the server.

Response: { recordings: [{ name, created, eventCount, duration }] }

---

## Testing

### `POST /test/run`

**Run a JSON test**

Execute a test defined in Haltija JSON format.

Test structure:
{
  "version": 1,
  "name": "Login flow",
  "url": "http://localhost:3000/login",
  "steps": [
    { "action": "type", "selector": "#email", "text": "user@example.com" },
    { "action": "type", "selector": "#password", "text": "secret123" },
    { "action": "click", "selector": "button[type=submit]" },
    { "action": "assert", "assertion": { "type": "url", "pattern": "/dashboard" } }
  ]
}

Step actions: navigate, click, type, key, wait, assert, eval, verify

Output formats:
- json: Structured result with step-by-step details
- github: Annotations for GitHub Actions + markdown summary
- human: Colored terminal output

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `test` | any | Test object with steps *(required)* |
| `format` | string,null | Output format: json (structured), github (annotations + summary), human (readable) |
| `stepDelay` | number,null | Milliseconds between steps (default 100) |
| `timeout` | number,null | Milliseconds timeout per step (default 5000) |
| `stopOnFailure` | boolean,null | Stop on first failure (default true) |

**Examples:**

- **simple-test**: Simple click and verify
  ```json
  {"test":{"version":1,"name":"Click button","url":"http://localhost:3000","steps":[{"action":"click","selector":"#submit"},{"action":"assert","assertion":{"type":"exists","selector":".success"}}]}}
  ```
- **github-output**: Get GitHub Actions format
  ```json
  {"test":{"version":1,"name":"Test","url":"http://localhost:3000","steps":[]},"format":"github"}
  ```

---

### `POST /test/suite`

**Run multiple tests**

Execute a suite of tests, optionally stopping on first failure.

Input: { tests: [test1, test2, ...], format?, stopOnFailure? }

Response includes per-test results and overall summary.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `tests` | array | Array of test objects *(required)* |
| `format` | string,null | Output format: json (structured), github (annotations + summary), human (readable) |
| `testDelay` | number,null | Milliseconds between tests (default 500) |
| `stepDelay` | number,null | Milliseconds between steps (default 100) |
| `timeout` | number,null | Milliseconds timeout per step (default 5000) |
| `stopOnFailure` | boolean,null | Stop on first failure (default false for suites) |

**Examples:**

- **two-tests**: Run two tests, continue on failure
  ```json
  {"tests":[{"version":1,"name":"Login","url":"http://localhost:3000/login","steps":[]},{"version":1,"name":"Dashboard","url":"http://localhost:3000/dashboard","steps":[]}],"stopOnFailure":false}
  ```

---

### `POST /test/validate`

**Validate test without running**

Check that a test is well-formed and all selectors exist on the current page.

Use this to pre-check tests before running. Returns validation errors without executing steps.

Response: { valid: boolean, errors?: [{ step?, message }] }

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `test` | any | Test object to validate *(required)* |

**Examples:**

- **validate**: Validate test before running
  ```json
  {"test":{"version":1,"name":"Test","url":"http://localhost:3000","steps":[{"action":"click","selector":"#btn"}]}}
  ```

---

## Status & Meta

### `GET /status`

**Server status**

Returns server info and connected browser count.

Response: { version, uptime, browsers: n, focused?: windowId }

Use to verify server is running and browsers are connected before testing.

---

### `GET /version`

**Get server version**

Returns the Haltija server version.

Response: { version: "1.0.0" }

---

### `GET /docs`

**Quick start guide**

Human-readable getting started docs for AI agents.

Returns markdown-formatted quick start guide with common workflows.

---

### `GET /api`

**Full API reference**

Complete API documentation with all endpoints.

Returns structured JSON with all endpoints, their parameters, and examples.

---
