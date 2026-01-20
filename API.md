# Haltija API Reference

> **Auto-generated from `src/api-schema.ts`** - Do not edit directly.

## Quick Start

```bash
# Is it working?
curl localhost:8700/status

# What tabs are connected?
curl localhost:8700/windows

# What's on the page?
curl -X POST localhost:8700/tree -d '{"mode":"actionable"}'

# Click something
curl -X POST localhost:8700/click -d '{"selector":"#submit"}'
```

---

## Connection & Status

### `GET /status`

**Server status**

Returns server info and connected browser count.

Response: { version, uptime, browsers: n, focused?: windowId }

Use to verify server is running and browsers are connected before testing.

---

### `GET /stats`

**Efficiency and usage statistics**

Returns metrics showing Haltija's efficiency vs raw DOM events.

Response includes:
- session: { startTime, uptimeMs, uptimeFormatted }
- events: { raw, semantic, reductionPercent, byCategory }
- dom: { processed, inTree, inActionable, reductionPercent }
- refs: { assigned, resolved, stale, hitRate }
- endpoints: { [name]: { calls, success, errors, avgMs } }

Use this to verify efficiency claims (99%+ event reduction, etc.) and debug performance.

---

### `GET /version`

**[Deprecated] Use /status instead**

Deprecated: Version is included in /status response.

---

### `GET /docs`

**[Deprecated] Use /api instead**

Deprecated: Use /api for complete API documentation.

---

### `GET /api`

**Full API reference**

Complete API documentation with all endpoints.

Returns structured JSON with all endpoints, their parameters, and examples.

---

## See the Page

### `POST /tree`

**Get DOM tree structure**

Returns hierarchical view of page elements. Best for understanding page structure before interacting.

Response structure:
  { tag, id?, classes?, attrs?, text?, value?, checked?, children?, flags?: { interactive, hidden, hasAria, ... } }

Flags help identify interactive elements (buttons, inputs) and hidden content.
Form inputs include live value/checked state (not just HTML attribute).

Use ancestors:true to see parent elements when inspecting deep elements.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string,null | Root element selector |
| `depth` | number,null | Max depth (-1 = unlimited, default 3) |
| `includeText` | boolean,null | Include text content (default true) |
| `visibleOnly` | boolean,null | Only visible elements (default false) |
| `pierceShadow` | boolean,null | Pierce shadow DOM (default true) |
| `pierceFrames` | boolean,null | Pierce same-origin iframes (default true) |
| `compact` | boolean,null | Minimal output (default false) |
| `ancestors` | boolean,null | Include ancestor path from root (default false) |
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
- **with-context**: See element with parent context
  ```json
  {"selector":"#deep-element","ancestors":true}
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
  Response:
  ```json
  {
    "success": true,
    "data": {
      "tagName": "button",
      "id": "submit-btn",
      "className": "btn primary",
      "textContent": "Submit",
      "attributes": {
        "id": "submit-btn",
        "class": "btn primary",
        "type": "submit"
      }
    }
  }
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
  - styles: { display, visibility, opacity, ... } (curated subset)
  - allStyles: { ...all computed styles } (only if fullStyles=true)
  - matchedRules: [ { selector, source, specificity, properties } ] (only if matchedRules=true)
  - hierarchy: { parent, children count, depth }

Use before clicking to verify element is visible and enabled.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string | CSS selector *(required)* |
| `fullStyles` | boolean,null | Include all computed styles (default: false) |
| `matchedRules` | boolean,null | Include matched CSS rules with specificity (default: false) |
| `window` | string,null | Target window ID |

**Examples:**

- **check-button**: Verify button is clickable
  ```json
  {"selector":"#submit"}
  ```
  Response:
  ```json
  {
    "success": true,
    "data": {
      "selector": "body > form > button#submit",
      "tagName": "button",
      "classList": [
        "btn",
        "primary"
      ],
      "box": {
        "x": 100,
        "y": 200,
        "width": 120,
        "height": 40,
        "visible": true,
        "display": "inline-block",
        "visibility": "visible",
        "opacity": 1
      },
      "text": {
        "innerText": "Submit",
        "textContent": "Submit",
        "innerHTML": "Submit"
      },
      "attributes": {
        "id": "submit",
        "class": "btn primary",
        "type": "submit"
      },
      "properties": {
        "disabled": false,
        "hidden": false,
        "type": "submit"
      },
      "hierarchy": {
        "parent": "form#login",
        "children": 0,
        "depth": 4
      },
      "styles": {
        "display": "inline-block",
        "visibility": "visible",
        "opacity": "1"
      }
    }
  }
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
| `fullStyles` | boolean,null | Include all computed styles (default: false) |
| `matchedRules` | boolean,null | Include matched CSS rules with specificity (default: false) |
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

### `POST /find`

**Find elements by text content**

Search for elements containing specific text. Saves writing querySelector + filter patterns.

Returns first match by default, or all matches with all:true.

Response: { found: true, selector: "...", element: {...} } or { found: true, elements: [...] }

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `text` | string | Text to search for (substring match) *(required)* |
| `tag` | string,null | Limit to specific tag (button, a, div, etc) |
| `exact` | boolean,null | Require exact text match (default false = substring) |
| `all` | boolean,null | Return all matches (default false = first only) |
| `visible` | boolean,null | Only visible elements (default true) |
| `window` | string,null | Target window ID |

**Examples:**

- **button-by-text**: Find Submit button
  ```json
  {"text":"Submit","tag":"button"}
  ```
- **link-by-text**: Find link by text
  ```json
  {"text":"Learn more","tag":"a"}
  ```
- **exact-match**: Find button with exact "OK" text
  ```json
  {"text":"OK","tag":"button","exact":true}
  ```
- **all-matches**: Find all Delete buttons
  ```json
  {"text":"Delete","tag":"button","all":true}
  ```
- **any-element**: Find any element containing "Error:"
  ```json
  {"text":"Error:"}
  ```

---

### `POST /form`

**Extract all form values as structured JSON**

Get all form field values without needing to know the component's API.

Introspects forms and returns structured data:
- Input values (text, email, password, etc.)
- Checkbox/radio states
- Select values (single and multiple)
- Textarea content
- Custom form elements with value property

Response: { fields: { name: value, ... }, form: { action, method, id } }

Works with standard forms and most framework components (React, Vue, etc).

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string,null | Form selector (default: first form on page) |
| `includeDisabled` | boolean,null | Include disabled fields (default false) |
| `includeHidden` | boolean,null | Include hidden fields (default false) |
| `window` | string,null | Target window ID |

**Examples:**

- **first-form**: Get data from first form
  ```json
  {}
  ```
- **by-id**: Get specific form data
  ```json
  {"selector":"#login-form"}
  ```
- **with-hidden**: Include hidden fields like CSRF tokens
  ```json
  {"selector":"form","includeHidden":true}
  ```

---

## Do Things

### `POST /click`

**Click an element**

Scrolls element into view, then performs full click sequence: mouseenter, mouseover, mousedown, mouseup, click.

Three ways to target elements:
- ref: Ref ID from /tree output (e.g., @1, @42) - fastest, survives DOM changes
- selector: CSS selector (traditional)
- text + tag: Find by text content (more reliable for dynamic UIs)

Options:
- autoWait: Wait for element to appear before clicking (default false). Eliminates need for separate /wait call.
- diff: Return what changed after the click (added/removed elements, attribute changes)

Automatically fails if element is not found or is disabled. Check response.success to verify.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ref` | string,null | Ref ID from /tree output (e.g., @1, @42) - preferred for efficiency |
| `selector` | string,null | CSS selector of element to click |
| `text` | string,null | Text content to find (alternative to selector) |
| `tag` | string,null | Tag name when using text (default: any clickable element) |
| `autoWait` | boolean,null | Wait for element to appear before clicking (default false) |
| `timeout` | number,null | Max wait time in ms when autoWait is true (default 5000) |
| `diff` | boolean,null | Return DOM diff showing what changed after click (default false) |
| `diffDelay` | number,null | Wait ms before capturing "after" state (default 100) |
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
- **by-text**: Click element containing "Save"
  ```json
  {"text":"Save"}
  ```
- **button-by-text**: Click button by text
  ```json
  {"text":"Submit","tag":"button"}
  ```
- **link-by-text**: Click link by text
  ```json
  {"text":"Learn more","tag":"a"}
  ```
- **by-role**: Click by ARIA
  ```json
  {"selector":"[role=\"button\"][aria-label=\"Close\"]"}
  ```
- **with-diff**: Click and see what changed
  ```json
  {"selector":".add-item","diff":true}
  ```
- **auto-wait**: Wait for element then click
  ```json
  {"selector":".modal-button","autoWait":true}
  ```
- **auto-wait-timeout**: Wait up to 10s for element
  ```json
  {"selector":".slow-element","autoWait":true,"timeout":10000}
  ```

---

### `POST /type`

**Type text into an element**

Focus element and type text character by character with realistic event lifecycle.

Target element via ref (from /tree output) or selector.

Simulates real user behavior:
1. Focus via mouse click (default) or keyboard Tab
2. Full keystroke events: keydown → beforeinput → input → keyup
3. Fires change event on completion

Handles native inputs, textareas, contenteditable, and framework-wrapped inputs (React, MUI, etc).

Options:
- autoWait: Wait for element to appear before typing (default false). Eliminates need for separate /wait call.
- humanlike: Add realistic delays and occasional typos (default true)
- focusMode: How to focus the element before typing
  - "mouse" (default): Full mouse lifecycle (mouseenter → click → focus)
  - "keyboard": Tab key navigation (for accessibility testing)
  - "direct": Just .focus() (fast, for simple tests)
- clear: Clear existing content before typing (default false)

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ref` | string,null | Ref ID from /tree output (e.g., @1, @42) - preferred for efficiency |
| `selector` | string,null | CSS selector of input/textarea/contenteditable |
| `text` | string | Text to type *(required)* |
| `autoWait` | boolean,null | Wait for element to appear before typing (default false) |
| `timeout` | number,null | Max wait time in ms when autoWait is true (default 5000) |
| `humanlike` | boolean,null | Human-like delays and typos (default true) |
| `focusMode` | string,null | How to focus: mouse (default), keyboard, or direct |
| `clear` | boolean,null | Clear existing content before typing (default false) |
| `blur` | boolean,null | Blur element after typing to trigger change event (default true) |
| `typoRate` | number,null | Typo probability 0-1 (default 0.03) |
| `minDelay` | number,null | Min ms between keys (default 50) |
| `maxDelay` | number,null | Max ms between keys (default 150) |
| `diff` | boolean,null | Return DOM diff showing what changed after typing (default false) |
| `diffDelay` | number,null | Wait ms before capturing "after" state (default 100) |
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
- **fast-test**: Fast typing for tests
  ```json
  {"selector":"input","text":"hello","humanlike":false,"focusMode":"direct"}
  ```
- **keyboard-focus**: Focus via Tab key
  ```json
  {"selector":"#search","text":"query","focusMode":"keyboard"}
  ```
- **clear-first**: Clear field then type
  ```json
  {"selector":"#name","text":"New Name","clear":true}
  ```
- **contenteditable**: Type into contenteditable
  ```json
  {"selector":"[contenteditable]","text":"Hello world"}
  ```

---

### `POST /key`

**Send keyboard input**

Send key press with full event lifecycle: keydown → keypress → beforeinput → input → keyup.

Target element defaults to document.activeElement. Use ref or selector to focus a specific element first.

Supports modifiers (ctrlKey, shiftKey, altKey, metaKey) and repeat count for holding keys.

Common keys: Enter, Escape, Tab, ArrowUp/Down/Left/Right, Backspace, Delete, Home, End, PageUp/PageDown, F1-F12, or any printable character.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `key` | string | Key to press (e.g., "Enter", "Escape", "a", "ArrowDown") *(required)* |
| `ref` | string,null | Ref ID from /tree output (e.g., @1, @42) - preferred for efficiency |
| `selector` | string,null | Element to focus first (default: activeElement) |
| `ctrlKey` | boolean,null | Hold Ctrl/Control |
| `shiftKey` | boolean,null | Hold Shift |
| `altKey` | boolean,null | Hold Alt/Option |
| `metaKey` | boolean,null | Hold Meta/Command |
| `repeat` | number,null | Repeat count for key hold (default 1) |
| `window` | string,null | Target window ID |

**Examples:**

- **escape**: Close modal/cancel
  ```json
  {"key":"Escape"}
  ```
- **enter**: Submit form
  ```json
  {"key":"Enter"}
  ```
- **save**: Ctrl+S save shortcut
  ```json
  {"key":"s","ctrlKey":true}
  ```
- **tab**: Tab from element
  ```json
  {"key":"Tab","selector":"#first-input"}
  ```
- **shift-tab**: Shift+Tab backwards
  ```json
  {"key":"Tab","shiftKey":true}
  ```
- **arrow-nav**: Navigate down 3 times
  ```json
  {"key":"ArrowDown","repeat":3}
  ```
- **select-all**: Ctrl+A in element
  ```json
  {"key":"a","ctrlKey":true,"selector":"#editor"}
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

### `POST /wait`

**Wait for time, element, or condition**

Flexible wait for async UI scenarios. Multiple modes:

- ms: Wait for a fixed time (simple delay)
- forElement: Poll until element appears (or disappears with hidden:true)
- Both: Wait for element, then add extra ms delay

All modes support timeout (default 5000ms). Returns immediately if condition already met.

Response: { success: true, waited: ms, found?: boolean }

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ms` | number,null | Milliseconds to wait |
| `forElement` | string,null | CSS selector to wait for |
| `hidden` | boolean,null | Wait for element to disappear (default false) |
| `timeout` | number,null | Max wait time in ms (default 5000) |
| `pollInterval` | number,null | Polling interval in ms (default 100) |
| `window` | string,null | Target window ID |

**Examples:**

- **delay**: Simple 500ms delay
  ```json
  {"ms":500}
  ```
- **for-element**: Wait for modal to appear
  ```json
  {"forElement":".modal"}
  ```
- **for-hidden**: Wait for loading to disappear
  ```json
  {"forElement":".loading","hidden":true}
  ```
- **with-timeout**: Wait up to 10s
  ```json
  {"forElement":"button[data-ready]","timeout":10000}
  ```
- **element-plus-delay**: Wait for dropdown, then 100ms for animation
  ```json
  {"forElement":".dropdown","ms":100}
  ```

---

### `POST /call`

**Call a method or get a property on an element**

Call a method or access a property on an element by selector. Convenience wrapper around /eval.

This avoids writing querySelector boilerplate. Two modes:
- With args (even empty []): Calls element.method(...args)
- Without args: Returns element.property value

Return value is JSON-serialized. Promises are awaited.

Response: { success: true, data: <return value> }

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `selector` | string | CSS selector of the element *(required)* |
| `method` | string | Method name to call or property name to get *(required)* |
| `args` | array,null | Arguments to pass (omit to get property value) |
| `window` | string,null | Target window ID |

**Examples:**

- **get-value**: Get input value
  ```json
  {"selector":"#email","method":"value"}
  ```
- **get-checked**: Get checkbox state
  ```json
  {"selector":"#agree","method":"checked"}
  ```
- **get-inner-html**: Get element HTML
  ```json
  {"selector":"#content","method":"innerHTML"}
  ```
- **get-dataset**: Get data attributes
  ```json
  {"selector":"#item","method":"dataset"}
  ```
- **get-open**: Check if dialog is open
  ```json
  {"selector":"dialog","method":"open"}
  ```
- **show-popover**: Show a popover element
  ```json
  {"selector":"#my-popover","method":"showPopover","args":[]}
  ```
- **hide-popover**: Hide a popover element
  ```json
  {"selector":"#my-popover","method":"hidePopover","args":[]}
  ```
- **play-video**: Play a video element
  ```json
  {"selector":"video","method":"play","args":[]}
  ```
- **focus**: Focus an input element
  ```json
  {"selector":"#email","method":"focus","args":[]}
  ```
- **scroll-into-view**: Scroll with options
  ```json
  {"selector":"#section","method":"scrollIntoView","args":[{"behavior":"smooth"}]}
  ```
- **set-attribute**: Set an attribute
  ```json
  {"selector":"#btn","method":"setAttribute","args":["disabled","true"]}
  ```
- **get-bounding-rect**: Get element geometry
  ```json
  {"selector":"#box","method":"getBoundingClientRect","args":[]}
  ```

---

## Navigate

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

Hard reload the current page, bypassing cache. Use soft: true for cache-friendly reload.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `soft` | boolean,null | Use cached resources if available (default false = hard refresh) |
| `window` | string,null | Target window ID |

**Examples:**

- **hard**: Hard refresh (default, bypasses cache)
  ```json
  {}
  ```
- **soft**: Soft refresh (uses cache)
  ```json
  {"soft":true}
  ```

---

### `GET /location`

**Get current URL and title**

Returns current page info.

Response: { url, title, pathname, search, hash }

Use after /navigate to verify you're on the expected page.

---

## Watch What Happens

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

## Watch DOM Changes

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

## User Selection

### `POST /select`

**Interactive element selection**

Let user point at elements on the page instead of writing selectors.

Actions:
- start: Begin selection mode (user can draw a rectangle)
- result: Get elements from completed selection
- cancel: Exit selection mode without capturing
- clear: Clear stored selection result
- status: Check if selection is active

Workflow: start → (user draws region) → result → use returned selectors

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `action` | string,null | Selection action to perform (default: result) |
| `window` | string,null | Target window ID |

**Examples:**

- **start**: Begin selection mode
  ```json
  {"action":"start"}
  ```
- **result**: Get selected elements
  ```json
  {"action":"result"}
  ```
- **status**: Check if selection is active
  ```json
  {"action":"status"}
  ```

---

### `POST /select/start`

**[Deprecated] Use /select with action:"start"**

Deprecated: Use POST /select {"action":"start"} instead.

---

### `POST /select/cancel`

**[Deprecated] Use /select with action:"cancel"**

Deprecated: Use POST /select {"action":"cancel"} instead.

---

### `GET /select/status`

**[Deprecated] Use /select with action:"status"**

Deprecated: Use POST /select {"action":"status"} instead.

---

### `GET /select/result`

**[Deprecated] Use /select with action:"result"**

Deprecated: Use POST /select {"action":"result"} instead.

---

### `POST /select/clear`

**[Deprecated] Use /select with action:"clear"**

Deprecated: Use POST /select {"action":"clear"} instead.

---

## Multiple Tabs

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

## Record & Replay

### `POST /recording`

**Record user actions and generate tests**

Record user interactions and convert them to runnable tests.

Actions:
- start: Begin capturing user interactions
- stop: Stop capturing, returns recorded events
- generate: Convert recording to JSON test format
- list: List all saved recordings

Workflow: start → (user interacts) → stop → generate → run with /test

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `action` | string | Recording action to perform *(required)* |
| `name` | string,null | Test name (for generate action) |
| `window` | string,null | Target window ID |

**Examples:**

- **start**: Begin recording
  ```json
  {"action":"start"}
  ```
- **stop**: Stop and get events
  ```json
  {"action":"stop"}
  ```
- **generate**: Generate test from recording
  ```json
  {"action":"generate","name":"Login flow"}
  ```
- **list**: List saved recordings
  ```json
  {"action":"list"}
  ```

---

### `POST /recording/start`

**[Deprecated] Use /recording with action:"start"**

Deprecated: Use POST /recording {"action":"start"} instead.

---

### `POST /recording/stop`

**[Deprecated] Use /recording with action:"stop"**

Deprecated: Use POST /recording {"action":"stop"} instead.

---

### `POST /recording/generate`

**[Deprecated] Use /recording with action:"generate"**

Deprecated: Use POST /recording {"action":"generate"} instead.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `name` | string,null | Test name |

---

### `GET /recordings`

**[Deprecated] Use /recording with action:"list"**

Deprecated: Use POST /recording {"action":"list"} instead.

---

## Run Tests

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

## Escape Hatches

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

Works automatically in the Haltija Desktop app. In browser widget mode, captures viewport only.

Response: { success, image: "data:image/png;base64,...", width, height, source }

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
