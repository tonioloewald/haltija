/**
 * Haltija - Browser Control for AI Agents
 * https://github.com/anthropics/claude-code
 * 
 * Copyright 2025 Tonio Loewald
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Dev Channel Browser Component
 * 
 * A floating widget that:
 * - Connects to local Haltija server via WebSocket
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
  SemanticEvent,
  SemanticEventCategory,
  SemanticEventSubscription,
  SemanticEventPreset,
} from './types'

// Component version - imported from shared version file
import { VERSION as _VERSION } from './version'
export const VERSION = _VERSION

// Product name and element tag
const PRODUCT_NAME = 'Haltija'
const TAG_NAME = 'haltija-dev'
const LOG_PREFIX = '[haltija]'

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
    console.warn(`${LOG_PREFIX} Framework detection failed:`, err)
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
    
    #haltija-highlight {
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
    
    #haltija-highlight-label {
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
  highlightOverlay.id = 'haltija-highlight'
  
  highlightLabel = document.createElement('div')
  highlightLabel.id = 'haltija-highlight-label'
  
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

// Track the current tag name (may be renamed on re-registration)
let currentTagName = TAG_NAME
let registrationCount = 0

export class DevChannel extends HTMLElement {
  // Static getter for current tag name
  static get tagName(): string {
    return currentTagName
  }
  
  // Element creator that always uses the current tag name
  static elementCreator(): () => DevChannel {
    return () => document.createElement(currentTagName) as DevChannel
  }
  
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
  private windowId: string // Stable ID persisted in sessionStorage (survives refresh)
  private browserId = uid() // Unique ID for this browser instance (changes each page load)
  private killed = false // Prevents reconnection after kill()
  private isActive = true // Whether this window is active (responding to commands)
  private homeLeft = 0 // Store home position for restore
  private homeBottom = 16
  
  // Log viewer state
  private logPanelOpen = false
  private logAutoScroll = true
  
  // Recording state
  private isRecording = false
  private recordingStartTime = 0
  private recordingEvents: SemanticEvent[] = []
  
  // Pending requests waiting for response
  private pending = new Map<string, { resolve: (r: DevResponse) => void, reject: (e: Error) => void }>()
  
  // ============================================
  // Semantic Event Aggregation (Phase 6)
  // ============================================
  private semanticEventsEnabled = false
  private semanticEventBuffer: SemanticEvent[] = []
  private readonly SEMANTIC_BUFFER_MAX = 100
  private semanticSubscription: SemanticEventSubscription | null = null
  
  // Preset definitions
  private readonly SEMANTIC_PRESETS: Record<SemanticEventPreset, SemanticEventCategory[]> = {
    minimal: ['interaction', 'navigation', 'recording'],
    interactive: ['interaction', 'navigation', 'input', 'focus', 'recording'],
    detailed: ['interaction', 'navigation', 'input', 'focus', 'hover', 'scroll', 'recording'],
    debug: ['interaction', 'navigation', 'input', 'focus', 'hover', 'scroll', 'mutation', 'console', 'recording'],
  }
  
  // Noise reduction metrics - count raw DOM events vs emitted semantic events
  private rawEventCounts: Record<string, number> = {}
  private semanticEventCounts: Record<SemanticEventCategory, number> = {
    interaction: 0, navigation: 0, input: 0, hover: 0, scroll: 0, mutation: 0, console: 0, focus: 0, recording: 0
  }
  private statsStartTime = 0
  
  // Typing aggregation state
  private typingState: {
    field: Element | null
    startTime: number
    text: string
    timeout: ReturnType<typeof setTimeout> | null
  } = { field: null, startTime: 0, text: '', timeout: null }
  private readonly TYPING_DEBOUNCE = 500
  
  // Scroll aggregation state
  private scrollState: {
    startY: number
    startTime: number
    timeout: ReturnType<typeof setTimeout> | null
  } = { startY: 0, startTime: 0, timeout: null }
  private readonly SCROLL_DEBOUNCE = 150
  
  // Hover tracking state
  private hoverState: {
    element: Element | null
    enterTime: number
    timeout: ReturnType<typeof setTimeout> | null
  } = { element: null, enterTime: 0, timeout: null }
  private readonly DWELL_THRESHOLD = 300
  
  // Bound event handlers for cleanup
  private semanticHandlers: {
    click?: (e: MouseEvent) => void
    input?: (e: Event) => void
    scroll?: (e: Event) => void
    mouseover?: (e: MouseEvent) => void
    mouseout?: (e: MouseEvent) => void
    focus?: (e: FocusEvent) => void
    blur?: (e: FocusEvent) => void
    submit?: (e: SubmitEvent) => void
    popstate?: (e: PopStateEvent) => void
    mousedown?: (e: MouseEvent) => void
    mouseup?: (e: MouseEvent) => void
  } = {}
  
  // Selection tool state
  private selectionActive = false
  private selectionStart: { x: number, y: number } | null = null
  private selectionRect: { x: number, y: number, width: number, height: number } | null = null
  private selectionResult: {
    region: { x: number, y: number, width: number, height: number }
    elements: Array<{
      selector: string
      tagName: string
      text: string
      html: string
      rect: { x: number, y: number, width: number, height: number }
      attributes: Record<string, string>
    }>
    screenshot?: string
    timestamp: number
  } | null = null
  private selectionOverlay: HTMLDivElement | null = null
  private selectionBox: HTMLDivElement | null = null
  private highlightedElements: HTMLDivElement[] = []
  
  static get observedAttributes() {
    return ['server', 'hidden']
  }
  
  /**
   * Run browser-side tests
   * Usage: DevChannel.runTests() or from agent: POST /eval { code: "DevChannel.runTests()" }
   */
  static async runTests() {
    const el = document.querySelector(TAG_NAME) as DevChannel
    if (!el) {
      console.error(`${LOG_PREFIX} No ${TAG_NAME} element found. Inject first.`)
      return { passed: 0, failed: 1, error: `No ${TAG_NAME} element` }
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
    
    console.log(`%c${LOG_PREFIX} Running tests...`, 'color: #6366f1; font-weight: bold')
    
    // Run tests
    await test('element exists', () => {
      if (!document.querySelector(TAG_NAME)) throw new Error('Missing')
    })()
    
    await test('has shadow root', () => {
      if (!el.shadowRoot) throw new Error('No shadow root')
    })()
    
    await test('widget visible', () => {
      const widget = el.shadowRoot?.querySelector('.widget')
      if (!widget) throw new Error('No widget')
    })()
    
    await test('status indicator', () => {
      const status = el.shadowRoot?.querySelector('.status-ring')
      if (!status) throw new Error('No status ring')
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
    
    console.log(`%c${LOG_PREFIX} ${passed}/${results.length} tests passed`, `color: ${color}; font-weight: bold`)
    
    return { passed, failed, results }
  }
  
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    
    // Initialize windowId from sessionStorage or generate new one
    // This survives page refreshes but not tab close
    const WINDOW_ID_KEY = 'haltija-window-id'
    let storedWindowId = sessionStorage.getItem(WINDOW_ID_KEY)
    if (!storedWindowId) {
      storedWindowId = uid()
      sessionStorage.setItem(WINDOW_ID_KEY, storedWindowId)
    }
    this.windowId = storedWindowId
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
          display: block;
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
          min-width: 240px;
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
        
        .logo-wrapper {
          position: relative;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .status-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px solid #666;
        }
        
        .status-ring.connected { border-color: #22c55e; }
        .status-ring.connecting { border-color: #eab308; animation: pulse 1s infinite; }
        .status-ring.paused { border-color: #f97316; }
        .status-ring.disconnected { border-color: #ef4444; }
        
        .logo {
          font-size: 14px;
          line-height: 1;
          z-index: 1;
        }
        
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
          cursor: pointer;
        }
        
        .indicator.errors:hover {
          background: #dc2626;
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
        .btn.recording { color: #ef4444; animation: pulse 1s infinite; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
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
        
        /* Log Viewer Panel */
        .log-panel {
          display: none;
          border-top: 1px solid #333;
          max-height: 300px;
          overflow: hidden;
          flex-direction: column;
        }
        
        .log-panel.open {
          display: flex;
        }
        
        .log-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: #16213e;
          border-bottom: 1px solid #333;
          flex-shrink: 0;
        }
        
        .log-title {
          flex: 1;
          font-size: 10px;
          font-weight: 500;
          color: #888;
        }
        
        .log-filter {
          font-size: 9px;
          padding: 2px 6px;
          background: #2a2a4a;
          border: 1px solid #444;
          border-radius: 4px;
          color: #aaa;
          cursor: pointer;
        }
        
        .log-filter:hover {
          background: #3a3a5a;
          border-color: #666;
        }
        
        .log-scroll-btn {
          font-size: 10px;
          padding: 2px 6px;
          background: transparent;
          border: 1px solid #444;
          border-radius: 4px;
          color: #666;
          cursor: pointer;
        }
        
        .log-scroll-btn.active {
          background: #2a4a2a;
          border-color: #22c55e;
          color: #22c55e;
        }
        
        .log-scroll-btn:hover {
          border-color: #666;
          color: #888;
        }
        
        .log-content {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          font-family: ui-monospace, monospace;
          font-size: 10px;
        }
        
        .log-empty {
          padding: 20px;
          text-align: center;
          color: #555;
          font-style: italic;
        }
        
        .log-entry {
          border-bottom: 1px solid #222;
        }
        
        .log-entry:hover {
          background: #222;
        }
        
        details.log-entry > summary {
          cursor: pointer;
          list-style: none;
        }
        
        details.log-entry > summary::-webkit-details-marker {
          display: none;
        }
        
        details.log-entry[open] {
          background: #1a1a2e;
        }
        
        .log-entry-main {
          display: flex;
          gap: 8px;
          padding: 4px 12px;
          align-items: baseline;
        }
        
        .log-entry.no-payload .log-entry-main {
          padding: 4px 12px;
        }
        
        .log-time {
          color: #555;
          flex-shrink: 0;
          width: 65px;
        }
        
        .log-cat {
          font-size: 8px;
          padding: 1px 4px;
          border-radius: 3px;
          flex-shrink: 0;
          text-transform: uppercase;
          font-weight: 600;
        }
        
        .log-cat.interaction { background: #3b82f6; color: white; }
        .log-cat.navigation { background: #8b5cf6; color: white; }
        .log-cat.input { background: #22c55e; color: white; }
        .log-cat.hover { background: #f59e0b; color: black; }
        .log-cat.scroll { background: #6b7280; color: white; }
        .log-cat.focus { background: #06b6d4; color: white; }
        .log-cat.mutation { background: #ec4899; color: white; }
        .log-cat.console { background: #ef4444; color: white; }
        .log-cat.error { background: #ef4444; color: white; }
        .log-cat.warn { background: #f59e0b; color: black; }
        .log-cat.log { background: #6b7280; color: white; }
        
        .console-entry.error { border-left: 3px solid #ef4444; }
        .console-entry.warn { border-left: 3px solid #f59e0b; }
        
        .log-console-detail {
          padding: 8px;
          background: #1a1a2e;
        }
        
        .log-console-detail pre {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-all;
          font-size: 10px;
          color: #ccc;
        }
        
        .log-stack {
          margin-top: 8px !important;
          color: #888 !important;
          font-size: 9px !important;
        }
        
        .log-type {
          color: #aaa;
          flex-shrink: 0;
        }
        
        .log-target {
          color: #6366f1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        
        .log-payload-table {
          width: 100%;
          margin: 4px 12px 8px 12px;
          font-size: 9px;
          border-collapse: collapse;
        }
        
        .log-payload-table td {
          padding: 2px 8px 2px 0;
          vertical-align: top;
        }
        
        .log-key {
          color: #888;
          white-space: nowrap;
          width: 1%;
        }
        
        .log-val {
          color: #aaa;
          word-break: break-all;
        }
        
        /* Test output modal */
        .test-modal {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.8);
          z-index: 999999;
          justify-content: center;
          align-items: center;
        }
        .test-modal.open { display: flex; }
        .test-modal-content {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 8px;
          width: 90%;
          max-width: 600px;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
        }
        .test-modal-header {
          padding: 12px 16px;
          border-bottom: 1px solid #333;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .test-modal-header h3 {
          margin: 0;
          font-size: 14px;
          color: #fff;
        }
        .test-modal-body {
          padding: 16px;
          overflow: auto;
          flex: 1;
        }
        .test-modal-body input {
          width: calc(100% - 16px);
          padding: 8px;
          margin-bottom: 12px;
          background: #222;
          border: 1px solid #444;
          border-radius: 4px;
          color: #fff;
          font-size: 13px;
        }
        .test-modal-body textarea {
          width: calc(100% - 16px);
          height: 200px;
          padding: 8px;
          background: #111;
          border: 1px solid #333;
          border-radius: 4px;
          color: #0f0;
          font-family: monospace;
          font-size: 11px;
          resize: vertical;
        }
        .test-modal-footer {
          padding: 12px 16px;
          border-top: 1px solid #333;
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          align-items: center;
        }
        .test-modal-footer button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }
        .test-modal-footer .btn-primary {
          background: #6366f1;
          color: #fff;
        }
        .test-modal-footer .btn-primary:hover {
          background: #4f46e5;
        }
        .test-modal-footer .btn-secondary {
          background: #333;
          color: #fff;
        }
        .test-modal-footer .btn-secondary:hover {
          background: #444;
        }
        .test-modal .success-msg {
          color: #22c55e;
          font-size: 11px;
          flex: 1;
        }
        .test-modal-footer .btn-cancel {
          background: transparent;
          border: 1px solid #444;
          color: #888;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          margin-right: auto;
        }
        .test-modal-footer .btn-cancel:hover {
          background: #222;
          color: #fff;
          border-color: #666;
        }
      </style>
      
      <div class="widget">
        <div class="header">
          <div class="logo-wrapper">
            <div class="status-ring"></div>
            <span class="logo">🧝</span>
          </div>
          <div class="title">${PRODUCT_NAME}</div>
          <div class="indicators"></div>
          <div class="controls">
            <button class="btn" data-action="select" title="Select elements (drag to select area)" aria-label="Select elements">👆</button>
            <button class="btn" data-action="record" title="Record test (click to start/stop)" aria-label="Record test">🎬</button>
            <button class="btn" data-action="logs" title="Show event log panel" aria-label="Toggle event log">📋</button>
            <button class="btn" data-action="minimize" title="Minimize widget (⌥Tab)" aria-label="Minimize">─</button>
            <button class="btn danger" data-action="kill" title="Close and disconnect" aria-label="Close widget">✕</button>
          </div>
        </div>
        <div class="body">
            <a href="javascript:(function(){fetch('${this.serverUrl.replace('ws:', 'http:').replace('wss:', 'https:').replace('/ws/browser', '')}/inject.js').then(r=>r.text()).then(eval).catch(e=>alert('${PRODUCT_NAME}: Cannot reach server'))})();" 
               style="color: #6366f1; text-decoration: none;"
               title="Drag to bookmarks bar"
               class="bookmark-link">🧝 bookmark</a>
        </div>
        <div class="log-panel">
          <div class="log-header">
            <span class="log-title">Events</span>
            <select class="log-filter" title="Filter events by category" aria-label="Event category filter">
              <option value="all">All</option>
              <option value="interaction">Clicks</option>
              <option value="input">Input</option>
              <option value="navigation">Nav</option>
              <option value="hover">Hover</option>
              <option value="focus">Focus</option>
              <option value="console">Console</option>
            </select>
            <button class="log-scroll-btn active" title="Auto-scroll to new events (click to toggle)" aria-label="Toggle auto-scroll">⤓</button>
            <button class="btn" data-action="clear-logs" title="Clear all events" aria-label="Clear event log">🗑</button>
          </div>
          <div class="log-content">
            <div class="log-empty">No events yet. Events will appear when semantic event watching is active.</div>
          </div>
        </div>
      </div>
      
      <div class="test-modal">
        <div class="test-modal-content">
          <div class="test-modal-header">
            <h3>Name and Save Your Test</h3>
            <button class="btn" data-action="close-modal" title="Close">✕</button>
          </div>
          <div class="test-modal-body">
            <input type="text" class="test-name" placeholder="Enter test name..." value="">
            <textarea class="test-json" readonly></textarea>
          </div>
          <div class="test-modal-footer">
            <button class="btn-cancel" data-action="close-modal">Cancel</button>
            <span class="success-msg"></span>
            <button class="btn-secondary" data-action="download-test">💾 Save</button>
            <button class="btn-primary" data-action="copy-test">📋 Copy</button>
          </div>
        </div>
      </div>
    `
    
    this.updateUI()
    
    // Event handlers (only set up once)
    // Handle all buttons with data-action (including modal buttons)
    shadow.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation() // Don't trigger drag
      })
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const action = (e.currentTarget as HTMLElement).dataset.action
        if (action === 'minimize') this.toggleMinimize()
        if (action === 'kill') this.kill()
        if (action === 'logs') this.toggleLogPanel()
        if (action === 'clear-logs') this.clearLogPanel()
        if (action === 'record') this.toggleRecording()
        if (action === 'select') this.startSelection()
        if (action === 'close-modal') this.closeTestModal()
        if (action === 'copy-test') this.copyTest()
        if (action === 'download-test') this.downloadTest()
      })
    })
    
    // Error indicator click - open log panel with console filter
    const indicators = shadow.querySelector('.indicators')
    if (indicators) {
      indicators.addEventListener('click', (e) => {
        const target = e.target as HTMLElement
        if (target.classList.contains('errors')) {
          // Set filter to console first, then open panel
          const logFilter = shadow.querySelector('.log-filter') as HTMLSelectElement
          if (logFilter) {
            logFilter.value = 'console'
          }
          // Open log panel if not already open
          if (!this.logPanelOpen) {
            this.toggleLogPanel()
          } else {
            // Already open, just update the display
            this.updateLogPanel()
          }
        }
      })
    }
    
    // Log panel controls
    const logFilter = shadow.querySelector('.log-filter') as HTMLSelectElement
    if (logFilter) {
      logFilter.addEventListener('change', () => this.updateLogPanel())
    }
    
    const logScrollBtn = shadow.querySelector('.log-scroll-btn')
    if (logScrollBtn) {
      logScrollBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.logAutoScroll = !this.logAutoScroll
        logScrollBtn.classList.toggle('active', this.logAutoScroll)
        if (this.logAutoScroll) {
          this.scrollLogToBottom()
        }
      })
    }
    
    // Detect manual scroll to pause auto-scroll
    const logContent = shadow.querySelector('.log-content')
    if (logContent) {
      logContent.addEventListener('scroll', () => {
        const el = logContent as HTMLElement
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
        if (!atBottom && this.logAutoScroll) {
          this.logAutoScroll = false
          shadow.querySelector('.log-scroll-btn')?.classList.remove('active')
        }
      })
    }
    
    // Bookmark link - show product name on hover so drag gets useful name
    const bookmarkLink = shadow.querySelector('.bookmark-link') as HTMLAnchorElement
    if (bookmarkLink) {
      bookmarkLink.addEventListener('mouseenter', () => {
        bookmarkLink.textContent = `🧝 ${PRODUCT_NAME}`
      })
      bookmarkLink.addEventListener('mouseleave', () => {
        bookmarkLink.textContent = '🧝 bookmark'
      })
    }
    

    
    // Drag support
    this.setupDrag(shadow.querySelector('.header')!)
  }
  
  private updateUI() {
    const shadow = this.shadowRoot!
    
    // Update status indicator (ring around logo)
    const statusRing = shadow.querySelector('.status-ring')
    if (statusRing) {
      statusRing.className = `status-ring ${this.state}`
    }
    

    
    // Update indicators
    const indicators = shadow.querySelector('.indicators')
    if (indicators) {
      const errorCount = this.consoleBuffer.filter(e => e.level === 'error').length
      let html = ''
      if (errorCount > 0) {
        html += `<span class="indicator errors" title="${errorCount} error${errorCount > 1 ? 's' : ''}">⚠ ${errorCount}</span>`
      }
      if (this.recording) {
        html += `<span class="indicator recording">REC</span>`
      }
      indicators.innerHTML = html
    }
    
    // Update log panel button state
    const logBtn = shadow.querySelector('[data-action="logs"]')
    if (logBtn) {
      logBtn.classList.toggle('active', this.logPanelOpen)
    }
  }
  
  // ============================================
  // Log Panel Methods
  // ============================================
  
  private toggleLogPanel() {
    this.logPanelOpen = !this.logPanelOpen
    const panel = this.shadowRoot?.querySelector('.log-panel')
    if (panel) {
      panel.classList.toggle('open', this.logPanelOpen)
      if (this.logPanelOpen) {
        // Auto-start semantic events with 'interactive' preset
        if (!this.semanticEventsEnabled) {
          this.semanticSubscription = { preset: 'interactive' }
          this.startSemanticEvents()
        }
        this.updateLogPanel()
        if (this.logAutoScroll) {
          this.scrollLogToBottom()
        }
        // Reposition if panel goes off screen
        requestAnimationFrame(() => this.ensureOnScreen())
      } else {
        // Auto-stop when closing (unless agent started it via API)
        // Only stop if we started it ourselves (no explicit subscription from API)
        if (this.semanticEventsEnabled && this.semanticSubscription?.preset === 'interactive') {
          this.stopSemanticEvents()
          this.semanticSubscription = null
        }
      }
    }
    this.updateUI()
  }
  
  private ensureOnScreen() {
    const rect = this.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    
    let newBottom = parseInt(this.style.bottom) || 16
    let newLeft = parseInt(this.style.left) || this.homeLeft
    
    // If top is off screen, move down (increase bottom)
    if (rect.top < 0) {
      newBottom = viewportHeight - rect.height - 8
    }
    
    // If bottom is off screen, move up
    if (rect.bottom > viewportHeight) {
      newBottom = 8
    }
    
    // If right is off screen, move left
    if (rect.right > viewportWidth) {
      newLeft = viewportWidth - rect.width - 8
    }
    
    // If left is off screen, move right
    if (rect.left < 0) {
      newLeft = 8
    }
    
    this.style.bottom = `${newBottom}px`
    this.style.left = `${newLeft}px`
  }
  
  private clearLogPanel() {
    this.semanticEventBuffer.length = 0
    this.updateLogPanel()
  }
  
  private scrollLogToBottom() {
    const content = this.shadowRoot?.querySelector('.log-content')
    if (content) {
      content.scrollTop = content.scrollHeight
    }
  }
  
  private updateLogPanel() {
    const content = this.shadowRoot?.querySelector('.log-content')
    if (!content) return
    
    const filter = (this.shadowRoot?.querySelector('.log-filter') as HTMLSelectElement)?.value || 'all'
    
    // Handle console filter separately - show console buffer entries
    if (filter === 'console') {
      if (this.consoleBuffer.length === 0) {
        content.innerHTML = `<div class="log-empty">No console messages captured.</div>`
        return
      }
      
      content.innerHTML = this.consoleBuffer.map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { 
          hour12: false, 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit',
          fractionalSecondDigits: 1
        } as Intl.DateTimeFormatOptions)
        
        const levelClass = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log'
        const args = entry.args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
        const displayArgs = args.length > 100 ? args.slice(0, 100) + '…' : args
        
        return `
          <details class="log-entry console-entry ${levelClass}" data-ts="${entry.timestamp}">
            <summary class="log-entry-main">
              <span class="log-time">${time}</span>
              <span class="log-cat ${levelClass}">${entry.level.slice(0, 3)}</span>
              <span class="log-type">console.${entry.level}</span>
              <span class="log-target" title="${this.escapeHtml(args)}">${this.escapeHtml(displayArgs)}</span>
            </summary>
            <div class="log-console-detail">
              <pre>${this.escapeHtml(args)}</pre>
              ${entry.stack ? `<pre class="log-stack">${this.escapeHtml(entry.stack)}</pre>` : ''}
            </div>
          </details>
        `
      }).join('')
      
      if (this.logAutoScroll) {
        this.scrollLogToBottom()
      }
      return
    }
    
    const events = filter === 'all' 
      ? this.semanticEventBuffer 
      : this.semanticEventBuffer.filter(e => e.category === filter)
    
    if (events.length === 0) {
      content.innerHTML = `<div class="log-empty">No events yet. Interact with the page to see events.</div>`
      return
    }
    
    content.innerHTML = events.map(event => {
      const time = new Date(event.timestamp).toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        fractionalSecondDigits: 1
      } as Intl.DateTimeFormatOptions)
      
      const target = event.target 
        ? (event.target.label || event.target.text || event.target.selector || event.target.tag)
        : ''
      
      const payloadEntries = Object.entries(event.payload).filter(([_, v]) => v != null && v !== '')
      const hasPayload = payloadEntries.length > 0
      
      const payloadTable = hasPayload ? `
        <table class="log-payload-table">
          ${payloadEntries.map(([k, v]) => {
            const val = typeof v === 'object' ? JSON.stringify(v) : String(v)
            const displayVal = val.length > 60 ? val.slice(0, 60) + '…' : val
            return `<tr><td class="log-key">${this.escapeHtml(k)}</td><td class="log-val" title="${this.escapeHtml(val)}">${this.escapeHtml(displayVal)}</td></tr>`
          }).join('')}
        </table>
      ` : ''
      
      if (hasPayload) {
        return `
          <details class="log-entry" data-ts="${event.timestamp}">
            <summary class="log-entry-main">
              <span class="log-time">${time}</span>
              <span class="log-cat ${event.category}">${event.category.slice(0, 3)}</span>
              <span class="log-type">${event.type}</span>
              <span class="log-target" title="${this.escapeHtml(target)}">${this.escapeHtml(target)}</span>
            </summary>
            ${payloadTable}
          </details>
        `
      } else {
        return `
          <div class="log-entry no-payload" data-ts="${event.timestamp}">
            <div class="log-entry-main">
              <span class="log-time">${time}</span>
              <span class="log-cat ${event.category}">${event.category.slice(0, 3)}</span>
              <span class="log-type">${event.type}</span>
              <span class="log-target" title="${this.escapeHtml(target)}">${this.escapeHtml(target)}</span>
            </div>
          </div>
        `
      }
    }).join('')
    
    if (this.logAutoScroll) {
      this.scrollLogToBottom()
    }
  }
  
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
  
  // ============================================
  // Recording Methods
  // ============================================
  
  private toggleRecording() {
    if (this.isRecording) {
      this.stopRecording()
    } else {
      this.startRecording()
    }
  }
  
  private startRecording() {
    this.isRecording = true
    this.recordingStartTime = Date.now()
    this.recordingEvents = []
    
    // Start semantic event watching if not already active
    if (!this.semanticEventsEnabled) {
      this.semanticSubscription = { preset: 'interactive' }
      this.startSemanticEvents()
    }
    
    // Emit recording:started semantic event
    this.emitSemanticEvent({
      type: 'recording:started',
      timestamp: this.recordingStartTime,
      category: 'recording',
      target: { selector: 'document', tag: 'document' },
      payload: {
        url: window.location.href,
        title: document.title,
      },
    })
    
    // Update button state
    const recordBtn = this.shadowRoot?.querySelector('[data-action="record"]')
    if (recordBtn) {
      recordBtn.textContent = '💾'
      recordBtn.classList.add('recording')
      recordBtn.setAttribute('title', 'Stop recording (click to finish)')
    }
  }
  
  private stopRecording() {
    this.isRecording = false
    const stopTime = Date.now()
    
    // Capture events that occurred during recording
    this.recordingEvents = this.semanticEventBuffer.filter(
      e => e.timestamp >= this.recordingStartTime
    )
    
    // Generate a recording ID
    const recordingId = `rec_${this.recordingStartTime}_${Math.random().toString(36).slice(2, 8)}`
    
    // Emit recording:stopped semantic event with the recording data
    this.emitSemanticEvent({
      type: 'recording:stopped',
      timestamp: stopTime,
      category: 'recording',
      target: { selector: 'document', tag: 'document' },
      payload: {
        id: recordingId,
        url: window.location.href,
        title: document.title,
        startTime: this.recordingStartTime,
        endTime: stopTime,
        duration: stopTime - this.recordingStartTime,
        eventCount: this.recordingEvents.length,
      },
    })
    
    // Send recording to server for storage
    this.saveRecordingToServer(recordingId, stopTime)
    
    // Update button state
    const recordBtn = this.shadowRoot?.querySelector('[data-action="record"]')
    if (recordBtn) {
      recordBtn.textContent = '🎬'
      recordBtn.classList.remove('recording')
      recordBtn.setAttribute('title', 'Record test (click to start)')
    }
    
    // Generate the test and show modal
    this.generateAndShowTest()
  }
  
  private saveRecordingToServer(recordingId: string, endTime: number) {
    // Send the recording to the server so agents can retrieve it
    this.send('recording', 'save', {
      id: recordingId,
      url: window.location.href,
      title: document.title,
      startTime: this.recordingStartTime,
      endTime: endTime,
      events: this.recordingEvents,
    })
  }
  
  private generateAndShowTest() {
    const test = this.eventsToTest(this.recordingEvents, {
      name: '',  // Start with empty name
      url: window.location.href,
      addAssertions: true,
    })
    
    const modal = this.shadowRoot?.querySelector('.test-modal')
    const nameInput = this.shadowRoot?.querySelector('.test-name') as HTMLInputElement
    const jsonArea = this.shadowRoot?.querySelector('.test-json') as HTMLTextAreaElement
    const successMsg = this.shadowRoot?.querySelector('.success-msg')
    
    if (modal && nameInput && jsonArea) {
      nameInput.value = ''  // Empty, user must enter name
      jsonArea.value = JSON.stringify(test, null, 2)
      modal.classList.add('open')
      
      // Focus the name input so user can start typing immediately
      setTimeout(() => nameInput.focus(), 100)
      
      // Clear any previous success message
      if (successMsg) successMsg.textContent = ''
      
      // Update JSON when name changes
      nameInput.oninput = () => {
        test.name = nameInput.value
        jsonArea.value = JSON.stringify(test, null, 2)
      }
    }
  }
  
  // Clean up text for use in descriptions (remove newlines, truncate)
  private cleanDescription(text: string, maxLen = 30): string {
    if (!text) return ''
    return text
      .replace(/\s+/g, ' ')  // Collapse whitespace/newlines to single space
      .trim()
      .slice(0, maxLen)
      + (text.length > maxLen ? '...' : '')
  }
  
  private eventsToTest(events: SemanticEvent[], options: { name: string, url: string, addAssertions: boolean }): DevChannelTest {
    const steps: TestStep[] = []
    let prevTimestamp = events[0]?.timestamp || Date.now()
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      const delay = i > 0 ? Math.min(event.timestamp - prevTimestamp, 5000) : undefined
      prevTimestamp = event.timestamp
      
      const selector = event.target?.selector || ''
      const text = event.target?.text || event.target?.label || ''
      
      switch (event.type) {
        case 'interaction:click':
          const clickText = this.cleanDescription(text)
          steps.push({
            action: 'click',
            selector,
            description: clickText ? `Click "${clickText}"` : `Click ${selector}`,
            ...(delay && delay > 50 ? { delay } : {}),
          })
          
          // Check if next event is navigation (click triggered it)
          const nextEvent = events[i + 1]
          if (nextEvent?.type === 'navigation:navigate' && options.addAssertions) {
            steps.push({
              action: 'assert',
              assertion: { type: 'url', pattern: nextEvent.payload?.url || '' },
              description: `Verify navigation to ${nextEvent.payload?.url}`,
            })
            i++ // Skip the navigation event
          }
          break
          
        case 'input:typed':
        case 'input:cleared':
        case 'input:changed':
        case 'input:checked':
          const inputValue = event.payload?.text ?? event.payload?.value ?? ''
          const inputType = event.payload?.fieldType || event.target?.tag || 'input'
          const inputLabel = this.cleanDescription(event.target?.label || inputType)
          const isCleared = event.type === 'input:cleared' || inputValue === ''
          
          // Determine the right action and description based on input type
          let inputAction = 'type'
          let inputDesc = ''
          
          if (isCleared) {
            inputDesc = `Clear ${inputLabel}`
          } else if (inputType === 'range') {
            inputAction = 'set'
            inputDesc = `Set ${inputLabel} to ${inputValue}`
          } else if (inputType === 'select-one' || inputType === 'select-multiple') {
            inputAction = 'select'
            inputDesc = `Select "${inputValue}" in ${inputLabel}`
          } else if (inputType === 'checkbox' || inputType === 'radio') {
            inputAction = 'check'
            inputDesc = `Check ${inputLabel}`
          } else if (inputType === 'date' || inputType === 'time' || inputType === 'color') {
            inputAction = 'set'
            inputDesc = `Set ${inputLabel} to ${inputValue}`
          } else {
            inputDesc = `Type "${inputValue}" in ${inputLabel}`
          }
          
          steps.push({
            action: inputAction,
            selector,
            ...(inputAction === 'type' || inputAction === 'set' ? { text: inputValue } : { value: inputValue }),
            description: inputDesc,
            ...(delay && delay > 50 ? { delay } : {}),
          })
          
          // Add value assertion
          if (options.addAssertions && inputValue) {
            steps.push({
              action: 'assert',
              assertion: { type: 'value', selector, expected: inputValue },
              description: `Verify ${inputLabel} is "${inputValue}"`,
            })
          }
          break
          
        case 'navigation:navigate':
          // Skip initial navigation (we set the test URL separately)
          // Only add if not triggered by click (handled above) or initial page load
          if (event.payload?.trigger !== 'click' && 
              event.payload?.trigger !== 'submit' && 
              event.payload?.trigger !== 'initial') {
            const navUrl = event.payload?.url || event.payload?.to || ''
            steps.push({
              action: 'navigate',
              url: navUrl,
              description: `Navigate to ${navUrl}`,
            })
          }
          break
          
        case 'interaction:submit':
          steps.push({
            action: 'click',
            selector: event.target?.selector || 'button[type="submit"]',
            description: `Submit form`,
            ...(delay && delay > 50 ? { delay } : {}),
          })
          break
          
        case 'interaction:select':
          const selectedText = this.cleanDescription(event.payload?.text || '', 50)
          steps.push({
            action: 'select',
            selector,
            text: event.payload?.text || '',
            description: `Select text "${selectedText}"`,
            ...(delay && delay > 50 ? { delay } : {}),
          })
          break
          
        case 'interaction:cut':
          const cutText = this.cleanDescription(event.payload?.text || '', 50)
          steps.push({
            action: 'cut',
            selector,
            text: event.payload?.text || '',
            description: `Cut "${cutText}"`,
            ...(delay && delay > 50 ? { delay } : {}),
          })
          break
          
        case 'interaction:copy':
          const copyText = this.cleanDescription(event.payload?.text || '', 50)
          steps.push({
            action: 'copy',
            selector,
            text: event.payload?.text || '',
            description: `Copy "${copyText}"`,
            ...(delay && delay > 50 ? { delay } : {}),
          })
          break
          
        case 'interaction:paste':
          const pasteText = this.cleanDescription(event.payload?.text || '', 50)
          steps.push({
            action: 'paste',
            selector,
            text: event.payload?.text || '',
            description: `Paste "${pasteText}"`,
            ...(delay && delay > 50 ? { delay } : {}),
          })
          break
          
        case 'input:newline':
          steps.push({
            action: 'key',
            selector,
            key: 'Enter',
            description: `Press Enter`,
            ...(delay && delay > 50 ? { delay } : {}),
          })
          break
          
        case 'input:escape':
          steps.push({
            action: 'key',
            selector,
            key: 'Escape',
            description: `Press Escape`,
            ...(delay && delay > 50 ? { delay } : {}),
          })
          break
      }
    }
    
    return {
      version: 1,
      name: options.name,
      url: options.url,
      createdAt: Date.now(),
      createdBy: 'human',
      steps,
    }
  }
  
  private closeTestModal() {
    const modal = this.shadowRoot?.querySelector('.test-modal')
    if (modal) {
      modal.classList.remove('open')
    }
  }
  
  private copyTest() {
    const jsonArea = this.shadowRoot?.querySelector('.test-json') as HTMLTextAreaElement
    const successMsg = this.shadowRoot?.querySelector('.success-msg')
    
    if (jsonArea) {
      navigator.clipboard.writeText(jsonArea.value).then(() => {
        if (successMsg) {
          successMsg.textContent = 'Copied!'
          setTimeout(() => { successMsg.textContent = '' }, 2000)
        }
      })
    }
  }
  
  private downloadTest() {
    const nameInput = this.shadowRoot?.querySelector('.test-name') as HTMLInputElement
    const jsonArea = this.shadowRoot?.querySelector('.test-json') as HTMLTextAreaElement
    const successMsg = this.shadowRoot?.querySelector('.success-msg')
    
    if (!nameInput?.value.trim()) {
      if (successMsg) {
        successMsg.textContent = 'Please enter a test name'
        successMsg.style.color = '#ef4444'
        setTimeout(() => { 
          successMsg.textContent = ''
          successMsg.style.color = ''
        }, 2000)
      }
      nameInput?.focus()
      return
    }
    
    if (jsonArea && nameInput) {
      // Update the JSON with the current name before saving
      const testData = JSON.parse(jsonArea.value)
      testData.name = nameInput.value.trim()
      const updatedJson = JSON.stringify(testData, null, 2)
      
      const filename = nameInput.value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '.test.json'
      const blob = new Blob([updatedJson], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      if (successMsg) {
        successMsg.textContent = `Saved as ${filename}`
        setTimeout(() => { successMsg.textContent = '' }, 3000)
      }
    }
  }
  
  // ============================================
  // Selection Tool (Phase 10)
  // ============================================
  
  private startSelection() {
    if (this.selectionActive) {
      this.cancelSelection()
      return
    }
    
    this.selectionActive = true
    this.selectionResult = null
    
    // Update button state
    const selectBtn = this.shadowRoot?.querySelector('[data-action="select"]')
    if (selectBtn) {
      selectBtn.classList.add('active')
      selectBtn.setAttribute('title', 'Cancel selection (click or Esc)')
    }
    
    // Create overlay
    this.selectionOverlay = document.createElement('div')
    this.selectionOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.1);
      cursor: crosshair;
      z-index: 2147483645;
    `
    
    // Create selection box (hidden initially)
    this.selectionBox = document.createElement('div')
    this.selectionBox.style.cssText = `
      position: fixed;
      border: 2px dashed #6366f1;
      background: rgba(99, 102, 241, 0.1);
      pointer-events: none;
      z-index: 2147483646;
      display: none;
    `
    
    document.body.appendChild(this.selectionOverlay)
    document.body.appendChild(this.selectionBox)
    
    // Event handlers
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      this.selectionStart = { x: e.clientX, y: e.clientY }
      this.selectionBox!.style.display = 'block'
      this.selectionBox!.style.left = `${e.clientX}px`
      this.selectionBox!.style.top = `${e.clientY}px`
      this.selectionBox!.style.width = '0'
      this.selectionBox!.style.height = '0'
    }
    
    const onMouseMove = (e: MouseEvent) => {
      if (!this.selectionStart) return
      
      const x = Math.min(this.selectionStart.x, e.clientX)
      const y = Math.min(this.selectionStart.y, e.clientY)
      const width = Math.abs(e.clientX - this.selectionStart.x)
      const height = Math.abs(e.clientY - this.selectionStart.y)
      
      this.selectionBox!.style.left = `${x}px`
      this.selectionBox!.style.top = `${y}px`
      this.selectionBox!.style.width = `${width}px`
      this.selectionBox!.style.height = `${height}px`
      
      this.selectionRect = { x, y, width, height }
      
      // Update element highlights as user drags
      this.updateSelectionHighlights()
    }
    
    const onMouseUp = (e: MouseEvent) => {
      if (!this.selectionStart || !this.selectionRect) {
        this.cancelSelection()
        return
      }
      
      // Finalize selection
      this.finalizeSelection()
    }
    
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.cancelSelection()
      }
    }
    
    this.selectionOverlay.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onKeyDown)
    
    // Store cleanup function
    ;(this.selectionOverlay as any)._cleanup = () => {
      this.selectionOverlay?.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKeyDown)
    }
  }
  
  private updateSelectionHighlights() {
    // Clear previous highlights
    this.clearHighlights()
    
    if (!this.selectionRect || this.selectionRect.width < 5 || this.selectionRect.height < 5) {
      return
    }
    
    // Find elements intersecting the selection rectangle
    const elements = this.getElementsInRect(this.selectionRect)
    
    // Highlight each element
    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      const highlight = document.createElement('div')
      highlight.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 2px solid #ef4444;
        background: rgba(239, 68, 68, 0.15);
        pointer-events: none;
        z-index: 2147483646;
        box-sizing: border-box;
      `
      document.body.appendChild(highlight)
      this.highlightedElements.push(highlight)
    }
  }
  
  private getElementsInRect(rect: { x: number, y: number, width: number, height: number }): Element[] {
    const elements: Element[] = []
    
    // Check all elements for intersection with selection rectangle
    const allElements = document.body.querySelectorAll('*')
    
    for (const el of allElements) {
      // Skip our own elements
      if (el.closest(TAG_NAME)) continue
      
      const elRect = el.getBoundingClientRect()
      
      // Skip zero-size elements
      if (elRect.width === 0 || elRect.height === 0) continue
      
      // Check if element is fully enclosed by selection rectangle
      const enclosed = (
        elRect.left >= rect.x &&
        elRect.right <= rect.x + rect.width &&
        elRect.top >= rect.y &&
        elRect.bottom <= rect.y + rect.height
      )
      
      if (enclosed) {
        elements.push(el)
      }
    }
    
    return elements
  }
  
  private clearHighlights() {
    for (const highlight of this.highlightedElements) {
      highlight.remove()
    }
    this.highlightedElements = []
  }
  
  private async finalizeSelection() {
    if (!this.selectionRect) {
      this.cancelSelection()
      return
    }
    
    const elements = this.getElementsInRect(this.selectionRect)
    
    // Build result
    this.selectionResult = {
      region: { ...this.selectionRect },
      elements: elements.map(el => {
        const rect = el.getBoundingClientRect()
        const attrs: Record<string, string> = {}
        for (const attr of el.attributes) {
          attrs[attr.name] = attr.value
        }
        return {
          selector: getSelector(el),
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 200),
          html: el.outerHTML.slice(0, 500),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          attributes: attrs,
        }
      }),
      timestamp: Date.now(),
    }
    
    // Send selection to server
    this.send('selection', 'completed', this.selectionResult)
    
    console.log(`${LOG_PREFIX} Selection completed: ${elements.length} elements`)
    
    // Clean up selection UI but keep highlights briefly
    this.selectionOverlay?.remove()
    this.selectionBox?.remove()
    this.selectionOverlay = null
    this.selectionBox = null
    this.selectionActive = false
    this.selectionStart = null
    this.selectionRect = null
    
    // Update button
    const selectBtn = this.shadowRoot?.querySelector('[data-action="select"]')
    if (selectBtn) {
      selectBtn.classList.remove('active')
      selectBtn.setAttribute('title', 'Select elements (drag to select area)')
    }
    
    // Keep highlights visible for 2 seconds
    setTimeout(() => {
      this.clearHighlights()
    }, 2000)
  }
  
  private cancelSelection() {
    // Cleanup
    if ((this.selectionOverlay as any)?._cleanup) {
      (this.selectionOverlay as any)._cleanup()
    }
    this.selectionOverlay?.remove()
    this.selectionBox?.remove()
    this.clearHighlights()
    
    this.selectionOverlay = null
    this.selectionBox = null
    this.selectionActive = false
    this.selectionStart = null
    this.selectionRect = null
    
    // Update button
    const selectBtn = this.shadowRoot?.querySelector('[data-action="select"]')
    if (selectBtn) {
      selectBtn.classList.remove('active')
      selectBtn.setAttribute('title', 'Select elements (drag to select area)')
    }
  }
  
  // Get current selection result (for API)
  getSelectionResult() {
    return this.selectionResult
  }
  
  // Clear stored selection
  clearSelection() {
    this.selectionResult = null
    this.clearHighlights()
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
      if (!target || target.closest(TAG_NAME)) return // Ignore widget clicks
      
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
   * Generate the best human-readable selector for an element.
   * Priority: meaningful identifiers an engineer would use to find it.
   * 
   * This incentivizes good accessibility: apps with proper ARIA labels,
   * semantic landmarks, and form labels get useful selectors.
   * Apps without them get "div[47] in body" - a nudge to improve.
   */
  private getBestSelector(el: Element): string {
    const tag = el.tagName.toLowerCase()
    const htmlEl = el as HTMLElement
    
    // 1. ID (if not auto-generated looking)
    if (el.id && !el.id.match(/^(ember|react|vue|ng-|:r|:R|\d)/)) {
      return `#${el.id}`
    }
    
    // 2. ARIA label - exactly what screen readers announce
    const ariaLabel = el.getAttribute('aria-label')
    if (ariaLabel) {
      return `${tag}[aria-label="${ariaLabel.slice(0, 40)}"]`
    }
    
    // 3. Title attribute - tooltip text
    const title = el.getAttribute('title')
    if (title) {
      return `${tag}[title="${title.slice(0, 40)}"]`
    }
    
    // 4. For form elements: associated label
    if (el.matches('input, select, textarea')) {
      const input = el as HTMLInputElement
      // Explicit label via for attribute
      const labelFor = input.id && document.querySelector(`label[for="${input.id}"]`)
      if (labelFor) {
        const labelText = (labelFor as HTMLElement).innerText?.trim().slice(0, 30)
        if (labelText) {
          return `${tag} labeled "${labelText}"`
        }
      }
      // Implicit label (input inside label)
      const parentLabel = el.closest('label')
      if (parentLabel) {
        const labelText = parentLabel.innerText?.trim().slice(0, 30)
        if (labelText) {
          return `${tag} labeled "${labelText}"`
        }
      }
      // aria-labelledby
      const labelledBy = el.getAttribute('aria-labelledby')
      if (labelledBy) {
        const labelEl = document.getElementById(labelledBy)
        if (labelEl) {
          return `${tag} labeled "${labelEl.innerText?.trim().slice(0, 30)}"`
        }
      }
      // Placeholder as last resort for inputs
      if (input.placeholder) {
        return `${tag}[placeholder="${input.placeholder.slice(0, 30)}"]`
      }
    }
    
    // 5. data-testid (designed for testing)
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id')
    if (testId) {
      return `[data-testid="${testId}"]`
    }
    
    // 6. Form element name attribute
    const name = el.getAttribute('name')
    if (name && el.matches('input, select, textarea, button')) {
      return `${tag}[name="${name}"]`
    }
    
    // 7. ARIA role with accessible name
    const role = el.getAttribute('role')
    if (role) {
      const accName = ariaLabel || htmlEl.innerText?.trim().slice(0, 30)
      if (accName) {
        return `${role} "${accName}"`
      }
      return `[role="${role}"]`
    }
    
    // 8. Semantic landmarks
    if (el.matches('main, nav, header, footer, aside, article, section')) {
      // Try to identify by heading inside
      const heading = el.querySelector('h1, h2, h3, h4')
      if (heading) {
        const headingText = (heading as HTMLElement).innerText?.trim().slice(0, 30)
        if (headingText) {
          return `${tag} "${headingText}"`
        }
      }
      return tag
    }
    
    // 9. Buttons and links by their text
    if (tag === 'button' || tag === 'a') {
      const text = htmlEl.innerText?.trim()
      if (text && text.length < 50 && !text.includes('\n')) {
        return `${tag} "${text.slice(0, 30)}"`
      }
      // Link by href
      if (tag === 'a') {
        const href = (el as HTMLAnchorElement).getAttribute('href')
        if (href && !href.startsWith('javascript:')) {
          return `link to "${href.slice(0, 40)}"`
        }
      }
    }
    
    // 10. Images by alt text
    if (tag === 'img') {
      const alt = el.getAttribute('alt')
      if (alt) {
        return `img "${alt.slice(0, 40)}"`
      }
    }
    
    // 11. Stable classes (filtering out utility classes)
    const classList = Array.from(el.classList).filter(c => 
      !c.match(/^(p|m|w|h|text|bg|flex|grid|hidden|block|inline|absolute|relative|overflow|cursor|transition|transform|opacity|z-)-/) && // Tailwind
      !c.match(/^-?xin-/) && // xinjs transient
      !c.match(/^(ng-|ember-|react-|vue-)/) && // Framework internals
      c.length > 2
    )
    
    if (classList.length > 0) {
      const selector = `${tag}.${classList.slice(0, 2).join('.')}`
      // Check uniqueness
      if (document.querySelectorAll(selector).length === 1) {
        return selector
      }
    }
    
    // 12. Context-based: describe by parent landmark + position
    const landmark = el.closest('main, nav, header, footer, aside, article, section, form')
    if (landmark && landmark !== el) {
      const landmarkDesc = this.getBestSelector(landmark)
      // Simple position within parent
      const siblings = Array.from(landmark.querySelectorAll(tag))
      const index = siblings.indexOf(el)
      if (siblings.length === 1) {
        return `${tag} in ${landmarkDesc}`
      } else if (index >= 0) {
        return `${tag}[${index + 1}] in ${landmarkDesc}`
      }
    }
    
    // 13. Last resort: path-based selector
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
  // Semantic Events (Phase 6)
  // ==========================================
  
  private startSemanticEvents() {
    if (this.semanticEventsEnabled) return
    this.semanticEventsEnabled = true
    
    // Click handler
    this.semanticHandlers.click = (e: MouseEvent) => {
      this.countRawEvent('click')
      const target = e.target as Element
      if (!target || this.contains(target)) return // Ignore widget clicks
      
      // Skip checkbox/radio clicks - the change event handles these better
      const inputType = (target as HTMLInputElement).type
      if (target.tagName === 'INPUT' && (inputType === 'checkbox' || inputType === 'radio')) {
        return
      }
      
      this.emitSemanticEvent({
        type: 'interaction:click',
        timestamp: Date.now(),
        category: 'interaction',
        target: this.getTargetInfo(target),
        payload: {
          text: (target as HTMLElement).innerText?.slice(0, 100),
          href: (target as HTMLAnchorElement).href,
          disabled: (target as HTMLButtonElement).disabled,
          position: { x: e.clientX, y: e.clientY },
        },
      })
    }
    
    // Input handler - aggregates typing (includes contenteditable)
    this.semanticHandlers.input = (e: Event) => {
      this.countRawEvent('input')
      const target = e.target as HTMLElement
      if (!target || this.contains(target)) return
      
      // Skip inputs handled by change handler (checkbox, radio, range, color, date, time, file)
      if (target.tagName === 'INPUT') {
        const inputType = (target as HTMLInputElement).type
        if (['checkbox', 'radio', 'range', 'color', 'date', 'time', 'datetime-local', 'month', 'week', 'file'].includes(inputType)) {
          return
        }
      }
      
      // Get the value - either from input/textarea or contenteditable
      const isContentEditable = target.isContentEditable
      const isFormField = 'value' in target
      
      if (!isContentEditable && !isFormField) return
      
      const currentValue = isContentEditable 
        ? target.innerText || ''
        : (target as HTMLInputElement).value
      
      // If typing in same field, extend the timeout
      if (this.typingState.field === target) {
        if (this.typingState.timeout) clearTimeout(this.typingState.timeout)
      } else {
        // New field - flush previous if any
        this.flushTyping()
        this.typingState.field = target
        this.typingState.startTime = Date.now()
        this.typingState.text = ''
      }
      
      this.typingState.text = currentValue
      this.typingState.timeout = setTimeout(() => this.flushTyping(), this.TYPING_DEBOUNCE)
    }
    
    // Keydown handler - capture Enter for newlines and special keys
    this.semanticHandlers.keydown = (e: KeyboardEvent) => {
      this.countRawEvent('keydown')
      const target = e.target as HTMLElement
      if (!target || this.contains(target)) return
      
      // Capture Enter key (newlines in textarea/contenteditable)
      if (e.key === 'Enter' && !e.isComposing) {
        const isContentEditable = target.isContentEditable
        const isTextarea = target.tagName === 'TEXTAREA'
        
        if (isContentEditable || isTextarea) {
          this.emitSemanticEvent({
            type: 'input:newline',
            timestamp: Date.now(),
            category: 'input',
            target: this.getTargetInfo(target),
            payload: {
              field: this.getBestSelector(target),
              shiftKey: e.shiftKey,
            },
          })
        }
      }
      
      // Capture Escape key
      if (e.key === 'Escape') {
        this.emitSemanticEvent({
          type: 'input:escape',
          timestamp: Date.now(),
          category: 'input',
          target: this.getTargetInfo(target),
          payload: {},
        })
      }
    }
    
    // Change handler - for inputs that don't fire 'input' events (date, time, color, select, file)
    this.semanticHandlers.change = (e: Event) => {
      this.countRawEvent('change')
      const target = e.target as HTMLInputElement | HTMLSelectElement
      if (!target || this.contains(target)) return
      
      const tagName = target.tagName.toLowerCase()
      const inputType = (target as HTMLInputElement).type || ''
      
      // Skip text inputs - they're handled by the input handler
      if (tagName === 'input' && ['text', 'password', 'email', 'search', 'tel', 'url', 'number'].includes(inputType)) {
        return
      }
      
      // Handle select elements
      if (tagName === 'select') {
        const select = target as HTMLSelectElement
        const selectedOptions = Array.from(select.selectedOptions).map(o => o.value)
        const value = select.multiple ? selectedOptions.join(', ') : select.value
        
        this.emitSemanticEvent({
          type: 'input:changed',
          timestamp: Date.now(),
          category: 'input',
          target: this.getTargetInfo(target),
          payload: {
            text: value,
            value,
            field: this.getBestSelector(target),
            fieldType: select.multiple ? 'select-multiple' : 'select-one',
            selectedOptions,
          },
        })
        return
      }
      
      // Handle special input types (date, time, color, range, checkbox, radio, file)
      if (tagName === 'input') {
        const input = target as HTMLInputElement
        let value = input.value
        let eventType: 'input:changed' | 'input:checked' = 'input:changed'
        
        // For checkbox/radio, track checked state
        if (inputType === 'checkbox' || inputType === 'radio') {
          eventType = 'input:checked'
          value = input.checked ? input.value || 'on' : ''
        }
        
        // For file inputs, get file names
        if (inputType === 'file' && input.files) {
          value = Array.from(input.files).map(f => f.name).join(', ')
        }
        
        this.emitSemanticEvent({
          type: eventType,
          timestamp: Date.now(),
          category: 'input',
          target: this.getTargetInfo(target),
          payload: {
            text: value,
            value,
            field: this.getBestSelector(target),
            fieldType: inputType,
            checked: input.checked,
          },
        })
      }
    }
    
    // Scroll handler - aggregates scroll events
    this.semanticHandlers.scroll = () => {
      this.countRawEvent('scroll')
      const now = Date.now()
      
      if (this.scrollState.timeout) {
        clearTimeout(this.scrollState.timeout)
      } else {
        // Start of scroll
        this.scrollState.startY = window.scrollY
        this.scrollState.startTime = now
      }
      
      this.scrollState.timeout = setTimeout(() => this.flushScroll(), this.SCROLL_DEBOUNCE)
    }
    
    // Hover handlers - track element boundaries
    this.semanticHandlers.mouseover = (e: MouseEvent) => {
      this.countRawEvent('mouseover')
      const target = e.target as Element
      if (!target || this.contains(target)) return
      
      // Ignore if same element
      if (this.hoverState.element === target) return
      
      // Flush previous hover
      this.flushHover()
      
      this.hoverState.element = target
      this.hoverState.enterTime = Date.now()
      
      // Emit enter event
      this.emitSemanticEvent({
        type: 'hover:enter',
        timestamp: Date.now(),
        category: 'hover',
        target: this.getTargetInfo(target),
        payload: {
          from: e.relatedTarget ? this.getBestSelector(e.relatedTarget as Element) : undefined,
        },
      })
      
      // Set dwell timeout
      this.hoverState.timeout = setTimeout(() => {
        if (this.hoverState.element === target) {
          const isInteractive = target.matches('a, button, input, select, textarea, [role="button"], [tabindex]')
          this.emitSemanticEvent({
            type: 'hover:dwell',
            timestamp: Date.now(),
            category: 'hover',
            target: this.getTargetInfo(target),
            payload: {
              duration: Date.now() - this.hoverState.enterTime,
              element: this.getBestSelector(target),
              interactive: isInteractive,
            },
          })
        }
      }, this.DWELL_THRESHOLD)
    }
    
    this.semanticHandlers.mouseout = (e: MouseEvent) => {
      const target = e.target as Element
      if (!target || this.hoverState.element !== target) return
      
      this.flushHover()
    }
    
    // Focus handlers
    this.semanticHandlers.focus = (e: FocusEvent) => {
      this.countRawEvent('focus')
      const target = e.target as Element
      if (!target || this.contains(target)) return
      
      this.emitSemanticEvent({
        type: 'focus:in',
        timestamp: Date.now(),
        category: 'focus',
        target: this.getTargetInfo(target),
        payload: {
          fieldType: (target as HTMLInputElement).type,
          hasValue: !!(target as HTMLInputElement).value,
          required: (target as HTMLInputElement).required,
        },
      })
    }
    
    this.semanticHandlers.blur = (e: FocusEvent) => {
      this.countRawEvent('blur')
      const target = e.target as Element
      if (!target || this.contains(target)) return
      
      this.emitSemanticEvent({
        type: 'focus:out',
        timestamp: Date.now(),
        category: 'focus',
        target: this.getTargetInfo(target),
        payload: {
          fieldType: (target as HTMLInputElement).type,
          hasValue: !!(target as HTMLInputElement).value,
          required: (target as HTMLInputElement).required,
        },
      })
    }
    
    // Form submit
    this.semanticHandlers.submit = (e: SubmitEvent) => {
      this.countRawEvent('submit')
      const form = e.target as HTMLFormElement
      if (!form || this.contains(form)) return
      
      this.emitSemanticEvent({
        type: 'form:submit',
        timestamp: Date.now(),
        category: 'interaction',
        target: this.getTargetInfo(form),
        payload: {
          formId: form.id,
          formName: form.name,
          formAction: form.action,
          fieldCount: form.elements.length,
          method: form.method,
        },
      })
    }
    
    // Form reset
    this.semanticHandlers.reset = (e: Event) => {
      this.countRawEvent('reset')
      const form = e.target as HTMLFormElement
      if (!form || this.contains(form)) return
      
      this.emitSemanticEvent({
        type: 'form:reset',
        timestamp: Date.now(),
        category: 'interaction',
        target: this.getTargetInfo(form),
        payload: {
          formId: form.id,
          formName: form.name,
        },
      })
    }
    
    // Form invalid (validation failed on a field)
    this.semanticHandlers.invalid = (e: Event) => {
      this.countRawEvent('invalid')
      const target = e.target as HTMLInputElement
      if (!target || this.contains(target)) return
      
      this.emitSemanticEvent({
        type: 'form:invalid',
        timestamp: Date.now(),
        category: 'input',
        target: this.getTargetInfo(target),
        payload: {
          field: this.getBestSelector(target),
          fieldName: target.name,
          fieldType: target.type,
          validationMessage: target.validationMessage,
          validity: {
            valueMissing: target.validity.valueMissing,
            typeMismatch: target.validity.typeMismatch,
            patternMismatch: target.validity.patternMismatch,
            tooShort: target.validity.tooShort,
            tooLong: target.validity.tooLong,
            rangeUnderflow: target.validity.rangeUnderflow,
            rangeOverflow: target.validity.rangeOverflow,
            stepMismatch: target.validity.stepMismatch,
          },
        },
      })
    }
    
    // Navigation (popstate)
    this.semanticHandlers.popstate = () => {
      this.countRawEvent('popstate')
      this.emitSemanticEvent({
        type: 'navigation:navigate',
        timestamp: Date.now(),
        category: 'navigation',
        payload: {
          from: document.referrer,
          to: location.href,
          trigger: 'popstate',
        },
      })
    }
    
    // Drag tracking state
    let dragState: { 
      target: Element | null
      startX: number
      startY: number
      startTime: number
    } | null = null
    
    // Mousedown - potential drag start
    this.semanticHandlers.mousedown = (e: MouseEvent) => {
      this.countRawEvent('mousedown')
      const target = e.target as Element
      if (!target || this.contains(target)) return
      
      dragState = {
        target,
        startX: e.clientX,
        startY: e.clientY,
        startTime: Date.now(),
      }
    }
    
    // Mouseup - check if it was a drag
    this.semanticHandlers.mouseup = (e: MouseEvent) => {
      this.countRawEvent('mouseup')
      if (!dragState) return
      
      const dx = e.clientX - dragState.startX
      const dy = e.clientY - dragState.startY
      const distance = Math.sqrt(dx * dx + dy * dy)
      const duration = Date.now() - dragState.startTime
      
      // Emit drag if:
      // - distance > 10px (any duration), OR
      // - duration > 200ms (deliberate hold, any distance)
      const isSignificantMove = distance > 10
      const isDeliberateHold = duration > 200
      
      if (isSignificantMove || isDeliberateHold) {
        this.emitSemanticEvent({
          type: 'interaction:drag',
          timestamp: Date.now(),
          category: 'interaction',
          target: this.getTargetInfo(dragState.target!),
          payload: {
            startX: dragState.startX,
            startY: dragState.startY,
            endX: e.clientX,
            endY: e.clientY,
            distance: Math.round(distance),
            duration,
            direction: Math.abs(dx) > Math.abs(dy) 
              ? (dx > 0 ? 'right' : 'left')
              : (dy > 0 ? 'down' : 'up'),
          },
        })
      }
      
      dragState = null
    }
    
    // Clipboard handlers - cut/copy/paste
    this.semanticHandlers.cut = (e: ClipboardEvent) => {
      this.countRawEvent('cut')
      const target = e.target as Element
      if (!target || this.contains(target)) return
      
      const selection = document.getSelection()
      const text = selection?.toString() || ''
      
      this.emitSemanticEvent({
        type: 'interaction:cut',
        timestamp: Date.now(),
        category: 'interaction',
        target: this.getTargetInfo(target),
        payload: {
          text: text.slice(0, 200),
          length: text.length,
        },
      })
    }
    
    this.semanticHandlers.copy = (e: ClipboardEvent) => {
      this.countRawEvent('copy')
      const target = e.target as Element
      if (!target || this.contains(target)) return
      
      const selection = document.getSelection()
      const text = selection?.toString() || ''
      
      this.emitSemanticEvent({
        type: 'interaction:copy',
        timestamp: Date.now(),
        category: 'interaction',
        target: this.getTargetInfo(target),
        payload: {
          text: text.slice(0, 200),
          length: text.length,
        },
      })
    }
    
    this.semanticHandlers.paste = (e: ClipboardEvent) => {
      this.countRawEvent('paste')
      const target = e.target as Element
      if (!target || this.contains(target)) return
      
      const text = e.clipboardData?.getData('text') || ''
      
      this.emitSemanticEvent({
        type: 'interaction:paste',
        timestamp: Date.now(),
        category: 'interaction',
        target: this.getTargetInfo(target),
        payload: {
          text: text.slice(0, 200),
          length: text.length,
        },
      })
    }
    
    // Selection change handler - capture text selections
    let selectionTimeout: ReturnType<typeof setTimeout> | null = null
    this.semanticHandlers.selectionchange = () => {
      this.countRawEvent('selectionchange')
      // Debounce selection events
      if (selectionTimeout) clearTimeout(selectionTimeout)
      selectionTimeout = setTimeout(() => {
        const selection = document.getSelection()
        if (!selection || selection.isCollapsed) return
        
        const text = selection.toString().trim()
        if (!text || text.length < 2) return // Ignore tiny selections
        
        // Get the element containing the selection
        const anchorNode = selection.anchorNode
        const element = anchorNode?.nodeType === Node.TEXT_NODE 
          ? anchorNode.parentElement 
          : anchorNode as Element
        
        if (!element || this.contains(element)) return
        
        this.emitSemanticEvent({
          type: 'interaction:select',
          timestamp: Date.now(),
          category: 'interaction',
          target: this.getTargetInfo(element),
          payload: {
            text: text.slice(0, 200),
            length: text.length,
            selector: this.getBestSelector(element),
          },
        })
      }, 300) // Wait for selection to stabilize
    }
    
    // Add all listeners
    document.addEventListener('click', this.semanticHandlers.click, true)
    document.addEventListener('input', this.semanticHandlers.input, true)
    document.addEventListener('change', this.semanticHandlers.change, true)
    document.addEventListener('keydown', this.semanticHandlers.keydown, true)
    document.addEventListener('cut', this.semanticHandlers.cut, true)
    document.addEventListener('copy', this.semanticHandlers.copy, true)
    document.addEventListener('paste', this.semanticHandlers.paste, true)
    document.addEventListener('selectionchange', this.semanticHandlers.selectionchange)
    window.addEventListener('scroll', this.semanticHandlers.scroll, { passive: true })
    document.addEventListener('mouseover', this.semanticHandlers.mouseover, true)
    document.addEventListener('mouseout', this.semanticHandlers.mouseout, true)
    document.addEventListener('focusin', this.semanticHandlers.focus, true)
    document.addEventListener('focusout', this.semanticHandlers.blur, true)
    document.addEventListener('submit', this.semanticHandlers.submit, true)
    document.addEventListener('reset', this.semanticHandlers.reset, true)
    document.addEventListener('invalid', this.semanticHandlers.invalid, true)
    window.addEventListener('popstate', this.semanticHandlers.popstate)
    document.addEventListener('mousedown', this.semanticHandlers.mousedown, true)
    document.addEventListener('mouseup', this.semanticHandlers.mouseup, true)
    
    // Emit initial navigation event
    this.emitSemanticEvent({
      type: 'navigation:navigate',
      timestamp: Date.now(),
      category: 'navigation',
      payload: {
        from: document.referrer,
        to: location.href,
        trigger: 'initial',
      },
    })
  }
  
  private stopSemanticEvents() {
    if (!this.semanticEventsEnabled) return
    this.semanticEventsEnabled = false
    
    // Flush any pending aggregated events
    this.flushTyping()
    this.flushScroll()
    this.flushHover()
    
    // Remove all listeners
    if (this.semanticHandlers.click) {
      document.removeEventListener('click', this.semanticHandlers.click, true)
    }
    if (this.semanticHandlers.input) {
      document.removeEventListener('input', this.semanticHandlers.input, true)
    }
    if (this.semanticHandlers.change) {
      document.removeEventListener('change', this.semanticHandlers.change, true)
    }
    if (this.semanticHandlers.keydown) {
      document.removeEventListener('keydown', this.semanticHandlers.keydown, true)
    }
    if (this.semanticHandlers.cut) {
      document.removeEventListener('cut', this.semanticHandlers.cut, true)
    }
    if (this.semanticHandlers.copy) {
      document.removeEventListener('copy', this.semanticHandlers.copy, true)
    }
    if (this.semanticHandlers.paste) {
      document.removeEventListener('paste', this.semanticHandlers.paste, true)
    }
    if (this.semanticHandlers.selectionchange) {
      document.removeEventListener('selectionchange', this.semanticHandlers.selectionchange)
    }
    if (this.semanticHandlers.scroll) {
      window.removeEventListener('scroll', this.semanticHandlers.scroll)
    }
    if (this.semanticHandlers.mouseover) {
      document.removeEventListener('mouseover', this.semanticHandlers.mouseover, true)
    }
    if (this.semanticHandlers.mouseout) {
      document.removeEventListener('mouseout', this.semanticHandlers.mouseout, true)
    }
    if (this.semanticHandlers.focus) {
      document.removeEventListener('focusin', this.semanticHandlers.focus, true)
    }
    if (this.semanticHandlers.blur) {
      document.removeEventListener('focusout', this.semanticHandlers.blur, true)
    }
    if (this.semanticHandlers.submit) {
      document.removeEventListener('submit', this.semanticHandlers.submit, true)
    }
    if (this.semanticHandlers.reset) {
      document.removeEventListener('reset', this.semanticHandlers.reset, true)
    }
    if (this.semanticHandlers.invalid) {
      document.removeEventListener('invalid', this.semanticHandlers.invalid, true)
    }
    if (this.semanticHandlers.popstate) {
      window.removeEventListener('popstate', this.semanticHandlers.popstate)
    }
    if (this.semanticHandlers.mousedown) {
      document.removeEventListener('mousedown', this.semanticHandlers.mousedown, true)
    }
    if (this.semanticHandlers.mouseup) {
      document.removeEventListener('mouseup', this.semanticHandlers.mouseup, true)
    }
    
    this.semanticHandlers = {}
  }
  
  private flushTyping() {
    if (this.typingState.field) {
      const field = this.typingState.field as HTMLElement
      const isContentEditable = field.isContentEditable
      
      // Skip inputs that are handled by the change handler
      if (field.tagName === 'INPUT') {
        const inputType = (field as HTMLInputElement).type
        if (['checkbox', 'radio', 'range', 'color', 'date', 'time', 'datetime-local', 'month', 'week', 'file'].includes(inputType)) {
          if (this.typingState.timeout) clearTimeout(this.typingState.timeout)
          this.typingState = { field: null, startTime: 0, text: '', timeout: null }
          return
        }
      }
      
      const finalValue = isContentEditable 
        ? field.innerText || ''
        : (field as HTMLInputElement).value
      const fieldType = isContentEditable 
        ? 'contenteditable' 
        : (field as HTMLInputElement).type || field.tagName.toLowerCase()
      
      // Emit if there's text OR if the field was cleared (empty value after interaction)
      if (this.typingState.text || finalValue === '') {
        this.emitSemanticEvent({
          type: finalValue === '' ? 'input:cleared' : 'input:typed',
          timestamp: Date.now(),
          category: 'input',
          target: this.getTargetInfo(field),
          payload: {
            text: finalValue,
            field: this.getBestSelector(field),
            fieldType,
            duration: Date.now() - this.typingState.startTime,
            finalValue: finalValue,
          },
        })
      }
    }
    
    if (this.typingState.timeout) clearTimeout(this.typingState.timeout)
    this.typingState = { field: null, startTime: 0, text: '', timeout: null }
  }
  
  private flushScroll() {
    if (this.scrollState.timeout) {
      const distance = Math.abs(window.scrollY - this.scrollState.startY)
      if (distance > 50) { // Only emit if scrolled meaningfully
        // Try to find what element we scrolled to
        const viewportMid = window.innerHeight / 2
        const elemAtMid = document.elementFromPoint(window.innerWidth / 2, viewportMid)
        
        let toSelector = 'unknown'
        if (window.scrollY < 100) {
          toSelector = 'top'
        } else if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 100) {
          toSelector = 'bottom'
        } else if (elemAtMid) {
          toSelector = this.getBestSelector(elemAtMid)
        }
        
        this.emitSemanticEvent({
          type: 'scroll:stop',
          timestamp: Date.now(),
          category: 'scroll',
          payload: {
            to: toSelector,
            direction: window.scrollY > this.scrollState.startY ? 'down' : 'up',
            distance,
            duration: Date.now() - this.scrollState.startTime,
          },
        })
      }
      
      clearTimeout(this.scrollState.timeout)
    }
    this.scrollState = { startY: 0, startTime: 0, timeout: null }
  }
  
  private flushHover() {
    if (this.hoverState.element) {
      const dwellTime = Date.now() - this.hoverState.enterTime
      
      this.emitSemanticEvent({
        type: 'hover:leave',
        timestamp: Date.now(),
        category: 'hover',
        target: this.getTargetInfo(this.hoverState.element),
        payload: {
          to: undefined, // Could track this but adds complexity
          dwellTime,
        },
      })
    }
    
    if (this.hoverState.timeout) clearTimeout(this.hoverState.timeout)
    this.hoverState = { element: null, enterTime: 0, timeout: null }
  }
  
  private getTargetInfo(el: Element): SemanticEvent['target'] {
    return {
      selector: this.getBestSelector(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      text: (el as HTMLElement).innerText?.slice(0, 50),
      role: el.getAttribute('role') || undefined,
      label: el.getAttribute('aria-label') || (el as HTMLInputElement).labels?.[0]?.innerText,
    }
  }
  
  // Count a raw DOM event for noise metrics
  private countRawEvent(eventType: string) {
    this.rawEventCounts[eventType] = (this.rawEventCounts[eventType] || 0) + 1
  }
  
  private emitSemanticEvent(event: SemanticEvent) {
    // Count semantic event for metrics
    this.semanticEventCounts[event.category]++
    
    // Check if this event category is subscribed
    if (this.semanticSubscription) {
      const categories = this.semanticSubscription.categories 
        || (this.semanticSubscription.preset 
            ? this.SEMANTIC_PRESETS[this.semanticSubscription.preset] 
            : null)
      
      if (categories && !categories.includes(event.category)) {
        return // Skip - not subscribed to this category
      }
    }
    
    // Add to buffer
    this.semanticEventBuffer.push(event)
    if (this.semanticEventBuffer.length > this.SEMANTIC_BUFFER_MAX) {
      this.semanticEventBuffer.shift()
    }
    
    // Update log panel if open
    if (this.logPanelOpen) {
      this.updateLogPanel()
    }
    
    // Send to server
    this.send('semantic', event.type, event)
  }
  
  private getSemanticBuffer(since?: number): SemanticEvent[] {
    if (since) {
      return this.semanticEventBuffer.filter(e => e.timestamp > since)
    }
    return [...this.semanticEventBuffer]
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
          windowId: this.windowId,
          browserId: this.browserId, 
          version: VERSION,
          serverSessionId: SERVER_SESSION_ID,
          url: location.href, 
          title: document.title,
          active: this.isActive
        })
        // Watch for URL/title changes to report to server
        this.setupNavigationWatcher()
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
    this.cleanupNavigationWatcher()
  }
  
  // Track URL/title changes for multi-window management
  private lastReportedUrl = ''
  private lastReportedTitle = ''
  private navigationWatcherInterval: ReturnType<typeof setInterval> | null = null
  
  private setupNavigationWatcher() {
    this.lastReportedUrl = location.href
    this.lastReportedTitle = document.title
    
    // Poll for changes (catches SPA navigation, title changes, etc.)
    this.navigationWatcherInterval = setInterval(() => {
      const currentUrl = location.href
      const currentTitle = document.title
      
      if (currentUrl !== this.lastReportedUrl || currentTitle !== this.lastReportedTitle) {
        this.lastReportedUrl = currentUrl
        this.lastReportedTitle = currentTitle
        this.send('system', 'window-updated', {
          windowId: this.windowId,
          url: currentUrl,
          title: currentTitle
        })
      }
    }, 500)
  }
  
  private cleanupNavigationWatcher() {
    if (this.navigationWatcherInterval) {
      clearInterval(this.navigationWatcherInterval)
      this.navigationWatcherInterval = null
    }
  }
  
  /**
   * Activate this window - it will respond to commands
   */
  activate() {
    this.isActive = true
    this.send('system', 'window-state', {
      windowId: this.windowId,
      active: true
    })
    this.render()
  }
  
  /**
   * Deactivate this window - it stays connected but won't respond to commands
   * (unless specifically targeted by windowId)
   */
  deactivate() {
    this.isActive = false
    this.send('system', 'window-state', {
      windowId: this.windowId,
      active: false
    })
    this.render()
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
    
    // Check if this message is targeted at a specific window
    const targetWindowId = msg.payload?.windowId
    const isTargeted = !!targetWindowId
    const isForUs = !targetWindowId || targetWindowId === this.windowId
    
    // If message is targeted at another window, ignore it
    if (isTargeted && !isForUs) {
      return
    }
    
    // If we're inactive and the message isn't specifically for us, ignore non-system messages
    // (System messages are always handled so we can be activated/focused)
    if (!this.isActive && !isForUs && msg.channel !== 'system') {
      return
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
      case 'selection':
        this.handleSelectionMessage(msg)
        break
      case 'navigation':
        this.handleNavigationMessage(msg)
        break
      case 'tabs':
        this.handleTabsMessage(msg)
        break
      case 'mutations':
        this.handleMutationsMessage(msg)
        break
      case 'semantic':
        this.handleSemanticMessage(msg)
        break
    }
    
    this.render()
  }
  
  private handleSemanticMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    if (action === 'start' || action === 'watch') {
      // Accept subscription options
      this.semanticSubscription = payload || null
      
      // Reset noise reduction stats
      this.rawEventCounts = {}
      this.semanticEventCounts = {
        interaction: 0, navigation: 0, input: 0, hover: 0, scroll: 0, mutation: 0, console: 0, focus: 0
      }
      this.statsStartTime = Date.now()
      
      this.startSemanticEvents()
      
      const categories = this.semanticSubscription?.categories 
        || (this.semanticSubscription?.preset 
            ? this.SEMANTIC_PRESETS[this.semanticSubscription.preset] 
            : Object.values(this.SEMANTIC_PRESETS).flat())
      
      this.respond(msg.id, true, { 
        watching: true,
        preset: this.semanticSubscription?.preset,
        categories: [...new Set(categories)],
      })
    } else if (action === 'stop' || action === 'unwatch') {
      this.stopSemanticEvents()
      this.semanticSubscription = null
      this.respond(msg.id, true, { watching: false })
    } else if (action === 'buffer' || action === 'get') {
      const since = payload?.since
      const category = payload?.category
      let events = this.getSemanticBuffer(since)
      
      // Filter by category if specified
      if (category) {
        events = events.filter(e => e.category === category)
      }
      
      this.respond(msg.id, true, { 
        events,
        enabled: this.semanticEventsEnabled,
      })
    } else if (action === 'status') {
      this.respond(msg.id, true, {
        enabled: this.semanticEventsEnabled,
        bufferSize: this.semanticEventBuffer.length,
        subscription: this.semanticSubscription,
      })
    } else if (action === 'stats') {
      // Calculate noise reduction metrics
      const totalRaw = Object.values(this.rawEventCounts).reduce((a, b) => a + b, 0)
      const totalSemantic = Object.values(this.semanticEventCounts).reduce((a, b) => a + b, 0)
      const duration = Date.now() - this.statsStartTime
      
      // Calculate what would be visible at each preset level
      const byPreset: Record<string, { events: number; categories: string[] }> = {}
      for (const [preset, categories] of Object.entries(this.SEMANTIC_PRESETS)) {
        const count = categories.reduce((sum, cat) => sum + (this.semanticEventCounts[cat] || 0), 0)
        byPreset[preset] = { events: count, categories }
      }
      
      this.respond(msg.id, true, {
        duration,
        raw: {
          total: totalRaw,
          byType: this.rawEventCounts,
        },
        semantic: {
          total: totalSemantic,
          byCategory: this.semanticEventCounts,
        },
        byPreset,
        noiseReduction: totalRaw > 0 ? Math.round((1 - totalSemantic / totalRaw) * 100) : 0,
      })
    }
  }
  
  private handleSystemMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    // When we see another browser connect, kill ourselves
    // But only if it's a different browser in the same window (same windowId, different browserId)
    // This prevents killing other tabs
    if (action === 'connected' && payload?.browserId && payload.browserId !== this.browserId) {
      // Only kill if same windowId (this is a refresh of the same tab)
      if (payload.windowId === this.windowId) {
        this.kill()
      }
    }
    
    // Respond to version request
    if (action === 'version') {
      this.respond(msg.id, true, { 
        version: VERSION,
        windowId: this.windowId,
        browserId: this.browserId,
        url: location.href,
        title: document.title,
        state: this.state,
        active: this.isActive,
      })
    }
    
    // Activate this window
    if (action === 'activate') {
      // Check if this message is for us (either no target or targets our window)
      if (!payload?.windowId || payload.windowId === this.windowId) {
        this.isActive = true
        this.render()
        this.respond(msg.id, true, { windowId: this.windowId, active: true })
      }
    }
    
    // Deactivate this window
    if (action === 'deactivate') {
      if (!payload?.windowId || payload.windowId === this.windowId) {
        this.isActive = false
        this.render()
        this.respond(msg.id, true, { windowId: this.windowId, active: false })
      }
    }
    
    // Focus this window (bring browser tab to front)
    if (action === 'focus') {
      if (!payload?.windowId || payload.windowId === this.windowId) {
        // Try to focus the window/tab
        window.focus()
        // Also activate it
        this.isActive = true
        this.render()
        this.respond(msg.id, true, { windowId: this.windowId, focused: true })
      }
    }
    
    // Get window info
    if (action === 'window-info') {
      this.respond(msg.id, true, {
        windowId: this.windowId,
        browserId: this.browserId,
        url: location.href,
        title: document.title,
        active: this.isActive,
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
          const wsUrl = this.serverUrl
          // Remove old element
          this.remove()
          // Eval new code - this registers a new DevChannel with auto-generated tag
          eval(code)
          // Use the NEW DevChannel class (attached to window by the eval'd code)
          const NewDevChannel = (window as any).DevChannel
          const creator = NewDevChannel.elementCreator()
          const newWidget = creator()
          newWidget.setAttribute('server', wsUrl)
          newWidget.setAttribute('data-version', NewDevChannel.VERSION || VERSION)
          document.body.appendChild(newWidget)
        })
        .catch(err => {
          console.error(`${LOG_PREFIX} Failed to reload:`, err)
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
  
  private handleTabsMessage(msg: DevMessage) {
    const { action, payload } = msg
    
    // Tab management - only works in Electron app where window.haltija is exposed
    const haltija = (window as any).haltija
    
    if (action === 'open') {
      if (haltija?.openTab) {
        haltija.openTab(payload.url)
          .then((opened: boolean) => {
            this.respond(msg.id, true, { opened })
          })
          .catch((err: any) => {
            this.respond(msg.id, false, null, err.message)
          })
      } else {
        // Fallback: open in new window (works outside Electron too)
        window.open(payload.url, '_blank')
        this.respond(msg.id, true, { opened: true, fallback: true })
      }
    } else if (action === 'close') {
      if (haltija?.closeTab) {
        haltija.closeTab(payload.windowId)
        this.respond(msg.id, true)
      } else {
        this.respond(msg.id, false, null, 'Tab close not available outside Electron app')
      }
    } else if (action === 'focus') {
      if (haltija?.focusTab) {
        haltija.focusTab(payload.windowId)
        this.respond(msg.id, true)
      } else {
        this.respond(msg.id, false, null, 'Tab focus not available outside Electron app')
      }
    } else {
      this.respond(msg.id, false, null, `Unknown tabs action: ${action}`)
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
  // Selection Tool Message Handling
  // ==========================================
  
  private handleSelectionMessage(msg: DevMessage) {
    const { action } = msg
    
    if (action === 'start') {
      this.startSelection()
      this.respond(msg.id, true, { active: true })
    } else if (action === 'cancel') {
      this.cancelSelection()
      this.respond(msg.id, true, { active: false })
    } else if (action === 'status') {
      this.respond(msg.id, true, {
        active: this.selectionActive,
        hasResult: this.selectionResult !== null,
      })
    } else if (action === 'result') {
      if (this.selectionResult) {
        this.respond(msg.id, true, this.selectionResult)
      } else {
        this.respond(msg.id, false, null, 'No selection available')
      }
    } else if (action === 'clear') {
      this.clearSelection()
      this.respond(msg.id, true, { cleared: true })
    } else {
      this.respond(msg.id, false, null, `Unknown selection action: ${action}`)
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
        if (level === 'error') {
          if (this.state === 'connected') {
            this.send('console', level, entry)
          }
          // Update UI to show error indicator
          this.updateUI()
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

// Register the custom element, handling re-registration with new tag names
function registerDevChannel() {
  // Try to register with preferred tag name, fall back to numbered versions
  let tagToUse = TAG_NAME
  
  if (customElements.get(tagToUse)) {
    // Already registered - generate a new tag name
    registrationCount++
    tagToUse = `${TAG_NAME}-${registrationCount}`
    
    // Keep trying until we find an unused tag
    while (customElements.get(tagToUse)) {
      registrationCount++
      tagToUse = `${TAG_NAME}-${registrationCount}`
    }
    
    console.log(`${LOG_PREFIX} Re-registering as ${tagToUse}`)
  }
  
  customElements.define(tagToUse, DevChannel)
  currentTagName = tagToUse
}

registerDevChannel()

// Export for bookmarklet injection
export function inject(serverUrl = 'wss://localhost:8700/ws/browser') {
  // Check for any existing haltija widget (handles renamed tags like haltija-dev-1, haltija-dev-2)
  const existingWidget = Array.from(document.querySelectorAll('*')).find(
    el => el.tagName.toLowerCase().startsWith('haltija-dev')
  )
  if (existingWidget) {
    console.log(`${LOG_PREFIX} Already injected as`, existingWidget.tagName.toLowerCase())
    return
  }
  
  // Use the element creator to get the correct tag
  const el = DevChannel.elementCreator()()
  el.setAttribute('server', serverUrl)
  el.setAttribute('data-version', VERSION)
  document.body.appendChild(el)
  console.log(`${LOG_PREFIX} Injected as`, currentTagName)
}

// Attach to window for console access
if (typeof window !== 'undefined') {
  (window as any).DevChannel = DevChannel
}
