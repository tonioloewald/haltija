/**
 * Dev Channel Types
 * 
 * Pub/sub message types for communication between:
 * - Browser page (tosijs-dev component)
 * - Local server (WebSocket hub)
 * - Agent/CLI (REST or WebSocket client)
 */

export interface DevMessage {
  id: string
  channel: string  // e.g. 'dom', 'console', 'build', 'test', 'events'
  action: string   // e.g. 'query', 'log', 'error', 'complete', 'click'
  payload: any
  timestamp: number
  source: 'browser' | 'server' | 'agent'
}

export interface DevResponse {
  id: string       // Matches request id
  success: boolean
  data?: any
  error?: string
  timestamp: number
}

// ============================================
// DOM Queries
// ============================================

export interface DomQueryRequest {
  selector: string
  all?: boolean           // querySelectorAll vs querySelector
  properties?: string[]   // Which properties to return (default: basic set)
}

export interface DomElement {
  tagName: string
  id: string
  className: string
  textContent: string
  innerText: string
  outerHTML: string
  attributes: Record<string, string>
  rect?: DOMRect
  computedStyle?: Record<string, string>
}

// ============================================
// Element Inspector (detailed view)
// ============================================

export interface ElementInspection {
  // Identity
  selector: string
  tagName: string
  id?: string
  classList: string[]
  
  // Geometry
  box: {
    x: number
    y: number
    width: number
    height: number
    visible: boolean        // Is it in viewport?
    display: string         // computed display value
    visibility: string      // computed visibility
    opacity: number         // computed opacity
  }
  
  // Offset hierarchy (for understanding positioning)
  offsets: {
    offsetTop: number
    offsetLeft: number
    offsetWidth: number
    offsetHeight: number
    offsetParent: string | null  // selector of offsetParent
    scrollTop: number
    scrollLeft: number
    scrollWidth: number
    scrollHeight: number
  }
  
  // Content
  text: {
    innerText: string       // Truncated to 500 chars
    textContent: string     // Truncated to 500 chars
    value?: string          // For inputs
    placeholder?: string
    innerHTML: string       // Truncated to 1000 chars
  }
  
  // Attributes (all of them)
  attributes: Record<string, string>
  
  // Data attributes (convenience)
  dataset: Record<string, string>
  
  // Key properties for common element types
  properties: {
    // State
    hidden?: boolean
    disabled?: boolean
    checked?: boolean
    selected?: boolean
    open?: boolean          // for details/dialog
    
    // Form elements
    type?: string
    name?: string
    required?: boolean
    readOnly?: boolean
    
    // Links
    href?: string
    target?: string
    
    // Media
    src?: string
    alt?: string
    
    // ARIA
    role?: string
    ariaLabel?: string
    ariaExpanded?: boolean
    ariaHidden?: boolean
    ariaDisabled?: boolean
    ariaSelected?: boolean
    ariaCurrent?: string
    
    // Custom element
    isCustomElement: boolean
    shadowRoot: boolean
  }
  
  // Hierarchy
  hierarchy: {
    parent: string | null    // Selector
    children: number         // Count
    childTags: string[]      // Unique tag names of children
    previousSibling?: string // Tag name
    nextSibling?: string     // Tag name
    depth: number            // How deep in DOM tree
  }
  
  // Computed styles (only the useful ones)
  styles: {
    display: string
    position: string
    visibility: string
    opacity: string
    overflow: string
    zIndex: string
    pointerEvents: string
    cursor: string
    color: string
    backgroundColor: string
    fontSize: string
    fontWeight: string
  }
}

// ============================================
// Event Watching & Recording
// ============================================

export interface EventWatchRequest {
  selector?: string       // Watch events on specific elements (default: document)
  events: string[]        // Event types to watch: ['click', 'input', 'keydown', etc.]
  capture?: boolean       // Use capture phase
  passive?: boolean       // Passive listener
}

export interface RecordedEvent {
  type: string            // 'click', 'input', 'keydown', etc.
  timestamp: number
  target: {
    selector: string      // CSS selector path to element
    tagName: string
    id?: string
    className?: string
    textContent?: string  // Truncated
    value?: string        // For inputs
  }
  // Event-specific data
  position?: { x: number, y: number, clientX: number, clientY: number }
  key?: string            // For keyboard events
  code?: string
  modifiers?: { alt: boolean, ctrl: boolean, meta: boolean, shift: boolean }
  value?: string          // For input/change events
  detail?: any            // Custom event detail
}

// ============================================
// Synthetic Events (Replay/Testing)
// ============================================

export interface SyntheticEventRequest {
  selector: string        // Target element
  event: string           // Event type
  options?: {
    // Mouse events
    clientX?: number
    clientY?: number
    button?: number
    bubbles?: boolean
    cancelable?: boolean
    // Keyboard events
    key?: string
    code?: string
    altKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    // Input events
    value?: string
    inputType?: string
    // Custom
    detail?: any
  }
}

export interface ActionSequence {
  name: string
  description?: string
  steps: SyntheticEventRequest[]
  delays?: number[]       // Delay before each step (ms)
}

// ============================================
// Console Capture
// ============================================

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  args: any[]
  timestamp: number
  stack?: string
}

// ============================================
// Build Events
// ============================================

export interface BuildEvent {
  type: 'start' | 'complete' | 'error' | 'warning'
  file?: string
  line?: number
  column?: number
  message?: string
  duration?: number
}

// ============================================
// Test Events
// ============================================

export interface TestEvent {
  type: 'suite-start' | 'suite-end' | 'test-pass' | 'test-fail' | 'test-skip'
  name: string
  file?: string
  duration?: number
  error?: string
}

// ============================================
// Recording Sessions
// ============================================

export interface RecordingSession {
  id: string
  name: string
  startTime: number
  endTime?: number
  events: RecordedEvent[]
  consoleEntries: ConsoleEntry[]
  snapshots?: DomSnapshot[]  // Periodic DOM snapshots
}

export interface DomSnapshot {
  timestamp: number
  html: string              // document.documentElement.outerHTML (could be large)
  url: string
  title: string
}

// ============================================
// Test Format (JSON)
// ============================================

/**
 * A test file that can be saved, loaded, and replayed.
 * Designed for agent-driven testing and recording/playback.
 */
export interface DevChannelTest {
  /** Schema version for forward compatibility */
  version: 1
  /** Test metadata */
  name: string
  description?: string
  /** URL the test was recorded on (or should run on) */
  url: string
  /** When the test was created */
  createdAt: number
  /** Steps to execute */
  steps: TestStep[]
}

/**
 * A single step in a test.
 */
export type TestStep = 
  | NavigateStep
  | ClickStep
  | TypeStep
  | KeyStep
  | WaitStep
  | AssertStep
  | EvalStep

interface BaseStep {
  /** Optional description of what this step does */
  description?: string
  /** Delay in ms before executing this step (default: 0) */
  delay?: number
}

export interface NavigateStep extends BaseStep {
  action: 'navigate'
  url: string
}

export interface ClickStep extends BaseStep {
  action: 'click'
  selector: string
  /** Optional: specific position within element */
  position?: { x: number, y: number }
}

export interface TypeStep extends BaseStep {
  action: 'type'
  selector: string
  text: string
  /** Clear existing value first (default: true) */
  clear?: boolean
}

export interface KeyStep extends BaseStep {
  action: 'key'
  key: string
  modifiers?: { alt?: boolean, ctrl?: boolean, meta?: boolean, shift?: boolean }
}

export interface WaitStep extends BaseStep {
  action: 'wait'
  /** Wait for selector to appear */
  selector?: string
  /** Wait for fixed duration (ms) */
  duration?: number
  /** Wait for URL to match */
  url?: string | RegExp
}

export interface AssertStep extends BaseStep {
  action: 'assert'
  /** What to assert */
  assertion: TestAssertion
}

export interface EvalStep extends BaseStep {
  action: 'eval'
  /** JavaScript code to execute */
  code: string
  /** Expected return value (optional) */
  expect?: any
}

/**
 * Assertions that can be made during a test.
 */
export type TestAssertion =
  | { type: 'exists', selector: string }
  | { type: 'not-exists', selector: string }
  | { type: 'text', selector: string, text: string, contains?: boolean }
  | { type: 'value', selector: string, value: string }
  | { type: 'visible', selector: string }
  | { type: 'hidden', selector: string }
  | { type: 'url', pattern: string }
  | { type: 'title', pattern: string }
  | { type: 'console-contains', text: string, level?: 'log' | 'warn' | 'error' }
  | { type: 'eval', code: string, expected: any }

/**
 * Result of running a test.
 */
export interface TestResult {
  test: DevChannelTest
  passed: boolean
  startTime: number
  endTime: number
  steps: StepResult[]
  error?: string
}

export interface StepResult {
  step: TestStep
  passed: boolean
  duration: number
  error?: string
}

// ============================================
// DOM Mutation Watching
// ============================================

/**
 * Mutation filter presets for common frameworks.
 * Each preset defines what to ignore and what to highlight.
 */
export type MutationFilterPreset = 
  | 'none'        // No filtering (raw mutations)
  | 'xinjs'       // xinjs: highlight -xin-event, -xin-data classes
  | 'b8rjs'       // b8r: highlight data-event, data-bind attributes  
  | 'tailwind'    // Ignore tailwind utility classes
  | 'react'       // Ignore React internals (__reactFiber, etc.)
  | 'minimal'     // Only show structural changes (add/remove elements)
  | 'smart'       // Auto-detect framework, apply sensible defaults

export interface MutationFilterRules {
  /** Class patterns to ignore (regex strings) */
  ignoreClasses?: string[]
  /** Attribute names to ignore */
  ignoreAttributes?: string[]
  /** Element selectors to completely ignore (e.g., 'script', 'style') */
  ignoreElements?: string[]
  /** Class patterns that are interesting (highlight these) */
  interestingClasses?: string[]
  /** Attribute patterns that are interesting (e.g., 'aria-', 'data-bind') */
  interestingAttributes?: string[]
  /** Only report mutations on elements matching these selectors */
  onlySelectors?: string[]
}

export interface MutationWatchRequest {
  /** CSS selector for subtree to observe (default: document.body) */
  root?: string
  /** Watch for child list changes */
  childList?: boolean
  /** Watch for attribute changes */
  attributes?: boolean
  /** Watch for text content changes */
  characterData?: boolean
  /** Watch entire subtree (default: true) */
  subtree?: boolean
  /** Debounce mutations (ms, default: 100) */
  debounce?: number
  /** Filter preset (default: 'smart') */
  preset?: MutationFilterPreset
  /** Custom filter rules (merged with preset) */
  filters?: MutationFilterRules
}

export interface MutationBatch {
  timestamp: number
  /** Number of mutations in this batch */
  count: number
  /** Summary of changes */
  summary: {
    added: number
    removed: number
    attributeChanges: number
    textChanges: number
  }
  /** Notable changes (elements added/removed that might be interesting) */
  notable: NotableMutation[]
  /** Number of mutations filtered out (if filtering is active) */
  ignored?: number
}

export interface NotableMutation {
  type: 'added' | 'removed' | 'attribute' | 'text'
  selector: string
  tagName: string
  id?: string
  className?: string
  /** For attribute changes */
  attribute?: string
  oldValue?: string
  newValue?: string
  /** For text changes */
  textContent?: string
}

// ============================================
// DOM Tree Inspector
// ============================================

/**
 * Request to build a DOM tree representation.
 * Designed for efficient, configurable snapshots of DOM subtrees.
 */
export interface DomTreeRequest {
  /** Root element selector */
  selector: string
  /** Maximum depth to traverse (default: 3, -1 for unlimited) */
  depth?: number
  /** Include text content of leaf nodes (default: true) */
  includeText?: boolean
  /** Include all attributes (default: false, includes only "interesting" ones) */
  allAttributes?: boolean
  /** Include computed styles (default: false) */
  includeStyles?: boolean
  /** Include box model info (default: false) */
  includeBox?: boolean
  /** Patterns for interesting classes (highlight these) */
  interestingClasses?: string[]
  /** Patterns for interesting attributes */
  interestingAttributes?: string[]
  /** Ignore elements matching these selectors */
  ignoreSelectors?: string[]
  /** Compact mode: minimal output (default: false) */
  compact?: boolean
}

/**
 * A node in the DOM tree representation.
 * Designed to be compact but informative.
 */
export interface DomTreeNode {
  /** Tag name (lowercase) */
  tag: string
  /** Element ID if present */
  id?: string
  /** Interesting classes only (filtered) */
  classes?: string[]
  /** Interesting attributes only (filtered) */
  attrs?: Record<string, string>
  /** Text content (for leaf nodes or if short) */
  text?: string
  /** Child nodes */
  children?: DomTreeNode[]
  /** Flags for quick scanning */
  flags?: {
    /** Has event bindings (xinjs, b8r, etc.) */
    hasEvents?: boolean
    /** Has data bindings */
    hasData?: boolean
    /** Is interactive (button, input, a, etc.) */
    interactive?: boolean
    /** Is a custom element */
    customElement?: boolean
    /** Has shadow DOM */
    shadowRoot?: boolean
    /** Is hidden */
    hidden?: boolean
    /** Has ARIA attributes */
    hasAria?: boolean
  }
  /** Position info (if requested) */
  box?: { x: number; y: number; w: number; h: number; visible: boolean }
  /** Truncation indicator */
  truncated?: boolean
  /** Child count if children were truncated */
  childCount?: number
}

// ============================================
// Channel Subscription
// ============================================

export type MessageHandler = (message: DevMessage) => void | Promise<void>

export interface DevChannelClient {
  // Connection
  connect(): Promise<void>
  disconnect(): void
  isConnected(): boolean
  
  // Pub/sub
  publish(channel: string, action: string, payload: any): void
  subscribe(channel: string, handler: MessageHandler): () => void
  request(channel: string, action: string, payload: any): Promise<DevResponse>
  
  // DOM convenience methods
  query(selector: string): Promise<DomElement | null>
  queryAll(selector: string): Promise<DomElement[]>
  eval(code: string): Promise<any>
  
  // Console
  getConsole(since?: number): Promise<ConsoleEntry[]>
  clearConsole(): void
  
  // Event watching
  watchEvents(options: EventWatchRequest): Promise<() => void>  // Returns unwatch fn
  
  // Synthetic events
  click(selector: string, options?: { x?: number, y?: number }): Promise<void>
  type(selector: string, text: string): Promise<void>
  press(key: string, modifiers?: { alt?: boolean, ctrl?: boolean, meta?: boolean, shift?: boolean }): Promise<void>
  dispatch(request: SyntheticEventRequest): Promise<void>
  
  // Recording
  startRecording(name: string): Promise<string>  // Returns session id
  stopRecording(): Promise<RecordingSession>
  replayRecording(session: RecordingSession, speed?: number): Promise<void>
}
