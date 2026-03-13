/**
 * Dev Channel Server Tests
 * 
 * Tests the REST API endpoints.
 * Run with: bun test packages/tosijs-dev/src/server.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const PORT = 8701 // Use different port for tests
const CUSTOM_DOCS_PORT = 8702 // Port for custom docs test
const BASE_URL = `http://localhost:${PORT}`

let serverProcess: Subprocess | null = null

beforeAll(async () => {
  // Start server on test port
  serverProcess = spawn({
    cmd: ['bun', 'run', 'bin/server.ts'],
    cwd: import.meta.dir + '/..',
    env: { ...process.env, DEV_CHANNEL_PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  
  // Wait for server to be ready
  let ready = false
  for (let i = 0; i < 20 && !ready; i++) {
    try {
      const res = await fetch(`${BASE_URL}/status`)
      if (res.ok) ready = true
    } catch {
      await new Promise(r => setTimeout(r, 100))
    }
  }
  
  if (!ready) {
    throw new Error('Server failed to start')
  }
})

afterAll(() => {
  serverProcess?.kill()
})

describe('tosijs-dev server', () => {
  describe('GET /status', () => {
    it('returns server status', async () => {
      const res = await fetch(`${BASE_URL}/status`)
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data).toHaveProperty('ok')
      expect(data).toHaveProperty('windows')
      expect(data).toHaveProperty('serverVersion')
      expect(data).toHaveProperty('browsers')
      expect(data).toHaveProperty('agents')
      expect(typeof data.browsers).toBe('number')
      expect(typeof data.agents).toBe('number')
      expect(Array.isArray(data.windows)).toBe(true)
    })
  })
  
  describe('GET /inject.js', () => {
    it('returns JavaScript injector code', async () => {
      const res = await fetch(`${BASE_URL}/inject.js`)
      expect(res.ok).toBe(true)
      expect(res.headers.get('content-type')).toContain('javascript')
      
      const code = await res.text()
      expect(code).toContain('haltija')
      expect(code).toContain('function')
    })
    
    it('contains correct HTTP URLs for HTTP request', async () => {
      const res = await fetch(`${BASE_URL}/inject.js`)
      const code = await res.text()
      
      // Should contain http:// URLs since we're requesting over HTTP
      expect(code).toContain(`http://localhost:${PORT}`)
      expect(code).toContain(`ws://localhost:${PORT}/ws/browser`)
      // Should NOT contain https:// URLs
      expect(code).not.toContain('https://localhost')
      expect(code).not.toContain('wss://localhost')
    })
  })
  
  describe('GET /docs', () => {
    it('returns quick-start documentation', async () => {
      const res = await fetch(`${BASE_URL}/docs`)
      expect(res.ok).toBe(true)
      expect(res.headers.get('content-type')).toContain('text/plain')
      
      const docs = await res.text()
      expect(docs).toContain('Browser Control for AI Agents')
      expect(docs).toContain('hj status')
      expect(docs).toContain('hj tree')
      expect(docs).toContain('hj api')
    })
  })
  
  describe('GET /api', () => {
    it('returns full API reference', async () => {
      const res = await fetch(`${BASE_URL}/api`)
      expect(res.ok).toBe(true)
      expect(res.headers.get('content-type')).toContain('text/plain')
      
      const api = await res.text()
      expect(api).toContain('API Reference')
      expect(api).toContain('POST /inspect')
      expect(api).toContain('POST /tree')
      expect(api).toContain('Quick Start')
    })
  })
  
  describe('GET /docs/list', () => {
    it('returns list of available docs', async () => {
      const res = await fetch(`${BASE_URL}/docs/list`)
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data).toHaveProperty('docs')
      expect(Array.isArray(data.docs)).toBe(true)
      expect(data.docs.length).toBeGreaterThan(0)
      
      // Should include built-in ux-crimes doc
      const uxCrimes = data.docs.find((d: any) => d.name === 'ux-crimes')
      expect(uxCrimes).toBeDefined()
      expect(uxCrimes.source).toBe('builtin')
      expect(uxCrimes.description).toContain('UX')
    })
    
    it('includes hint for fetching docs', async () => {
      const res = await fetch(`${BASE_URL}/docs/list`)
      const data = await res.json()
      expect(data.hint).toContain('/docs/:name')
    })
  })
  
  describe('GET /docs/:name', () => {
    it('returns built-in doc by name', async () => {
      const res = await fetch(`${BASE_URL}/docs/ux-crimes`)
      expect(res.ok).toBe(true)
      expect(res.headers.get('content-type')).toContain('text/markdown')
      expect(res.headers.get('x-doc-source')).toBe('builtin')
      
      const content = await res.text()
      expect(content).toContain('Haltija Criminal Code')
      expect(content).toContain('Class 1')
    })
    
    it('returns 404 for unknown doc', async () => {
      const res = await fetch(`${BASE_URL}/docs/nonexistent-doc`)
      expect(res.status).toBe(404)
      
      const data = await res.json()
      expect(data.error).toContain('not found')
      expect(data.available).toContain('ux-crimes')
    })
  })
  
  describe('GET /component.js', () => {
    it('returns component JavaScript', async () => {
      const res = await fetch(`${BASE_URL}/component.js`)
      expect(res.ok).toBe(true)
      expect(res.headers.get('content-type')).toContain('javascript')
      
      const code = await res.text()
      expect(code).toContain('DevChannel')
    })
  })
  
  describe('GET /messages', () => {
    it('returns empty array initially', async () => {
      const res = await fetch(`${BASE_URL}/messages`)
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(Array.isArray(data)).toBe(true)
    })
    
    it('respects since parameter', async () => {
      const res = await fetch(`${BASE_URL}/messages?since=${Date.now()}`)
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(0)
    })
  })
  
  describe('GET /console', () => {
    it('returns response (needs browser for actual data)', async () => {
      const res = await fetch(`${BASE_URL}/console`)
      // Without a browser connected, this will timeout or return error
      const data = await res.json()
      // Just check we got a response object
      expect(typeof data).toBe('object')
    })
  })
  
  describe('POST /send', () => {
    it('accepts messages', async () => {
      const res = await fetch(`${BASE_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'test',
          action: 'ping',
          payload: { hello: 'world' }
        })
      })
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data).toHaveProperty('id')
      expect(data.success).toBe(true)
    })
  })
  
  describe('POST /build', () => {
    it('publishes build events', async () => {
      const res = await fetch(`${BASE_URL}/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'complete',
          duration: 1234
        })
      })
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })
  
  describe('CORS', () => {
    it('includes CORS headers', async () => {
      const res = await fetch(`${BASE_URL}/status`)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    })
    
    it('handles OPTIONS preflight', async () => {
      const res = await fetch(`${BASE_URL}/send`, {
        method: 'OPTIONS'
      })
      expect(res.ok).toBe(true)
      expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    })
  })
  
  describe('404 handling', () => {
    it('returns 404 for unknown endpoints', async () => {
      const res = await fetch(`${BASE_URL}/nonexistent`)
      expect(res.status).toBe(404)
    })
  })
  
  describe('POST endpoint validation', () => {
    it('GET on /eval returns self-documenting schema (schemaEndpoint)', async () => {
      // Endpoints using schemaEndpoint() return docs on GET instead of 405
      const res = await fetch(`${BASE_URL}/eval`)
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data.endpoint).toBe('/eval')
      expect(data.method).toBe('POST')
    })
    
    it('returns helpful error when required field is missing on /eval', async () => {
      const res = await fetch(`${BASE_URL}/eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: '1+1' }) // wrong field name
      })
      expect(res.status).toBe(400)
      
      const data = await res.json()
      expect(data.success).toBe(false)
      // tosijs-schema error format
      expect(data.error).toContain('code')
    })
    
    it('returns helpful error when wrong type is provided on /eval', async () => {
      const res = await fetch(`${BASE_URL}/eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 123 }) // wrong type
      })
      expect(res.status).toBe(400)
      
      const data = await res.json()
      expect(data.success).toBe(false)
      // tosijs-schema error format
      expect(data.error).toContain('code')
    })
    
    it('GET on /click without selector returns validation error', async () => {
      // GET on /click now attempts the action, so missing selector returns 400
      const res = await fetch(`${BASE_URL}/click`)
      expect(res.status).toBe(400)
      
      const data = await res.json()
      expect(data.error).toContain('selector')
    })
    
    it('returns helpful error when selector is missing on /click', async () => {
      const res = await fetch(`${BASE_URL}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      expect(res.status).toBe(400)
      
      const data = await res.json()
      // tosijs-schema error format
      expect(data.error).toContain('selector')
    })
    
    it('GET on /navigate returns self-documenting schema (schemaEndpoint)', async () => {
      // Endpoints using schemaEndpoint() return docs on GET instead of 405
      const res = await fetch(`${BASE_URL}/navigate`)
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data.endpoint).toBe('/navigate')
      expect(data.method).toBe('POST')
    })
    
    it('returns helpful error when url is missing on /navigate', async () => {
      const res = await fetch(`${BASE_URL}/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      expect(res.status).toBe(400)
      
      const data = await res.json()
      // tosijs-schema error format
      expect(data.error).toContain('url')
    })
    
    it('validates /send requires channel and action', async () => {
      const res = await fetch(`${BASE_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: {} }) // missing channel and action
      })
      expect(res.status).toBe(400)
      
      const data = await res.json()
      expect(data.error).toContain('missing required field')
    })
    
    it('validates /tree accepts empty body', async () => {
      // /tree should work with empty body (defaults to body selector)
      const res = await fetch(`${BASE_URL}/tree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      // Will fail because no browser connected, but should not be 400
      expect(res.status).not.toBe(400)
    })
  })
})

describe('tosijs-dev WebSocket', () => {
  it('accepts browser connections', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws/browser`)
    
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        ws.close()
        resolve()
      }
      ws.onerror = reject
      setTimeout(() => reject(new Error('Connection timeout')), 2000)
    })
  })
  
  it('accepts agent connections', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws/agent`)
    
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        ws.close()
        resolve()
      }
      ws.onerror = reject
      setTimeout(() => reject(new Error('Connection timeout')), 2000)
    })
  })
  
  it('sends requests to browser via REST (not WebSocket broadcast)', async () => {
    // This tests that the /send endpoint delivers messages to browsers
    const browserWs = new WebSocket(`ws://localhost:${PORT}/ws/browser`)
    
    const received: any[] = []
    
    await new Promise<void>((resolve, reject) => {
      browserWs.onopen = async () => {
        // Use REST API to send message to browser
        await fetch(`http://localhost:${PORT}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'dom',
            action: 'query',
            payload: { selector: '#test' }
          })
        })
      }
      
      browserWs.onmessage = (e) => {
        received.push(JSON.parse(e.data))
        browserWs.close()
        resolve()
      }
      
      setTimeout(() => {
        browserWs.close()
        reject(new Error('Message routing timeout'))
      }, 2000)
    })
    
    expect(received.length).toBeGreaterThan(0)
    expect(received[0].channel).toBe('dom')
  })
})

describe('tosijs-dev custom docs', () => {
  const CUSTOM_DOCS_DIR = join(import.meta.dir, '../.test-docs')
  const CUSTOM_URL = `http://localhost:${CUSTOM_DOCS_PORT}`
  let customServer: Subprocess | null = null
  
  beforeAll(async () => {
    // Create temp docs directory with test files
    mkdirSync(CUSTOM_DOCS_DIR, { recursive: true })
    writeFileSync(
      join(CUSTOM_DOCS_DIR, 'style-guide.md'),
      '# Project Style Guide\n\nUse tabs, not spaces.'
    )
    writeFileSync(
      join(CUSTOM_DOCS_DIR, 'api-reference.md'),
      '# API Reference\n\nOur custom API docs.'
    )
    // Override built-in doc
    writeFileSync(
      join(CUSTOM_DOCS_DIR, 'ux-crimes.md'),
      '# Custom UX Crimes\n\nOur project-specific UX rules.'
    )
    
    // Start server with custom docs dir
    customServer = spawn({
      cmd: ['bun', 'run', 'bin/server.ts'],
      cwd: import.meta.dir + '/..',
      env: { 
        ...process.env, 
        DEV_CHANNEL_PORT: String(CUSTOM_DOCS_PORT),
        DEV_CHANNEL_DOCS_DIR: CUSTOM_DOCS_DIR
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    
    // Wait for server to be ready
    let ready = false
    for (let i = 0; i < 20 && !ready; i++) {
      try {
        const res = await fetch(`${CUSTOM_URL}/status`)
        if (res.ok) ready = true
      } catch {
        await new Promise(r => setTimeout(r, 100))
      }
    }
    
    if (!ready) {
      throw new Error('Custom docs server failed to start')
    }
  })
  
  afterAll(() => {
    customServer?.kill()
    // Clean up temp docs
    try {
      rmSync(CUSTOM_DOCS_DIR, { recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  })
  
  it('lists custom docs alongside built-in', async () => {
    const res = await fetch(`${CUSTOM_URL}/docs/list`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.customDocsDir).toBe(CUSTOM_DOCS_DIR)
    
    // Should have style-guide and api-reference as custom
    const styleGuide = data.docs.find((d: any) => d.name === 'style-guide')
    expect(styleGuide).toBeDefined()
    expect(styleGuide.source).toBe('custom')
    expect(styleGuide.description).toContain('Style Guide')
    
    const apiRef = data.docs.find((d: any) => d.name === 'api-reference')
    expect(apiRef).toBeDefined()
    expect(apiRef.source).toBe('custom')
  })
  
  it('serves custom doc content', async () => {
    const res = await fetch(`${CUSTOM_URL}/docs/style-guide`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('x-doc-source')).toBe('custom')
    
    const content = await res.text()
    expect(content).toContain('Use tabs, not spaces')
  })
  
  it('custom docs override built-in docs', async () => {
    const res = await fetch(`${CUSTOM_URL}/docs/ux-crimes`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('x-doc-source')).toBe('custom')
    
    const content = await res.text()
    expect(content).toContain('Custom UX Crimes')
    expect(content).toContain('project-specific')
    // Should NOT contain the built-in content
    expect(content).not.toContain('Haltija Criminal Code')
  })
})

describe('schema-driven self-documenting endpoints', () => {
  // These tests verify that POST endpoints using schemaEndpoint() return
  // self-documenting JSON when accessed via GET
  
  it('GET on /click attempts action (returns error without selector)', async () => {
    // GET on /click now uses defaults and attempts the action
    const res = await fetch(`${BASE_URL}/click`)
    expect(res.status).toBe(400)
    
    const data = await res.json()
    // Missing required selector
    expect(data.error).toContain('selector')
  })
  
  it('GET on /type attempts action (returns error without required params)', async () => {
    // GET on /type now uses defaults and attempts the action
    const res = await fetch(`${BASE_URL}/type`)
    expect(res.status).toBe(400)
    
    const data = await res.json()
    // Missing required selector and text
    expect(data.error).toBeDefined()
  })
  
  it('GET on /tree uses defaults and returns tree (or error if no browser)', async () => {
    // GET on /tree now uses defaults and returns tree data, not schema docs
    const res = await fetch(`${BASE_URL}/tree`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    // Without a browser connected, we get an error response
    // but the endpoint should still work and return JSON
    expect(data).toHaveProperty('success')
    // If success is false, it means no browser (expected in unit tests)
    // If success is true, it would have tree data
  })
  
  it('GET on /query returns schema documentation', async () => {
    const res = await fetch(`${BASE_URL}/query`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/query')
    expect(data.method).toBe('POST')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.properties.ref).toBeDefined() // ref is also accepted
    expect(data.input.properties.all).toBeDefined()
    // selector is now optional (ref can be used instead)
  })
  
  it('GET on /inspect returns schema documentation', async () => {
    const res = await fetch(`${BASE_URL}/inspect`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/inspect')
    expect(data.method).toBe('POST')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.properties.ref).toBeDefined() // ref is also accepted
    // selector is now optional (ref can be used instead)
  })
  
  it('GET on /highlight returns schema documentation', async () => {
    const res = await fetch(`${BASE_URL}/highlight`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/highlight')
    expect(data.method).toBe('POST')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.properties.label).toBeDefined()
    expect(data.input.properties.color).toBeDefined()
    expect(data.input.properties.duration).toBeDefined()
  })
  
  it('GET on /scroll returns schema documentation', async () => {
    const res = await fetch(`${BASE_URL}/scroll`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/scroll')
    expect(data.method).toBe('POST')
    expect(data.summary).toBe('Scroll to element or position')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.properties.x).toBeDefined()
    expect(data.input.properties.y).toBeDefined()
    expect(data.input.properties.deltaX).toBeDefined()
    expect(data.input.properties.deltaY).toBeDefined()
    expect(data.input.properties.duration).toBeDefined()
    expect(data.input.properties.easing).toBeDefined()
    expect(data.input.properties.block).toBeDefined()
  })
  
  it('/scroll requires at least one scroll target', async () => {
    const res = await fetch(`${BASE_URL}/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}) // no target specified
    })
    expect(res.status).toBe(400)
    
    const data = await res.json()
    expect(data.error).toContain('selector')
  })
  
  it('schema validation rejects invalid input', async () => {
    const res = await fetch(`${BASE_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 123 }) // wrong type
    })
    expect(res.status).toBe(400)
    
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.error).toBeDefined()
    expect(data.schema).toBeDefined() // Returns schema on error for reference
  })
  
  it('schema validation accepts valid input', async () => {
    // This will fail because no browser connected, but should NOT be 400
    const res = await fetch(`${BASE_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#test-button' })
    })
    // Should not be a validation error (400)
    expect(res.status).not.toBe(400)
  })
  
  it('GET on /call returns schema documentation', async () => {
    const res = await fetch(`${BASE_URL}/call`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/call')
    expect(data.method).toBe('POST')
    expect(data.summary).toBe('Call a method or get a property on an element')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.properties.ref).toBeDefined() // ref is also accepted
    expect(data.input.properties.method).toBeDefined()
    expect(data.input.properties.args).toBeDefined()
    // selector is now optional (ref can be used instead), only method is required
    expect(data.input.required).toContain('method')
  })
  
  // Note: /call no longer rejects missing selector at schema level since ref can be used instead.
  // The runtime handler validates that at least one of ref/selector is provided.
  
  it('/call rejects missing method', async () => {
    const res = await fetch(`${BASE_URL}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#btn' })
    })
    expect(res.status).toBe(400)
    
    const data = await res.json()
    expect(data.error).toContain('method')
  })
  
  it('/call accepts valid input (property access mode)', async () => {
    // No browser connected so will timeout, but should not be 400
    const res = await fetch(`${BASE_URL}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#email', method: 'value' })
    })
    expect(res.status).not.toBe(400)
  })
  
  it('/call accepts valid input (method call mode)', async () => {
    // No browser connected so will timeout, but should not be 400
    const res = await fetch(`${BASE_URL}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#popover', method: 'showPopover', args: [] })
    })
    expect(res.status).not.toBe(400)
  })
})

describe('window focus management', () => {
  // Helper: connect a fake browser widget and register it as a window
  async function connectBrowserWindow(windowId: string): Promise<WebSocket> {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws/browser`)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = reject
      setTimeout(() => reject(new Error('Connection timeout')), 2000)
    })
    // Register as a window (simulates widget's system:connected message)
    ws.send(JSON.stringify({
      channel: 'system',
      action: 'connected',
      payload: {
        windowId,
        browserId: `browser-${windowId}`,
        url: 'http://example.com',
        title: 'Test Page',
        active: true,
        windowType: 'tab',
      },
      timestamp: Date.now(),
    }))
    // Give server time to process
    await new Promise(r => setTimeout(r, 100))
    return ws
  }

  it('POST /windows/blur clears focused window', async () => {
    const ws = await connectBrowserWindow('test-blur-win')
    try {
      // Verify window is registered
      const statusRes = await fetch(`${BASE_URL}/windows`)
      const statusData = await statusRes.json()
      const windows = statusData.data?.windows || statusData.windows || []
      expect(windows.some((w: any) => w.id === 'test-blur-win')).toBe(true)

      // Blur
      const blurRes = await fetch(`${BASE_URL}/windows/blur`, { method: 'POST' })
      expect(blurRes.status).toBe(200)
      const blurData = await blurRes.json()
      expect(blurData.success).toBe(true)
    } finally {
      ws.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('POST /windows/:id/focus restores focus after blur', async () => {
    const ws = await connectBrowserWindow('test-focus-win')
    try {
      // Blur all
      await fetch(`${BASE_URL}/windows/blur`, { method: 'POST' })

      // Focus specific window
      const focusRes = await fetch(`${BASE_URL}/windows/test-focus-win/focus`, { method: 'POST' })
      expect(focusRes.status).toBe(200)
      const focusData = await focusRes.json()
      expect(focusData.success).toBe(true)
      expect(focusData.focused).toBe(true)
    } finally {
      ws.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('focused window still receives commands after deactivate (webview stays visible)', async () => {
    const ws = await connectBrowserWindow('test-still-routes-win')
    try {
      // Focus the window, then deactivate it (simulates terminal tab overlay,
      // but the webview stays visible underneath so commands still work)
      await fetch(`${BASE_URL}/windows/test-still-routes-win/focus`, { method: 'POST' })
      await fetch(`${BASE_URL}/windows/test-still-routes-win/deactivate`, { method: 'POST' })

      // Command should still be routed to the focused window (even though inactive)
      // because in the desktop app the webview stays visible behind the terminal frame.
      // The command will timeout since our fake browser doesn't respond, but it
      // should be *sent* — verify by checking the WebSocket receives the message.
      const received = new Promise<any>((resolve) => {
        ws.onmessage = (e) => resolve(JSON.parse(e.data))
        setTimeout(() => resolve(null), 2000)
      })

      fetch(`${BASE_URL}/tree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {})

      const msg = await received
      expect(msg).not.toBeNull()
      expect(msg.channel).toBe('dom')
      expect(msg.action).toBe('tree')
    } finally {
      ws.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('POST /windows/:id/deactivate and /activate toggle active state', async () => {
    const ws = await connectBrowserWindow('test-toggle-win')
    try {
      // Deactivate
      const deactivateRes = await fetch(`${BASE_URL}/windows/test-toggle-win/deactivate`, { method: 'POST' })
      expect(deactivateRes.status).toBe(200)
      const deactivateData = await deactivateRes.json()
      expect(deactivateData.active).toBe(false)

      // Reactivate
      const activateRes = await fetch(`${BASE_URL}/windows/test-toggle-win/activate`, { method: 'POST' })
      expect(activateRes.status).toBe(200)
      const activateData = await activateRes.json()
      expect(activateData.active).toBe(true)
    } finally {
      ws.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })
})

describe('widget-side session tokens', () => {
  // Helper: connect a fake browser widget with a session token
  async function connectBrowserWindow(windowId: string, session?: string): Promise<WebSocket> {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws/browser`)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = reject
      setTimeout(() => reject(new Error('Connection timeout')), 2000)
    })
    ws.send(JSON.stringify({
      channel: 'system',
      action: 'connected',
      payload: {
        windowId,
        browserId: `browser-${windowId}`,
        url: 'http://example.com',
        title: 'Test Page',
        active: true,
        windowType: 'tab',
        session: session || undefined,
      },
      timestamp: Date.now(),
    }))
    await new Promise(r => setTimeout(r, 100))
    return ws
  }

  it('window stores session from connected payload', async () => {
    const ws = await connectBrowserWindow('test-session-win', 'token-abc')
    try {
      const windowsRes = await fetch(`${BASE_URL}/windows`)
      const windowsData = await windowsRes.json()
      const windows = windowsData.data?.windows || windowsData.windows || []
      const win = windows.find((w: any) => w.id === 'test-session-win')
      expect(win).toBeDefined()
      expect(win.session).toBe('token-ab') // Truncated to 8 chars in response
    } finally {
      ws.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('/windows filters by session token — only matching widgets visible', async () => {
    const ws1 = await connectBrowserWindow('test-filter-win-a', 'session-x')
    const ws2 = await connectBrowserWindow('test-filter-win-b', 'session-y')
    try {
      // Session-x should see only its own window
      const xWindowsRes = await fetch(`${BASE_URL}/windows`, {
        headers: { 'X-Haltija-Session': 'session-x' },
      })
      const xData = await xWindowsRes.json()
      const xWindows = xData.data?.windows || xData.windows || []
      const xIds = xWindows.map((w: any) => w.id)
      expect(xIds).toContain('test-filter-win-a')
      expect(xIds).not.toContain('test-filter-win-b')

      // Session-y should see only its own window
      const yWindowsRes = await fetch(`${BASE_URL}/windows`, {
        headers: { 'X-Haltija-Session': 'session-y' },
      })
      const yData = await yWindowsRes.json()
      const yWindows = yData.data?.windows || yData.windows || []
      const yIds = yWindows.map((w: any) => w.id)
      expect(yIds).toContain('test-filter-win-b')
      expect(yIds).not.toContain('test-filter-win-a')
    } finally {
      ws1.close()
      ws2.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('request without session header sees all windows (legacy mode)', async () => {
    const ws1 = await connectBrowserWindow('test-legacy-win-a', 'session-one')
    const ws2 = await connectBrowserWindow('test-legacy-win-b', 'session-two')
    try {
      // Request without session header should see ALL windows
      const windowsRes = await fetch(`${BASE_URL}/windows`)
      const windowsData = await windowsRes.json()
      const windows = windowsData.data?.windows || windowsData.windows || []
      const ids = windows.map((w: any) => w.id)
      expect(ids).toContain('test-legacy-win-a')
      expect(ids).toContain('test-legacy-win-b')
    } finally {
      ws1.close()
      ws2.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('/status filters windows by session', async () => {
    const ws1 = await connectBrowserWindow('test-status-win-a', 'session-status')
    const ws2 = await connectBrowserWindow('test-status-win-b', 'session-other')
    try {
      // Status with session should only show matching windows
      const statusRes = await fetch(`${BASE_URL}/status`, {
        headers: { 'X-Haltija-Session': 'session-status' },
      })
      const statusData = await statusRes.json()
      const ids = statusData.windows.map((w: any) => w.id)
      expect(ids).toContain('test-status-win-a')
      expect(ids).not.toContain('test-status-win-b')
    } finally {
      ws1.close()
      ws2.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('single session: mismatched agent still sees window (no conflict)', async () => {
    const ws = await connectBrowserWindow('test-mismatch-win', 'real-token-123')
    try {
      // Only one session exists — no multi-agent conflict, so show all
      const windowsRes = await fetch(`${BASE_URL}/windows`, {
        headers: { 'X-Haltija-Session': 'wrong-token' },
      })
      const windowsData = await windowsRes.json()
      const windows = windowsData.data?.windows || windowsData.windows || []
      expect(windows.length).toBe(1)
      expect(windows[0].id).toBe('test-mismatch-win')
    } finally {
      ws.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('session-filtered routing sends to correct window', async () => {
    const ws1 = await connectBrowserWindow('test-route-win-a', 'agent-1')
    const ws2 = await connectBrowserWindow('test-route-win-b', 'agent-2')
    try {
      // Each agent should route to their own window
      // We can verify by checking /status with each session header
      const s1 = await fetch(`${BASE_URL}/status`, {
        headers: { 'X-Haltija-Session': 'agent-1' },
      })
      const d1 = await s1.json()
      expect(d1.windows.length).toBe(1)
      expect(d1.windows[0].id).toBe('test-route-win-a')

      const s2 = await fetch(`${BASE_URL}/status`, {
        headers: { 'X-Haltija-Session': 'agent-2' },
      })
      const d2 = await s2.json()
      expect(d2.windows.length).toBe(1)
      expect(d2.windows[0].id).toBe('test-route-win-b')
    } finally {
      ws1.close()
      ws2.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('window without session is visible to all (backward compat)', async () => {
    const wsWithSession = await connectBrowserWindow('test-has-session', 'my-session')
    const wsNoSession = await connectBrowserWindow('test-no-session') // no session
    try {
      // No session header — should see both
      const allRes = await fetch(`${BASE_URL}/windows`)
      const allData = await allRes.json()
      const allIds = (allData.data?.windows || allData.windows || []).map((w: any) => w.id)
      expect(allIds).toContain('test-has-session')
      expect(allIds).toContain('test-no-session')

      // With session header — only 1 distinct session, so sees all (no conflict)
      const filteredRes = await fetch(`${BASE_URL}/windows`, {
        headers: { 'X-Haltija-Session': 'my-session' },
      })
      const filteredData = await filteredRes.json()
      const filteredIds = (filteredData.data?.windows || filteredData.windows || []).map((w: any) => w.id)
      expect(filteredIds).toContain('test-has-session')
      expect(filteredIds).toContain('test-no-session')
    } finally {
      wsWithSession.close()
      wsNoSession.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('/status ok reflects global window count regardless of session', async () => {
    const ws = await connectBrowserWindow('test-ok-win', 'some-session')
    try {
      // Status with a different session — ok should still be true (global)
      // With single session, agent still sees all windows (no conflict)
      const res = await fetch(`${BASE_URL}/status`, {
        headers: { 'X-Haltija-Session': 'different-session' },
      })
      const data = await res.json()
      expect(data.ok).toBe(true) // Global: windows exist
      expect(data.windows.length).toBe(1) // Single session: no filtering
    } finally {
      ws.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('legacy command routing: sessionless widget receives commands from sessionless agent', async () => {
    const ws = await connectBrowserWindow('test-legacy-cmd-win') // no session
    try {
      // Intercept WebSocket message sent to this browser
      const received = new Promise<any>((resolve) => {
        ws.onmessage = (e) => resolve(JSON.parse(e.data))
        setTimeout(() => resolve(null), 3000)
      })

      // Agent sends /tree without any session header (legacy mode)
      fetch(`${BASE_URL}/tree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {})

      const msg = await received
      expect(msg).not.toBeNull()
      expect(msg.channel).toBe('dom')
      expect(msg.action).toBe('tree')
    } finally {
      ws.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('session-filtered command routing: action goes to matching session window only', async () => {
    const ws1 = await connectBrowserWindow('test-cmd-route-a', 'cmd-agent-1')
    const ws2 = await connectBrowserWindow('test-cmd-route-b', 'cmd-agent-2')
    try {
      // Track which windows receive the message
      let ws1Received: any = null
      let ws2Received: any = null
      ws1.onmessage = (e) => { ws1Received = JSON.parse(e.data) }
      ws2.onmessage = (e) => { ws2Received = JSON.parse(e.data) }

      // Agent-1 sends /tree with its session header
      fetch(`${BASE_URL}/tree`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Haltija-Session': 'cmd-agent-1',
        },
        body: JSON.stringify({}),
      }).catch(() => {})

      // Wait for message delivery
      await new Promise(r => setTimeout(r, 500))

      // Window A (agent-1's session) should receive the command
      expect(ws1Received).not.toBeNull()
      expect(ws1Received.channel).toBe('dom')
      expect(ws1Received.action).toBe('tree')

      // Window B (agent-2's session) should NOT receive anything
      expect(ws2Received).toBeNull()
    } finally {
      ws1.close()
      ws2.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('single session: mismatched agent adopts existing window (no conflict)', async () => {
    const ws = await connectBrowserWindow('test-adopt-win', 'existing-token')
    try {
      // Only 1 distinct session — agent with different token should still
      // route to the existing window (no multi-agent conflict to isolate).
      const received = new Promise<any>((resolve) => {
        ws.onmessage = (e) => resolve(JSON.parse(e.data))
        setTimeout(() => resolve(null), 3000)
      })

      fetch(`${BASE_URL}/tree`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Haltija-Session': 'different-token',
        },
        body: JSON.stringify({}),
      }).catch(() => {})

      const msg = await received
      expect(msg).not.toBeNull()
      expect(msg.channel).toBe('dom')
      expect(msg.action).toBe('tree')
    } finally {
      ws.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })

  it('multi-session: mismatched agent gets error, not hang', { timeout: 15000 }, async () => {
    // Two distinct sessions — a third agent should get an error
    const ws1 = await connectBrowserWindow('test-multi-a', 'session-alpha')
    const ws2 = await connectBrowserWindow('test-multi-b', 'session-beta')
    try {
      const start = Date.now()
      const res = await fetch(`${BASE_URL}/tree`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Haltija-Session': 'session-gamma',
        },
        body: JSON.stringify({}),
      })
      const elapsed = Date.now() - start
      const data = await res.json()

      expect(data.success).toBe(false)
      expect(data.error).toContain('No windows in session')
      expect(elapsed).toBeLessThan(12000)
    } finally {
      ws1.close()
      ws2.close()
      await new Promise(r => setTimeout(r, 100))
    }
  })
})
