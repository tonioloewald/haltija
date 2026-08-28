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

import { writeFile } from 'fs/promises'
import { performDrag } from './drag'
import { attachSession, readSession, writeSession, detachSession, type RunTmux } from './tmux-session'
import type { EndpointDef } from './api-schema'
import { saveDataUrl } from './artifacts'

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
  /** Hidden-tab / focus-ambiguity caveat attached by the server (see requestFromBrowser). */
  warning?: string
  /** True when this exact warning was already reported within the cooldown (see types.ts). */
  warningRepeated?: boolean
}

/**
 * Preserve a top-level `warning` (hidden-tab #3 / focus-ambiguity #2) when a handler reshapes the
 * browser response into a different top-level object. Handlers that return `response.data` verbatim
 * would otherwise drop the caveat — a `hj form` / `hj find` against a hidden or focus-chosen tab
 * would come back empty with nothing saying why.
 */
function withWarning(body: Record<string, unknown>, response: DevResponse): Record<string, unknown> {
  if (!response.warning) return body
  // Carry `warningRepeated` too, or the client can't tell a repeat from a first report and would
  // re-print it on every command (see server.ts attachWarning).
  return response.warningRepeated
    ? { ...body, warning: response.warning, warningRepeated: true }
    : { ...body, warning: response.warning }
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
  getWindowInfo: (windowId?: string) => WindowInfo | undefined
  /**
   * Set the server-side focused window — the tab that receives untargeted commands. This is pure
   * server state, NOT a browser roundtrip: it validates the tab exists and returns immediately, so
   * it can never time out the way dispatching a command *to* the (possibly hidden) tab does (#4).
   */
  focusWindow: (windowId: string) => {
    ok: boolean
    error?: string
    active?: boolean
    windowType?: string
    title?: string
  }
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

/** Targeting param accepted by every endpoint (?window=<id>), not declared per-schema. */
type CommonParams = { window?: string }
/**
 * The body type a handler sees: the endpoint's inferred input type plus the
 * universal `window` targeting param. The input type already carries every
 * declared parameter as an optional field (see EndpointDef.input typing), so no
 * union-flattening is needed.
 */
type FlatBody<T> = T & CommonParams

// ============================================
// Handler Registry
// ============================================

/** Map of path -> handler function */
export const handlers = new Map<string, EndpointHandler>()

/** Register a handler for an endpoint */
export function registerHandler<T>(
  endpoint: EndpointDef<T>,
  handler: EndpointHandler<FlatBody<T>>
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
    ref: body.ref,
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
  const ref = body.ref
  const selector = body.selector
  const method = body.method
  const args = body.args
  
  // Build resolve expression based on ref or selector
  const resolveExpr = ref
    ? `window.__haltija_refRegistry?.resolve(${JSON.stringify(ref)})`
    : `(window.__haltija_resolveSelector || document.querySelector.bind(document))(${JSON.stringify(selector)})`
  const targetDesc = ref ? `@${ref}` : (selector || '(none)')
  
  let code: string
  if (args !== undefined) {
    // Method call mode: element.method(...args)
    const argsJson = JSON.stringify(args)
    code = `(function() {
      const el = ${resolveExpr};
      if (!el) return { success: false, error: 'Element not found: ${targetDesc.replace(/'/g, "\\'")}' };
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
      if (!el) return { success: false, error: 'Element not found: ${targetDesc.replace(/'/g, "\\'")}' };
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
  // The routine itself lives in src/drag.ts because the test-suite runner needs it too — it had no
  // `drag` step at all (#30), and a copy in the runner's switch would be the fourth instance this
  // cycle of two implementations drifting apart.
  const result = await performDrag(
    ctx.requestFromBrowser,
    {
      ref: body.ref,
      selector: body.selector,
      deltaX: body.deltaX,
      deltaY: body.deltaY,
      duration: body.duration,
    },
    body.window || ctx.targetWindowId,
  )
  return Response.json(result, { headers: ctx.headers })
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
    // `ref` is declared in the schema, parsed by the CLI, and resolved by the widget — and was
    // missing from THIS list, so `hj type 10 "hello"` (the headline example in README, DOCS.md and
    // SKILL.md, and the whole point of the `hj tree` → `hj <cmd> <ref>` workflow) failed every time
    // with `Element not found: .` — the target name literally blank, because there was none.
    ref: body.ref,
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
    // Same omission as /type, and worse here: with no ref AND no selector the widget falls back to
    // `document.activeElement`, so `/key {ref:…}` returned **success: true** having sent the
    // keystroke to whatever happened to be focused. A false success is the failure mode this
    // release exists to eliminate, and it was sitting in the second-most-used interaction endpoint.
    ref: body.ref,
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
    ref: body.ref,
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
    ref: body.ref,
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
  
  // Scroll element into view (use ref or selector)
  if (body.ref) {
    await ctx.requestFromBrowser('eval', 'exec', {
      code: `(window.__haltija_refRegistry?.resolve(${JSON.stringify(body.ref)}) || document.body)?.scrollIntoView({behavior: "smooth", block: "center"})`
    }, 5000, windowId)
  } else if (body.selector) {
    await ctx.requestFromBrowser('eval', 'exec', {
      code: `${qs(body.selector)}?.scrollIntoView({behavior: "smooth", block: "center"})`
    }, 5000, windowId)
  }
  await sleep(100)
  
  const response = await ctx.requestFromBrowser('dom', 'highlight', {
    ref: body.ref, selector: body.selector, label: body.label, color: body.color, duration: body.duration,
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

  // Refuse a `file://` navigation in the DESKTOP APP, rather than wedging the instance.
  //
  // The app cannot inject the widget into a `file://` page, so navigating there disconnects the tab
  // permanently: the widget dies with the old document and nothing attaches to the new one. The
  // command reported `success: true` — truthfully, the navigation happened — and the damage
  // surfaced on the NEXT command as a generic "No browser connected", which reads like the app
  // crashed rather than like the previous command did it. That misattribution costs a restart
  // before anyone thinks to look at the URL.
  //
  // Worse, there is no way back: `hj tabs open` is the obvious recovery and it needs a connected
  // browser to service the request, so the one command that could fix it is unavailable exactly
  // when it is needed. Only `hj shutdown` and relaunch recovers.
  //
  // Scoped to the desktop app ON PURPOSE. `file://` works fine under the Playwright headless
  // engine — this repo's own fixtures rely on it — so a blanket refusal would break a path that
  // works today. Refusing where it is known broken, and saying what to do instead, leaves the tab
  // intact and teaches the workaround in one line.
  if (process.env.HALTIJA_DESKTOP === '1' && /^file:\/\//i.test(String(body.url || ''))) {
    return Response.json(
      {
        success: false,
        error:
          `The desktop app cannot inject the widget into a file:// page, so navigating there would ` +
          `disconnect this tab permanently with no CLI way back. The current page is untouched. ` +
          `Serve the file over HTTP instead — e.g. \`python3 -m http.server 8911\` in that ` +
          `directory, then navigate to http://127.0.0.1:8911/<file>. (file:// does work under ` +
          `\`haltija --headless\`, which uses Playwright.)`,
      },
      { status: 400, headers: ctx.headers },
    )
  }

  const response = await ctx.requestFromBrowser('navigation', 'goto', { url: body.url }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Refresh handler
registerHandler(api.refresh, async (body, ctx) => {
  const soft = body.soft ?? false
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('navigation', 'refresh', { soft }, 5000, windowId)
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
    interactiveOnly: body.interactiveOnly,
    ancestors: body.ancestors,
    includeBox: body.includeBox,
    mode: body.mode,
  }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Screenshot handler - longer timeout since screenshots can be slow
// Response includes window context so agent knows exactly what they captured
registerHandler(api.screenshot, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId

  const response = await ctx.requestFromBrowser('dom', 'screenshot', {
    ref: body.ref,
    selector: body.selector,
    canvas: body.canvas,
    format: body.format,
    quality: body.quality,
    scale: body.scale,
    maxWidth: body.maxWidth,
    maxHeight: body.maxHeight,
    delay: body.delay,
    fallback: body.fallback,
    schematic: body.schematic,
    // Third instance of the same omission, found only by generalising the guard across every
    // handler: the widget reads `payload?.chyron !== false`, so `{chyron: false}` never arrived and
    // the burned-in caption was drawn unconditionally. `src/screen-capture.playwright.ts` has been
    // passing `chyron: false` and getting one.
    chyron: body.chyron,
  }, 15000 + (body.delay || 0), windowId) // 15s timeout + any delay
  
  // Add window context to response so agent knows what they captured
  const windowInfo = ctx.getWindowInfo(windowId)
  const enrichedResponse = {
    ...response,
    window: windowInfo || { id: windowId || 'unknown', url: 'unknown', title: 'unknown' },
  }
  // A canvas capture can succeed and still be blank (WebGL drawing buffer already cleared). The
  // widget explains that in data.warning; promote it to the top level so `hj` prints it on stderr
  // instead of handing back an empty image that looks like "the scene is broken".
  if (enrichedResponse.data?.warning && !enrichedResponse.warning) {
    enrichedResponse.warning = enrichedResponse.data.warning as string
  }
  
  // Save to disk by default (file defaults to true, pass file=false for base64).
  // Shared with /map via saveDataUrl — the two copies of this had already diverged on the jpeg→jpg
  // mapping and on what to do when the write fails. See src/artifacts.ts.
  if (body.file !== false && enrichedResponse.data?.image) {
    const saved = await saveDataUrl(enrichedResponse.data.image as string, { kind: 'screenshots' })
    if ('path' in saved) {
      enrichedResponse.data.path = saved.path
      delete enrichedResponse.data.image
    } else {
      // Keep the capture, but SAY the fallback happened. Previously this path 500'd here and was
      // swallowed in /map; neither told the caller what actually went wrong.
      enrichedResponse.warning =
        `could not write the screenshot to disk (${saved.error}) — returning it inline as a data ` +
        `URL instead. Pass file:false to ask for that deliberately, or fix the temp directory.`
    }
  }
  
  return Response.json(enrichedResponse, { headers: ctx.headers })
})

// Tabs handlers
registerHandler(api.map, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  // Forward every schematic parameter, not a hand-picked four. `maxWidth`, `maxHeight`, `format`
  // and `quality` are read by `buildSchematicResponse` in the widget and were honoured there from
  // 1.11.x — but this allowlist never learned about them, so they never crossed the wire and
  // `/map {maxWidth:300, maxHeight:300, format:'jpeg'}` returned a byte-identical full-size PNG
  // with a 200. Three registries had to agree (schema, this list, the widget) and one fix updated
  // one of them. Verified by probe: `scale` (on the list) changed the output; the other four did
  // nothing at all. `src/handler-forwarding.test.ts` asserts every parameter an endpoint declares
  // is mentioned here, across ALL handlers, so the next one can't be dropped the same way.
  const response = await ctx.requestFromBrowser('dom', 'map', {
    global: body.global,
    maxNodes: body.maxNodes,
    image: body.image,
    scale: body.scale,
    maxWidth: body.maxWidth,
    maxHeight: body.maxHeight,
    format: body.format,
    quality: body.quality,
    fullPage: body.fullPage,
    layout: body.layout,
  }, 15000, windowId)

  // Write the schematic to disk instead of returning ~700KB of base64 on stdout. Measured on
  // haltija's own homepage: `hj map --image` emitted 736k chars (~184k tokens) where the plain map
  // is 18k — 40x the thing it was supposed to be cheaper than, and unusable besides, because
  // nothing renders a data URL out of a terminal. The vision-encoder discount is only earned when
  // the bytes reach a model AS an image, which means a file. Mirrors /screenshot.
  const img = (response as any)?.data?.image as string | undefined
  if (body.file !== false && img) {
    const saved = await saveDataUrl(img, { kind: 'schematics', prefix: 'map' })
    if ('path' in saved) {
      ;(response as any).data.path = saved.path
      delete (response as any).data.image
      // The legend goes beside the image, as a sibling file.
      //
      // The image carries geometry and handles; the legend carries what the image had to leave
      // out — which is what makes it safe to STOP cramming captions into boxes too small to hold
      // them. Written rather than inlined so `hj map --image` stdout stays a bare path, and so the
      // pair travels together: read the number off the picture, look it up here.
      const legend = (response as any).data?.legend
      if (legend && Object.keys(legend).length) {
        // Strip-then-append, NOT replace-with. A `replace(/\.\w+$/, '.legend.json')` is a no-op
        // when the path has no extension, and the legend would then be written OVER the image we
        // just saved. Appending always yields a distinct name, so the two can never collide.
        const legendPath = saved.path.replace(/\.[a-z0-9]+$/i, '') + '.legend.json'
        try {
          await writeFile(legendPath, JSON.stringify(legend, null, 2))
          ;(response as any).data.legendPath = legendPath
          delete (response as any).data.legend
        } catch {
          // Keep it inline if the sibling write fails — losing the legend entirely would be worse
          // than a larger payload, and the caller can still act on it.
        }
      }
    } else if (saved.error === 'not a base64 image data URL') {
      // A non-data-URL `image` means the widget returned a shape we don't understand. Passing it
      // through unremarked would look like a successful capture.
      ;(response as any).warning =
        `the widget returned an 'image' that is not a base64 data URL, so it could not be written ` +
        `to disk and is being passed through unchanged.`
    } else {
      // Keeping the data URL is the right fallback — losing the capture would be worse. Doing it
      // SILENTLY was not: the caller asked for a file and got ~736k chars of base64 back with no
      // explanation, i.e. the exact regression this block exists to prevent, restored invisibly and
      // with the whole suite green. Say what happened and why, so the reader spends their time on
      // the read-only temp dir (or full disk, or sandbox) instead of on us.
      ;(response as any).warning =
        `could not write the schematic to disk (${saved.error}) — returning it inline ` +
        `as a data URL instead. That is very large (~700KB of base64 is typical) and no terminal ` +
        `can render it; pass file:false to ask for this deliberately, or fix the temp directory.`
    }
  }
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.tabsOpen, async (body, ctx) => {
  const response = await ctx.requestFromBrowser('tabs', 'open', { url: body.url })
  // #5: `window.open` fallback opens a client-less tab that's invisible and uncontrollable. Promote
  // the widget's explanation to a top-level `warning` so `hj` prints it on stderr — otherwise the
  // fallback looks like success and the next command silently lands on the wrong tab.
  if (response?.data?.fallback && response.data.reason && !response.warning) {
    response.warning = response.data.reason as string
  }
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
    return Response.json({ success: false, error: 'window id is required (run `hj tabs` to list connected tabs)' }, { status: 400, headers: ctx.headers })
  }
  // #4: focus is a SERVER-SIDE operation. The old code dispatched a `focus` command to the browser,
  // routed to the *focused* tab (not the target), so nobody answered and it timed out — and even
  // routed correctly, a backgrounded tab can't raise itself (window.focus() is a no-op there, and
  // its throttled event loop may never process the message). So we just set the routing target.
  const r = ctx.focusWindow(windowId)
  if (!r.ok) {
    return Response.json({ success: false, error: r.error }, { status: 404, headers: ctx.headers })
  }
  const result: Record<string, unknown> = { success: true, focused: windowId, active: r.active !== false }
  if (r.title) result.title = r.title
  if (r.active === false) {
    // Honest about the limit: we route commands here, but we can't physically raise a hidden tab
    // from the server — a backgrounded tab stays frozen until it's actually brought to the front.
    result.warning =
      'Untargeted commands now route to this tab, but it reports HIDDEN — browsers freeze ' +
      'requestAnimationFrame and throttle timers in a backgrounded tab, so results can be stale ' +
      '("not mounted yet", not "broken"). Bring it to the front in your browser to wake it.'
  }
  return Response.json(result, { headers: ctx.headers })
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

// Network handlers (CDP-based, routed through widget bridge)
registerHandler(api.networkWatch, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('network', 'watch', {
    preset: body.preset,
    includePatterns: body.includePatterns,
    excludePatterns: body.excludePatterns,
    maxBuffer: body.maxBuffer,
  }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.networkUnwatch, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('network', 'unwatch', {})
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.network, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('network', 'get', {})
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.networkStats, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('network', 'stats', {})
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

  // `selector` is an accepted alias for `forElement`. The CLI sent `selector`, the test-runner
  // `wait` step accepts `selector`, and SKILL.md documents them as interchangeable — this endpoint
  // was the lone holdout, and because a stray key validates fine, `hj wait ".modal"` fell through to
  // the "no arguments" path and returned `{ success: true, waited: 0 }` in 52ms. A wait that
  // reports success without waiting is the purest form of the instrument lying: every assertion
  // after it races the page, and the failure surfaces somewhere else entirely.
  const forElement = body.forElement ?? (body as any).selector

  // Nothing to wait FOR. Previously this returned success, which is what let a field-name mismatch
  // masquerade as a passing command for as long as nobody measured the elapsed time. Refuse.
  if (!forElement && !(ms > 0)) {
    return Response.json({
      success: false,
      error:
        `/wait needs something to wait for: pass \`ms\` for a fixed delay, or \`forElement\` ` +
        `(alias: \`selector\`) for an element. Received neither, so there was nothing to do — ` +
        `reporting that instead of returning success after 0ms.`,
      waited: 0,
    }, { status: 400, headers: ctx.headers })
  }

  // If waiting for element
  if (forElement) {
    const selector = forElement
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
  
  // `/find` used to carry its OWN text search — `document.querySelectorAll(tag)` in document
  // order, returning the FIRST match. Every ancestor of a hit also contains its text, so the first
  // match is the OUTERMOST one: on a real app it answered `app-layout:nth-of-type(1)` — the entire
  // application — with `found: true` and exit 0. A false positive that reads as a success is worse
  // than a miss, and it survived because `:text()` was fixed to return the innermost match in a
  // different code path (`resolveSelectorAll`) while this one was never touched. Two
  // implementations of "find me the element with this text" WILL diverge; there is now one.
  //
  // Reported as https://github.com/tonioloewald/haltija/issues/24.
  //
  // Candidates come from the widget's own resolver, so `/find` inherits shadow-DOM piercing and
  // agrees with `:text()` about which element is meant. The text is NOT interpolated into a
  // `:text(...)` selector — arbitrary text containing `)` or quotes would break the parser — so
  // matching stays here and only candidate GATHERING is delegated.
  const findCode = `(function() {
    const gather = window.__haltija_resolveSelectorAll;
    const elements = gather ? gather(${JSON.stringify(tag)}) : Array.from(document.querySelectorAll(${JSON.stringify(tag)}));
    const searchText = ${JSON.stringify(body.text)};
    const exact = ${exact};
    const visibleOnly = ${visible};
    const results = [];

    // Containment that CROSSES shadow boundaries. \`Node.contains\` stops at the boundary, so with
    // shadow-piercing candidates it reports false for a real ancestor and the outermost match
    // survives the innermost filter — the very bug being fixed, reintroduced one layer down.
    const containsDeep = (ancestor, node) => {
      let cur = node;
      while (cur) {
        if (cur === ancestor) return true;
        cur = cur.parentNode ? cur.parentNode : cur.host;
      }
      return false;
    };

    // "Rendered", matching assert visible/hidden — NOT \`offsetParent === null\`, which is null for
    // \`html\`, \`body\` and EVERY \`position: fixed\` element. Fixed shells, modals and sticky chrome
    // are perfectly visible and were all being skipped.
    //
    // Prefers the WIDGET'S OWN predicate so \`find\` and \`click\` cannot disagree about which element
    // a text selector means — they did, and it also let \`find\` return an element parked off-canvas
    // at \`left:-9999px\` (#27). The inline copy below is only a fallback for a widget too old to
    // export it; keeping two rules in permanent use is what caused #24 in the first place.
    const isVisible = window.__haltija_isActionable || ((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    const textOf = (el) => (el.textContent || '').trim();
    const hits = elements.filter((el) => {
      if (visibleOnly && !isVisible(el)) return false;
      const t = textOf(el);
      return exact ? t === searchText : t.includes(searchText);
    });
    // Innermost only: drop any hit that contains another hit.
    const innermost = hits.filter((el) => !hits.some((o) => o !== el && containsDeep(el, o)));

    for (const el of innermost) {
      const text = textOf(el);
      {
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
        
        // A match inside a shadow root cannot be reached by the selector we just generated:
        // document.querySelector does not cross the boundary. Saying so beats handing back a
        // selector that silently resolves to nothing (or, worse, to a different element).
        const inShadow = el.getRootNode() !== document;

        const result = {
          selector,
          tag: el.tagName.toLowerCase(),
          text: text.substring(0, 100),
          id: el.id || undefined,
          classes: el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 5) : undefined,
          inShadow: inShadow || undefined,
          note: inShadow ? 'inside a shadow root — this selector will not resolve from the document; use hj tree --shadow to get a ref, or click by ref' : undefined,
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
    return Response.json(withWarning({ success: true, ...response.data }, response), { headers: ctx.headers })
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
    return Response.json(withWarning(response.data, response), { headers: ctx.headers })
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
  
  if (body.ref || body.selector) {
    // Resolve element via ref or selector
    const resolveCode = body.ref 
      ? `window.__haltija_refRegistry?.resolve(${JSON.stringify(body.ref)})`
      : `(window.__haltija_resolveSelector || document.querySelector.bind(document))(${JSON.stringify(body.selector)})`
    const targetDesc = body.ref ? `@${body.ref}` : body.selector
    const code = `
      (async () => {
        const el = ${resolveCode};
        if (!el) return { success: false, error: 'Element not found: ${targetDesc}' };
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

// ============================================
// Video Handlers
// ============================================

registerHandler(api.videoStart, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const maxDuration = Math.min(body.maxDuration || 60, 300) // cap at 5 min
  const response = await ctx.requestFromBrowser('video', 'start', { maxDuration }, 10000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.videoStop, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  // Long timeout — collecting and encoding video chunks can take time
  const response = await ctx.requestFromBrowser('video', 'stop', {}, 30000, windowId)
  
  // Video data is streamed directly to disk by the Electron main process.
  // response.data contains { path, duration, size, format } — no base64.
  if (response.success && response.data) {
    return Response.json({
      success: true,
      path: response.data.path,
      duration: response.data.duration,
      size: response.data.size,
      format: response.data.format || 'webm',
    }, { headers: ctx.headers })
  }
  
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.videoStatus, async (_body, ctx) => {
  const windowId = ctx.targetWindowId
  const response = await ctx.requestFromBrowser('video', 'status', {}, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// ============================================
// Dialog Handlers
// ============================================

registerHandler(api.dialogConfigure, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const response = await ctx.requestFromBrowser('dialog', 'configure', body, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.dialogHistory, async (_body, ctx) => {
  const windowId = ctx.targetWindowId
  const response = await ctx.requestFromBrowser('dialog', 'history', {}, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
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

/**
 * Session mirror — the READ half of #37. See src/tmux-session.ts for why it is read-only.
 *
 * tmux is invoked with an ARGUMENT ARRAY, never a shell string, so a session name containing shell
 * metacharacters is inert. The name is also validated against `tmux list-sessions` before use, but
 * argv-not-shell is what makes the injection class impossible rather than merely unlikely.
 */
const runTmux: RunTmux = async (args) => {
  try {
    const proc = Bun.spawn(['tmux', ...args], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { ok: code === 0, stdout, stderr }
  } catch (err) {
    // tmux not installed is the common case, and it deserves a real remedy rather than ENOENT.
    return { ok: false, stdout: '', stderr: `could not run tmux: ${(err as Error).message}` }
  }
}


/**
 * `/session/*` requires a token to be CONFIGURED — refusing, not warning.
 *
 * The previous design warned and continued, on the reasoning that a feature which blocks the common
 * case gets worked around. An adversarial review showed the reasoning was inverted for this
 * endpoint: with no token, an anonymous caller performs the opt-in ITSELF —
 * `POST /session/attach {"target":"agent","allowInput":true}` then `POST /session/write` — and lands
 * arbitrary text on the stdin of an agent holding the developer's shell privileges. Reproduced end
 * to end from a foreign Origin. "Opt-in by construction" described the STATE and was never an
 * authorization boundary: the attacker did the opting in.
 *
 * The server binds beyond loopback and answers `Access-Control-Allow-Origin: *`, so "it is only
 * localhost" is not true by default. Given the asset — a terminal running a privileged agent — the
 * right default is to refuse. This endpoint family is opt-in and niche, so requiring `--token` costs
 * a flag rather than a workflow.
 */
function requireToken(ctx: { headers: HeadersInit }): Response | null {
  if (process.env.HALTIJA_TOKEN) return null
  return Response.json(
    {
      success: false,
      error:
        'the session mirror requires a token. It exposes an agent\'s terminal — and, with ' +
        '--allow-input, lets a caller type into it — so it will not run on an unauthenticated ' +
        'server. Restart with `haltija --token <secret>` and set HALTIJA_TOKEN for clients.',
    },
    { status: 403, headers: ctx.headers },
  )
}

registerHandler(api.sessionAttach, async (body, ctx) => {
  const denied = requireToken(ctx)
  if (denied) return denied
  // The token advisory is the server's to make — only it knows whether one is required.
  const result = await attachSession(runTmux, String(body.target || ''), !!process.env.HALTIJA_TOKEN, body.allowInput === true)
  return Response.json(
    result.ok
      ? { success: true, target: result.target, available: result.available, allowInput: result.allowInput, writeKey: result.writeKey, warning: result.warning }
      : { success: false, error: result.error, available: result.available },
    { status: result.ok ? 200 : 400, headers: ctx.headers },
  )
})

registerHandler(api.sessionRead, async (body, ctx) => {
  const denied = requireToken(ctx)
  if (denied) return denied
  const result = await readSession(runTmux, body.lines ?? 200)
  return Response.json(
    result.ok
      ? { success: true, target: result.target, text: result.text }
      : { success: false, error: result.error, target: result.target },
    { status: result.ok ? 200 : 400, headers: ctx.headers },
  )
})

registerHandler(api.sessionDetach, async (_body, ctx) => {
  const denied = requireToken(ctx)
  if (denied) return denied
  detachSession()
  return Response.json({ success: true, attached: false }, { headers: ctx.headers })
})

registerHandler(api.sessionWrite, async (body, ctx) => {
  const denied = requireToken(ctx)
  if (denied) return denied
  const result = await writeSession(runTmux, String(body.text ?? ''), body.submit !== false, String(body.writeKey ?? ''))
  return Response.json(
    result.ok
      ? { success: true, target: result.target }
      : { success: false, error: result.error, target: result.target },
    { status: result.ok ? 200 : 400, headers: ctx.headers },
  )
})
