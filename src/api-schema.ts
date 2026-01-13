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

export const tree = endpoint({
  path: '/tree',
  method: 'POST',
  summary: 'Get DOM tree structure',
  description: 'Returns hierarchical view of page elements with flags for interactivity, visibility, data bindings, shadow DOM, etc. Great for understanding page structure.',
  input: s.object({
    selector: s.string.describe('Root element selector').optional,
    depth: s.number.describe('Max depth (-1 = unlimited, default 3)').optional,
    includeText: s.boolean.describe('Include text content (default true)').optional,
    visibleOnly: s.boolean.describe('Only visible elements (default false)').optional,
    pierceShadow: s.boolean.describe('Pierce shadow DOM (default false)').optional,
    compact: s.boolean.describe('Minimal output (default false)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
})

export const query = endpoint({
  path: '/query',
  method: 'POST',
  summary: 'Query DOM elements by selector',
  description: 'Find elements matching a CSS selector. Returns basic element info.',
  input: s.object({
    selector: s.string.describe('CSS selector'),
    all: s.boolean.describe('Return all matches (default false = first only)').optional,
  }),
})

export const inspect = endpoint({
  path: '/inspect',
  method: 'POST',
  summary: 'Deep inspection of an element',
  description: 'Get detailed info: geometry, computed styles, ARIA attributes, visibility, scroll position, and more.',
  input: s.object({
    selector: s.string.describe('CSS selector'),
    window: s.string.describe('Target window ID').optional,
  }),
})

export const inspectAll = endpoint({
  path: '/inspectAll',
  method: 'POST',
  summary: 'Inspect multiple elements',
  description: 'Deep inspection of all elements matching selector.',
  input: s.object({
    selector: s.string.describe('CSS selector'),
    limit: s.number.describe('Max elements (default 10)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
})

// ============================================
// Interaction Endpoints
// ============================================

export const click = endpoint({
  path: '/click',
  method: 'POST',
  summary: 'Click an element',
  description: 'Scrolls element into view, then performs full click sequence: mouseenter, mouseover, mousedown, mouseup, click.',
  category: 'interaction',
  input: s.object({
    selector: s.string.describe('CSS selector of element to click'),
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'basic', input: { selector: '#submit' }, description: 'Click a button by ID' },
    { name: 'with-class', input: { selector: '.btn-primary' }, description: 'Click by class' },
  ],
  invalidExamples: [
    { input: {}, error: 'selector' },
    { input: { selector: 123 }, error: 'string' },
  ],
})

export const type = endpoint({
  path: '/type',
  method: 'POST',
  summary: 'Type text into an element',
  description: 'Focus element and type text. Supports human-like typing with variable delays and occasional typos that get corrected.',
  category: 'interaction',
  input: s.object({
    selector: s.string.describe('CSS selector of input/textarea'),
    text: s.string.describe('Text to type'),
    humanlike: s.boolean.describe('Human-like delays (default true)').optional,
    typoRate: s.number.describe('Typo probability 0-1 (default 0.03)').optional,
    minDelay: s.number.describe('Min ms between keys (default 50)').optional,
    maxDelay: s.number.describe('Max ms between keys (default 150)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'basic', input: { selector: '#email', text: 'user@example.com' } },
    { name: 'fast', input: { selector: 'input', text: 'hello', humanlike: false } },
  ],
  invalidExamples: [
    { input: { selector: '#input' }, error: 'text' },
    { input: { text: 'hello' }, error: 'selector' },
  ],
})

export const drag = endpoint({
  path: '/drag',
  method: 'POST',
  summary: 'Drag from an element',
  description: 'Simulates drag: mousedown on element, mousemove by delta, mouseup. Good for sliders, resizing, reordering.',
  input: s.object({
    selector: s.string.describe('CSS selector of drag handle'),
    deltaX: s.number.describe('Horizontal distance in pixels').optional,
    deltaY: s.number.describe('Vertical distance in pixels').optional,
    duration: s.number.describe('Drag duration in ms (default 300)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
})

export const highlight = endpoint({
  path: '/highlight',
  method: 'POST',
  summary: 'Visually highlight an element',
  description: 'Draw attention to an element with colored border and optional label. Great for showing users what you found.',
  category: 'interaction',
  input: s.object({
    selector: s.string.describe('CSS selector'),
    label: s.string.describe('Label text to show').optional,
    color: s.string.describe('CSS color (default #6366f1)').optional,
    duration: s.number.describe('Auto-hide after ms (omit for manual)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
  examples: [
    { name: 'basic', input: { selector: '#login-btn', label: 'Click here' } },
    { name: 'error', input: { selector: '.error', label: 'Problem', color: '#ef4444' } },
    { name: 'timed', input: { selector: 'button', duration: 3000 } },
  ],
  invalidExamples: [
    { input: {}, error: 'selector' },
  ],
})

export const unhighlight = endpoint({
  path: '/unhighlight',
  method: 'POST',
  summary: 'Remove highlight',
  description: 'Remove any active highlight overlay.',
  input: s.object({}),
})

export const scroll = endpoint({
  path: '/scroll',
  method: 'POST',
  summary: 'Scroll to element or position',
  description: 'Smooth scroll with natural easing. Can scroll to a selector, coordinates, or relative amount.',
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
    { name: 'to-element', input: { selector: '#pricing' } },
    { name: 'to-top', input: { y: 0 } },
    { name: 'down', input: { deltaY: 500 } },
  ],
  invalidExamples: [
    { input: {}, error: 'selector' },
  ],
})

// ============================================
// Navigation Endpoints
// ============================================

export const navigate = endpoint({
  path: '/navigate',
  method: 'POST',
  summary: 'Navigate to a URL',
  input: s.object({
    url: s.string.describe('URL to navigate to'),
    window: s.string.describe('Target window ID').optional,
  }),
})

export const refresh = endpoint({
  path: '/refresh',
  method: 'POST',
  summary: 'Refresh the page',
  input: s.object({
    hard: s.boolean.describe('Bypass cache (default false)').optional,
    window: s.string.describe('Target window ID').optional,
  }),
})

export const location = endpoint({
  path: '/location',
  method: 'GET',
  summary: 'Get current URL and title',
  description: 'Returns the current page URL and document title.',
})

// ============================================
// Mutation Watching
// ============================================

export const mutationsWatch = endpoint({
  path: '/mutations/watch',
  method: 'POST',
  summary: 'Start watching DOM mutations',
  description: 'Begin capturing DOM changes (element adds/removes, attribute changes). Uses presets for filtering.',
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
})

export const mutationsUnwatch = endpoint({
  path: '/mutations/unwatch',
  method: 'POST',
  summary: 'Stop watching mutations',
  input: s.object({}),
})

export const mutationsStatus = endpoint({
  path: '/mutations/status',
  method: 'GET',
  summary: 'Get mutation watch status',
})

// ============================================
// Event Watching
// ============================================

export const eventsWatch = endpoint({
  path: '/events/watch',
  method: 'POST',
  summary: 'Start watching semantic events',
  description: 'Begin capturing aggregated events (clicks, typing, navigation). Retrieve with GET /events. Events are semantic: "user typed hello" not 5 keydown events.',
  input: s.object({
    preset: s.string.describe('Verbosity: minimal, interactive, detailed, debug').optional,
    categories: s.array(s.string).describe('Specific categories to watch').optional,
  }),
})

export const eventsUnwatch = endpoint({
  path: '/events/unwatch',
  method: 'POST',
  summary: 'Stop watching events',
  input: s.object({}),
})

export const events = endpoint({
  path: '/events',
  method: 'GET',
  summary: 'Get captured semantic events',
  description: 'Returns buffered events since watch started. Events are aggregated and meaningful.',
})

export const eventsStats = endpoint({
  path: '/events/stats',
  method: 'GET',
  summary: 'Get event aggregation statistics',
  description: 'Shows noise reduction metrics: raw DOM events vs semantic events emitted.',
})

// ============================================
// Console & Eval
// ============================================

export const console_ = endpoint({
  path: '/console',
  method: 'GET',
  summary: 'Get console output',
  description: 'Returns captured console.log/warn/error/info from the page.',
})

export const eval_ = endpoint({
  path: '/eval',
  method: 'POST',
  summary: 'Execute JavaScript',
  description: 'Run arbitrary JavaScript in the browser context. Returns the result.',
  input: s.object({
    code: s.string.describe('JavaScript code to execute'),
    window: s.string.describe('Target window ID').optional,
  }),
})

// ============================================
// Screenshots
// ============================================

export const screenshot = endpoint({
  path: '/screenshot',
  method: 'POST',
  summary: 'Capture a screenshot',
  description: 'Capture the page or a specific element as base64 PNG.',
  input: s.object({
    selector: s.string.describe('Element to capture (omit for full page)').optional,
    scale: s.number.describe('Scale factor (default 1)').optional,
    maxWidth: s.number.describe('Max width in pixels').optional,
    maxHeight: s.number.describe('Max height in pixels').optional,
  }),
})

// ============================================
// Selection Tool
// ============================================

export const selectStart = endpoint({
  path: '/select/start',
  method: 'POST',
  summary: 'Start interactive selection',
  description: 'User drags to select a region. Call /select/result to get elements in selection.',
  input: s.object({}),
})

export const selectCancel = endpoint({
  path: '/select/cancel',
  method: 'POST',
  summary: 'Cancel selection mode',
  input: s.object({}),
})

export const selectStatus = endpoint({
  path: '/select/status',
  method: 'GET',
  summary: 'Check if selection is active',
})

export const selectResult = endpoint({
  path: '/select/result',
  method: 'GET',
  summary: 'Get selection result',
  description: 'After user completes selection, returns the region and elements within.',
})

export const selectClear = endpoint({
  path: '/select/clear',
  method: 'POST',
  summary: 'Clear selection result',
  input: s.object({}),
})

// ============================================
// Windows / Tabs
// ============================================

export const windows = endpoint({
  path: '/windows',
  method: 'GET',
  summary: 'List connected windows',
  description: 'Returns all connected browser windows/tabs with IDs, URLs, and titles.',
})

export const tabsOpen = endpoint({
  path: '/tabs/open',
  method: 'POST',
  summary: 'Open a new tab',
  description: 'Desktop app only. Opens a new tab.',
  input: s.object({
    url: s.string.describe('URL to open').optional,
  }),
})

export const tabsClose = endpoint({
  path: '/tabs/close',
  method: 'POST',
  summary: 'Close a tab',
  description: 'Desktop app only. Closes specified tab.',
  input: s.object({
    window: s.string.describe('Window ID to close'),
  }),
})

export const tabsFocus = endpoint({
  path: '/tabs/focus',
  method: 'POST',
  summary: 'Focus a tab',
  description: 'Desktop app only. Brings tab to front.',
  input: s.object({
    window: s.string.describe('Window ID to focus'),
  }),
})

// ============================================
// Recording & Testing
// ============================================

export const recordingStart = endpoint({
  path: '/recording/start',
  method: 'POST',
  summary: 'Start recording user actions',
  input: s.object({}),
})

export const recordingStop = endpoint({
  path: '/recording/stop',
  method: 'POST',
  summary: 'Stop recording',
  input: s.object({}),
})

export const recordingGenerate = endpoint({
  path: '/recording/generate',
  method: 'POST',
  summary: 'Generate test from recording',
  description: 'Converts recorded semantic events into a JSON test file.',
  input: s.object({
    name: s.string.describe('Test name').optional,
  }),
})

export const recordings = endpoint({
  path: '/recordings',
  method: 'GET',
  summary: 'List saved recordings',
})

export const testRun = endpoint({
  path: '/test/run',
  method: 'POST',
  summary: 'Run a JSON test',
  description: 'Execute a test defined in Haltija JSON format.',
  input: s.object({
    test: s.any.describe('Test object with steps'),
  }),
})

export const testValidate = endpoint({
  path: '/test/validate',
  method: 'POST',
  summary: 'Validate test without running',
  description: 'Check that all selectors exist and test is well-formed.',
  input: s.object({
    test: s.any.describe('Test object to validate'),
  }),
})

// ============================================
// Snapshots
// ============================================

export const snapshot = endpoint({
  path: '/snapshot',
  method: 'POST',
  summary: 'Capture page snapshot',
  description: 'Capture current page state including DOM tree, console, and viewport for debugging.',
  input: s.object({
    trigger: s.string.describe('What triggered the snapshot (e.g., "manual", "test-failure")').optional,
    context: s.any.describe('Additional context about the snapshot').optional,
  }),
})

// ============================================
// Status & Meta
// ============================================

export const status = endpoint({
  path: '/status',
  method: 'GET',
  summary: 'Server status',
  description: 'Returns server info and connected browser count.',
})

export const version = endpoint({
  path: '/version',
  method: 'GET',
  summary: 'Get server version',
})

export const docs = endpoint({
  path: '/docs',
  method: 'GET',
  summary: 'Quick start guide',
  description: 'Human-readable getting started docs for AI agents.',
})

export const api = endpoint({
  path: '/api',
  method: 'GET',
  summary: 'Full API reference',
  description: 'Complete API documentation.',
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
  
  // Interaction
  click,
  type,
  drag,
  highlight,
  unhighlight,
  scroll,
  
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
export type ClickInput = Infer<typeof click.input>
export type TypeInput = Infer<typeof type.input>
export type DragInput = Infer<typeof drag.input>
export type HighlightInput = Infer<typeof highlight.input>
export type NavigateInput = Infer<typeof navigate.input>
export type EvalInput = Infer<typeof eval_.input>
export type ScreenshotInput = Infer<typeof screenshot.input>
