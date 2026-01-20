/**
 * Haltija API Router
 * 
 * Auto-registers endpoints from schema and routes requests to handlers.
 * Provides:
 * - Automatic route matching from schema
 * - GET support on POST endpoints with sensible defaults
 * - Self-documenting GET when no defaults available
 * - Input validation before handler invocation
 * - Consistent error responses
 */

import { ALL_ENDPOINTS, validateInput, getEndpointDocs, type EndpointDef } from './api-schema'
import { handlers, type HandlerContext } from './api-handlers'

// ============================================
// Deprecation Detection
// ============================================

/** Check if an endpoint is deprecated based on its summary */
function isDeprecated(endpoint: EndpointDef): boolean {
  return endpoint.summary.startsWith('[Deprecated]')
}

/** Extract deprecation message from endpoint description */
function getDeprecationMessage(endpoint: EndpointDef): string | null {
  if (!isDeprecated(endpoint)) return null
  // Description typically starts with "Deprecated: Use X instead"
  const match = endpoint.description?.match(/^Deprecated:\s*(.+)$/m)
  return match ? match[1] : endpoint.summary.replace('[Deprecated] ', '')
}

/** Add deprecation notice to response if endpoint is deprecated */
async function wrapWithDeprecation(response: Response, endpoint: EndpointDef): Promise<Response> {
  const message = getDeprecationMessage(endpoint)
  if (!message) return response
  
  // Clone and modify JSON responses
  try {
    const data = await response.json()
    return Response.json({ ...data, deprecated: message }, { 
      status: response.status, 
      headers: response.headers 
    })
  } catch {
    // Non-JSON response, return as-is
    return response
  }
}

// ============================================
// GET Defaults for POST Endpoints
// ============================================
// These endpoints can work with GET using sensible defaults.
// Other POST endpoints return self-documenting schema on GET.

const GET_DEFAULTS: Record<string, Record<string, any>> = {
  '/tree': { selector: 'body', depth: 3 },
  '/screenshot': {},  // Full page capture
  '/click': {},  // selector required via query param
  '/type': {},   // selector and text required via query params
  '/key': {},    // key required via query param
  '/unhighlight': {},
  '/refresh': {},
  '/mutationsUnwatch': {},
  '/mutations/unwatch': {},
  '/eventsWatch': { preset: 'interactive' },
  '/events/watch': { preset: 'interactive' },
  '/eventsUnwatch': {},
  '/events/unwatch': {},
  '/recordingStart': {},
  '/recording/start': {},
  '/recordingStop': {},
  '/recording/stop': {},
  '/selectStart': {},
  '/select/start': {},
  '/selectCancel': {},
  '/select/cancel': {},
  '/selectClear': {},
  '/select/clear': {},
  '/snapshot': { trigger: 'manual' },
}

// ============================================
// Router Types
// ============================================

/** Factory function to create handler context from request */
export type ContextFactory = (req: Request, url: URL) => HandlerContext

// ============================================
// Router Implementation
// ============================================

/** Build path -> endpoint map for fast lookup */
const endpointMap = new Map<string, EndpointDef>(
  ALL_ENDPOINTS.map(ep => [ep.path, ep])
)

/**
 * Create a router function that handles requests based on schema
 * 
 * @param contextFactory - Function to create HandlerContext from request
 * @returns Request handler that returns Response or null (for unhandled routes)
 */
export function createRouter(contextFactory: ContextFactory) {
  return async function handleRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url)
    const path = url.pathname
    
    // Find matching endpoint
    const endpoint = endpointMap.get(path)
    if (!endpoint) {
      return null // Not handled by router, fall through to legacy code
    }
    
    // Check if we have a handler registered
    const handler = handlers.get(path)
    if (!handler) {
      return null // Endpoint defined but no handler yet, fall through
    }
    
    // Create context
    const ctx = contextFactory(req, url)
    
    // GET on POST endpoint - use defaults if available, otherwise self-documenting
    if (req.method === 'GET' && endpoint.method === 'POST') {
      const defaults = GET_DEFAULTS[path]
      if (defaults !== undefined) {
        // Parse query params and merge with defaults
        const queryParams: Record<string, any> = {}
        for (const [key, value] of url.searchParams.entries()) {
          // Try to parse as JSON for boolean/number values
          try {
            queryParams[key] = JSON.parse(value)
          } catch {
            queryParams[key] = value
          }
        }
        const body = { ...defaults, ...queryParams }
        // Validate against schema (catches missing required params)
        const validation = validateInput(endpoint, body)
        if (!validation.valid) {
          return Response.json({
            success: false,
            error: validation.error,
            schema: endpoint.input?.schema,
          }, { status: 400, headers: ctx.headers })
        }
        const response = await handler(body, ctx)
        return wrapWithDeprecation(response, endpoint)
      }
      // No defaults - return self-documenting schema
      return Response.json(getEndpointDocs(endpoint), { headers: ctx.headers })
    }
    
    // Method mismatch
    if (req.method !== endpoint.method) {
      return Response.json({
        success: false,
        error: `${endpoint.path} requires ${endpoint.method}`,
      }, { status: 405, headers: ctx.headers })
    }
    
    // GET endpoints - no body validation needed
    if (endpoint.method === 'GET') {
      const response = await handler({}, ctx)
      return wrapWithDeprecation(response, endpoint)
    }
    
    // POST endpoints - parse and validate body
    let body: any
    try {
      const text = await req.text()
      body = text ? JSON.parse(text) : {}
    } catch {
      return Response.json({
        success: false,
        error: 'Invalid JSON body',
        schema: endpoint.input?.schema,
      }, { status: 400, headers: ctx.headers })
    }
    
    // Validate input against schema
    const validation = validateInput(endpoint, body)
    if (!validation.valid) {
      return Response.json({
        success: false,
        error: validation.error,
        schema: endpoint.input?.schema,
      }, { status: 400, headers: ctx.headers })
    }
    
    // Call handler with validated body and wrap with deprecation notice if needed
    const response = await handler(body, ctx)
    return wrapWithDeprecation(response, endpoint)
  }
}

/**
 * Get list of endpoints that have handlers registered
 */
export function getRegisteredEndpoints(): string[] {
  return Array.from(handlers.keys())
}

/**
 * Check if an endpoint has a handler registered
 */
export function hasHandler(path: string): boolean {
  return handlers.has(path)
}
