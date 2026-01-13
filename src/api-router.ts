/**
 * Haltija API Router
 * 
 * Auto-registers endpoints from schema and routes requests to handlers.
 * Provides:
 * - Automatic route matching from schema
 * - Self-documenting GET on POST endpoints
 * - Input validation before handler invocation
 * - Consistent error responses
 */

import { ALL_ENDPOINTS, validateInput, getEndpointDocs, type EndpointDef } from './api-schema'
import { handlers, type HandlerContext } from './api-handlers'

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
    
    // GET on POST endpoint = self-documenting
    if (req.method === 'GET' && endpoint.method === 'POST') {
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
      return handler({}, ctx)
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
    
    // Call handler with validated body
    return handler(body, ctx)
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
