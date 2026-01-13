/**
 * Endpoint definitions for Haltija MCP
 * 
 * This is a simplified copy of the main api-schema.ts that doesn't require
 * tosijs-schema dependency. We only need the endpoint metadata and JSON schemas.
 */

export interface EndpointDef {
  path: string
  method: 'GET' | 'POST'
  summary: string
  description?: string
  inputSchema?: {
    type: "object"
    properties?: Record<string, unknown>
    required?: string[]
  }
}

// Helper to get input schema
export function getInputSchema(ep: EndpointDef): object | undefined {
  return ep.inputSchema
}

// ============================================
// Endpoint Definitions
// ============================================

export const ALL_ENDPOINTS: EndpointDef[] = [
  // DOM
  {
    path: '/tree',
    method: 'POST',
    summary: 'Get DOM tree structure',
    description: 'Returns hierarchical view of page elements with flags for interactivity, visibility, data bindings, shadow DOM, etc.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Root element selector" },
        depth: { type: "number", description: "Max depth (-1 = unlimited, default 3)" },
        includeText: { type: "boolean", description: "Include text content (default true)" },
        visibleOnly: { type: "boolean", description: "Only visible elements (default false)" },
        pierceShadow: { type: "boolean", description: "Pierce shadow DOM (default false)" },
        compact: { type: "boolean", description: "Minimal output (default false)" },
        window: { type: "string", description: "Target window ID" },
      },
    },
  },
  {
    path: '/query',
    method: 'POST',
    summary: 'Query DOM elements by selector',
    description: 'Find elements matching a CSS selector. Returns basic element info.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
        all: { type: "boolean", description: "Return all matches (default false = first only)" },
      },
      required: ["selector"],
    },
  },
  {
    path: '/inspect',
    method: 'POST',
    summary: 'Deep inspection of an element',
    description: 'Get detailed info: geometry, computed styles, ARIA attributes, visibility, scroll position.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
        window: { type: "string", description: "Target window ID" },
      },
      required: ["selector"],
    },
  },
  {
    path: '/inspectAll',
    method: 'POST',
    summary: 'Inspect multiple elements',
    description: 'Deep inspection of all elements matching selector.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
        limit: { type: "number", description: "Max elements (default 10)" },
        window: { type: "string", description: "Target window ID" },
      },
      required: ["selector"],
    },
  },

  // Interaction
  {
    path: '/click',
    method: 'POST',
    summary: 'Click an element',
    description: 'Scrolls element into view, then performs full click sequence.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of element to click" },
        window: { type: "string", description: "Target window ID" },
      },
      required: ["selector"],
    },
  },
  {
    path: '/type',
    method: 'POST',
    summary: 'Type text into an element',
    description: 'Focus element and type text with human-like timing.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of input/textarea" },
        text: { type: "string", description: "Text to type" },
        humanlike: { type: "boolean", description: "Human-like delays (default true)" },
        typoRate: { type: "number", description: "Typo probability 0-1 (default 0.03)" },
        minDelay: { type: "number", description: "Min ms between keys (default 50)" },
        maxDelay: { type: "number", description: "Max ms between keys (default 150)" },
        window: { type: "string", description: "Target window ID" },
      },
      required: ["selector", "text"],
    },
  },
  {
    path: '/drag',
    method: 'POST',
    summary: 'Drag from an element',
    description: 'Simulates drag: mousedown, mousemove by delta, mouseup.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of drag handle" },
        deltaX: { type: "number", description: "Horizontal distance in pixels" },
        deltaY: { type: "number", description: "Vertical distance in pixels" },
        duration: { type: "number", description: "Drag duration in ms (default 300)" },
        window: { type: "string", description: "Target window ID" },
      },
      required: ["selector"],
    },
  },
  {
    path: '/highlight',
    method: 'POST',
    summary: 'Visually highlight an element',
    description: 'Draw attention to an element with colored border and optional label.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
        label: { type: "string", description: "Label text to show" },
        color: { type: "string", description: "CSS color (default #6366f1)" },
        duration: { type: "number", description: "Auto-hide after ms (omit for manual)" },
        window: { type: "string", description: "Target window ID" },
      },
      required: ["selector"],
    },
  },
  {
    path: '/unhighlight',
    method: 'POST',
    summary: 'Remove highlight',
    description: 'Remove any active highlight overlay.',
    inputSchema: { type: "object" },
  },
  {
    path: '/scroll',
    method: 'POST',
    summary: 'Scroll to element or position',
    description: 'Smooth scroll with natural easing. Can scroll to a selector, coordinates, or relative amount.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to scroll into view" },
        x: { type: "number", description: "Absolute X position in pixels" },
        y: { type: "number", description: "Absolute Y position in pixels" },
        deltaX: { type: "number", description: "Relative horizontal scroll in pixels" },
        deltaY: { type: "number", description: "Relative vertical scroll in pixels" },
        duration: { type: "number", description: "Animation duration in ms (default 500)" },
        easing: { type: "string", description: "Easing function: ease-out (default), ease-in-out, linear" },
        block: { type: "string", description: "Vertical alignment: center (default), start, end, nearest" },
        window: { type: "string", description: "Target window ID" },
      },
    },
  },

  // Navigation
  {
    path: '/navigate',
    method: 'POST',
    summary: 'Navigate to a URL',
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to" },
        window: { type: "string", description: "Target window ID" },
      },
      required: ["url"],
    },
  },
  {
    path: '/refresh',
    method: 'POST',
    summary: 'Refresh the page',
    inputSchema: {
      type: "object",
      properties: {
        hard: { type: "boolean", description: "Bypass cache (default false)" },
        window: { type: "string", description: "Target window ID" },
      },
    },
  },
  {
    path: '/location',
    method: 'GET',
    summary: 'Get current URL and title',
    description: 'Returns the current page URL and document title.',
  },

  // Events
  {
    path: '/events/watch',
    method: 'POST',
    summary: 'Start watching semantic events',
    description: 'Begin capturing aggregated events (clicks, typing, navigation).',
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", description: "Verbosity: minimal, interactive, detailed, debug" },
        categories: { type: "array", items: { type: "string" }, description: "Specific categories to watch" },
      },
    },
  },
  {
    path: '/events/unwatch',
    method: 'POST',
    summary: 'Stop watching events',
    inputSchema: { type: "object" },
  },
  {
    path: '/events',
    method: 'GET',
    summary: 'Get captured semantic events',
    description: 'Returns buffered events since watch started.',
  },
  {
    path: '/events/stats',
    method: 'GET',
    summary: 'Get event aggregation statistics',
    description: 'Shows noise reduction metrics.',
  },

  // Mutations
  {
    path: '/mutations/watch',
    method: 'POST',
    summary: 'Start watching DOM mutations',
    description: 'Begin capturing DOM changes with filtering presets.',
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root selector to watch (default body)" },
        preset: { type: "string", description: "Filter preset: smart, xinjs, tailwind, react, minimal" },
        debounce: { type: "number", description: "Debounce ms (default 100)" },
      },
    },
  },
  {
    path: '/mutations/unwatch',
    method: 'POST',
    summary: 'Stop watching mutations',
    inputSchema: { type: "object" },
  },
  {
    path: '/mutations/status',
    method: 'GET',
    summary: 'Get mutation watch status',
  },

  // Console & Eval
  {
    path: '/console',
    method: 'GET',
    summary: 'Get console output',
    description: 'Returns captured console.log/warn/error/info from the page.',
  },
  {
    path: '/eval',
    method: 'POST',
    summary: 'Execute JavaScript',
    description: 'Run arbitrary JavaScript in the browser context.',
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript code to execute" },
        window: { type: "string", description: "Target window ID" },
      },
      required: ["code"],
    },
  },

  // Screenshots
  {
    path: '/screenshot',
    method: 'POST',
    summary: 'Capture a screenshot',
    description: 'Capture the page or a specific element as base64 PNG.',
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Element to capture (omit for full page)" },
        scale: { type: "number", description: "Scale factor (default 1)" },
        maxWidth: { type: "number", description: "Max width in pixels" },
        maxHeight: { type: "number", description: "Max height in pixels" },
      },
    },
  },

  // Selection
  {
    path: '/select/start',
    method: 'POST',
    summary: 'Start interactive selection',
    description: 'User drags to select a region.',
    inputSchema: { type: "object" },
  },
  {
    path: '/select/cancel',
    method: 'POST',
    summary: 'Cancel selection mode',
    inputSchema: { type: "object" },
  },
  {
    path: '/select/status',
    method: 'GET',
    summary: 'Check if selection is active',
  },
  {
    path: '/select/result',
    method: 'GET',
    summary: 'Get selection result',
    description: 'Returns the region and elements within after selection.',
  },
  {
    path: '/select/clear',
    method: 'POST',
    summary: 'Clear selection result',
    inputSchema: { type: "object" },
  },

  // Windows / Tabs
  {
    path: '/windows',
    method: 'GET',
    summary: 'List connected windows',
    description: 'Returns all connected browser windows/tabs with IDs, URLs, and titles.',
  },
  {
    path: '/tabs/open',
    method: 'POST',
    summary: 'Open a new tab',
    description: 'Desktop app only. Opens a new tab.',
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open" },
      },
    },
  },
  {
    path: '/tabs/close',
    method: 'POST',
    summary: 'Close a tab',
    description: 'Desktop app only. Closes specified tab.',
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", description: "Window ID to close" },
      },
      required: ["window"],
    },
  },
  {
    path: '/tabs/focus',
    method: 'POST',
    summary: 'Focus a tab',
    description: 'Desktop app only. Brings tab to front.',
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", description: "Window ID to focus" },
      },
      required: ["window"],
    },
  },

  // Recording
  {
    path: '/recording/start',
    method: 'POST',
    summary: 'Start recording user actions',
    inputSchema: { type: "object" },
  },
  {
    path: '/recording/stop',
    method: 'POST',
    summary: 'Stop recording',
    inputSchema: { type: "object" },
  },
  {
    path: '/recording/generate',
    method: 'POST',
    summary: 'Generate test from recording',
    description: 'Converts recorded semantic events into a JSON test file.',
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Test name" },
      },
    },
  },
  {
    path: '/recordings',
    method: 'GET',
    summary: 'List saved recordings',
  },

  // Snapshots
  {
    path: '/snapshot',
    method: 'POST',
    summary: 'Capture page snapshot',
    description: 'Capture current page state including DOM tree, console, and viewport.',
    inputSchema: {
      type: "object",
      properties: {
        trigger: { type: "string", description: "What triggered the snapshot" },
      },
    },
  },

  // Status
  {
    path: '/status',
    method: 'GET',
    summary: 'Server status',
    description: 'Returns server info and connected browser count.',
  },
  {
    path: '/version',
    method: 'GET',
    summary: 'Get server version',
  },
]
