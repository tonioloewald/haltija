/**
 * Haltija API Handlers
 * 
 * Handler implementations for API endpoints.
 * Handlers are registered by path and called by the router.
 * 
 * Each handler receives:
 * - body: Validated request body (for POST) or empty object (for GET)
 * - ctx: HandlerContext with requestFromBrowser, headers, etc.
 */

import type { EndpointDef } from './api-schema'

// ============================================
// Handler Context Type
// ============================================

/** Response from browser widget */
export interface DevResponse {
  id: string
  success: boolean
  data?: any
  error?: string
  timestamp: number
}

/** Function to send request to browser widget */
export type RequestFromBrowserFn = (
  channel: string,
  action: string,
  payload: any,
  timeoutMs?: number,
  windowId?: string
) => Promise<DevResponse>

/** Window info for response context */
export interface WindowInfo {
  id: string
  url: string
  title: string
}

/** Active recording session info */
export interface RecordingSessionInfo {
  windowId: string
  startTime: number
  startUrl: string
  events: unknown[]
  name?: string
}

/** Stored recording info */
export interface StoredRecording {
  id: string
  url: string
  title: string
  startTime: number
  endTime: number
  events: unknown[]
  createdAt: number
}

/** Context passed to every handler */
export interface HandlerContext {
  requestFromBrowser: RequestFromBrowserFn
  targetWindowId: string | undefined
  headers: Record<string, string>
  url: URL
  sessionId: string | undefined
  getWindowInfo: (windowId?: string) => WindowInfo | undefined
  updateSessionAffinity: (windowId: string) => void
  // Recording session management (for cross-page recording)
  startRecordingSession: (windowId: string, url: string, name?: string) => void
  stopRecordingSession: (windowId: string) => RecordingSessionInfo | undefined
  getRecordingSession: (windowId: string) => RecordingSessionInfo | undefined
  // Recording storage
  saveRecording: (recording: StoredRecording) => void
  listRecordings: () => Array<{id: string; url: string; title: string; startTime: number; endTime: number; eventCount: number; createdAt: number}>
  getRecording: (id: string) => StoredRecording | undefined
}

/** Handler function signature */
export type EndpointHandler<T = any> = (
  body: T,
  ctx: HandlerContext
) => Promise<Response>

// ============================================
// Handler Registry
// ============================================

/** Map of path -> handler function */
export const handlers = new Map<string, EndpointHandler>()

/** Register a handler for an endpoint */
export function registerHandler<T>(
  endpoint: EndpointDef<T>,
  handler: EndpointHandler<T>
): void {
  handlers.set(endpoint.path, handler as EndpointHandler)
}

// ============================================
// Utility Functions
// ============================================

/** Sleep helper */
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** 
 * Generate eval-safe JS code to resolve a selector (supports :text() pseudo-selectors).
 * Returns a JS expression string that resolves to an Element or null.
 * Uses __haltija_resolveSelector if available, falls back to document.querySelector.
 */
function qs(selector: string): string {
  const s = JSON.stringify(selector)
  return `(window.__haltija_resolveSelector || document.querySelector.bind(document))(${s})`
}

/**
 * Generate eval-safe JS code for querySelector existence + visibility check.
 * Returns a JS expression string that evaluates to boolean.
 */
function qsVisible(selector: string): string {
  return `(function(){var el=${qs(selector)};return !!el && el.offsetParent !== null})()`
}

// ============================================
// DOM Diff Support
// ============================================

/** Snapshot of DOM state for diffing */
interface DomSnapshot {
  elements: Map<string, { tag: string; text: string; attrs: Record<string, string>; childCount: number }>
  focused: string | null
  scrollY: number
  scrollX: number
}

/** Semantic diff result */
export interface DomDiff {
  added: string[]
  removed: string[]
  changed: Array<{ selector: string; changes: Record<string, { from: any; to: any }> }>
  focused: string | null
  scrolled: boolean
}

/** Capture DOM snapshot for diffing - runs in browser */
const SNAPSHOT_CODE = `(function() {
  const snapshot = { elements: {}, focused: null, scrollY: window.scrollY, scrollX: window.scrollX };
  
  // Get focused element selector
  if (document.activeElement && document.activeElement !== document.body) {
    const el = document.activeElement;
    snapshot.focused = el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : '');
  }
  
  // Capture visible elements (limit to prevent huge snapshots)
  const elements = document.querySelectorAll('body *:not(script):not(style):not(noscript)');
  let count = 0;
  for (const el of elements) {
    if (count > 500) break;
    
    // Skip invisible elements
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    
    // Generate selector
    let selector;
    if (el.id) selector = '#' + el.id;
    else if (el.getAttribute('data-testid')) selector = '[data-testid="' + el.getAttribute('data-testid') + '"]';
    else {
      // Use tag + nth-child for uniqueness
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const sameTag = siblings.filter(s => s.tagName === el.tagName);
        if (sameTag.length > 1) {
          const idx = sameTag.indexOf(el) + 1;
          selector = el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
        } else {
          selector = el.tagName.toLowerCase();
        }
        // Add parent context
        if (parent.id) selector = '#' + parent.id + ' > ' + selector;
        else if (parent !== document.body) {
          const pTag = parent.tagName.toLowerCase();
          selector = pTag + ' > ' + selector;
        }
      } else {
        selector = el.tagName.toLowerCase();
      }
    }
    
    // Capture element state
    const attrs = {};
    for (const attr of el.attributes) {
      if (!attr.name.startsWith('data-haltija')) {
        attrs[attr.name] = attr.value;
      }
    }
    
    snapshot.elements[selector] = {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 50),
      attrs,
      childCount: el.children.length,
    };
    count++;
  }
  
  return snapshot;
})()`

/** Compute semantic diff between two snapshots */
function computeDiff(before: any, after: any): DomDiff {
  const diff: DomDiff = {
    added: [],
    removed: [],
    changed: [],
    focused: after.focused !== before.focused ? after.focused : null,
    scrolled: Math.abs(after.scrollY - before.scrollY) > 10 || Math.abs(after.scrollX - before.scrollX) > 10,
  }
  
  const beforeKeys = new Set(Object.keys(before.elements))
  const afterKeys = new Set(Object.keys(after.elements))
  
  // Find added elements
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      diff.added.push(key)
    }
  }
  
  // Find removed elements
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      diff.removed.push(key)
    }
  }
  
  // Find changed elements (in both snapshots)
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) continue
    
    const b = before.elements[key]
    const a = after.elements[key]
    const changes: Record<string, { from: any; to: any }> = {}
    
    // Check childCount change
    if (a.childCount !== b.childCount) {
      changes.childCount = { from: b.childCount, to: a.childCount }
    }
    
    // Check text change (significant changes only)
    if (a.text !== b.text && (a.text.length > 0 || b.text.length > 0)) {
      changes.text = { from: b.text, to: a.text }
    }
    
    // Check attribute changes
    const allAttrs = new Set([...Object.keys(b.attrs), ...Object.keys(a.attrs)])
    for (const attr of allAttrs) {
      if (b.attrs[attr] !== a.attrs[attr]) {
        changes[`@${attr}`] = { from: b.attrs[attr], to: a.attrs[attr] }
      }
    }
    
    if (Object.keys(changes).length > 0) {
      diff.changed.push({ selector: key, changes })
    }
  }
  
  return diff
}

/** Capture snapshot, perform action, capture again, return diff */
async function withDiff<T>(
  ctx: HandlerContext,
  windowId: string | undefined,
  action: () => Promise<T>,
  diffDelay: number = 100
): Promise<{ result: T; diff: DomDiff }> {
  // Capture before state
  const beforeResp = await ctx.requestFromBrowser('eval', 'exec', { code: SNAPSHOT_CODE }, 5000, windowId)
  const before = beforeResp.success ? beforeResp.data : { elements: {}, focused: null, scrollY: 0, scrollX: 0 }
  
  // Perform the action
  const result = await action()
  
  // Wait for DOM to settle
  await sleep(diffDelay)
  
  // Capture after state
  const afterResp = await ctx.requestFromBrowser('eval', 'exec', { code: SNAPSHOT_CODE }, 5000, windowId)
  const after = afterResp.success ? afterResp.data : { elements: {}, focused: null, scrollY: 0, scrollX: 0 }
  
  // Compute diff
  const diff = computeDiff(before, after)
  
  return { result, diff }
}

// ============================================
// Handler Implementations
// ============================================

// Import schema for type inference
import * as api from './api-schema'

// Click handler - fires full mouse event lifecycle
// Supports both selector and text-based targeting
// With diff:true, returns what changed after the click
// With autoWait:true, waits for element to appear first
registerHandler(api.click, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  
  // Update session affinity
  if (windowId) ctx.updateSessionAffinity(windowId)
  
  const wantDiff = body.diff === true
  const diffDelay = body.diffDelay ?? 100
  const autoWait = body.autoWait === true
  const timeout = body.timeout ?? 5000
  let selector = body.selector
  const ref = body.ref
  
  // If ref is provided, use it directly (fastest path)
  if (ref) {
    const clickPayload = { ref }
    if (wantDiff) {
      const { result: response, diff } = await withDiff(
        ctx,
        windowId,
        () => ctx.requestFromBrowser('interaction', 'click', clickPayload, 5000, windowId),
        diffDelay
      )
      return Response.json({ ...response, ref, diff }, { headers: ctx.headers })
    }
    const response = await ctx.requestFromBrowser('interaction', 'click', clickPayload, 5000, windowId)
    return Response.json({ ...response, ref }, { headers: ctx.headers })
  }
  
  // If text is provided, find the element first (only visible elements)
  if (!selector && body.text) {
    const tag = body.tag || '*'
    const findCode = `(function() {
      const elements = document.querySelectorAll(${JSON.stringify(tag)});
      const searchText = ${JSON.stringify(body.text)};
      for (const el of elements) {
        // Skip hidden elements
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        if (el.closest('[hidden], [aria-hidden="true"]')) continue;
        
        if (el.textContent && el.textContent.includes(searchText)) {
          // Generate a unique selector for this element
          if (el.id) return '#' + el.id;
          if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
          if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
          if (el.className && typeof el.className === 'string') {
            const classes = el.className.split(' ').filter(c => c && !c.startsWith('-')).slice(0, 2);
            if (classes.length) return el.tagName.toLowerCase() + '.' + classes.join('.');
          }
          // Fallback: use nth-child
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children);
            const index = siblings.indexOf(el);
            return ':scope > ' + el.tagName.toLowerCase() + ':nth-child(' + (index + 1) + ')';
          }
          return el.tagName.toLowerCase();
        }
      }
      return null;
    })()`
    
    const findResponse = await ctx.requestFromBrowser('eval', 'exec', { code: findCode }, 5000, windowId)
    if (!findResponse.success || !findResponse.data) {
      return Response.json({ 
        success: false, 
        error: `Element with text "${body.text}"${body.tag ? ` and tag "${body.tag}"` : ''} not found` 
      }, { headers: ctx.headers })
    }
    selector = findResponse.data
  }
  
  if (!selector) {
    return Response.json({ success: false, error: 'ref, selector, or text is required' }, { status: 400, headers: ctx.headers })
  }
  
  // If autoWait is enabled, wait for element to appear
  if (autoWait) {
    const startTime = Date.now()
    const pollInterval = 100
    const checkCode = qsVisible(selector)
    
    while (Date.now() - startTime < timeout) {
      const checkResponse = await ctx.requestFromBrowser('eval', 'exec', { code: checkCode }, 5000, windowId)
      if (checkResponse.success && checkResponse.data === true) {
        break // Element found, proceed with click
      }
      await sleep(pollInterval)
    }
    
    // Check one more time - if still not found, return error
    const finalCheck = await ctx.requestFromBrowser('eval', 'exec', { code: checkCode }, 5000, windowId)
    if (!finalCheck.success || finalCheck.data !== true) {
      return Response.json({ 
        success: false, 
        error: `Timeout: element "${selector}" not found after ${timeout}ms`,
        waited: Date.now() - startTime
      }, { headers: ctx.headers })
    }
  }
  
  // If diff requested, wrap the action with before/after snapshots
  if (wantDiff) {
    const { result: response, diff } = await withDiff(
      ctx,
      windowId,
      () => ctx.requestFromBrowser('interaction', 'click', { selector }, 5000, windowId),
      diffDelay
    )
    return Response.json({ ...response, selector, diff }, { headers: ctx.headers })
  }
  
  // Standard click without diff
  const response = await ctx.requestFromBrowser('interaction', 'click', { selector }, 5000, windowId)
  return Response.json({ ...response, selector }, { headers: ctx.headers })
})

// Query handler
registerHandler(api.query, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('dom', 'query', {
    selector: body.selector,
    all: body.all,
  }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Eval handler
registerHandler(api.eval_, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('eval', 'exec', { code: body.code }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Fetch handler - fetch URL from within tab context (essential for blob: URLs)
registerHandler(api.fetchUrl, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('fetch', 'fetch', { url: body.url }, 30000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Call handler - call method or get property on element
registerHandler(api.call, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const selector = JSON.stringify(body.selector)
  const resolveExpr = `(window.__haltija_resolveSelector || document.querySelector.bind(document))(${selector})`
  const method = body.method
  const args = body.args
  
  let code: string
  if (args !== undefined) {
    // Method call mode: element.method(...args)
    const argsJson = JSON.stringify(args)
    code = `(function() {
      const el = ${resolveExpr};
      if (!el) return { success: false, error: 'Element not found: ${body.selector.replace(/'/g, "\\'")}' };
      if (typeof el[${JSON.stringify(method)}] !== 'function') {
        return { success: false, error: 'Method not found: ${method}' };
      }
      try {
        const result = el[${JSON.stringify(method)}](...${argsJson});
        return result instanceof Promise ? result.then(r => ({ success: true, data: r })) : { success: true, data: result };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })()`
  } else {
    // Property access mode: element.property
    code = `(function() {
      const el = ${resolveExpr};
      if (!el) return { success: false, error: 'Element not found: ${body.selector.replace(/'/g, "\\'")}' };
      try {
        const value = el[${JSON.stringify(method)}];
        return { success: true, data: value };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })()`
  }
  
  const response = await ctx.requestFromBrowser('eval', 'exec', { code }, 5000, windowId)
  
  // The eval returns { success, data } where data is our inner result
  if (response.success && response.data) {
    return Response.json(response.data, { headers: ctx.headers })
  }
  return Response.json(response, { headers: ctx.headers })
})

// Drag handler
registerHandler(api.drag, async (body, ctx) => {
  const selector = body.selector
  const deltaX = body.deltaX || 0
  const deltaY = body.deltaY || 0
  const duration = body.duration || 300
  const steps = Math.max(5, Math.floor(duration / 16))
  const windowId = body.window || ctx.targetWindowId
  
  // Scroll into view
  await ctx.requestFromBrowser('eval', 'exec', {
    code: `${qs(selector)}?.scrollIntoView({behavior: "smooth", block: "center"})`
  }, 5000, windowId)
  await sleep(100)
  
  // Get element center
  const inspectResponse = await ctx.requestFromBrowser('dom', 'inspect', { selector }, 5000, windowId)
  if (!inspectResponse.success || !inspectResponse.data) {
    return Response.json({ success: false, error: 'Element not found' }, { headers: ctx.headers })
  }
  const box = inspectResponse.data.box
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  
  // mouseenter, mouseover, mousemove to start
  for (const event of ['mouseenter', 'mouseover', 'mousemove']) {
    await ctx.requestFromBrowser('events', 'dispatch', {
      selector, event, options: { clientX: startX, clientY: startY },
    }, 5000, windowId)
  }
  
  // mousedown
  await ctx.requestFromBrowser('events', 'dispatch', {
    selector, event: 'mousedown', options: { clientX: startX, clientY: startY },
  }, 5000, windowId)
  
  // mousemove steps
  const stepDelay = duration / steps
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps
    const x = startX + deltaX * progress
    const y = startY + deltaY * progress
    await ctx.requestFromBrowser('eval', 'exec', {
      code: `document.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))`
    }, 5000, windowId)
    await sleep(stepDelay)
  }
  
  // mouseup
  await ctx.requestFromBrowser('eval', 'exec', {
    code: `document.dispatchEvent(new MouseEvent('mouseup', { clientX: ${startX + deltaX}, clientY: ${startY + deltaY}, bubbles: true }))`
  }, 5000, windowId)
  
  return Response.json({ success: true, from: { x: startX, y: startY }, to: { x: startX + deltaX, y: startY + deltaY } }, { headers: ctx.headers })
})

// Type handler - realistic typing with full event lifecycle
// With diff:true, returns what changed after typing
// With autoWait:true, waits for element to appear first
registerHandler(api.type, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const wantDiff = body.diff === true
  const diffDelay = body.diffDelay ?? 100
  const autoWait = body.autoWait === true
  const waitTimeout = body.timeout ?? 5000
  
  // If autoWait is enabled, wait for element to appear
  if (autoWait && body.selector) {
    const startTime = Date.now()
    const pollInterval = 100
    const checkCode = qsVisible(body.selector)
    
    while (Date.now() - startTime < waitTimeout) {
      const checkResponse = await ctx.requestFromBrowser('eval', 'exec', { code: checkCode }, 5000, windowId)
      if (checkResponse.success && checkResponse.data === true) {
        break // Element found, proceed with type
      }
      await sleep(pollInterval)
    }
    
    // Check one more time - if still not found, return error
    const finalCheck = await ctx.requestFromBrowser('eval', 'exec', { code: checkCode }, 5000, windowId)
    if (!finalCheck.success || finalCheck.data !== true) {
      return Response.json({ 
        success: false, 
        error: `Timeout: element "${body.selector}" not found after ${waitTimeout}ms`,
        waited: Date.now() - startTime
      }, { headers: ctx.headers })
    }
  }
  
  // Calculate timeout based on text length and typing speed
  // Worst case: humanlike with typos, max delay 150ms per char + typo overhead
  const baseTimeout = 5000
  const perCharTimeout = (body.maxDelay ?? 150) * 2 // Account for typos and delays
  const timeout = baseTimeout + (body.text?.length || 0) * perCharTimeout
  
  const doType = () => ctx.requestFromBrowser('interaction', 'type', {
    selector: body.selector,
    text: body.text,
    focusMode: body.focusMode,
    clear: body.clear,
    blur: body.blur,
    humanlike: body.humanlike,
    typoRate: body.typoRate,
    minDelay: body.minDelay,
    maxDelay: body.maxDelay,
  }, timeout, windowId)
  
  if (wantDiff) {
    const { result: response, diff } = await withDiff(ctx, windowId, doType, diffDelay)
    return Response.json({ ...response, diff }, { headers: ctx.headers })
  }
  
  const response = await doType()
  return Response.json(response, { headers: ctx.headers })
})

// Key handler - send keyboard input with full event lifecycle
registerHandler(api.key, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const repeat = body.repeat ?? 1
  
  // Calculate timeout: base + per-repeat time
  const timeout = 5000 + repeat * 100
  
  const response = await ctx.requestFromBrowser('interaction', 'key', {
    key: body.key,
    selector: body.selector,
    ctrlKey: body.ctrlKey,
    shiftKey: body.shiftKey,
    altKey: body.altKey,
    metaKey: body.metaKey,
    repeat,
  }, timeout, windowId)
  
  return Response.json(response, { headers: ctx.headers })
})

// Inspect handler
registerHandler(api.inspect, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('dom', 'inspect', { 
    selector: body.selector,
    fullStyles: body.fullStyles,
    matchedRules: body.matchedRules,
  }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// InspectAll handler
registerHandler(api.inspectAll, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('dom', 'inspectAll', { 
    selector: body.selector, 
    limit: body.limit || 10,
    fullStyles: body.fullStyles,
    matchedRules: body.matchedRules,
  }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Highlight handler
registerHandler(api.highlight, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  
  await ctx.requestFromBrowser('eval', 'exec', {
    code: `${qs(body.selector)}?.scrollIntoView({behavior: "smooth", block: "center"})`
  }, 5000, windowId)
  await sleep(100)
  
  const response = await ctx.requestFromBrowser('dom', 'highlight', {
    selector: body.selector, label: body.label, color: body.color, duration: body.duration,
  }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Unhighlight handler
registerHandler(api.unhighlight, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('dom', 'unhighlight', {})
  return Response.json(response, { headers: ctx.headers })
})

// Navigate handler
registerHandler(api.navigate, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('navigation', 'goto', { url: body.url }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Refresh handler
registerHandler(api.refresh, async (body, ctx) => {
  const hard = body.hard ?? false
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('navigation', 'refresh', { hard }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Tree handler
registerHandler(api.tree, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('dom', 'tree', {
    selector: body.selector || 'body',
    depth: body.depth,
    includeText: body.includeText,
    compact: body.compact,
    pierceShadow: body.pierceShadow,
    pierceFrames: body.pierceFrames,
    visibleOnly: body.visibleOnly,
    ancestors: body.ancestors,
  }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Screenshot handler - longer timeout since screenshots can be slow
// Response includes window context so agent knows exactly what they captured
registerHandler(api.screenshot, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  
  // Update session affinity if targeting a specific window
  if (windowId) {
    ctx.updateSessionAffinity(windowId)
  }
  
  const response = await ctx.requestFromBrowser('dom', 'screenshot', {
    selector: body.selector,
    format: body.format,
    quality: body.quality,
    scale: body.scale,
    maxWidth: body.maxWidth,
    maxHeight: body.maxHeight,
    delay: body.delay,
  }, 15000 + (body.delay || 0), windowId) // 15s timeout + any delay
  
  // Add window context to response so agent knows what they captured
  const windowInfo = ctx.getWindowInfo(windowId)
  const enrichedResponse = {
    ...response,
    window: windowInfo || { id: windowId || 'unknown', url: 'unknown', title: 'unknown' },
  }
  
  return Response.json(enrichedResponse, { headers: ctx.headers })
})

// Tabs handlers
registerHandler(api.tabsOpen, async (body, ctx) => {
  const response = await ctx.requestFromBrowser('tabs', 'open', { url: body.url })
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.tabsClose, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  if (!windowId) {
    return Response.json({ success: false, error: 'window id is required' }, { status: 400, headers: ctx.headers })
  }
  const response = await ctx.requestFromBrowser('tabs', 'close', { windowId })
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.tabsFocus, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  if (!windowId) {
    return Response.json({ success: false, error: 'window id is required' }, { status: 400, headers: ctx.headers })
  }
  const response = await ctx.requestFromBrowser('tabs', 'focus', { windowId })
  return Response.json(response, { headers: ctx.headers })
})

// Mutations handlers
registerHandler(api.mutationsWatch, async (body, ctx) => {
  const response = await ctx.requestFromBrowser('mutations', 'watch', {
    root: body.root,
    childList: body.childList ?? true,
    attributes: body.attributes ?? true,
    characterData: body.characterData ?? false,
    subtree: body.subtree ?? true,
    debounce: body.debounce ?? 100,
    preset: body.preset,
    filters: body.filters,
    pierceShadow: body.pierceShadow,
  })
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.mutationsUnwatch, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('mutations', 'unwatch', {})
  return Response.json(response, { headers: ctx.headers })
})

// Events handlers
registerHandler(api.eventsWatch, async (body, ctx) => {
  const response = await ctx.requestFromBrowser('semantic', 'watch', {
    preset: body.preset,
    categories: body.categories,
  })
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.eventsUnwatch, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('semantic', 'unwatch', {})
  return Response.json(response, { headers: ctx.headers })
})

// Consolidated recording handler
// Uses server-side session management so recordings survive page navigations
registerHandler(api.recording, async (body, ctx) => {
  // Get window ID - try explicit, then targeted, then get from windowInfo (which falls back to focused)
  let windowId = body.window || ctx.targetWindowId
  if (!windowId) {
    // Fall back to focused window via getWindowInfo
    const info = ctx.getWindowInfo()
    windowId = info?.id
  }
  const action = body.action
  
  if (!windowId) {
    return Response.json(
      { success: false, error: 'No window connected' },
      { status: 400, headers: ctx.headers }
    )
  }
  
  switch (action) {
    case 'start': {
      // Get current window URL for the session
      const windowInfo = ctx.getWindowInfo(windowId)
      const url = windowInfo?.url || 'unknown'
      
      // Create server-side recording session
      ctx.startRecordingSession(windowId, url, body.name)
      
      // Tell browser to start capturing events
      const response = await ctx.requestFromBrowser('recording', 'start', { 
        name: body.name,
        serverManaged: true  // Tell browser to stream events to server
      }, 5000, windowId)
      
      return Response.json(
        { 
          ...response, 
          crossPage: true,
          message: 'Recording started (survives page navigations)'
        },
        { headers: ctx.headers }
      )
    }
    
    case 'stop': {
      // Tell browser to stop capturing
      await ctx.requestFromBrowser('recording', 'stop', { serverManaged: true }, 5000, windowId)
      
      // Get and clear server-side session
      const session = ctx.stopRecordingSession(windowId)
      if (!session) {
        return Response.json(
          { success: false, error: 'No active recording session for this window' },
          { headers: ctx.headers }
        )
      }
      
      const endTime = Date.now()
      const recordingId = `rec_${session.startTime}_${Math.random().toString(36).slice(2, 8)}`
      
      // Save to permanent storage
      ctx.saveRecording({
        id: recordingId,
        url: session.startUrl,
        title: session.name || `Recording ${new Date(session.startTime).toLocaleString()}`,
        startTime: session.startTime,
        endTime,
        events: session.events,
        createdAt: Date.now(),
      })
      
      return Response.json(
        { 
          success: true, 
          data: {
            id: recordingId,
            events: session.events,
            startTime: session.startTime,
            endTime,
            startUrl: session.startUrl,
            eventCount: session.events.length
          }
        },
        { headers: ctx.headers }
      )
    }
    
    case 'status': {
      // New action: check if recording is active
      const session = ctx.getRecordingSession(windowId)
      return Response.json(
        { 
          success: true, 
          data: {
            recording: !!session,
            startTime: session?.startTime,
            eventCount: session?.events.length || 0,
            startUrl: session?.startUrl
          }
        },
        { headers: ctx.headers }
      )
    }
    
    case 'generate': {
      // Generate test from last recording or specified recording
      const recordingsList = ctx.listRecordings()
      if (recordingsList.length === 0) {
        return Response.json(
          { success: false, error: 'No recordings available' },
          { status: 400, headers: ctx.headers }
        )
      }
      // Get most recent recording
      const latest = recordingsList[recordingsList.length - 1]
      const recording = ctx.getRecording(latest.id)
      if (!recording) {
        return Response.json(
          { success: false, error: 'Recording not found' },
          { status: 404, headers: ctx.headers }
        )
      }
      
      // Generate test JSON from events
      // For now, forward to browser for test generation (it has the test-generator logic)
      // TODO: Move test generation to server
      return Response.json(
        await ctx.requestFromBrowser('recording', 'generate', { 
          name: body.name || recording.title,
          events: recording.events,
          url: recording.url,
        }, 5000, windowId),
        { headers: ctx.headers }
      )
    }
    case 'list': {
      const list = ctx.listRecordings()
      // Add index to each recording for easy replay
      const indexed = list.map((r, i) => ({ index: i, ...r }))
      return Response.json(
        { success: true, data: indexed },
        { headers: ctx.headers }
      )
    }
    
    case 'replay': {
      if (!body.id && body.id !== 0) {
        return Response.json(
          { success: false, error: 'id is required (recording ID or index number)' },
          { status: 400, headers: ctx.headers }
        )
      }
      
      const list = ctx.listRecordings()
      let recording: StoredRecording | undefined
      
      // Check if id is an index number
      const index = parseInt(String(body.id), 10)
      if (!isNaN(index) && index >= 0 && index < list.length) {
        recording = ctx.getRecording(list[index].id)
      } else {
        // Try as recording ID
        recording = ctx.getRecording(String(body.id))
      }
      
      if (!recording) {
        return Response.json(
          { success: false, error: `Recording not found: ${body.id}` },
          { status: 404, headers: ctx.headers }
        )
      }
      
      // Generate test from recording and run it
      const generateResult = await ctx.requestFromBrowser('recording', 'generate', {
        name: recording.title,
        events: recording.events,
        url: recording.url,
      }, 5000, windowId) as { success: boolean; test?: unknown; error?: string }
      
      if (!generateResult.success || !generateResult.test) {
        return Response.json(
          { success: false, error: generateResult.error || 'Failed to generate test from recording' },
          { status: 500, headers: ctx.headers }
        )
      }
      
      // Run the generated test
      const testResult = await ctx.requestFromBrowser('test', 'run', {
        test: generateResult.test,
      }, 120000, windowId)
      
      return Response.json(testResult, { headers: ctx.headers })
    }
    
    default:
      return Response.json(
        { success: false, error: 'action is required: start, stop, status, generate, list, or replay' },
        { status: 400, headers: ctx.headers }
      )
  }
})

// Legacy recording handlers (deprecated - router adds deprecation notice automatically)
registerHandler(api.recordingStart, async (body, ctx) => {
  const response = await ctx.requestFromBrowser('recording', 'start', { name: body.name })
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.recordingStop, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('recording', 'stop', {})
  return Response.json(response, { headers: ctx.headers })
})

// Consolidated selection handler
registerHandler(api.select, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const action = body.action || 'result'
  
  switch (action) {
    case 'start':
      return Response.json(
        await ctx.requestFromBrowser('selection', 'start', {}, 5000, windowId),
        { headers: ctx.headers }
      )
    case 'cancel':
      return Response.json(
        await ctx.requestFromBrowser('selection', 'cancel', {}, 5000, windowId),
        { headers: ctx.headers }
      )
    case 'clear':
      return Response.json(
        await ctx.requestFromBrowser('selection', 'clear', {}, 5000, windowId),
        { headers: ctx.headers }
      )
    case 'status':
      return Response.json(
        await ctx.requestFromBrowser('selection', 'status', {}, 5000, windowId),
        { headers: ctx.headers }
      )
    case 'result':
    default:
      return Response.json(
        await ctx.requestFromBrowser('selection', 'result', {}, 5000, windowId),
        { headers: ctx.headers }
      )
  }
})

// Legacy selection handlers (deprecated - router adds deprecation notice automatically)
registerHandler(api.selectStart, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('selection', 'start', {})
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.selectCancel, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('selection', 'cancel', {})
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.selectClear, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('selection', 'clear', {})
  return Response.json(response, { headers: ctx.headers })
})

// Wait handler - flexible wait for time, element, or both
registerHandler(api.wait, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const timeout = body.timeout ?? 5000
  const pollInterval = body.pollInterval ?? 100
  const ms = body.ms ?? 0
  const hidden = body.hidden ?? false
  const startTime = Date.now()
  
  // If waiting for element
  if (body.forElement) {
    const selector = body.forElement
    const checkCode = hidden
      ? `(function(){var el=${qs(selector)};return !el || el.offsetParent === null})()`
      : qsVisible(selector)
    
    while (Date.now() - startTime < timeout) {
      const checkResponse = await ctx.requestFromBrowser('eval', 'exec', { code: checkCode }, 5000, windowId)
      if (checkResponse.success && checkResponse.data === true) {
        // Element condition met, add extra delay if specified
        if (ms > 0) await sleep(ms)
        return Response.json({ 
          success: true, 
          waited: Date.now() - startTime + ms, 
          found: !hidden 
        }, { headers: ctx.headers })
      }
      await sleep(pollInterval)
    }
    
    // Timeout reached
    return Response.json({ 
      success: false, 
      error: hidden 
        ? `Timeout: element "${selector}" still visible after ${timeout}ms`
        : `Timeout: element "${selector}" not found after ${timeout}ms`,
      waited: Date.now() - startTime
    }, { headers: ctx.headers })
  }
  
  // Simple time wait
  if (ms > 0) {
    await sleep(ms)
    return Response.json({ success: true, waited: ms }, { headers: ctx.headers })
  }
  
  return Response.json({ success: true, waited: 0 }, { headers: ctx.headers })
})

// Find handler - find elements by text content
registerHandler(api.find, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const tag = body.tag || '*'
  const exact = body.exact ?? false
  const all = body.all ?? false
  const visible = body.visible ?? true
  
  const findCode = `(function() {
    const elements = document.querySelectorAll(${JSON.stringify(tag)});
    const searchText = ${JSON.stringify(body.text)};
    const exact = ${exact};
    const visibleOnly = ${visible};
    const results = [];
    
    for (const el of elements) {
      // Check visibility if required
      if (visibleOnly && (el.offsetParent === null || getComputedStyle(el).visibility === 'hidden')) {
        continue;
      }
      
      const text = el.textContent?.trim() || '';
      const matches = exact ? text === searchText : text.includes(searchText);
      
      if (matches) {
        // Generate selector
        let selector;
        if (el.id) selector = '#' + el.id;
        else if (el.getAttribute('data-testid')) selector = '[data-testid="' + el.getAttribute('data-testid') + '"]';
        else if (el.name) selector = el.tagName.toLowerCase() + '[name="' + el.name + '"]';
        else if (el.className && typeof el.className === 'string') {
          const classes = el.className.split(' ').filter(c => c && !c.startsWith('-')).slice(0, 2);
          if (classes.length) selector = el.tagName.toLowerCase() + '.' + classes.join('.');
        }
        if (!selector) {
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(s => s.tagName === el.tagName);
            const index = siblings.indexOf(el);
            selector = el.tagName.toLowerCase() + ':nth-of-type(' + (index + 1) + ')';
          } else {
            selector = el.tagName.toLowerCase();
          }
        }
        
        const result = {
          selector,
          tag: el.tagName.toLowerCase(),
          text: text.substring(0, 100),
          id: el.id || undefined,
          classes: el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 5) : undefined,
        };
        
        if (!${all}) return { found: true, element: result, selector };
        results.push(result);
      }
    }
    
    if (${all}) return { found: results.length > 0, elements: results, count: results.length };
    return { found: false };
  })()`
  
  const response = await ctx.requestFromBrowser('eval', 'exec', { code: findCode }, 5000, windowId)
  
  if (response.success && response.data) {
    return Response.json({ success: true, ...response.data }, { headers: ctx.headers })
  }
  return Response.json(response, { headers: ctx.headers })
})

// Form data handler - extract all form values as structured JSON
registerHandler(api.formData, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const includeDisabled = body.includeDisabled ?? false
  const includeHidden = body.includeHidden ?? false
  const selector = body.selector || 'form'
  
  const formCode = `(function() {
    const form = (window.__haltija_resolveSelector || document.querySelector.bind(document))(${JSON.stringify(selector)});
    if (!form) return { success: false, error: 'Form not found: ${selector.replace(/'/g, "\\'")}' };
    
    const fields = {};
    const fieldDetails = [];
    const includeDisabled = ${includeDisabled};
    const includeHidden = ${includeHidden};
    
    // Get all form elements
    const elements = form.querySelectorAll('input, select, textarea, [contenteditable]');
    
    for (const el of elements) {
      // Skip disabled unless requested
      if (el.disabled && !includeDisabled) continue;
      
      // Skip hidden inputs unless requested
      if (el.type === 'hidden' && !includeHidden) continue;
      
      // Get field name/id
      const name = el.name || el.id || null;
      if (!name) continue;
      
      let value;
      let type = el.type || el.tagName.toLowerCase();
      
      // Handle different input types
      if (el.tagName === 'SELECT') {
        if (el.multiple) {
          value = Array.from(el.selectedOptions).map(o => o.value);
          type = 'select-multiple';
        } else {
          value = el.value;
          type = 'select';
        }
      } else if (el.type === 'checkbox') {
        value = el.checked;
      } else if (el.type === 'radio') {
        // Only include checked radios
        if (!el.checked) continue;
        value = el.value;
      } else if (el.type === 'file') {
        value = el.files?.length ? Array.from(el.files).map(f => f.name) : null;
      } else if (el.isContentEditable) {
        value = el.textContent;
        type = 'contenteditable';
      } else {
        value = el.value;
      }
      
      fields[name] = value;
      
      // Collect field details
      fieldDetails.push({
        name,
        type,
        value,
        required: el.required || false,
        disabled: el.disabled || false,
        selector: el.id ? '#' + el.id : (el.name ? '[name="' + el.name + '"]' : null),
      });
    }
    
    // Also check for custom form elements with value property
    const customElements = form.querySelectorAll('[data-value], [value]');
    for (const el of customElements) {
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') continue;
      const name = el.getAttribute('name') || el.id;
      if (!name || fields[name] !== undefined) continue;
      
      const value = el.dataset?.value ?? el.getAttribute('value') ?? el.value;
      if (value !== undefined) {
        fields[name] = value;
        fieldDetails.push({
          name,
          type: 'custom',
          value,
          selector: el.id ? '#' + el.id : null,
        });
      }
    }
    
    return {
      success: true,
      fields,
      fieldDetails,
      form: {
        id: form.id || null,
        action: form.action || null,
        method: form.method || 'get',
        name: form.name || null,
      },
      fieldCount: fieldDetails.length,
    };
  })()`
  
  const response = await ctx.requestFromBrowser('eval', 'exec', { code: formCode }, 5000, windowId)
  
  if (response.success && response.data) {
    return Response.json(response.data, { headers: ctx.headers })
  }
  return Response.json(response, { headers: ctx.headers })
})

// Scroll handler - smooth scroll with easing
registerHandler(api.scroll, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const duration = body.duration ?? 500
  const easing = body.easing || 'ease-out'
  const block = body.block || 'center'
  
  const easingCode = `
    const easings = {
      'linear': t => t,
      'ease-out': t => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      },
      'ease-in-out': t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    };
    const easing = easings[${JSON.stringify(easing)}] || easings['ease-out'];
  `
  
  if (body.selector) {
    const code = `
      (async () => {
        const el = (window.__haltija_resolveSelector || document.querySelector.bind(document))(${JSON.stringify(body.selector)});
        if (!el) return { success: false, error: 'Element not found' };
        const rect = el.getBoundingClientRect();
        const blockAlign = ${JSON.stringify(block)};
        let targetY;
        if (blockAlign === 'start') targetY = window.scrollY + rect.top;
        else if (blockAlign === 'end') targetY = window.scrollY + rect.bottom - window.innerHeight;
        else if (blockAlign === 'nearest') {
          if (rect.top < 0) targetY = window.scrollY + rect.top;
          else if (rect.bottom > window.innerHeight) targetY = window.scrollY + rect.bottom - window.innerHeight;
          else targetY = window.scrollY;
        } else targetY = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
        const startY = window.scrollY, startX = window.scrollX, distY = targetY - startY;
        ${easingCode}
        return new Promise(resolve => {
          const startTime = performance.now();
          function step(now) {
            const progress = Math.min((now - startTime) / ${duration}, 1);
            window.scrollTo(startX, startY + distY * easing(progress));
            if (progress < 1) requestAnimationFrame(step);
            else resolve({ success: true, scrolledTo: { x: window.scrollX, y: window.scrollY } });
          }
          requestAnimationFrame(step);
        });
      })()
    `
    const response = await ctx.requestFromBrowser('eval', 'exec', { code }, duration + 1000, windowId)
    return Response.json(response, { headers: ctx.headers })
  } else if (body.x !== undefined || body.y !== undefined) {
    const code = `
      (async () => {
        const startX = window.scrollX, startY = window.scrollY;
        const targetX = ${body.x ?? 'startX'}, targetY = ${body.y ?? 'startY'};
        const distX = targetX - startX, distY = targetY - startY;
        ${easingCode}
        return new Promise(resolve => {
          const startTime = performance.now();
          function step(now) {
            const progress = Math.min((now - startTime) / ${duration}, 1);
            window.scrollTo(startX + distX * easing(progress), startY + distY * easing(progress));
            if (progress < 1) requestAnimationFrame(step);
            else resolve({ success: true, scrolledTo: { x: window.scrollX, y: window.scrollY } });
          }
          requestAnimationFrame(step);
        });
      })()
    `
    const response = await ctx.requestFromBrowser('eval', 'exec', { code }, duration + 1000, windowId)
    return Response.json(response, { headers: ctx.headers })
  } else if (body.deltaX !== undefined || body.deltaY !== undefined) {
    const code = `
      (async () => {
        const startX = window.scrollX, startY = window.scrollY;
        const distX = ${body.deltaX ?? 0}, distY = ${body.deltaY ?? 0};
        ${easingCode}
        return new Promise(resolve => {
          const startTime = performance.now();
          function step(now) {
            const progress = Math.min((now - startTime) / ${duration}, 1);
            window.scrollTo(startX + distX * easing(progress), startY + distY * easing(progress));
            if (progress < 1) requestAnimationFrame(step);
            else resolve({ success: true, scrolledTo: { x: window.scrollX, y: window.scrollY } });
          }
          requestAnimationFrame(step);
        });
      })()
    `
    const response = await ctx.requestFromBrowser('eval', 'exec', { code }, duration + 1000, windowId)
    return Response.json(response, { headers: ctx.headers })
  } else {
    return Response.json({ success: false, error: 'Must provide selector, x/y coordinates, or deltaX/deltaY' }, { status: 400, headers: ctx.headers })
  }
})

/** JSON response helper */
export function jsonResponse(
  data: any,
  headers: Record<string, string>,
  status = 200
): Response {
  return Response.json(data, { headers, status })
}

/** Success response helper */
export function successResponse(
  data: any,
  headers: Record<string, string>
): Response {
  return jsonResponse({ success: true, ...data }, headers)
}

/** Error response helper */
export function errorResponse(
  error: string,
  headers: Record<string, string>,
  status = 400
): Response {
  return jsonResponse({ success: false, error }, headers, status)
}
