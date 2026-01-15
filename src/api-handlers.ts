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

/** Context passed to every handler */
export interface HandlerContext {
  requestFromBrowser: RequestFromBrowserFn
  targetWindowId: string | undefined
  headers: Record<string, string>
  url: URL
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

// ============================================
// Handler Implementations
// ============================================

// Import schema for type inference
import * as api from './api-schema'

// Click handler - fires full mouse event lifecycle
// Supports both selector and text-based targeting
registerHandler(api.click, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  let selector = body.selector
  
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
    return Response.json({ success: false, error: 'selector or text is required' }, { status: 400, headers: ctx.headers })
  }
  
  // Use interaction channel for realistic click with cursor overlay
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

// Call handler - call method or get property on element
registerHandler(api.call, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  const selector = JSON.stringify(body.selector)
  const method = body.method
  const args = body.args
  
  let code: string
  if (args !== undefined) {
    // Method call mode: element.method(...args)
    const argsJson = JSON.stringify(args)
    code = `(function() {
      const el = document.querySelector(${selector});
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
      const el = document.querySelector(${selector});
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
    code: `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
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
registerHandler(api.type, async (body, ctx) => {
  const windowId = body.window || ctx.targetWindowId
  
  // Calculate timeout based on text length and typing speed
  // Worst case: humanlike with typos, max delay 150ms per char + typo overhead
  const baseTimeout = 5000
  const perCharTimeout = (body.maxDelay ?? 150) * 2 // Account for typos and delays
  const timeout = baseTimeout + (body.text?.length || 0) * perCharTimeout
  
  const response = await ctx.requestFromBrowser('interaction', 'type', {
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
    code: `document.querySelector(${JSON.stringify(body.selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
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
    visibleOnly: body.visibleOnly,
    ancestors: body.ancestors,
  }, 5000, windowId)
  return Response.json(response, { headers: ctx.headers })
})

// Screenshot handler - longer timeout since screenshots can be slow
registerHandler(api.screenshot, async (body, ctx) => {
  const response = await ctx.requestFromBrowser('dom', 'screenshot', {
    selector: body.selector,
    format: body.format,
    quality: body.quality,
    scale: body.scale,
    maxWidth: body.maxWidth,
    maxHeight: body.maxHeight,
  }, 15000) // 15s timeout for screenshots (default is 5s)
  return Response.json(response, { headers: ctx.headers })
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

// Recording handlers
registerHandler(api.recordingStart, async (body, ctx) => {
  const response = await ctx.requestFromBrowser('recording', 'start', { name: body.name })
  return Response.json(response, { headers: ctx.headers })
})

registerHandler(api.recordingStop, async (_body, ctx) => {
  const response = await ctx.requestFromBrowser('recording', 'stop', {})
  return Response.json(response, { headers: ctx.headers })
})

// Selection handlers
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
      ? `!document.querySelector(${JSON.stringify(selector)}) || document.querySelector(${JSON.stringify(selector)}).offsetParent === null`
      : `!!document.querySelector(${JSON.stringify(selector)}) && document.querySelector(${JSON.stringify(selector)}).offsetParent !== null`
    
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
        const el = document.querySelector(${JSON.stringify(body.selector)});
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
