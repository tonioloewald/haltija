/**
 * Dev Channel Browser Component
 * 
 * A floating widget that:
 * - Connects to local tosijs-dev server via WebSocket
 * - Exposes DOM query/manipulation capabilities
 * - Captures console output
 * - Watches and dispatches DOM events
 * - Records interaction sessions
 * 
 * Security:
 * - Always shows itself when channel becomes active (no silent snooping)
 * - User can pause/resume/kill the channel
 * - Option+Tab toggles visibility (but active state always shows briefly)
 * - Localhost only by default
 */

import type {
  DevMessage,
  DevResponse,
  DomElement,
  DomQueryRequest,
  ConsoleEntry,
  RecordedEvent,
  EventWatchRequest,
  SyntheticEventRequest,
  RecordingSession,
  MutationWatchRequest,
  MutationBatch,
  NotableMutation,
  ElementInspection,
  MutationFilterPreset,
  MutationFilterRules,
  DomTreeRequest,
  DomTreeNode,
  DevChannelTest,
  TestStep,
  TestAssertion,
} from './types'

// Component version - update when making changes
export const VERSION = '0.1.6'

// Server session ID - injected by server when serving component.js
// This allows the server to detect stale widgets and tell them to reload
const SERVER_SESSION_ID = ''

// Generate unique IDs
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

// Get a stable CSS selector path to an element
// Handles shadow DOM by marking shadow root boundaries with ::shadow
function getSelector(el: Element): string {
  // Build shadow DOM prefix if element is inside shadow roots
  const shadowPrefix: string[] = []
  let rootNode = el.getRootNode()
  let hostEl: Element | null = null
  
  while (rootNode instanceof ShadowRoot) {
    shadowPrefix.unshift('::shadow')
    hostEl = rootNode.host
    // Get selector for the host element up to the next shadow boundary or document
    const hostParts: string[] = []
    let current: Element | null = hostEl
    while (current) {
      let selector = current.tagName.toLowerCase()
      if (current.id) {
        selector = `#${current.id}`
        hostParts.unshift(selector)
        break
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.')
        if (classes) selector += `.${classes}`
      }
      hostParts.unshift(selector)
      
      const nextRoot = current.getRootNode()
      if (nextRoot instanceof ShadowRoot) {
        // This host is also inside a shadow root - stop here, outer loop will handle it
        break
      }
      current = current.parentElement
    }
    shadowPrefix.unshift(...hostParts)
    rootNode = hostEl.getRootNode()
  }
  
  // If element has ID and is in shadow DOM, prefix with shadow path
  if (el.id) {
    if (shadowPrefix.length > 0) {
      return `${shadowPrefix.join(' > ')} > #${el.id}`
    }
    return `#${el.id}`
  }
  
  const parts: string[] = []
  let current: Element | null = el
  
  while (current && current !== document.documentElement) {
    // Stop if we hit the shadow root boundary (handled by prefix)
    const currentRoot = current.getRootNode()
    if (currentRoot instanceof ShadowRoot) {
      // Build selector within this shadow root only
      let selector = current.tagName.toLowerCase()
      
      if (current.id) {
        selector = `#${current.id}`
        parts.unshift(selector)
        break
      }
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.')
        if (classes) selector += `.${classes}`
      }
      
      // Add nth-child if needed for uniqueness
      const parent = current.parentElement || (currentRoot as ShadowRoot)
      if (parent) {
        const children = parent instanceof ShadowRoot ? Array.from(parent.children) : Array.from(parent.children)
        const siblings = children.filter(c => c.tagName === current!.tagName)
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1
          selector += `:nth-child(${index})`
        }
      }
      
      parts.unshift(selector)
      current = current.parentElement
      
      // If we've reached the shadow root (no more parent), stop
      if (!current) break
    } else {
      // Normal DOM traversal
      let selector = current.tagName.toLowerCase()
      
      if (current.id) {
        selector = `#${current.id}`
        parts.unshift(selector)
        break
      }
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.')
        if (classes) selector += `.${classes}`
      }
      
      const parent = current.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName)
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1
          selector += `:nth-child(${index})`
        }
      }
      
      parts.unshift(selector)
      current = current.parentElement
    }
  }
  
  // Combine shadow prefix with element path
  if (shadowPrefix.length > 0) {
    return `${shadowPrefix.join(' > ')} > ${parts.join(' > ')}`
  }
  
  return parts.join(' > ')
}

// Extract element info for serialization
function extractElement(el: Element): DomElement {
  const rect = el.getBoundingClientRect()
  const attrs: Record<string, string> = {}
  
  for (const attr of el.attributes) {
    attrs[attr.name] = attr.value
  }
  
  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id,
    className: el.className?.toString() || '',
    textContent: el.textContent?.slice(0, 1000) || '',
    innerText: (el as HTMLElement).innerText?.slice(0, 1000) || '',
    outerHTML: el.outerHTML.slice(0, 5000),
    attributes: attrs,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      toJSON: () => rect,
    },
  }
}

// Detailed element inspection
function inspectElement(el: Element): ElementInspection {
  const htmlEl = el as HTMLElement
  const rect = el.getBoundingClientRect()
  const computed = getComputedStyle(el)
  
  // Check if visible in viewport
  const inViewport = rect.top < window.innerHeight && 
                     rect.bottom > 0 && 
                     rect.left < window.innerWidth && 
                     rect.right > 0
  
  // Get depth in DOM tree
  let depth = 0
  let parent = el.parentElement
  while (parent) {
    depth++
    parent = parent.parentElement
  }
  
  // Collect attributes
  const attrs: Record<string, string> = {}
  for (const attr of el.attributes) {
    attrs[attr.name] = attr.value
  }
  
  // Collect dataset
  const dataset: Record<string, string> = {}
  if (htmlEl.dataset) {
    for (const key of Object.keys(htmlEl.dataset)) {
      dataset[key] = htmlEl.dataset[key] || ''
    }
  }
  
  // Get unique child tag names
  const childTags = [...new Set(Array.from(el.children).map(c => c.tagName.toLowerCase()))]
  
  return {
    selector: getSelector(el),
    tagName: el.tagName.toLowerCase(),
    id: el.id || undefined,
    classList: Array.from(el.classList),
    
    box: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: inViewport && computed.display !== 'none' && computed.visibility !== 'hidden',
      display: computed.display,
      visibility: computed.visibility,
      opacity: parseFloat(computed.opacity),
    },
    
    offsets: {
      offsetTop: htmlEl.offsetTop,
      offsetLeft: htmlEl.offsetLeft,
      offsetWidth: htmlEl.offsetWidth,
      offsetHeight: htmlEl.offsetHeight,
      offsetParent: htmlEl.offsetParent ? getSelector(htmlEl.offsetParent as Element) : null,
      scrollTop: htmlEl.scrollTop,
      scrollLeft: htmlEl.scrollLeft,
      scrollWidth: htmlEl.scrollWidth,
      scrollHeight: htmlEl.scrollHeight,
    },
    
    text: {
      innerText: htmlEl.innerText?.slice(0, 500) || '',
      textContent: el.textContent?.slice(0, 500) || '',
      value: (htmlEl as HTMLInputElement).value || undefined,
      placeholder: (htmlEl as HTMLInputElement).placeholder || undefined,
      innerHTML: el.innerHTML.slice(0, 1000),
    },
    
    attributes: attrs,
    dataset,
    
    properties: {
      hidden: htmlEl.hidden,
      disabled: (htmlEl as HTMLButtonElement).disabled,
      checked: (htmlEl as HTMLInputElement).checked,
      selected: (htmlEl as HTMLOptionElement).selected,
      open: (htmlEl as HTMLDetailsElement).open,
      type: (htmlEl as HTMLInputElement).type || undefined,
      name: (htmlEl as HTMLInputElement).name || undefined,
      required: (htmlEl as HTMLInputElement).required,
      readOnly: (htmlEl as HTMLInputElement).readOnly,
      href: (htmlEl as HTMLAnchorElement).href || undefined,
      target: (htmlEl as HTMLAnchorElement).target || undefined,
      src: (htmlEl as HTMLImageElement).src || undefined,
      alt: (htmlEl as HTMLImageElement).alt || undefined,
      role: el.getAttribute('role') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      ariaExpanded: el.getAttribute('aria-expanded') === 'true',
      ariaHidden: el.getAttribute('aria-hidden') === 'true',
      ariaDisabled: el.getAttribute('aria-disabled') === 'true',
      ariaSelected: el.getAttribute('aria-selected') === 'true',
      ariaCurrent: el.getAttribute('aria-current') || undefined,
      isCustomElement: el.tagName.includes('-'),
      shadowRoot: !!el.shadowRoot,
    },
    
    hierarchy: {
      parent: el.parentElement ? getSelector(el.parentElement) : null,
      children: el.children.length,
      childTags,
      previousSibling: el.previousElementSibling?.tagName.toLowerCase(),
      nextSibling: el.nextElementSibling?.tagName.toLowerCase(),
      depth,
    },
    
    styles: {
      display: computed.display,
      position: computed.position,
      visibility: computed.visibility,
      opacity: computed.opacity,
      overflow: computed.overflow,
      zIndex: computed.zIndex,
      pointerEvents: computed.pointerEvents,
      cursor: computed.cursor,
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
    },
  }
}

// ==========================================
// Mutation Filter Presets
// ==========================================

const FILTER_PRESETS: Record<MutationFilterPreset, MutationFilterRules> = {
  none: {},
  
  xinjs: {
    interestingClasses: ['-xin-event', '-xin-data', '-xin-'],
    interestingAttributes: ['aria-', 'role', 'title', 'data-'],
    ignoreClasses: [
      // Animation/transition classes
      '^animate-', '^transition-', '^fade-',
    ],
  },
  
  b8rjs: {
    interestingAttributes: ['data-event', 'data-bind', 'data-list', 'data-component', 'aria-', 'role', 'title'],
    ignoreClasses: ['^animate-', '^transition-'],
  },
  
  tailwind: {
    ignoreClasses: [
      // Layout
      '^flex', '^grid', '^block', '^inline', '^hidden',
      // Spacing  
      '^p-', '^m-', '^px-', '^py-', '^mx-', '^my-', '^pt-', '^pb-', '^pl-', '^pr-', '^mt-', '^mb-', '^ml-', '^mr-',
      '^gap-', '^space-',
      // Sizing
      '^w-', '^h-', '^min-', '^max-',
      // Colors
      '^bg-', '^text-', '^border-', '^ring-', '^shadow-',
      // Typography
      '^font-', '^text-', '^leading-', '^tracking-',
      // Borders
      '^rounded', '^border',
      // Effects
      '^opacity-', '^blur-', '^brightness-',
      // Transitions
      '^transition', '^duration-', '^ease-', '^delay-',
      // Transforms
      '^scale-', '^rotate-', '^translate-', '^skew-',
      // Interactivity
      '^cursor-', '^select-', '^pointer-',
      // Position
      '^absolute', '^relative', '^fixed', '^sticky', '^static',
      '^top-', '^right-', '^bottom-', '^left-', '^inset-', '^z-',
      // Overflow
      '^overflow-', '^truncate',
      // Flex/Grid modifiers
      '^justify-', '^items-', '^content-', '^self-', '^place-',
      '^col-', '^row-', '^order-',
      // Responsive prefixes
      '^sm:', '^md:', '^lg:', '^xl:', '^2xl:',
      // State prefixes  
      '^hover:', '^focus:', '^active:', '^disabled:', '^group-',
      // Dark mode
      '^dark:',
    ],
    interestingAttributes: ['aria-', 'role', 'title', 'data-'],
  },
  
  react: {
    ignoreAttributes: [
      '__reactFiber', '__reactProps', '__reactEvents', 
      'data-reactroot', 'data-reactid',
    ],
    ignoreClasses: ['^css-'], // emotion/styled-components
    interestingAttributes: ['aria-', 'role', 'title', 'data-testid', 'data-cy'],
  },
  
  minimal: {
    ignoreAttributes: ['style', 'class'],
    ignoreClasses: ['.*'], // Ignore all class changes
  },
  
  smart: {
    // Will be computed dynamically based on detected framework
    interestingClasses: ['-xin-event', '-xin-data'],
    interestingAttributes: [
      'aria-', 'role', 'title',
      'data-event', 'data-bind', 'data-list', 'data-component', 'data-testid',
      'disabled', 'hidden', 'open', 'checked', 'selected',
    ],
    ignoreElements: [
      'script', 'style', 'link', 'meta', 'noscript',
      // DevTools-injected garbage
      '[id^="__"]', // React DevTools, etc.
    ],
    ignoreClasses: [
      // Common animation/transition classes
      '^animate-', '^transition-', '^fade-', '^slide-',
      // Common state classes that change frequently
      '^is-', '^has-', '^was-',
    ],
    ignoreAttributes: ['style'], // Style changes are usually noise
  },
}

/**
 * Detect which framework is in use on the page
 */
function detectFramework(): MutationFilterPreset[] {
  const detected: MutationFilterPreset[] = []
  
  try {
    // Check for xinjs
    if (document.querySelector('[class*="-xin-"]') || 
        typeof (window as any).xin !== 'undefined') {
      detected.push('xinjs')
    }
    
    // Check for b8r
    if (document.querySelector('[data-event]') || 
        document.querySelector('[data-bind]') ||
        typeof (window as any).b8r !== 'undefined') {
      detected.push('b8rjs')
    }
    
    // Check for React (use attribute presence check via JS, not CSS selector)
    // Note: __REACT_DEVTOOLS_GLOBAL_HOOK__ is injected by DevTools extension, not React itself
    const hasReactRoot = document.querySelector('[data-reactroot]') !== null
    const hasReactGlobal = typeof (window as any).React !== 'undefined'
    // Check for React fiber by looking at element properties (the real indicator)
    const hasReactFiber = Array.from(document.body?.children || []).some(el => 
      Object.keys(el).some(key => key.startsWith('__reactFiber') || key.startsWith('__reactProps'))
    )
    if (hasReactRoot || hasReactGlobal || hasReactFiber) {
      detected.push('react')
    }
    
    // Check for Tailwind (look for common utility classes)
    const hasTailwind = document.querySelector('[class*="flex"]') &&
                        document.querySelector('[class*="p-"]') &&
                        document.querySelector('[class*="text-"]')
    if (hasTailwind) {
      detected.push('tailwind')
    }
  } catch (err) {
    // If detection fails, just return empty - we'll use default rules
    console.warn('[tosijs-dev] Framework detection failed:', err)
  }
  
  return detected
}

/**
 * Merge multiple filter rule sets
 */
function mergeFilterRules(...rules: (MutationFilterRules | undefined)[]): MutationFilterRules {
  const merged: MutationFilterRules = {
    ignoreClasses: [],
    ignoreAttributes: [],
    ignoreElements: [],
    interestingClasses: [],
    interestingAttributes: [],
    onlySelectors: [],
  }
  
  for (const rule of rules) {
    if (!rule) continue
    if (rule.ignoreClasses) merged.ignoreClasses!.push(...rule.ignoreClasses)
    if (rule.ignoreAttributes) merged.ignoreAttributes!.push(...rule.ignoreAttributes)
    if (rule.ignoreElements) merged.ignoreElements!.push(...rule.ignoreElements)
    if (rule.interestingClasses) merged.interestingClasses!.push(...rule.interestingClasses)
    if (rule.interestingAttributes) merged.interestingAttributes!.push(...rule.interestingAttributes)
    if (rule.onlySelectors) merged.onlySelectors!.push(...rule.onlySelectors)
  }
  
  return merged
}

/**
 * Check if a class name matches any pattern in the list
 */
function matchesPatterns(value: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    try {
      if (new RegExp(pattern).test(value)) return true
    } catch {
      // Invalid regex, try exact match
      if (value === pattern || value.includes(pattern)) return true
    }
  }
  return false
}

/**
 * Filter class list based on rules
 */
function filterClasses(
  classes: string[], 
  rules: MutationFilterRules
): { ignored: string[], interesting: string[], other: string[] } {
  const ignored: string[] = []
  const interesting: string[] = []
  const other: string[] = []
  
  for (const cls of classes) {
    if (rules.ignoreClasses?.length && matchesPatterns(cls, rules.ignoreClasses)) {
      ignored.push(cls)
    } else if (rules.interestingClasses?.length && matchesPatterns(cls, rules.interestingClasses)) {
      interesting.push(cls)
    } else {
      other.push(cls)
    }
  }
  
  return { ignored, interesting, other }
}

/**
 * Check if an attribute is interesting
 */
function isInterestingAttribute(name: string, rules: MutationFilterRules): boolean {
  if (rules.ignoreAttributes?.some(pattern => name.startsWith(pattern) || name === pattern)) {
    return false
  }
  if (rules.interestingAttributes?.some(pattern => name.startsWith(pattern) || name === pattern)) {
    return true
  }
  return false
}

/**
 * Check if element should be ignored entirely
 */
function shouldIgnoreElement(el: Element, rules: MutationFilterRules): boolean {
  if (!rules.ignoreElements?.length) return false
  
  for (const selector of rules.ignoreElements) {
    try {
      if (el.matches(selector)) return true
    } catch {
      // Invalid selector, try tag name match
      if (el.tagName.toLowerCase() === selector.toLowerCase()) return true
    }
  }
  return false
}

/**
 * Check if element matches "only" filter
 */
function matchesOnlyFilter(el: Element, rules: MutationFilterRules): boolean {
  if (!rules.onlySelectors?.length) return true // No filter = include all
  
  for (const selector of rules.onlySelectors) {
    try {
      if (el.matches(selector)) return true
    } catch {
      continue
    }
  }
  return false
}

// ==========================================
// DOM Tree Inspector
// ==========================================

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY'])
const DEFAULT_INTERESTING_CLASSES = ['-xin-event', '-xin-data', '-xin-']
const DEFAULT_INTERESTING_ATTRS = [
  'aria-', 'role', 'title', 'href', 'src', 'alt',
  'data-event', 'data-bind', 'data-list', 'data-component', 'data-testid',
  'disabled', 'hidden', 'open', 'checked', 'selected', 'required', 'readonly',
  'type', 'name', 'value', 'placeholder',
]
const DEFAULT_IGNORE_SELECTORS = [
  'script', 'style', 'link', 'meta', 'noscript', 'svg', 'path',
  // Chrome DevTools / React DevTools injected garbage
  '[data-reactroot-hidden]',
  '#__react-devtools-global-hook__',
  '[class*="__reactdevtools"]',
  // Other common DevTools injections
  '#__vconsole',
  '[id^="__"]', // Most DevTools use __prefix convention
]

/**
 * Build a DOM tree representation
 */
function buildDomTree(el: Element, options: DomTreeRequest, currentDepth = 0): DomTreeNode | null {
  const {
    depth = 3,
    includeText = true,
    allAttributes = false,
    includeStyles = false,
    includeBox = false,
    interestingClasses = DEFAULT_INTERESTING_CLASSES,
    interestingAttributes = DEFAULT_INTERESTING_ATTRS,
    ignoreSelectors = DEFAULT_IGNORE_SELECTORS,
    compact = false,
    pierceShadow = false,
  } = options

  // Check if should be ignored
  for (const selector of ignoreSelectors) {
    try {
      if (el.matches(selector)) return null
    } catch {
      if (el.tagName.toLowerCase() === selector.toLowerCase()) return null
    }
  }

  const tagName = el.tagName.toLowerCase()
  const htmlEl = el as HTMLElement
  
  // Build the node
  const node: DomTreeNode = {
    tag: tagName,
  }

  // ID (always include if present)
  if (el.id) {
    node.id = el.id
  }

  // Classes - filter to interesting ones unless allAttributes
  const allClasses = el.className?.toString().split(/\s+/).filter(Boolean) || []
  if (allClasses.length > 0) {
    if (allAttributes) {
      node.classes = allClasses
    } else {
      const interesting = allClasses.filter(cls => 
        interestingClasses.some(pattern => {
          try {
            return new RegExp(pattern).test(cls)
          } catch {
            return cls.includes(pattern)
          }
        })
      )
      if (interesting.length > 0) {
        node.classes = interesting
      } else if (!compact && allClasses.length <= 3) {
        // In non-compact mode, show up to 3 classes even if not "interesting"
        node.classes = allClasses.slice(0, 3)
      }
    }
  }

  // Attributes - filter to interesting ones unless allAttributes
  const attrs: Record<string, string> = {}
  for (const attr of el.attributes) {
    if (attr.name === 'id' || attr.name === 'class') continue // Already handled
    
    if (allAttributes) {
      attrs[attr.name] = attr.value
    } else {
      const isInteresting = interestingAttributes.some(pattern => 
        attr.name.startsWith(pattern) || attr.name === pattern
      )
      if (isInteresting) {
        attrs[attr.name] = attr.value
      }
    }
  }
  if (Object.keys(attrs).length > 0) {
    node.attrs = attrs
  }

  // Flags for quick scanning
  const flags: DomTreeNode['flags'] = {}
  
  // Check for event bindings (xinjs, b8r)
  if (allClasses.some(c => c.includes('-xin-event')) || el.hasAttribute('data-event')) {
    flags.hasEvents = true
  }
  
  // Check for data bindings
  if (allClasses.some(c => c.includes('-xin-data')) || 
      el.hasAttribute('data-bind') || 
      el.hasAttribute('data-list')) {
    flags.hasData = true
  }
  
  // Interactive element
  if (INTERACTIVE_TAGS.has(el.tagName)) {
    flags.interactive = true
  }
  
  // Custom element
  if (tagName.includes('-')) {
    flags.customElement = true
  }
  
  // Shadow DOM
  if (el.shadowRoot) {
    flags.shadowRoot = true
  }
  
  // Hidden
  if (htmlEl.hidden || el.getAttribute('aria-hidden') === 'true') {
    flags.hidden = true
  }
  
  // Has ARIA
  if (Array.from(el.attributes).some(a => a.name.startsWith('aria-') || a.name === 'role')) {
    flags.hasAria = true
  }
  
  if (Object.keys(flags).length > 0) {
    node.flags = flags
  }

  // Box model (if requested)
  if (includeBox) {
    const rect = el.getBoundingClientRect()
    const computed = getComputedStyle(el)
    const inViewport = rect.top < window.innerHeight && 
                       rect.bottom > 0 && 
                       rect.left < window.innerWidth && 
                       rect.right > 0
    node.box = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      visible: inViewport && computed.display !== 'none' && computed.visibility !== 'hidden',
    }
  }

  // Text content for leaf nodes or short text
  if (includeText) {
    const childElements = el.children.length
    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent?.trim())
      .filter(Boolean)
      .join(' ')
    
    if (childElements === 0 && directText) {
      // Leaf node with text
      node.text = directText.slice(0, 200)
    } else if (directText && directText.length <= 50) {
      // Short direct text even with children
      node.text = directText
    }
  }

  // Children (if not at max depth)
  const maxDepth = depth < 0 ? Infinity : depth
  // Shadow DOM children (if pierceShadow is enabled and element has shadow root)
  if (pierceShadow && el.shadowRoot && currentDepth < maxDepth) {
    const shadowChildren: DomTreeNode[] = []
    
    for (const child of el.shadowRoot.children) {
      // Skip our own widget and style elements in shadow DOM
      if (child.tagName === 'STYLE' || child.tagName === 'SLOT') continue
      if (shadowChildren.length >= 50) break
      
      const childNode = buildDomTree(child, options, currentDepth + 1)
      if (childNode) {
        shadowChildren.push(childNode)
      }
    }
    
    if (shadowChildren.length > 0) {
      node.shadowChildren = shadowChildren
    }
  }

  // Light DOM children
  if (currentDepth < maxDepth && el.children.length > 0) {
    const children: DomTreeNode[] = []
    let truncatedCount = 0
    
    for (const child of el.children) {
      // Limit children to prevent huge responses
      if (children.length >= 50) {
        truncatedCount = el.children.length - children.length
        break
      }
      
      const childNode = buildDomTree(child, options, currentDepth + 1)
      if (childNode) {
        children.push(childNode)
      }
    }
    
    if (children.length > 0) {
      node.children = children
    }
    
    if (truncatedCount > 0) {
      node.truncated = true
      node.childCount = el.children.length
    }
  } else if (el.children.length > 0) {
    // At max depth but has children - indicate truncation
    node.truncated = true
    node.childCount = el.children.length
  }

  return node
}

type ChannelState = 'disconnected' | 'connecting' | 'connected' | 'paused'

// Highlight overlay for visual pointing
let highlightOverlay: HTMLDivElement | null = null
let highlightLabel: HTMLDivElement | null = null
let highlightStyles: HTMLStyleElement | null = null

function createHighlightOverlay() {
  if (highlightOverlay) return
  
  // Inject CSS variables and styles once
  highlightStyles = document.createElement('style')
  highlightStyles.textContent = `
    :root {
      --tosijs-highlight: #6366f1;
      --tosijs-highlight-bg: rgba(99, 102, 241, 0.1);
      --tosijs-highlight-glow: rgba(99, 102, 241, 0.3);
    }
    
    #tosijs-dev-highlight {
      position: fixed;
      pointer-events: none;
      z-index: 999998;
      border: 3px solid var(--tosijs-highlight);
      border-radius: 4px;
      background: var(--tosijs-highlight-bg);
      box-shadow: 0 0 0 4px var(--tosijs-highlight-glow), 0 0 20px var(--tosijs-highlight-glow);
      transition: all 0.15s ease-out;
      display: none;
    }
    
    #tosijs-dev-highlight-label {
      position: absolute;
      top: -28px;
      left: -3px;
      background: var(--tosijs-highlight);
      color: white;
      font: 600 11px system-ui, -apple-system, sans-serif;
      padding: 4px 8px;
      border-radius: 4px 4px 0 0;
      white-space: nowrap;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `
  document.head.appendChild(highlightStyles)
  
  highlightOverlay = document.createElement('div')
  highlightOverlay.id = 'tosijs-dev-highlight'
  
  highlightLabel = document.createElement('div')
  highlightLabel.id = 'tosijs-dev-highlight-label'
  
  highlightOverlay.appendChild(highlightLabel)
  document.body.appendChild(highlightOverlay)
}

function showHighlight(el: Element, label?: string, color?: string) {
  createHighlightOverlay()
  if (!highlightOverlay || !highlightLabel) return
  
  const rect = el.getBoundingClientRect()
  
  // Set custom color via CSS variable if provided
  if (color) {
    highlightOverlay.style.setProperty('--tosijs-highlight', color)
    // Derive bg and glow from color
    const match = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    if (match) {
      const r = parseInt(match[1], 16)
      const g = parseInt(match[2], 16)
      const b = parseInt(match[3], 16)
      highlightOverlay.style.setProperty('--tosijs-highlight-bg', `rgba(${r}, ${g}, ${b}, 0.1)`)
      highlightOverlay.style.setProperty('--tosijs-highlight-glow', `rgba(${r}, ${g}, ${b}, 0.3)`)
    }
  } else {
    // Reset to defaults
    highlightOverlay.style.removeProperty('--tosijs-highlight')
    highlightOverlay.style.removeProperty('--tosijs-highlight-bg')
    highlightOverlay.style.removeProperty('--tosijs-highlight-glow')
  }
  
  // Position
  highlightOverlay.style.display = 'block'
  highlightOverlay.style.top = `${rect.top - 3}px`
  highlightOverlay.style.left = `${rect.left - 3}px`
  highlightOverlay.style.width = `${rect.width + 6}px`
  highlightOverlay.style.height = `${rect.height + 6}px`
  
  // Label
  const tagName = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const classes = el.className && typeof el.className === 'string' 
    ? '.' + el.className.split(' ').slice(0, 2).join('.') 
    : ''
  highlightLabel.textContent = label || `${tagName}${id}${classes}`
}

function hideHighlight() {
  if (highlightOverlay) {
    highlightOverlay.style.display = 'none'
  }
}

function pulseHighlight(el: Element, label?: string, color?: string, duration = 2000) {
  showHighlight(el, label, color)
  setTimeout(() => hideHighlight(), duration)
}

export class DevChannel extends HTMLElement {
  private ws: WebSocket | null = null
  private state: ChannelState = 'disconnected'
  private consoleBuffer: ConsoleEntry[] = []
  private eventWatchers: Map<string, () => void> = new Map()
  private mutationObserver: MutationObserver | null = null
  private shadowObservers: Map<ShadowRoot, MutationObserver> = new Map()
  private mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingMutations: MutationRecord[] = []
  private mutationConfig: MutationWatchRequest | null = null
  private mutationFilterRules: MutationFilterRules | null = null
  private recording: RecordingSession | null = null
  private testRecording: {
    steps: TestStep[]
    startUrl: string
    startTime: number
  } | null = null
  private originalConsole: Partial<Console> = {}
  private widgetHidden = false
  private serverUrl = 'wss://localhost:8700/ws/browser'
  private browserId = uid() // Unique ID for this browser instance
  private killed = false // Prevents reconnection after kill()
  private homeLeft = 0 // Store home position for restore
  private homeBottom = 16
  
  // Pending requests waiting for response
  private pending = new Map<string, { resolve: (r: DevResponse) => void, reject: (e: Error) => void }>()
  
  static get observedAttributes() {
    return ['server', 'hidden']
  }
  
  /**
   * Run browser-side tests
   * Usage: DevChannel.runTests() or from agent: POST /eval { code: "DevChannel.runTests()" }
   */
  static async runTests() {
    const el = document.querySelector('tosijs-dev') as DevChannel
    if (!el) {
      console.error('[tosijs-dev] No tosijs-dev element found. Inject first.')
      return { passed: 0, failed: 1, error: 'No tosijs-dev element' }
    }
    
    const results: Array<{ name: string; passed: boolean; error?: string }> = []
    
    const test = (name: string, fn: () => void | Promise<void>) => {
      return async () => {
        try {
          await fn()
          results.push({ name, passed: true })
          console.log(`  %c✓ ${name}`, 'color: #22c55e')
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          results.push({ name, passed: false, error })
          console.log(`  %c✗ ${name}: ${error}`, 'color: #ef4444')
        }
      }
    }
    
    console.log('%c[tosijs-dev] Running tests...', 'color: #6366f1; font-weight: bold')
    
    // Run tests
    await test('element exists', () => {
      if (!document.querySelector('tosijs-dev')) throw new Error('Missing')
    })()
    
    await test('has shadow root', () => {
      if (!el.shadowRoot) throw new Error('No shadow root')
    })()
    
    await test('widget visible', () => {
      const widget = el.shadowRoot?.querySelector('.widget')
      if (!widget) throw new Error('No widget')
    })()
    
    await test('status indicator', () => {
      const status = el.shadowRoot?.querySelector('.status')
      if (!status) throw new Error('No status')
    })()
    
    await test('control buttons', () => {
      const btns = el.shadowRoot?.querySelectorAll('.btn')
      if (!btns || btns.length < 3) throw new Error(`Expected 3 buttons, got ${btns?.length}`)
    })()
    
    await test('bookmark link', () => {
      const link = el.shadowRoot?.querySelector('a[href^="javascript:"]')
      if (!link) throw new Error('No bookmark link')
    })()
    
    await test('console interception', async () => {
      const marker = `test-${Date.now()}`
      const before = el.consoleBuffer.length
      console.log(marker)
      await new Promise(r => setTimeout(r, 50))
      if (el.consoleBuffer.length <= before) throw new Error('Console not captured')
    })()
    
    await test('DOM query', () => {
      const body = document.querySelector('body')
      if (!body) throw new Error('No body element')
      // Test that extractElement works (used internally)
    })()
    
    await test('connection state valid', () => {
      const valid = ['disconnected', 'connecting', 'connected', 'paused']
      if (!valid.includes(el.state)) throw new Error(`Invalid state: ${el.state}`)
    })()
    
    const passed = results.filter(r => r.passed).length
    const failed = results.filter(r => !r.passed).length
    const color = failed === 0 ? '#22c55e' : '#ef4444'
    
    console.log(`%c[tosijs-dev] ${passed}/${results.length} tests passed`, `color: ${color}; font-weight: bold`)
    
    return { passed, failed, results }
  }
  
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }
  
  connectedCallback() {
    this.serverUrl = this.getAttribute('server') || this.serverUrl
    this.render()
    // Set initial position using left (calculate from right: 16px after render so we know width)
    const rect = this.getBoundingClientRect()
    this.homeLeft = window.innerWidth - rect.width - 16
    this.homeBottom = 16
    this.style.left = `${this.homeLeft}px`
    this.style.bottom = `${this.homeBottom}px`
    this.setupKeyboardShortcut()
    this.interceptConsole()
    this.connect()
  }
  
  disconnectedCallback() {
    this.killed = true // Prevent any reconnection attempts
    this.disconnect()
    this.restoreConsole()
    this.clearEventWatchers()
    this.stopMutationWatch()
  }
  
  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === 'server') {
      this.serverUrl = value
      if (this.state !== 'disconnected') {
        this.disconnect()
        this.connect()
      }
    }
  }
  
  // ==========================================
  // UI Rendering
  // ==========================================
  
  private render() {
    // Only do full render once
    if (this.shadowRoot!.querySelector('.widget')) {
      this.updateUI()
      return
    }
    
    const shadow = this.shadowRoot!
    
    shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          z-index: 999999;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 12px;
        }
        
        :host(.animating-hide) {
          transition: left 0.3s ease-out, bottom 0.3s ease-in;
        }
        
        :host(.animating-show) {
          transition: left 0.3s ease-in, bottom 0.3s ease-out;
        }
        

        
        .widget {
          background: #1a1a2e;
          color: #eee;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          overflow: hidden;
          min-width: 180px;
          transition: all 0.3s ease-out;
        }
        
        :host(.minimized) .widget {
          border-radius: 8px 8px 0 0;
        }
        
        :host(.minimized) .body {
          display: none;
        }
        
        .widget.flash {
          animation: flash 0.5s ease-out;
        }
        
        @keyframes flash {
          0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
          50% { box-shadow: 0 0 30px rgba(99, 102, 241, 0.8); }
        }
        
        .header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #16213e;
          cursor: move;
          user-select: none;
        }
        
        .status {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #666;
        }
        
        .status.connected { background: #22c55e; }
        .status.connecting { background: #eab308; animation: pulse 1s infinite; }
        .status.paused { background: #f97316; }
        .status.disconnected { background: #ef4444; }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        .title {
          flex: 1;
          font-weight: 500;
          font-size: 12px;
        }
        
        .indicators {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        
        .indicator {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 500;
        }
        
        .indicator.errors {
          background: #ef4444;
          color: white;
        }
        
        .indicator.recording {
          background: #ef4444;
          color: white;
          animation: pulse 1s infinite;
        }
        
        .controls {
          display: flex;
          gap: 4px;
        }
        
        .btn {
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          font-size: 14px;
          line-height: 1;
        }
        
        .btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .btn.active { color: #6366f1; }
        .btn.danger:hover { color: #ef4444; }
        
        .body {
          padding: 8px 12px;
          font-size: 10px;
          color: #666;
        }
        
        .test-controls {
          display: flex;
          gap: 4px;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #333;
        }
        
        .test-btn {
          flex: 1;
          background: #2a2a4a;
          border: 1px solid #444;
          color: #aaa;
          cursor: pointer;
          padding: 6px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        
        .test-btn:hover { background: #3a3a5a; color: #fff; border-color: #666; }
        .test-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .test-btn.recording { background: #4a2a2a; border-color: #ef4444; color: #ef4444; }
        .test-btn.recording:hover { background: #5a3a3a; }
        
        .step-count {
          font-size: 9px;
          color: #888;
          margin-top: 4px;
        }
      </style>
      
      <div class="widget">
        <div class="header">
          <div class="status"></div>
          <div class="title">🦉 tosijs-dev</div>
          <div class="indicators"></div>
          <div class="controls">
            <button class="btn" data-action="pause" title="Pause/Resume">⏸</button>
            <button class="btn" data-action="minimize" title="Minimize (⌥Tab)">─</button>
            <button class="btn danger" data-action="kill" title="Close">✕</button>
          </div>
        </div>
        <div class="body">
            <a href="javascript:(function(){fetch('${this.serverUrl.replace('ws:', 'http:').replace('wss:', 'https:').replace('/ws/browser', '')}/inject.js').then(r=>r.text()).then(eval).catch(e=>alert('tosijs-dev: Cannot reach server'))})();" 
               style="color: #6366f1; text-decoration: none;"
               title="Drag to bookmarks bar"
               class="bookmark-link">🦉 bookmark</a>
        </div>
      </div>
    `
    
    this.updateUI()
    
    // Event handlers (only set up once)
    shadow.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation() // Don't trigger drag
      })
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const action = (e.currentTarget as HTMLElement).dataset.action
        if (action === 'pause') this.togglePause()
        if (action === 'minimize') this.toggleMinimize()
        if (action === 'kill') this.kill()
      })
    })
    
    // Bookmark link - show "🦉 tosijs-dev" on hover so drag gets useful name
    const bookmarkLink = shadow.querySelector('.bookmark-link') as HTMLAnchorElement
    if (bookmarkLink) {
      bookmarkLink.addEventListener('mouseenter', () => {
        bookmarkLink.textContent = '🦉 tosijs-dev'
      })
      bookmarkLink.addEventListener('mouseleave', () => {
        bookmarkLink.textContent = '🦉 bookmark'
      })
    }
    

    
    // Drag support
    this.setupDrag(shadow.querySelector('.header')!)
  }
  
  private updateUI() {
    const shadow = this.shadowRoot!
    
    // Update status indicator
    const status = shadow.querySelector('.status')
    if (status) {
      status.className = `status ${this.state}`
    }
    
    // Update pause button
    const pauseBtn = shadow.querySelector('[data-action="pause"]')
    if (pauseBtn) {
      pauseBtn.textContent = this.state === 'paused' ? '▶' : '⏸'
    }
    
    // Update indicators
    const indicators = shadow.querySelector('.indicators')
    if (indicators) {
      const errorCount = this.consoleBuffer.filter(e => e.level === 'error').length
      let html = ''
      if (errorCount > 0) {
        html += `<span class="indicator errors">${errorCount} error${errorCount > 1 ? 's' : ''}</span>`
      }
      if (this.recording) {
        html += `<span class="indicator recording">REC</span>`
      }
      indicators.innerHTML = html
    }
    
  }
  
  private setupDrag(handle: Element) {
    let startX = 0, startY = 0, startLeft = 0, startBottom = 0
    
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      this.style.left = `${startLeft + dx}px`
      this.style.bottom = `${startBottom - dy}px`
    }
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      // Save current position as home (but not if minimized)
      if (!this.classList.contains('minimized')) {
        const rect = this.getBoundingClientRect()
        this.homeLeft = rect.left
        this.homeBottom = window.innerHeight - rect.bottom
      }
    }
    
    handle.addEventListener('mousedown', (e: Event) => {
      const me = e as MouseEvent
      startX = me.clientX
      startY = me.clientY
      
      // Get current position
      const rect = this.getBoundingClientRect()
      startLeft = rect.left
      startBottom = window.innerHeight - rect.bottom
      
      // If minimized, just remove the class (position is already left-based)
      if (this.classList.contains('minimized')) {
        this.classList.remove('minimized')
      }
      
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    })
  }
  
  private setupKeyboardShortcut() {
    document.addEventListener('keydown', (e) => {
      // Option+Tab to toggle minimize
      if (e.altKey && e.key === 'Tab') {
        e.preventDefault()
        this.toggleMinimize()
      }
    })
  }
  
  private flash() {
    const widget = this.shadowRoot?.querySelector('.widget')
    widget?.classList.add('flash')
    setTimeout(() => widget?.classList.remove('flash'), 500)
  }
  
  private show() {
    this.widgetHidden = false
    this.render()
    this.flash()
  }
  
  private toggleHidden() {
    this.widgetHidden = !this.widgetHidden
    this.render()
  }
  
  private toggleMinimize() {
    const isMinimized = this.classList.contains('minimized')
    
    // Capture current position before any changes
    const rect = this.getBoundingClientRect()
    const currentLeft = rect.left
    const currentBottom = window.innerHeight - rect.bottom
    
    if (isMinimized) {
      // Restoring: animate from current (minimized) position to home
      // 1. Ensure starting position is set
      this.style.left = `${currentLeft}px`
      this.style.bottom = `${currentBottom}px`
      this.classList.remove('minimized')
      
      // 2. Force reflow so browser knows starting point
      this.offsetHeight
      
      // 3. Add transition and set target
      this.classList.add('animating-show')
      this.style.left = `${this.homeLeft}px`
      this.style.bottom = `${this.homeBottom}px`
      
      // Cleanup
      setTimeout(() => this.classList.remove('animating-show'), 350)
    } else {
      // Minimizing: animate from current position to corner
      // 1. Save home and ensure starting position is set
      this.homeLeft = currentLeft
      this.homeBottom = currentBottom
      this.style.left = `${currentLeft}px`
      this.style.bottom = `${currentBottom}px`
      
      // 2. Force reflow so browser knows starting point
      this.offsetHeight
      
      // 3. Add transition and set target
      this.classList.add('animating-hide')
      this.style.left = '16px'
      this.style.bottom = '0px'
      this.classList.add('minimized')
      
      // Cleanup
      setTimeout(() => this.classList.remove('animating-hide'), 350)
    }
  }
  
  private togglePause() {
    if (this.state === 'paused') {
      this.state = 'connected'
      this.show() // Always show when resuming
    } else if (this.state === 'connected') {
      this.state = 'paused'
      // Clean up any visual artifacts when pausing
      hideHighlight()
      this.stopMutationWatch()
    }
    this.render()
  }
  
  private kill() {
    this.killed = true // Prevent reconnection
    hideHighlight() // Clean up visual artifacts
    this.restoreConsole()
    this.clearEventWatchers()
    this.stopMutationWatch()
    this.stopTestRecording()
    this.disconnect()
    this.remove()
  }
  
  // ==========================================
  // Test Recording (JSON Test Generation)
  // ==========================================
  
  private testRecordingHandler: ((e: Event) => void) | null = null
  
  private toggleTestRecording() {
    if (this.testRecording) {
      this.stopTestRecording()
    } else {
      this.startTestRecording()
    }
    this.render()
  }
  
  private startTestRecording() {
    this.testRecording = {
      steps: [],
      startUrl: location.href,
      startTime: Date.now(),
    }
    
    // Attach event listeners to capture user actions
    this.testRecordingHandler = (e: Event) => {
      if (!this.testRecording) return
      
      const target = e.target as Element
      if (!target || target.closest('tosijs-dev')) return // Ignore widget clicks
      
      const step = this.eventToTestStep(e)
      if (step) {
        this.testRecording.steps.push(step)
        this.render()
        
        // Send to server for live monitoring
        this.send('test-recording', 'step', { 
          index: this.testRecording.steps.length - 1,
          step 
        })
      }
    }
    
    // Capture clicks, input, and form submissions
    document.addEventListener('click', this.testRecordingHandler, true)
    document.addEventListener('input', this.testRecordingHandler, true)
    document.addEventListener('change', this.testRecordingHandler, true)
    document.addEventListener('submit', this.testRecordingHandler, true)
    
    this.send('test-recording', 'started', { url: location.href })
  }
  
  private stopTestRecording() {
    if (this.testRecordingHandler) {
      document.removeEventListener('click', this.testRecordingHandler, true)
      document.removeEventListener('input', this.testRecordingHandler, true)
      document.removeEventListener('change', this.testRecordingHandler, true)
      document.removeEventListener('submit', this.testRecordingHandler, true)
      this.testRecordingHandler = null
    }
    
    if (this.testRecording) {
      this.send('test-recording', 'stopped', { 
        stepCount: this.testRecording.steps.length 
      })
    }
    
    // Don't clear testRecording - keep it for save
  }
  
  /**
   * Generate a stable, unique selector for an element
   * Priority: id > data-testid > name > stable classes > path
   */
  private getBestSelector(el: Element): string {
    // ID is best
    if (el.id) {
      return `#${el.id}`
    }
    
    // data-testid is designed for testing
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id')
    if (testId) {
      return `[data-testid="${testId}"]`
    }
    
    // For form elements, name attribute is stable
    const name = el.getAttribute('name')
    if (name && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) {
      return `${el.tagName.toLowerCase()}[name="${name}"]`
    }
    
    // For buttons/links, unique text content
    if (el.tagName === 'BUTTON' || el.tagName === 'A') {
      const text = (el as HTMLElement).innerText?.trim()
      if (text && text.length < 50 && !text.includes('\n')) {
        // Check if this text is unique on the page
        const matches = document.querySelectorAll(`${el.tagName.toLowerCase()}`)
        const textMatches = Array.from(matches).filter(m => 
          (m as HTMLElement).innerText?.trim() === text
        )
        if (textMatches.length === 1) {
          return `${el.tagName.toLowerCase()}:contains("${text.slice(0, 30)}")`
        }
      }
    }
    
    // Fall back to class-based selector if classes look stable (not utility classes)
    const classList = Array.from(el.classList).filter(c => 
      !c.match(/^(p|m|w|h|text|bg|flex|grid|hidden|block|inline)-/) && // Tailwind
      !c.match(/^-?xin-/) && // xinjs transient
      c.length > 2
    )
    
    if (classList.length > 0) {
      const selector = `${el.tagName.toLowerCase()}.${classList.slice(0, 2).join('.')}`
      // Check uniqueness
      if (document.querySelectorAll(selector).length === 1) {
        return selector
      }
    }
    
    // Fall back to getSelector (full path)
    return getSelector(el)
  }
  
  /**
   * Convert a DOM event to a test step
   */
  private eventToTestStep(e: Event): TestStep | null {
    const target = e.target as Element
    const selector = this.getBestSelector(target)
    
    if (e.type === 'click') {
      // Ignore clicks on inputs (they're followed by input events)
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return null
      }
      
      return {
        action: 'click',
        selector,
        description: this.describeElement(target),
      }
    }
    
    if (e.type === 'input' || e.type === 'change') {
      const inputEl = target as HTMLInputElement
      
      // Debounce: if last step was same selector input, update it
      if (this.testRecording && this.testRecording.steps.length > 0) {
        const lastStep = this.testRecording.steps[this.testRecording.steps.length - 1]
        if (lastStep.action === 'type' && lastStep.selector === selector) {
          lastStep.text = inputEl.value
          return null // Don't add new step
        }
      }
      
      return {
        action: 'type',
        selector,
        text: inputEl.value,
        description: this.describeElement(target),
      }
    }
    
    if (e.type === 'submit') {
      // Find submit button or first button in form
      const form = target as HTMLFormElement
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')
      if (submitBtn) {
        return {
          action: 'click',
          selector: this.getBestSelector(submitBtn),
          description: 'Submit form',
        }
      }
    }
    
    return null
  }
  
  /**
   * Generate a human-readable description of an element
   */
  private describeElement(el: Element): string {
    const tag = el.tagName.toLowerCase()
    const htmlEl = el as HTMLElement
    
    // Buttons and links: use text
    if (tag === 'button' || tag === 'a') {
      const text = htmlEl.innerText?.trim().slice(0, 30)
      if (text) return `Click "${text}"`
    }
    
    // Inputs: use label or placeholder or name
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const inputEl = el as HTMLInputElement
      
      // Find associated label
      const labelFor = inputEl.id && document.querySelector(`label[for="${inputEl.id}"]`)
      if (labelFor) {
        return `Enter ${(labelFor as HTMLElement).innerText?.trim()}`
      }
      
      // Use placeholder
      if (inputEl.placeholder) {
        return `Enter ${inputEl.placeholder}`
      }
      
      // Use name
      if (inputEl.name) {
        return `Enter ${inputEl.name.replace(/[_-]/g, ' ')}`
      }
      
      // Use type
      if (inputEl.type) {
        return `Enter ${inputEl.type}`
      }
    }
    
    return `Interact with ${tag}`
  }
  
  /**
   * Add an assertion at the current state
   */
  private addTestAssertion() {
    if (!this.testRecording) return
    
    // Prompt for assertion type
    const type = prompt(
      'What to check?\n\n' +
      '1. Element exists (selector)\n' +
      '2. Text content (selector, text)\n' +
      '3. Input value (selector, value)\n' +
      '4. URL contains (pattern)\n' +
      '5. Element visible (selector)\n\n' +
      'Enter number (1-5):'
    )
    
    if (!type) return
    
    let assertion: TestAssertion | null = null
    let description = ''
    
    switch (type.trim()) {
      case '1': {
        const selector = prompt('Enter CSS selector:')
        if (selector) {
          assertion = { type: 'exists', selector }
          description = `Verify ${selector} exists`
        }
        break
      }
      case '2': {
        const selector = prompt('Enter CSS selector:')
        const text = prompt('Enter expected text (or part of it):')
        if (selector && text) {
          assertion = { type: 'text', selector, text, contains: true }
          description = `Verify ${selector} contains "${text}"`
        }
        break
      }
      case '3': {
        const selector = prompt('Enter CSS selector for input:')
        const value = prompt('Enter expected value:')
        if (selector && value) {
          assertion = { type: 'value', selector, value }
          description = `Verify ${selector} has value "${value}"`
        }
        break
      }
      case '4': {
        const pattern = prompt('Enter URL pattern to match:')
        if (pattern) {
          assertion = { type: 'url', pattern }
          description = `Verify URL contains "${pattern}"`
        }
        break
      }
      case '5': {
        const selector = prompt('Enter CSS selector:')
        if (selector) {
          assertion = { type: 'visible', selector }
          description = `Verify ${selector} is visible`
        }
        break
      }
    }
    
    if (assertion) {
      const step: TestStep = {
        action: 'assert',
        assertion,
        description,
      }
      this.testRecording.steps.push(step)
      this.render()
      
      this.send('test-recording', 'assertion', { 
        index: this.testRecording.steps.length - 1,
        step 
      })
    }
  }
  
  /**
   * Save the recorded test as JSON
   */
  private saveTest() {
    if (!this.testRecording || this.testRecording.steps.length === 0) {
      alert('No steps recorded!')
      return
    }
    
    const name = prompt('Test name:', 'Recorded test')
    if (!name) return
    
    const description = prompt('Test description (optional):')
    
    const test: DevChannelTest = {
      version: 1,
      name,
      description: description || undefined,
      url: this.testRecording.startUrl,
      createdAt: this.testRecording.startTime,
      createdBy: 'human',
      steps: this.testRecording.steps,
    }
    
    // Create JSON and trigger download
    const json = JSON.stringify(test, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.toLowerCase().replace(/\s+/g, '-')}.test.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    // Also send to server
    this.send('test-recording', 'saved', { test })
    
    // Clear recording
    this.testRecording = null
    this.render()
    
    alert(`Test saved: ${a.download}`)
  }
  
  // ==========================================
  // WebSocket Connection
  // ==========================================
  
  private connect() {
    if (this.ws) return
    if (this.killed) return // Don't connect if killed
    
    this.state = 'connecting'
    this.render()
    
    try {
      this.ws = new WebSocket(this.serverUrl)
      
      this.ws.onopen = () => {
        this.state = 'connected'
        this.show() // Always show when connection established
        this.send('system', 'connected', { 
          browserId: this.browserId, 
          version: VERSION,
          serverSessionId: SERVER_SESSION_ID,
          url: location.href, 
          title: document.title 
        })
      }
      
      this.ws.onmessage = (e) => {
        if (this.state === 'paused') return
        
        try {
          const msg: DevMessage = JSON.parse(e.data)
          this.handleMessage(msg)
        } catch {
          // Invalid message, ignore
        }
      }
      
      this.ws.onclose = () => {
        this.ws = null
        this.state = 'disconnected'
        this.render()
        // Reconnect after delay (unless killed)
        if (!this.killed) {
          setTimeout(() => this.connect(), 3000)
        }
      }
      
      this.ws.onerror = () => {
        this.ws?.close()
      }
    } catch (err) {
      this.state = 'disconnected'
      this.render()
    }
  }
  
  private disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.state = 'disconnected'
    this.pending.forEach(p => p.reject(new Error('Disconnected')))
    this.pending.clear()
  }
  
  private send(channel: string, action: string, payload: any, id?: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    
    const msg: DevMessage = {
      id: id || uid(),
      channel,
      action,
      payload,
      timestamp: Date.now(),
      source: 'browser',
    }
    
    this.ws.send(JSON.stringify(msg))
  }
  
  private respond(requestId: string, success: boolean, data?: any, error?: string) {
    const response: DevResponse = {
      id: requestId,
      success,
      data,
      error,
      timestamp: Date.now(),
    }
    this.ws?.send(JSON.stringify(response))
  }
  
  // ==========================================
  // Message Handling
  // ==========================================
  
  private handleMessage(msg: DevMessage) {
    // Always show when receiving commands (no silent snooping)
    if (msg.source === 'agent' || msg.source === 'server') {
      this.show()
    }
    
    switch (msg.channel) {
      case 'system':
        this.handleSystemMessage(msg)
        break
      case 'dom':
        this.handleDomMessage(msg)
        break
      case 'events':
        this.handleEventsMessage(msg)
        break
      case 'console':
        this.handleConsoleMessage(msg)
        break
      case 'eval':
        this.handleEvalMessage(msg)
        break
      case 'recording':
        this.handleRecordingMessage(msg)
        break
      case 'navigation':
        this.handleNavigationMessage(msg)
        break
      case 'mutations':
        this.handleMutationsMessage(msg)
        break
    }
    
    this.render()
  }
  
  private handleSystemMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    // When we see another browser connect, kill ourselves
    if (action === 'connected' && payload?.browserId && payload.browserId !== this.browserId) {
      this.kill()
    }
    
    // Respond to version request
    if (action === 'version') {
      this.respond(msg.id, true, { 
        version: VERSION,
        browserId: this.browserId,
        url: location.href,
        title: document.title,
        state: this.state,
      })
    }
    
    // Reload the widget with fresh code from server
    if (action === 'reload') {
      this.respond(msg.id, true, { reloading: true, oldVersion: VERSION })
      
      // Disconnect and remove current widget
      this.ws?.close()
      
      // Fetch and eval fresh component.js
      const serverUrl = this.serverUrl.replace('/ws/browser', '')
        .replace('ws://', 'http://')
        .replace('wss://', 'https://')
      
      fetch(`${serverUrl}/component.js?t=${Date.now()}`)
        .then(r => r.text())
        .then(code => {
          // Remove old element
          this.remove()
          // Eval new code and create fresh widget
          eval(code)
          const newWidget = document.createElement('tosijs-dev')
          document.body.appendChild(newWidget)
        })
        .catch(err => {
          console.error('[tosijs-dev] Failed to reload:', err)
        })
    }
  }
  
  private handleNavigationMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    if (action === 'refresh') {
      if (payload.hard) {
        // Hard refresh - bypass cache
        location.reload()
      } else {
        location.reload()
      }
      this.respond(msg.id, true)
    } else if (action === 'goto') {
      location.href = payload.url
      this.respond(msg.id, true)
    } else if (action === 'location') {
      this.respond(msg.id, true, {
        url: location.href,
        title: document.title,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      })
    }
  }
  
  private handleDomMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    if (action === 'query') {
      const req = payload as DomQueryRequest
      try {
        if (req.all) {
          const elements = document.querySelectorAll(req.selector)
          this.respond(msg.id, true, Array.from(elements).map(extractElement))
        } else {
          const el = document.querySelector(req.selector)
          this.respond(msg.id, true, el ? extractElement(el) : null)
        }
      } catch (err: any) {
        this.respond(msg.id, false, null, err.message)
      }
    } else if (action === 'inspect') {
      try {
        const el = document.querySelector(payload.selector)
        if (!el) {
          this.respond(msg.id, false, null, `Element not found: ${payload.selector}`)
          return
        }
        this.respond(msg.id, true, inspectElement(el))
      } catch (err: any) {
        this.respond(msg.id, false, null, err.message)
      }
    } else if (action === 'inspectAll') {
      try {
        const elements = document.querySelectorAll(payload.selector)
        const results = Array.from(elements).slice(0, payload.limit || 10).map(el => inspectElement(el))
        this.respond(msg.id, true, results)
      } catch (err: any) {
        this.respond(msg.id, false, null, err.message)
      }
    } else if (action === 'highlight') {
      try {
        const el = document.querySelector(payload.selector)
        if (!el) {
          this.respond(msg.id, false, null, `Element not found: ${payload.selector}`)
          return
        }
        if (payload.duration) {
          pulseHighlight(el, payload.label, payload.color, payload.duration)
        } else {
          showHighlight(el, payload.label, payload.color)
        }
        this.respond(msg.id, true, { highlighted: payload.selector })
      } catch (err: any) {
        this.respond(msg.id, false, null, err.message)
      }
    } else if (action === 'unhighlight') {
      hideHighlight()
      this.respond(msg.id, true)
    } else if (action === 'tree') {
      // Build a DOM tree representation
      try {
        const request = payload as DomTreeRequest
        const el = document.querySelector(request.selector)
        if (!el) {
          this.respond(msg.id, false, null, `Element not found: ${request.selector}`)
          return
        }
        const tree = buildDomTree(el, request)
        this.respond(msg.id, true, tree)
      } catch (err: any) {
        this.respond(msg.id, false, null, err.message)
      }
    } else if (action === 'screenshot') {
      // Note: This captures via the page, not the highlight overlay
      // The highlight will be visible in the screenshot if it's showing
      try {
        // Use html2canvas if available, otherwise return viewport info
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          devicePixelRatio: window.devicePixelRatio,
          url: location.href,
          title: document.title,
        }
        // Could integrate html2canvas here for actual screenshot
        this.respond(msg.id, true, { viewport, note: 'Use browser devtools or Playwright for actual screenshot capture' })
      } catch (err: any) {
        this.respond(msg.id, false, null, err.message)
      }
    }
  }
  
  private handleEventsMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    if (action === 'watch') {
      const req = payload as EventWatchRequest
      this.watchEvents(req, msg.id)
    } else if (action === 'unwatch') {
      const unwatcher = this.eventWatchers.get(payload.watchId)
      if (unwatcher) {
        unwatcher()
        this.eventWatchers.delete(payload.watchId)
      }
      this.respond(msg.id, true)
    } else if (action === 'dispatch') {
      this.dispatchSyntheticEvent(payload as SyntheticEventRequest, msg.id)
    }
  }
  
  private handleConsoleMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    if (action === 'get') {
      const since = payload?.since || 0
      const entries = this.consoleBuffer.filter(e => e.timestamp > since)
      this.respond(msg.id, true, entries)
    } else if (action === 'clear') {
      this.consoleBuffer = []
      this.respond(msg.id, true)
    }
  }
  
  private handleEvalMessage(msg: DevMessage) {
    try {
      // Note: eval is dangerous but this is a dev tool for localhost
      const result = eval(msg.payload.code)
      this.respond(msg.id, true, result)
    } catch (err: any) {
      this.respond(msg.id, false, null, err.message)
    }
  }
  
  private handleRecordingMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    if (action === 'start') {
      this.recording = {
        id: uid(),
        name: payload.name || 'Recording',
        startTime: Date.now(),
        events: [],
        consoleEntries: [],
      }
      // Watch common interaction events
      this.watchEvents({
        events: ['click', 'input', 'change', 'keydown', 'submit', 'focus', 'blur'],
      }, `recording-${this.recording.id}`)
      this.respond(msg.id, true, { sessionId: this.recording.id })
    } else if (action === 'stop') {
      if (this.recording) {
        this.recording.endTime = Date.now()
        this.recording.consoleEntries = [...this.consoleBuffer]
        const session = this.recording
        // Stop event watching
        this.eventWatchers.get(`recording-${session.id}`)?.()
        this.eventWatchers.delete(`recording-${session.id}`)
        this.recording = null
        this.respond(msg.id, true, session)
      } else {
        this.respond(msg.id, false, null, 'No active recording')
      }
    } else if (action === 'replay') {
      this.replaySession(payload.session, payload.speed || 1, msg.id)
    }
  }
  
  // ==========================================
  // DOM Mutation Watching
  // ==========================================
  
  private handleMutationsMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    try {
      if (action === 'watch') {
        this.startMutationWatch(payload as MutationWatchRequest)
        this.respond(msg.id, true, { watching: true })
      } else if (action === 'unwatch') {
        this.stopMutationWatch()
        this.respond(msg.id, true, { watching: false })
      } else if (action === 'status') {
        this.respond(msg.id, true, { 
          watching: this.mutationObserver !== null,
          config: this.mutationConfig 
        })
      }
    } catch (err: any) {
      this.respond(msg.id, false, null, err.message)
    }
  }
  
  private startMutationWatch(config: MutationWatchRequest) {
    // Stop any existing observer
    this.stopMutationWatch()
    
    this.mutationConfig = config
    const root = config.root ? document.querySelector(config.root) : document.body
    
    if (!root) {
      this.send('mutations', 'error', { error: `Root element not found: ${config.root}` })
      return
    }
    
    // Compute filter rules based on preset and custom filters
    const preset = config.preset ?? 'smart'
    let presetRules: MutationFilterRules
    
    if (preset === 'smart') {
      // Auto-detect frameworks and merge their rules
      const detected = detectFramework()
      const detectedRules = detected.map(p => FILTER_PRESETS[p])
      presetRules = mergeFilterRules(FILTER_PRESETS.smart, ...detectedRules)
      this.send('mutations', 'detected', { frameworks: detected })
    } else {
      presetRules = FILTER_PRESETS[preset]
    }
    
    // Merge with custom filters
    this.mutationFilterRules = mergeFilterRules(presetRules, config.filters)
    
    const debounceMs = config.debounce ?? 100
    
    this.mutationObserver = new MutationObserver((mutations) => {
      // Accumulate mutations
      this.pendingMutations.push(...mutations)
      
      // Debounce: wait for DOM to settle before sending batch
      if (this.mutationDebounceTimer) {
        clearTimeout(this.mutationDebounceTimer)
      }
      
      this.mutationDebounceTimer = setTimeout(() => {
        this.flushMutations()
      }, debounceMs)
    })
    
    const observerOptions = {
      childList: config.childList ?? true,
      attributes: config.attributes ?? true,
      characterData: config.characterData ?? false,
      subtree: config.subtree ?? true,
      attributeOldValue: config.attributes ?? true,
      characterDataOldValue: config.characterData ?? false,
    }
    
    this.mutationObserver.observe(root, observerOptions)
    
    // If pierceShadow is enabled, also observe inside shadow roots
    if (config.pierceShadow) {
      this.attachShadowObservers(root as Element, observerOptions, debounceMs)
    }
    
    this.send('mutations', 'started', { config, shadowRoots: this.shadowObservers.size })
  }
  
  /**
   * Find all shadow roots in the subtree and attach mutation observers
   */
  private attachShadowObservers(
    root: Element, 
    options: MutationObserverInit, 
    debounceMs: number
  ) {
    const attachToShadowRoot = (shadowRoot: ShadowRoot) => {
      if (this.shadowObservers.has(shadowRoot)) return
      
      const observer = new MutationObserver((mutations) => {
        this.pendingMutations.push(...mutations)
        
        if (this.mutationDebounceTimer) {
          clearTimeout(this.mutationDebounceTimer)
        }
        
        this.mutationDebounceTimer = setTimeout(() => {
          this.flushMutations()
        }, debounceMs)
      })
      
      observer.observe(shadowRoot, options)
      this.shadowObservers.set(shadowRoot, observer)
      
      // Recursively check for nested shadow roots
      for (const el of shadowRoot.querySelectorAll('*')) {
        if (el.shadowRoot) {
          attachToShadowRoot(el.shadowRoot)
        }
      }
    }
    
    // Find all elements with shadow roots in the main tree
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        attachToShadowRoot(el.shadowRoot)
      }
    }
    
    // Also check root itself
    if ((root as Element).shadowRoot) {
      attachToShadowRoot((root as Element).shadowRoot!)
    }
  }
  
  /**
   * Check newly added elements for shadow roots and attach observers
   */
  private checkNewElementsForShadowRoots(mutations: MutationRecord[]) {
    if (!this.mutationConfig?.pierceShadow) return
    
    const debounceMs = this.mutationConfig.debounce ?? 100
    const options = {
      childList: this.mutationConfig.childList ?? true,
      attributes: this.mutationConfig.attributes ?? true,
      characterData: this.mutationConfig.characterData ?? false,
      subtree: this.mutationConfig.subtree ?? true,
      attributeOldValue: this.mutationConfig.attributes ?? true,
      characterDataOldValue: this.mutationConfig.characterData ?? false,
    }
    
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element
          if (el.shadowRoot) {
            this.attachShadowObservers(el, options, debounceMs)
          }
          // Check children too
          for (const child of el.querySelectorAll('*')) {
            if (child.shadowRoot) {
              this.attachShadowObservers(child, options, debounceMs)
            }
          }
        }
      }
    }
  }
  
  private stopMutationWatch() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }
    
    // Disconnect all shadow root observers
    for (const observer of this.shadowObservers.values()) {
      observer.disconnect()
    }
    this.shadowObservers.clear()
    
    if (this.mutationDebounceTimer) {
      clearTimeout(this.mutationDebounceTimer)
      this.mutationDebounceTimer = null
    }
    this.pendingMutations = []
    this.mutationConfig = null
    this.mutationFilterRules = null
  }
  
  private flushMutations() {
    if (this.pendingMutations.length === 0) return
    
    const mutations = this.pendingMutations
    this.pendingMutations = []
    
    // Check for new elements with shadow roots (for dynamic shadow DOM watching)
    this.checkNewElementsForShadowRoots(mutations)
    
    const rules = this.mutationFilterRules || {}
    
    // Summarize the batch
    let added = 0
    let removed = 0
    let attributeChanges = 0
    let textChanges = 0
    let ignored = 0
    const notable: NotableMutation[] = []
    
    for (const m of mutations) {
      if (m.type === 'childList') {
        // Track added nodes
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element
            
            // Check if should be ignored
            if (shouldIgnoreElement(el, rules)) {
              ignored++
              continue
            }
            
            // Check if passes "only" filter
            if (!matchesOnlyFilter(el, rules)) {
              ignored++
              continue
            }
            
            added++
            
            // Determine if notable
            const hasId = !!el.id
            const isSignificant = ['DIALOG', 'MODAL', 'FORM', 'BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
            const isCustomElement = el.tagName.includes('-')
            
            // Check for interesting classes
            const classes = el.className?.toString().split(/\s+/).filter(Boolean) || []
            const { interesting: interestingClasses } = filterClasses(classes, rules)
            const hasInterestingClasses = interestingClasses.length > 0
            
            // Check for interesting attributes
            const hasInterestingAttrs = Array.from(el.attributes).some(
              attr => isInterestingAttribute(attr.name, rules)
            )
            
            if (hasId || isSignificant || isCustomElement || hasInterestingClasses || hasInterestingAttrs) {
              const mutation: NotableMutation = {
                type: 'added',
                selector: getSelector(el),
                tagName: el.tagName.toLowerCase(),
                id: el.id || undefined,
                className: interestingClasses.length > 0 
                  ? interestingClasses.join(' ') 
                  : (classes.slice(0, 3).join(' ') || undefined),
              }
              notable.push(mutation)
            }
          }
        }
        
        // Track removed nodes
        for (const node of m.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element
            
            if (shouldIgnoreElement(el, rules)) {
              ignored++
              continue
            }
            
            removed++
            
            const hasId = !!el.id
            const isSignificant = ['DIALOG', 'MODAL', 'FORM', 'BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
            const isCustomElement = el.tagName.includes('-')
            
            if (hasId || isSignificant || isCustomElement) {
              notable.push({
                type: 'removed',
                selector: getSelector(el),
                tagName: el.tagName.toLowerCase(),
                id: el.id || undefined,
                className: el.className?.toString().split(/\s+/).slice(0, 3).join(' ') || undefined,
              })
            }
          }
        }
      } else if (m.type === 'attributes') {
        const el = m.target as Element
        const attrName = m.attributeName || ''
        
        // Check if element should be ignored
        if (shouldIgnoreElement(el, rules)) {
          ignored++
          continue
        }
        
        // Check if attribute should be ignored
        if (rules.ignoreAttributes?.some(pattern => attrName.startsWith(pattern) || attrName === pattern)) {
          ignored++
          continue
        }
        
        // Special handling for class attribute
        if (attrName === 'class') {
          const oldClasses = (m.oldValue || '').split(/\s+/).filter(Boolean)
          const newClasses = (el.className?.toString() || '').split(/\s+/).filter(Boolean)
          
          // Find what changed
          const addedClasses = newClasses.filter(c => !oldClasses.includes(c))
          const removedClasses = oldClasses.filter(c => !newClasses.includes(c))
          
          // Filter the changes
          const { interesting: addedInteresting, ignored: addedIgnored } = filterClasses(addedClasses, rules)
          const { interesting: removedInteresting, ignored: removedIgnored } = filterClasses(removedClasses, rules)
          
          // If all changes are ignored, skip
          if (addedClasses.length === addedIgnored.length && removedClasses.length === removedIgnored.length) {
            ignored++
            continue
          }
          
          attributeChanges++
          
          // Only report if interesting classes changed
          if (addedInteresting.length > 0 || removedInteresting.length > 0) {
            notable.push({
              type: 'attribute',
              selector: getSelector(el),
              tagName: el.tagName.toLowerCase(),
              id: el.id || undefined,
              attribute: 'class',
              oldValue: removedInteresting.length > 0 ? `-${removedInteresting.join(' -')}` : undefined,
              newValue: addedInteresting.length > 0 ? `+${addedInteresting.join(' +')}` : undefined,
            })
          }
        } else {
          attributeChanges++
          
          // Check if this is an interesting attribute
          const isInteresting = isInterestingAttribute(attrName, rules)
          
          if (isInteresting) {
            notable.push({
              type: 'attribute',
              selector: getSelector(el),
              tagName: el.tagName.toLowerCase(),
              id: el.id || undefined,
              attribute: attrName,
              oldValue: m.oldValue || undefined,
              newValue: el.getAttribute(attrName) || undefined,
            })
          }
        }
      } else if (m.type === 'characterData') {
        textChanges++
      }
    }
    
    // Don't send batch if nothing notable happened and everything was filtered
    if (added === 0 && removed === 0 && attributeChanges === 0 && textChanges === 0) {
      return
    }
    
    const batch: MutationBatch & { ignored?: number } = {
      timestamp: Date.now(),
      count: mutations.length,
      summary: { added, removed, attributeChanges, textChanges },
      notable: notable.slice(0, 20), // Limit to 20 notable items
    }
    
    if (ignored > 0) {
      batch.ignored = ignored
    }
    
    this.send('mutations', 'batch', batch)
  }
  
  // ==========================================
  // Event Watching
  // ==========================================
  
  private watchEvents(req: EventWatchRequest, watchId: string) {
    const target = req.selector ? document.querySelector(req.selector) : document
    if (!target) {
      this.respond(watchId, false, null, `Element not found: ${req.selector}`)
      return
    }
    
    const handlers: Array<[string, EventListener]> = []
    
    for (const eventType of req.events) {
      const handler = (e: Event) => {
        const recorded = this.recordEvent(e)
        this.send('events', 'captured', recorded)
        
        if (this.recording) {
          this.recording.events.push(recorded)
        }
      }
      
      target.addEventListener(eventType, handler, {
        capture: req.capture,
        passive: req.passive,
      })
      handlers.push([eventType, handler])
    }
    
    // Store unwatch function
    this.eventWatchers.set(watchId, () => {
      for (const [type, handler] of handlers) {
        target.removeEventListener(type, handler)
      }
    })
    
    this.respond(watchId, true, { watchId })
  }
  
  private recordEvent(e: Event): RecordedEvent {
    const target = e.target as Element
    const recorded: RecordedEvent = {
      type: e.type,
      timestamp: Date.now(),
      target: {
        selector: getSelector(target),
        tagName: target.tagName?.toLowerCase() || '',
        id: target.id || undefined,
        className: target.className?.toString() || undefined,
        textContent: target.textContent?.slice(0, 100) || undefined,
        value: (target as HTMLInputElement).value || undefined,
      },
    }
    
    if (e instanceof MouseEvent) {
      recorded.position = {
        x: e.pageX,
        y: e.pageY,
        clientX: e.clientX,
        clientY: e.clientY,
      }
      recorded.modifiers = {
        alt: e.altKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
      }
    }
    
    if (e instanceof KeyboardEvent) {
      recorded.key = e.key
      recorded.code = e.code
      recorded.modifiers = {
        alt: e.altKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
      }
    }
    
    if (e.type === 'input' || e.type === 'change') {
      recorded.value = (e.target as HTMLInputElement).value
    }
    
    return recorded
  }
  
  private clearEventWatchers() {
    this.eventWatchers.forEach(unwatch => unwatch())
    this.eventWatchers.clear()
  }
  
  // ==========================================
  // Synthetic Events
  // ==========================================
  
  private dispatchSyntheticEvent(req: SyntheticEventRequest, responseId: string) {
    const el = document.querySelector(req.selector) as HTMLElement
    if (!el) {
      this.respond(responseId, false, null, `Element not found: ${req.selector}`)
      return
    }
    
    try {
      const opts = req.options || {}
      let event: Event
      
      if (req.event === 'click' || req.event === 'mousedown' || req.event === 'mouseup') {
        event = new MouseEvent(req.event, {
          bubbles: opts.bubbles ?? true,
          cancelable: opts.cancelable ?? true,
          clientX: opts.clientX,
          clientY: opts.clientY,
          button: opts.button ?? 0,
        })
      } else if (req.event === 'keydown' || req.event === 'keyup' || req.event === 'keypress') {
        event = new KeyboardEvent(req.event, {
          bubbles: opts.bubbles ?? true,
          cancelable: opts.cancelable ?? true,
          key: opts.key,
          code: opts.code,
          altKey: opts.altKey,
          ctrlKey: opts.ctrlKey,
          metaKey: opts.metaKey,
          shiftKey: opts.shiftKey,
        })
      } else if (req.event === 'input') {
        // Set value first for input elements
        if (opts.value !== undefined && 'value' in el) {
          (el as HTMLInputElement).value = opts.value
        }
        event = new InputEvent(req.event, {
          bubbles: opts.bubbles ?? true,
          cancelable: opts.cancelable ?? true,
          inputType: opts.inputType || 'insertText',
          data: opts.value,
        })
      } else if (req.event === 'focus') {
        el.focus()
        this.respond(responseId, true)
        return
      } else if (req.event === 'blur') {
        el.blur()
        this.respond(responseId, true)
        return
      } else {
        event = new CustomEvent(req.event, {
          bubbles: opts.bubbles ?? true,
          cancelable: opts.cancelable ?? true,
          detail: opts.detail,
        })
      }
      
      el.dispatchEvent(event)
      this.respond(responseId, true)
    } catch (err: any) {
      this.respond(responseId, false, null, err.message)
    }
  }
  
  private async replaySession(session: RecordingSession, speed: number, responseId: string) {
    const events = session.events
    let lastTime = events[0]?.timestamp || 0
    
    for (const event of events) {
      const delay = (event.timestamp - lastTime) / speed
      lastTime = event.timestamp
      
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay))
      }
      
      // Dispatch the recorded event
      await new Promise<void>((resolve) => {
        this.dispatchSyntheticEvent({
          selector: event.target.selector,
          event: event.type,
          options: {
            clientX: event.position?.clientX,
            clientY: event.position?.clientY,
            key: event.key,
            code: event.code,
            altKey: event.modifiers?.alt,
            ctrlKey: event.modifiers?.ctrl,
            metaKey: event.modifiers?.meta,
            shiftKey: event.modifiers?.shift,
            value: event.value,
          },
        }, uid())
        resolve()
      })
    }
    
    this.respond(responseId, true)
  }
  
  // ==========================================
  // Console Interception
  // ==========================================
  
  private interceptConsole() {
    const levels: Array<'log' | 'info' | 'warn' | 'error' | 'debug'> = ['log', 'info', 'warn', 'error', 'debug']
    
    for (const level of levels) {
      this.originalConsole[level] = console[level]
      console[level] = (...args: any[]) => {
        // Call original
        this.originalConsole[level]!.apply(console, args)
        
        // Capture
        const entry: ConsoleEntry = {
          level,
          args: args.map(arg => {
            try {
              return JSON.parse(JSON.stringify(arg))
            } catch {
              return String(arg)
            }
          }),
          timestamp: Date.now(),
        }
        
        if (level === 'error') {
          entry.stack = new Error().stack
        }
        
        this.consoleBuffer.push(entry)
        
        // Limit buffer size
        if (this.consoleBuffer.length > 1000) {
          this.consoleBuffer = this.consoleBuffer.slice(-500)
        }
        
        // Only send errors to server automatically (others are queryable via REST)
        if (this.state === 'connected' && level === 'error') {
          this.send('console', level, entry)
        }
      }
    }
  }
  
  private restoreConsole() {
    for (const [level, fn] of Object.entries(this.originalConsole)) {
      if (fn) {
        (console as any)[level] = fn
      }
    }
  }
}

// Register the custom element
customElements.define('tosijs-dev', DevChannel)

// Export for bookmarklet injection
export function inject(serverUrl = 'wss://localhost:8700/ws/browser') {
  if (document.querySelector('tosijs-dev')) {
    console.log('[tosijs-dev] Already injected')
    return
  }
  
  const el = document.createElement('tosijs-dev')
  el.setAttribute('server', serverUrl)
  document.body.appendChild(el)
  console.log('[tosijs-dev] Injected')
}

// Attach to window for console access
if (typeof window !== 'undefined') {
  (window as any).DevChannel = DevChannel
}
