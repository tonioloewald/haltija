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
registerHandler(api.click, async (body, ctx) => {
  const selector = body.selector
  const windowId = body.window || ctx.targetWindowId
  
  // Scroll element into view first
  await ctx.requestFromBrowser('eval', 'exec', {
    code: `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
  }, 5000, windowId)
  await sleep(100) // Wait for scroll
  
  // Full lifecycle: mouseenter → mouseover → mousemove → mousedown → mouseup → click
  for (const event of ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
    await ctx.requestFromBrowser('events', 'dispatch', {
      selector,
      event,
    }, 5000, windowId)
  }
  
  return Response.json({ success: true }, { headers: ctx.headers })
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
