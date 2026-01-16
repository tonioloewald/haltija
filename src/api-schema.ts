/**
 * Haltija API Schema Definitions
 * 
 * Single source of truth for:
 * - Server request validation
 * - API documentation generation  
 * - MCP tool definitions
 * - Self-documenting endpoints (GET returns schema, POST executes)
 * 
 * Uses tosijs-schema for JSON Schema generation with TypeScript inference.
 */

import { s, type Infer } from 'tosijs-schema'

// ============================================
// Endpoint Definition Type
// ============================================

/** Example of valid input for an endpoint */
export interface EndpointExample<T = any> {
  name: string              // Short identifier for the example
  input: T                  // Valid input object
  description?: string      // What this example demonstrates
  response?: any            // Example response (for documentation)
  curl?: string             // Example curl command (for documentation)
}

/** Example of invalid input (for test generation) */
export interface InvalidExample {
  name?: string             // Optional identifier
  input: any                // Invalid input object
  error: string             // Expected error substring
}

export interface EndpointDef<TInput = any> {
  path: string
  method: 'GET' | 'POST'
  summary: string           // One-line description
  description?: string      // Detailed description for docs
  input?: { schema: any, validate: (data: any, opts?: any) => boolean }
  examples?: EndpointExample<TInput>[]      // Valid input examples
  invalidExamples?: InvalidExample[]        // Invalid inputs for testing
  category?: string         // Grouping for docs (interaction, dom, events, etc.)
}

// Helper to create endpoint with proper typing
function endpoint<T>(def: EndpointDef<T>): EndpointDef<T> {
  return def
}

// ============================================
// DOM Endpoints
// ============================================
// 
// Choosing the right DOM tool:
// - /tree: Get page structure overview. Start here to understand layout.
// - /query: Quick check if element exists, get basic info (tag, id, class, text).
// - /inspect: Deep dive on ONE element (styles, ARIA, geometry, state).
// - /inspectAll: Deep dive on MULTIPLE elements (e.g., all buttons on page).
//
// Typical workflow: tree (overview) → query (find target) → inspect (verify) → click/type

export const tree = endpoint({
  path: '/tree',
  method: 'POST',
  summary: 'Get DOM tree structure',
  description: `Returns hierarchical view of page elements. Best for understanding page structure before interacting.

Response structure:
  { tag, id?, classes?, attrs?, text?, value?, checked?, children?, flags?: { interactive, hidden, hasAria, ... } }

Flags help identify interactive elements (buttons, inputs) and hidden content.
Form inputs include live value/checked state (not just HTML attribute).

Use ancestors:true to see parent elements when inspecting deep elements.`,
  category: 'dom',
  input: s.object({
    selector: s.string.describe('Root element selector').optional,
    depth: s.number.describe('Max depth (-1 = unlimited, default 3)').optional,
    includeText: s.boolean.describe('Include text content (default true)').optional,
    visibleOnly: s.boolean.describe('Only visible elements (default false)').optional,
    pierceShadow: s.boolean.describe('Pierce shadow DOM (default true)').optional,
    compact: s.boolean.describe('Minimal output (default false)').optional,
    ancestors: s.boolean.describe('Include ancestor path from root (default false)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'overview', input: { depth: 2 }, description: 'Quick page overview' },
    { name: 'form-only', input: { selector: 'form', depth: -1 }, description: 'Full form structure' },
    { name: 'visible-buttons', input: { selector: 'body', visibleOnly: true, depth: 4 }, description: 'Find visible interactive elements' },
    { name: 'with-context', input: { selector: '#deep-element', ancestors: true }, description: 'See element with parent context' },
  ],
})

export const query = endpoint({
  path: '/query',
  method: 'POST',
  summary: 'Query DOM elements by selector',
  description: `Quick element lookup. Returns basic info: tagName, id, className, textContent, attributes.

Use this to check if an element exists before clicking/typing. For detailed info, use /inspect instead.

Response: { tagName, id, className, textContent, attributes: {...} }`,
  category: 'dom',
  input: s.object({
    selector: s.string.describe('CSS selector'),
    all: s.boolean.describe('Return all matches (default false = first only)').optional,
  }),
  examples: [
    { 
      name: 'by-id', 
      input: { selector: '#submit-btn' }, 
      description: 'Find element by ID',
      response: {
        success: true,
        data: {
          tagName: 'button',
          id: 'submit-btn',
          className: 'btn primary',
          textContent: 'Submit',
          attributes: { id: 'submit-btn', class: 'btn primary', type: 'submit' }
        }
      }
    },
    { name: 'all-inputs', input: { selector: 'input[type="text"]', all: true }, description: 'Find all text inputs' },
  ],
  invalidExamples: [
    { name: 'missing-selector', input: {}, error: 'selector is required' },
    { name: 'wrong-type', input: { selector: 123 }, error: 'selector must be string' },
  ],
})

export const inspect = endpoint({
  path: '/inspect',
  method: 'POST',
  summary: 'Deep inspection of an element',
  description: `Get everything about ONE element: geometry, computed styles, ARIA attributes, scroll position, visibility state.

Response includes:
  - box: { x, y, width, height, visible }
  - text: { innerText, value, placeholder }
  - properties: { disabled, checked, hidden, role, ariaLabel, ... }
  - styles: { display, visibility, opacity, ... } (curated subset)
  - allStyles: { ...all computed styles } (only if fullStyles=true)
  - matchedRules: [ { selector, source, specificity, properties } ] (only if matchedRules=true)
  - hierarchy: { parent, children count, depth }

Use before clicking to verify element is visible and enabled.`,
  category: 'dom',
  input: s.object({
    selector: s.string.describe('CSS selector'),
    fullStyles: s.boolean.describe('Include all computed styles (default: false)').optional,
    matchedRules: s.boolean.describe('Include matched CSS rules with specificity (default: false)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { 
      name: 'check-button', 
      input: { selector: '#submit' }, 
      description: 'Verify button is clickable',
      response: {
        success: true,
        data: {
          selector: 'body > form > button#submit',
          tagName: 'button',
          classList: ['btn', 'primary'],
          box: { x: 100, y: 200, width: 120, height: 40, visible: true, display: 'inline-block', visibility: 'visible', opacity: 1 },
          text: { innerText: 'Submit', textContent: 'Submit', innerHTML: 'Submit' },
          attributes: { id: 'submit', class: 'btn primary', type: 'submit' },
          properties: { disabled: false, hidden: false, type: 'submit' },
          hierarchy: { parent: 'form#login', children: 0, depth: 4 },
          styles: { display: 'inline-block', visibility: 'visible', opacity: '1' }
        }
      }
    },
    { name: 'check-input', input: { selector: 'input[name="email"]' }, description: 'Get input state and value' },
  ],
  invalidExamples: [
    { name: 'missing-selector', input: {}, error: 'selector is required' },
  ],
})

export const inspectAll = endpoint({
  path: '/inspectAll',
  method: 'POST',
  summary: 'Inspect multiple elements',
  description: `Deep inspection of ALL elements matching selector (up to limit).

Same detailed info as /inspect, but for multiple elements. Great for:
  - Finding all buttons/links on a page
  - Checking which form fields are required
  - Listing all interactive elements

Response: array of inspection objects`,
  category: 'dom',
  input: s.object({
    selector: s.string.describe('CSS selector'),
    limit: s.number.describe('Max elements (default 10)').optional,
    fullStyles: s.boolean.describe('Include all computed styles (default: false)').optional,
    matchedRules: s.boolean.describe('Include matched CSS rules with specificity (default: false)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'all-buttons', input: { selector: 'button, [role="button"]', limit: 20 }, description: 'Find all clickable buttons' },
    { name: 'form-fields', input: { selector: 'input, select, textarea' }, description: 'List all form inputs' },
    { name: 'nav-links', input: { selector: 'nav a', limit: 15 }, description: 'Get navigation links' },
  ],
})

// ============================================
// Interaction Endpoints
// ============================================
//
// These simulate real user interactions. Elements are auto-scrolled into view.
// Use /inspect first to verify element is visible and enabled.

export const click = endpoint({
  path: '/click',
  method: 'POST',
  summary: 'Click an element',
  description: `Scrolls element into view, then performs full click sequence: mouseenter, mouseover, mousedown, mouseup, click.

Two ways to target elements:
- selector: CSS selector (traditional)
- text + tag: Find by text content (more reliable for dynamic UIs)

Automatically fails if element is not found or is disabled. Check response.success to verify.

With diff:true, returns what changed after the click - added/removed elements, attribute changes, focus, scroll.`,
  category: 'interaction',
  input: s.object({
    selector: s.string.describe('CSS selector of element to click').optional,
    text: s.string.describe('Text content to find (alternative to selector)').optional,
    tag: s.string.describe('Tag name when using text (default: any clickable element)').optional,
    diff: s.boolean.describe('Return DOM diff showing what changed after click (default false)').optional,
    diffDelay: s.number.describe('Wait ms before capturing "after" state (default 100)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'by-id', input: { selector: '#submit' }, description: 'Click button by ID' },
    { name: 'by-class', input: { selector: '.btn-primary' }, description: 'Click by class' },
    { name: 'by-text', input: { text: 'Save' }, description: 'Click element containing "Save"' },
    { name: 'button-by-text', input: { text: 'Submit', tag: 'button' }, description: 'Click button by text' },
    { name: 'link-by-text', input: { text: 'Learn more', tag: 'a' }, description: 'Click link by text' },
    { name: 'by-role', input: { selector: '[role="button"][aria-label="Close"]' }, description: 'Click by ARIA' },
    { name: 'with-diff', input: { selector: '.add-item', diff: true }, description: 'Click and see what changed' },
  ],
  invalidExamples: [
    { name: 'missing-both', input: {}, error: 'selector or text is required' },
    { name: 'wrong-type', input: { selector: 123 }, error: 'selector must be string' },
  ],
})

export const type = endpoint({
  path: '/type',
  method: 'POST',
  summary: 'Type text into an element',
  description: `Focus element and type text character by character with realistic event lifecycle.

Simulates real user behavior:
1. Focus via mouse click (default) or keyboard Tab
2. Full keystroke events: keydown → beforeinput → input → keyup
3. Fires change event on completion

Handles native inputs, textareas, contenteditable, and framework-wrapped inputs (React, MUI, etc).

Options:
- humanlike: Add realistic delays and occasional typos (default true)
- focusMode: How to focus the element before typing
  - "mouse" (default): Full mouse lifecycle (mouseenter → click → focus)
  - "keyboard": Tab key navigation (for accessibility testing)
  - "direct": Just .focus() (fast, for simple tests)
- clear: Clear existing content before typing (default false)`,
  category: 'interaction',
  input: s.object({
    selector: s.string.describe('CSS selector of input/textarea/contenteditable'),
    text: s.string.describe('Text to type'),
    humanlike: s.boolean.describe('Human-like delays and typos (default true)').optional,
    focusMode: s.enum(['mouse', 'keyboard', 'direct'] as const).describe('How to focus: mouse (default), keyboard, or direct').optional,
    clear: s.boolean.describe('Clear existing content before typing (default false)').optional,
    blur: s.boolean.describe('Blur element after typing to trigger change event (default true)').optional,
    typoRate: s.number.describe('Typo probability 0-1 (default 0.03)').optional,
    minDelay: s.number.describe('Min ms between keys (default 50)').optional,
    maxDelay: s.number.describe('Max ms between keys (default 150)').optional,
    diff: s.boolean.describe('Return DOM diff showing what changed after typing (default false)').optional,
    diffDelay: s.number.describe('Wait ms before capturing "after" state (default 100)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'email', input: { selector: '#email', text: 'user@example.com' }, description: 'Type email address' },
    { name: 'password', input: { selector: 'input[type="password"]', text: 'secret123' }, description: 'Type password' },
    { name: 'fast-test', input: { selector: 'input', text: 'hello', humanlike: false, focusMode: 'direct' }, description: 'Fast typing for tests' },
    { name: 'keyboard-focus', input: { selector: '#search', text: 'query', focusMode: 'keyboard' }, description: 'Focus via Tab key' },
    { name: 'clear-first', input: { selector: '#name', text: 'New Name', clear: true }, description: 'Clear field then type' },
    { name: 'contenteditable', input: { selector: '[contenteditable]', text: 'Hello world' }, description: 'Type into contenteditable' },
  ],
  invalidExamples: [
    { name: 'missing-text', input: { selector: '#input' }, error: 'text is required' },
    { name: 'missing-selector', input: { text: 'hello' }, error: 'selector is required' },
  ],
})

export const drag = endpoint({
  path: '/drag',
  method: 'POST',
  summary: 'Drag from an element',
  description: `Simulates drag gesture: mousedown on element, mousemove by delta, mouseup.

Good for: sliders, resize handles, drag-and-drop reordering, range inputs.`,
  category: 'interaction',
  input: s.object({
    selector: s.string.describe('CSS selector of drag handle'),
    deltaX: s.number.describe('Horizontal distance in pixels').optional,
    deltaY: s.number.describe('Vertical distance in pixels').optional,
    duration: s.number.describe('Drag duration in ms (default 300)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'slider-right', input: { selector: '.slider-handle', deltaX: 100 }, description: 'Move slider right' },
    { name: 'resize', input: { selector: '.resize-handle', deltaX: 50, deltaY: 50 }, description: 'Resize element' },
    { name: 'reorder', input: { selector: '.drag-item', deltaY: 80 }, description: 'Drag item down in list' },
  ],
  invalidExamples: [
    { name: 'missing-selector', input: { deltaX: 100 }, error: 'selector is required' },
  ],
})

export const highlight = endpoint({
  path: '/highlight',
  method: 'POST',
  summary: 'Visually highlight an element',
  description: `Draw attention to an element with colored border and optional label.

Great for showing users what you found or pointing out issues. Use /unhighlight to remove.`,
  category: 'interaction',
  input: s.object({
    selector: s.string.describe('CSS selector'),
    label: s.string.describe('Label text to show').optional,
    color: s.string.describe('CSS color (default #6366f1)').optional,
    duration: s.number.describe('Auto-hide after ms (omit for manual)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'point-out', input: { selector: '#login-btn', label: 'Click here' }, description: 'Show user where to click' },
    { name: 'error-red', input: { selector: '.error', label: 'Problem', color: '#ef4444' }, description: 'Highlight error in red' },
    { name: 'temporary', input: { selector: 'button', duration: 3000 }, description: 'Auto-hide after 3s' },
  ],
  invalidExamples: [
    { name: 'missing-selector', input: {}, error: 'selector is required' },
  ],
})

export const unhighlight = endpoint({
  path: '/unhighlight',
  method: 'POST',
  summary: 'Remove highlight',
  description: 'Remove any active highlight overlay created by /highlight.',
  category: 'interaction',
  input: s.object({}),
})

export const scroll = endpoint({
  path: '/scroll',
  method: 'POST',
  summary: 'Scroll to element or position',
  description: `Smooth scroll with natural easing. Multiple modes:

- selector: Scroll element into view (most common)
- x/y: Scroll to absolute position
- deltaX/deltaY: Scroll relative to current position

At least one of selector, x, y, deltaX, or deltaY must be provided.`,
  category: 'interaction',
  input: s.object({
    selector: s.string.describe('CSS selector to scroll into view').optional,
    x: s.number.describe('Absolute X position in pixels').optional,
    y: s.number.describe('Absolute Y position in pixels').optional,
    deltaX: s.number.describe('Relative horizontal scroll in pixels').optional,
    deltaY: s.number.describe('Relative vertical scroll in pixels').optional,
    duration: s.number.describe('Animation duration in ms (default 500)').optional,
    easing: s.string.describe('Easing function: ease-out (default), ease-in-out, linear').optional,
    block: s.string.describe('Vertical alignment: center (default), start, end, nearest').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'to-element', input: { selector: '#pricing' }, description: 'Scroll pricing section into view' },
    { name: 'to-top', input: { y: 0 }, description: 'Scroll to top of page' },
    { name: 'to-bottom', input: { selector: 'footer' }, description: 'Scroll to footer' },
    { name: 'down-500', input: { deltaY: 500 }, description: 'Scroll down 500px' },
    { name: 'slow-scroll', input: { selector: '#section', duration: 1000, easing: 'ease-in-out' }, description: 'Slow animated scroll' },
  ],
})

// ============================================
// Navigation Endpoints
// ============================================

export const wait = endpoint({
  path: '/wait',
  method: 'POST',
  summary: 'Wait for time, element, or condition',
  description: `Flexible wait for async UI scenarios. Multiple modes:

- ms: Wait for a fixed time (simple delay)
- forElement: Poll until element appears (or disappears with hidden:true)
- Both: Wait for element, then add extra ms delay

All modes support timeout (default 5000ms). Returns immediately if condition already met.

Response: { success: true, waited: ms, found?: boolean }`,
  category: 'interaction',
  input: s.object({
    ms: s.number.describe('Milliseconds to wait').optional,
    forElement: s.string.describe('CSS selector to wait for').optional,
    hidden: s.boolean.describe('Wait for element to disappear (default false)').optional,
    timeout: s.number.describe('Max wait time in ms (default 5000)').optional,
    pollInterval: s.number.describe('Polling interval in ms (default 100)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'delay', input: { ms: 500 }, description: 'Simple 500ms delay' },
    { name: 'for-element', input: { forElement: '.modal' }, description: 'Wait for modal to appear' },
    { name: 'for-hidden', input: { forElement: '.loading', hidden: true }, description: 'Wait for loading to disappear' },
    { name: 'with-timeout', input: { forElement: 'button[data-ready]', timeout: 10000 }, description: 'Wait up to 10s' },
    { name: 'element-plus-delay', input: { forElement: '.dropdown', ms: 100 }, description: 'Wait for dropdown, then 100ms for animation' },
  ],
})

export const formData = endpoint({
  path: '/form',
  method: 'POST',
  summary: 'Extract all form values as structured JSON',
  description: `Get all form field values without needing to know the component's API.

Introspects forms and returns structured data:
- Input values (text, email, password, etc.)
- Checkbox/radio states
- Select values (single and multiple)
- Textarea content
- Custom form elements with value property

Response: { fields: { name: value, ... }, form: { action, method, id } }

Works with standard forms and most framework components (React, Vue, etc).`,
  category: 'dom',
  input: s.object({
    selector: s.string.describe('Form selector (default: first form on page)').optional,
    includeDisabled: s.boolean.describe('Include disabled fields (default false)').optional,
    includeHidden: s.boolean.describe('Include hidden fields (default false)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'first-form', input: {}, description: 'Get data from first form' },
    { name: 'by-id', input: { selector: '#login-form' }, description: 'Get specific form data' },
    { name: 'with-hidden', input: { selector: 'form', includeHidden: true }, description: 'Include hidden fields like CSRF tokens' },
  ],
})

export const find = endpoint({
  path: '/find',
  method: 'POST',
  summary: 'Find elements by text content',
  description: `Search for elements containing specific text. Saves writing querySelector + filter patterns.

Returns first match by default, or all matches with all:true.

Response: { found: true, selector: "...", element: {...} } or { found: true, elements: [...] }`,
  category: 'dom',
  input: s.object({
    text: s.string.describe('Text to search for (substring match)'),
    tag: s.string.describe('Limit to specific tag (button, a, div, etc)').optional,
    exact: s.boolean.describe('Require exact text match (default false = substring)').optional,
    all: s.boolean.describe('Return all matches (default false = first only)').optional,
    visible: s.boolean.describe('Only visible elements (default true)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'button-by-text', input: { text: 'Submit', tag: 'button' }, description: 'Find Submit button' },
    { name: 'link-by-text', input: { text: 'Learn more', tag: 'a' }, description: 'Find link by text' },
    { name: 'exact-match', input: { text: 'OK', tag: 'button', exact: true }, description: 'Find button with exact "OK" text' },
    { name: 'all-matches', input: { text: 'Delete', tag: 'button', all: true }, description: 'Find all Delete buttons' },
    { name: 'any-element', input: { text: 'Error:' }, description: 'Find any element containing "Error:"' },
  ],
  invalidExamples: [
    { name: 'missing-text', input: { tag: 'button' }, error: 'text is required' },
  ],
})

export const navigate = endpoint({
  path: '/navigate',
  method: 'POST',
  summary: 'Navigate to a URL',
  description: `Navigate the browser to a new URL. Waits for page load to complete.

Use /location after to verify navigation succeeded.`,
  category: 'navigation',
  input: s.object({
    url: s.string.describe('URL to navigate to'),
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'full-url', input: { url: 'https://example.com/login' }, description: 'Navigate to full URL' },
    { name: 'relative', input: { url: '/dashboard' }, description: 'Navigate to relative path' },
  ],
  invalidExamples: [
    { name: 'missing-url', input: {}, error: 'url is required' },
  ],
})

export const refresh = endpoint({
  path: '/refresh',
  method: 'POST',
  summary: 'Refresh the page',
  description: 'Reload the current page. Use hard: true to bypass cache.',
  category: 'navigation',
  input: s.object({
    hard: s.boolean.describe('Bypass cache (default false)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'soft', input: {}, description: 'Normal refresh' },
    { name: 'hard', input: { hard: true }, description: 'Bypass cache' },
  ],
})

export const location = endpoint({
  path: '/location',
  method: 'GET',
  summary: 'Get current URL and title',
  description: `Returns current page info.

Response: { url, title, pathname, search, hash }

Use after /navigate to verify you're on the expected page.`,
  category: 'navigation',
})

// ============================================
// Mutation Watching
// ============================================
//
// Mutations vs Events:
// - /mutations/watch: Low-level DOM changes (elements added/removed, attributes changed)
// - /events/watch: High-level semantic events (user typed, clicked, scrolled)
//
// Use mutations for: detecting dynamic content loading, watching for error messages
// Use events for: tracking user behavior, recording interactions

export const mutationsWatch = endpoint({
  path: '/mutations/watch',
  method: 'POST',
  summary: 'Start watching DOM mutations',
  description: `Begin capturing DOM changes: elements added/removed, attributes changed, text modified.

Presets filter out framework noise:
- smart (default): Auto-detects React, Tailwind, etc.
- minimal: Only element add/remove
- none: Everything (noisy)

Get captured mutations via /mutations/status.`,
  category: 'mutations',
  input: s.object({
    root: s.string.describe('Root selector to watch (default body)').optional,
    childList: s.boolean.describe('Watch child additions/removals (default true)').optional,
    attributes: s.boolean.describe('Watch attribute changes (default true)').optional,
    characterData: s.boolean.describe('Watch text content changes (default false)').optional,
    subtree: s.boolean.describe('Watch all descendants (default true)').optional,
    debounce: s.number.describe('Debounce ms (default 100)').optional,
    preset: s.string.describe('Filter preset: smart, xinjs, b8rjs, tailwind, react, minimal, none').optional,
    filters: s.any.describe('Custom filter configuration').optional,
    pierceShadow: s.boolean.describe('Watch inside shadow DOM (default false)').optional,
  }),
  examples: [
    { name: 'default', input: {}, description: 'Watch all DOM changes with smart filtering' },
    { name: 'form-only', input: { root: 'form', preset: 'minimal' }, description: 'Watch form for new elements' },
    { name: 'react-app', input: { preset: 'react' }, description: 'Filter React internals' },
  ],
})

export const mutationsUnwatch = endpoint({
  path: '/mutations/unwatch',
  method: 'POST',
  summary: 'Stop watching mutations',
  description: 'Stop capturing DOM mutations. Call this when done to free resources.',
  category: 'mutations',
  input: s.object({}),
})

export const mutationsStatus = endpoint({
  path: '/mutations/status',
  method: 'GET',
  summary: 'Get mutation watch status',
  description: `Check if mutation watching is active and get captured mutations.

Response: { watching: boolean, mutations: [...], summary: { added, removed, changed } }`,
  category: 'mutations',
})

// ============================================
// Event Watching
// ============================================

export const eventsWatch = endpoint({
  path: '/events/watch',
  method: 'POST',
  summary: 'Start watching semantic events',
  description: `Begin capturing high-level user actions. Events are aggregated and meaningful:
- "user typed 'hello@example.com'" not 18 keydown events
- "user clicked Submit" not mousedown/mouseup/click

Presets control verbosity:
- minimal: clicks, submits, navigation only
- interactive: + hovers on buttons, form changes (recommended)
- detailed: + all element interactions
- debug: everything

Categories: interaction, navigation, input, hover, scroll, mutation, focus, console`,
  category: 'events',
  input: s.object({
    preset: s.string.describe('Verbosity: minimal, interactive, detailed, debug').optional,
    categories: s.array(s.string).describe('Specific categories to watch').optional,
  }),
  examples: [
    { name: 'default', input: { preset: 'interactive' }, description: 'Recommended for most use cases' },
    { name: 'minimal', input: { preset: 'minimal' }, description: 'Only clicks and navigation' },
    { name: 'custom', input: { categories: ['interaction', 'input', 'console'] }, description: 'Specific categories' },
  ],
})

export const eventsUnwatch = endpoint({
  path: '/events/unwatch',
  method: 'POST',
  summary: 'Stop watching events',
  description: 'Stop capturing semantic events. Events buffer is cleared.',
  category: 'events',
  input: s.object({}),
})

export const events = endpoint({
  path: '/events',
  method: 'GET',
  summary: 'Get captured semantic events',
  description: `Returns buffered events since watch started.

Response: { events: [{ type, timestamp, category, target?, payload }], since, count }

Event types: interaction:click, input:typed, navigation:navigate, hover:dwell, scroll:stop, etc.`,
  category: 'events',
})

export const eventsStats = endpoint({
  path: '/events/stats',
  method: 'GET',
  summary: 'Get event aggregation statistics',
  description: `Shows noise reduction metrics.

Response: { rawEvents, semanticEvents, reductionPercent, byCategory: {...} }

Typically see 90%+ reduction (e.g., 2000 raw events → 80 semantic events).`,
  category: 'events',
})

// ============================================
// Console & Eval
// ============================================

export const console_ = endpoint({
  path: '/console',
  method: 'GET',
  summary: 'Get console output',
  description: `Returns captured console.log/warn/error/info from the page.

Response: { entries: [{ level, message, timestamp, stack? }] }

Great for debugging - check for errors after actions fail.`,
  category: 'debug',
})

export const eval_ = endpoint({
  path: '/eval',
  method: 'POST',
  summary: 'Execute JavaScript',
  description: `Run arbitrary JavaScript in the browser context. Returns the result.

The code runs in the page's context with access to window, document, etc.
Return values are JSON-serialized. Promises are awaited.`,
  category: 'debug',
  input: s.object({
    code: s.string.describe('JavaScript code to execute'),
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'get-title', input: { code: 'document.title' }, description: 'Get page title' },
    { name: 'count-items', input: { code: 'document.querySelectorAll(".item").length' }, description: 'Count elements' },
    { name: 'get-value', input: { code: 'document.querySelector("#email").value' }, description: 'Get input value' },
    { name: 'check-state', input: { code: 'window.localStorage.getItem("token") !== null' }, description: 'Check auth state' },
    { name: 'scroll-position', input: { code: '({ x: window.scrollX, y: window.scrollY })' }, description: 'Get scroll position' },
  ],
  invalidExamples: [
    { name: 'missing-code', input: {}, error: 'code is required' },
  ],
})

export const call = endpoint({
  path: '/call',
  method: 'POST',
  summary: 'Call a method or get a property on an element',
  description: `Call a method or access a property on an element by selector. Convenience wrapper around /eval.

This avoids writing querySelector boilerplate. Two modes:
- With args (even empty []): Calls element.method(...args) 
- Without args: Returns element.property value

Return value is JSON-serialized. Promises are awaited.

Response: { success: true, data: <return value> }`,
  category: 'interaction',
  input: s.object({
    selector: s.string.describe('CSS selector of the element'),
    method: s.string.describe('Method name to call or property name to get'),
    args: s.array(s.any).describe('Arguments to pass (omit to get property value)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    // Property access (no args)
    { name: 'get-value', input: { selector: '#email', method: 'value' }, description: 'Get input value' },
    { name: 'get-checked', input: { selector: '#agree', method: 'checked' }, description: 'Get checkbox state' },
    { name: 'get-inner-html', input: { selector: '#content', method: 'innerHTML' }, description: 'Get element HTML' },
    { name: 'get-dataset', input: { selector: '#item', method: 'dataset' }, description: 'Get data attributes' },
    { name: 'get-open', input: { selector: 'dialog', method: 'open' }, description: 'Check if dialog is open' },
    // Method calls (with args, even empty)
    { name: 'show-popover', input: { selector: '#my-popover', method: 'showPopover', args: [] }, description: 'Show a popover element' },
    { name: 'hide-popover', input: { selector: '#my-popover', method: 'hidePopover', args: [] }, description: 'Hide a popover element' },
    { name: 'play-video', input: { selector: 'video', method: 'play', args: [] }, description: 'Play a video element' },
    { name: 'focus', input: { selector: '#email', method: 'focus', args: [] }, description: 'Focus an input element' },
    { name: 'scroll-into-view', input: { selector: '#section', method: 'scrollIntoView', args: [{ behavior: 'smooth' }] }, description: 'Scroll with options' },
    { name: 'set-attribute', input: { selector: '#btn', method: 'setAttribute', args: ['disabled', 'true'] }, description: 'Set an attribute' },
    { name: 'get-bounding-rect', input: { selector: '#box', method: 'getBoundingClientRect', args: [] }, description: 'Get element geometry' },
  ],
  invalidExamples: [
    { name: 'missing-selector', input: { method: 'click' }, error: 'selector is required' },
    { name: 'missing-method', input: { selector: '#btn' }, error: 'method is required' },
  ],
})

// ============================================
// Screenshots
// ============================================

export const screenshot = endpoint({
  path: '/screenshot',
  method: 'POST',
  summary: 'Capture a screenshot',
  description: `Capture the page or a specific element as base64 PNG/WebP/JPEG.

Response: { success, image: "data:image/png;base64,...", width, height, source }

Source indicates capture method: "electron" (best), "html2canvas", or "viewport-only".`,
  category: 'debug',
  input: s.object({
    selector: s.string.describe('Element to capture (omit for full page)').optional,
    scale: s.number.describe('Scale factor (default 1)').optional,
    maxWidth: s.number.describe('Max width in pixels').optional,
    maxHeight: s.number.describe('Max height in pixels').optional,
  }),
  examples: [
    { name: 'full-page', input: {}, description: 'Capture entire page' },
    { name: 'element', input: { selector: '#chart' }, description: 'Capture specific element' },
    { name: 'thumbnail', input: { scale: 0.5, maxWidth: 400 }, description: 'Small thumbnail' },
  ],
})

// ============================================
// Selection Tool
// ============================================
//
// Interactive selection lets users point at elements instead of writing selectors.
// Workflow: selectStart → (user draws region) → selectResult → use elements

export const selectStart = endpoint({
  path: '/select/start',
  method: 'POST',
  summary: 'Start interactive selection',
  description: `Let user drag to select a region on the page.

After calling this, the user can draw a rectangle on the page.
Call /select/result to get the elements within the selection.

Response: { success: true, message: "Selection mode active" }`,
  category: 'selection',
  input: s.object({}),
})

export const selectCancel = endpoint({
  path: '/select/cancel',
  method: 'POST',
  summary: 'Cancel selection mode',
  description: 'Exit selection mode without capturing. Use if user changed their mind.',
  category: 'selection',
  input: s.object({}),
})

export const selectStatus = endpoint({
  path: '/select/status',
  method: 'GET',
  summary: 'Check if selection is active',
  description: `Check whether selection mode is currently active.

Response: { active: boolean, hasResult: boolean }`,
  category: 'selection',
})

export const selectResult = endpoint({
  path: '/select/result',
  method: 'GET',
  summary: 'Get selection result',
  description: `After user completes selection, returns the region and elements within.

Response: { bounds: { x, y, width, height }, elements: [{ selector, tagName, text, ... }] }

Use the selectors from this response in subsequent /click or /type calls.`,
  category: 'selection',
})

export const selectClear = endpoint({
  path: '/select/clear',
  method: 'POST',
  summary: 'Clear selection result',
  description: 'Clear any stored selection result. Use before starting a new selection.',
  category: 'selection',
  input: s.object({}),
})

// ============================================
// Windows / Tabs
// ============================================
//
// Multi-window support. Use /windows to list connected browsers/tabs.
// Desktop app: can open/close/focus tabs directly.
// Browser widget: each tab with widget injected appears as a window.

export const windows = endpoint({
  path: '/windows',
  method: 'GET',
  summary: 'List connected windows',
  description: `Returns all connected browser windows/tabs with IDs, URLs, and titles.

Response: { windows: [{ id, url, title, focused }] }

Use window IDs in other endpoints (e.g., /click, /tree) to target specific tabs.`,
  category: 'windows',
})

export const tabsOpen = endpoint({
  path: '/tabs/open',
  method: 'POST',
  summary: 'Open a new tab',
  description: `Desktop app only. Opens a new tab with optional URL.

If url is omitted, opens a blank tab. The new tab gets the widget auto-injected.`,
  category: 'windows',
  input: s.object({
    url: s.string.describe('URL to open').optional,
  }),
  examples: [
    { name: 'blank', input: {}, description: 'Open blank tab' },
    { name: 'with-url', input: { url: 'https://example.com' }, description: 'Open tab with URL' },
  ],
})

export const tabsClose = endpoint({
  path: '/tabs/close',
  method: 'POST',
  summary: 'Close a tab',
  description: `Desktop app only. Closes the specified tab by window ID.

Get window IDs from /windows endpoint.`,
  category: 'windows',
  input: s.object({
    window: s.string.describe('Window ID to close'),
  }),
  examples: [
    { name: 'close', input: { window: 'window-abc123' }, description: 'Close specific tab' },
  ],
  invalidExamples: [
    { name: 'missing-window', input: {}, error: 'window is required' },
  ],
})

export const tabsFocus = endpoint({
  path: '/tabs/focus',
  method: 'POST',
  summary: 'Focus a tab',
  description: `Desktop app only. Brings the specified tab to front.

Useful when working with multiple tabs to ensure the right one is visible.`,
  category: 'windows',
  input: s.object({
    window: s.string.describe('Window ID to focus'),
  }),
  examples: [
    { name: 'focus', input: { window: 'window-abc123' }, description: 'Bring tab to front' },
  ],
})

// ============================================
// Recording & Testing
// ============================================
//
// Recording workflow:
// 1. recordingStart - begin capturing user actions
// 2. User interacts with page (clicks, types, navigates)
// 3. recordingStop - stop capturing
// 4. recordingGenerate - convert to runnable test

export const recordingStart = endpoint({
  path: '/recording/start',
  method: 'POST',
  summary: 'Start recording user actions',
  description: `Begin capturing user interactions as semantic events.

The recording captures clicks, typing, navigation, and more.
Use /recording/stop to finish, then /recording/generate to create a test.`,
  category: 'recording',
  input: s.object({}),
})

export const recordingStop = endpoint({
  path: '/recording/stop',
  method: 'POST',
  summary: 'Stop recording',
  description: `Stop capturing user actions.

Response: { events: [...], duration: ms, eventCount: n }

After stopping, use /recording/generate to convert events to a test.`,
  category: 'recording',
  input: s.object({}),
})

export const recordingGenerate = endpoint({
  path: '/recording/generate',
  method: 'POST',
  summary: 'Generate test from recording',
  description: `Converts recorded semantic events into a JSON test file.

The generated test can be run with /test/run or saved for later use.

Response: { test: { version, name, url, steps: [...] } }`,
  category: 'recording',
  input: s.object({
    name: s.string.describe('Test name').optional,
  }),
  examples: [
    { name: 'named', input: { name: 'Login flow test' }, description: 'Generate with custom name' },
    { name: 'default', input: {}, description: 'Generate with auto-generated name' },
  ],
})

export const recordings = endpoint({
  path: '/recordings',
  method: 'GET',
  summary: 'List saved recordings',
  description: `List all saved recordings on the server.

Response: { recordings: [{ name, created, eventCount, duration }] }`,
  category: 'recording',
})

export const testRun = endpoint({
  path: '/test/run',
  method: 'POST',
  summary: 'Run a JSON test',
  description: `Execute a test defined in Haltija JSON format.

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
- human: Colored terminal output`,
  category: 'testing',
  input: s.object({
    test: s.any.describe('Test object with steps'),
    format: s.enum(['json', 'github', 'human'] as const).describe('Output format: json (structured), github (annotations + summary), human (readable)').optional,
    stepDelay: s.number.describe('Milliseconds between steps (default 100)').optional,
    timeout: s.number.describe('Milliseconds timeout per step (default 5000)').optional,
    stopOnFailure: s.boolean.describe('Stop on first failure (default true)').optional,
  }),
  examples: [
    {
      name: 'simple-test',
      input: {
        test: {
          version: 1,
          name: 'Click button',
          url: 'http://localhost:3000',
          steps: [
            { action: 'click', selector: '#submit' },
            { action: 'assert', assertion: { type: 'exists', selector: '.success' } }
          ]
        }
      },
      description: 'Simple click and verify'
    },
    {
      name: 'github-output',
      input: {
        test: { version: 1, name: 'Test', url: 'http://localhost:3000', steps: [] },
        format: 'github'
      },
      description: 'Get GitHub Actions format'
    },
  ],
})

export const testSuite = endpoint({
  path: '/test/suite',
  method: 'POST',
  summary: 'Run multiple tests',
  description: `Execute a suite of tests, optionally stopping on first failure.

Input: { tests: [test1, test2, ...], format?, stopOnFailure? }

Response includes per-test results and overall summary.`,
  category: 'testing',
  input: s.object({
    tests: s.array(s.any).describe('Array of test objects'),
    format: s.enum(['json', 'github', 'human'] as const).describe('Output format: json (structured), github (annotations + summary), human (readable)').optional,
    testDelay: s.number.describe('Milliseconds between tests (default 500)').optional,
    stepDelay: s.number.describe('Milliseconds between steps (default 100)').optional,
    timeout: s.number.describe('Milliseconds timeout per step (default 5000)').optional,
    stopOnFailure: s.boolean.describe('Stop on first failure (default false for suites)').optional,
  }),
  examples: [
    {
      name: 'two-tests',
      input: {
        tests: [
          { version: 1, name: 'Login', url: 'http://localhost:3000/login', steps: [] },
          { version: 1, name: 'Dashboard', url: 'http://localhost:3000/dashboard', steps: [] }
        ],
        stopOnFailure: false
      },
      description: 'Run two tests, continue on failure'
    },
  ],
})

export const testValidate = endpoint({
  path: '/test/validate',
  method: 'POST',
  summary: 'Validate test without running',
  description: `Check that a test is well-formed and all selectors exist on the current page.

Use this to pre-check tests before running. Returns validation errors without executing steps.

Response: { valid: boolean, errors?: [{ step?, message }] }`,
  category: 'testing',
  input: s.object({
    test: s.any.describe('Test object to validate'),
  }),
  examples: [
    {
      name: 'validate',
      input: {
        test: { version: 1, name: 'Test', url: 'http://localhost:3000', steps: [{ action: 'click', selector: '#btn' }] }
      },
      description: 'Validate test before running'
    },
  ],
})

// ============================================
// Snapshots
// ============================================
//
// Snapshots capture full page state for debugging. Useful after test failures
// or when you need to understand what went wrong.

export const snapshot = endpoint({
  path: '/snapshot',
  method: 'POST',
  summary: 'Capture page snapshot',
  description: `Capture current page state for debugging.

Includes: DOM tree, console logs, viewport size, scroll position, URL, timestamp.

Response: { snapshot: { url, title, viewport, dom, console, timestamp } }

Great for debugging test failures - call this when something goes wrong.`,
  category: 'debug',
  input: s.object({
    trigger: s.string.describe('What triggered the snapshot (e.g., "manual", "test-failure")').optional,
    context: s.any.describe('Additional context about the snapshot').optional,
  }),
  examples: [
    { name: 'manual', input: { trigger: 'manual' }, description: 'Manual debug snapshot' },
    { name: 'test-fail', input: { trigger: 'test-failure', context: { step: 3, error: 'Element not found' } }, description: 'Capture after test failure' },
  ],
})

// ============================================
// Status & Meta
// ============================================
//
// Use /status to check server health and browser connections.
// Use /docs for quick start, /api for full reference.

export const status = endpoint({
  path: '/status',
  method: 'GET',
  summary: 'Server status',
  description: `Returns server info and connected browser count.

Response: { version, uptime, browsers: n, focused?: windowId }

Use to verify server is running and browsers are connected before testing.`,
  category: 'meta',
})

export const version = endpoint({
  path: '/version',
  method: 'GET',
  summary: 'Get server version',
  description: `Returns the Haltija server version.

Response: { version: "1.0.0" }`,
  category: 'meta',
})

export const docs = endpoint({
  path: '/docs',
  method: 'GET',
  summary: 'Quick start guide',
  description: `Human-readable getting started docs for AI agents.

Returns markdown-formatted quick start guide with common workflows.`,
  category: 'meta',
})

export const api = endpoint({
  path: '/api',
  method: 'GET',
  summary: 'Full API reference',
  description: `Complete API documentation with all endpoints.

Returns structured JSON with all endpoints, their parameters, and examples.`,
  category: 'meta',
})

// ============================================
// All Endpoints Registry
// ============================================

export const endpoints = {
  // DOM
  tree,
  query,
  inspect,
  inspectAll,
  find,
  formData,
  
  // Interaction
  click,
  type,
  drag,
  highlight,
  unhighlight,
  scroll,
  wait,
  
  // Navigation
  navigate,
  refresh,
  location,
  
  // Mutations
  mutationsWatch,
  mutationsUnwatch,
  mutationsStatus,
  
  // Events
  eventsWatch,
  eventsUnwatch,
  events,
  eventsStats,
  
  // Console & Eval
  console: console_,
  eval: eval_,
  call,
  
  // Screenshots
  screenshot,
  
  // Selection
  selectStart,
  selectCancel,
  selectStatus,
  selectResult,
  selectClear,
  
  // Windows
  windows,
  tabsOpen,
  tabsClose,
  tabsFocus,
  
  // Recording
  recordingStart,
  recordingStop,
  recordingGenerate,
  recordings,
  testRun,
  testSuite,
  testValidate,
  
  // Snapshots
  snapshot,
  
  // Meta
  status,
  version,
  docs,
  api,
} as const

// Array form for iteration
export const ALL_ENDPOINTS = Object.values(endpoints)

// ============================================
// Schema Fingerprint (Canary)
// ============================================
// This fingerprint must be updated when the schema changes.
// Run `bun test src/api-schema.test.ts` to get the new fingerprint.
// This ensures schema changes are intentional and documented.

export const SCHEMA_FINGERPRINT = {
  updated: '2026-01-16T13:26:10.284Z',
  checksum: '88b342c3',
}

/**
 * Compute a fingerprint of the schema for change detection.
 * Sorts endpoints alphabetically and hashes their essential properties.
 */
export function computeSchemaFingerprint(): string {
  // Build a simple representation of each endpoint
  const parts: string[] = []
  
  const names = Object.keys(endpoints).sort()
  for (const name of names) {
    const ep = endpoints[name as keyof typeof endpoints]
    // Get input property names if available
    const inputProps = ep.input && typeof ep.input === 'object' && 'properties' in ep.input
      ? Object.keys((ep.input as any).properties || {}).sort().join(',')
      : ''
    parts.push(`${name}:${ep.path}:${ep.method}:${inputProps}`)
  }
  
  const str = parts.join('|')
  
  // Simple hash function (djb2)
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash = hash >>> 0 // Convert to unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0')
}

// ============================================
// Helpers
// ============================================

/** Get JSON Schema object for an endpoint's input */
export function getInputSchema(ep: EndpointDef): object | undefined {
  return ep.input?.schema
}

/** Generate self-documenting response for GET on a POST endpoint */
export function getEndpointDocs(ep: EndpointDef): object {
  return {
    endpoint: ep.path,
    method: ep.method,
    summary: ep.summary,
    description: ep.description,
    input: ep.input?.schema,
    usage: ep.method === 'POST' 
      ? `curl -X POST localhost:8700${ep.path} -H "Content-Type: application/json" -d '{...}'`
      : `curl localhost:8700${ep.path}`,
  }
}

/** Validate request body against endpoint schema */
export function validateInput(ep: EndpointDef, body: any): { valid: boolean, error?: string } {
  if (!ep.input) return { valid: true }
  
  let error: string | undefined
  const valid = ep.input.validate(body, (path: string, msg: string) => {
    error = `${path}: ${msg}`
  })
  
  return { valid, error }
}

// ============================================
// Type Exports
// ============================================

export type TreeInput = Infer<typeof tree.input>
export type QueryInput = Infer<typeof query.input>
export type InspectInput = Infer<typeof inspect.input>
export type FindInput = Infer<typeof find.input>
export type ClickInput = Infer<typeof click.input>
export type TypeInput = Infer<typeof type.input>
export type DragInput = Infer<typeof drag.input>
export type HighlightInput = Infer<typeof highlight.input>
export type WaitInput = Infer<typeof wait.input>
export type NavigateInput = Infer<typeof navigate.input>
export type EvalInput = Infer<typeof eval_.input>
export type CallInput = Infer<typeof call.input>
export type ScreenshotInput = Infer<typeof screenshot.input>
