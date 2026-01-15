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
      expect(data).toHaveProperty('browsers')
      expect(data).toHaveProperty('agents')
      expect(data).toHaveProperty('bufferedMessages')
      expect(typeof data.browsers).toBe('number')
      expect(typeof data.agents).toBe('number')
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
      expect(docs).toContain('/status')
      expect(docs).toContain('/tree')
      expect(docs).toContain('/api')
    })
  })
  
  describe('GET /api', () => {
    it('returns full API reference', async () => {
      const res = await fetch(`${BASE_URL}/api`)
      expect(res.ok).toBe(true)
      expect(res.headers.get('content-type')).toContain('text/plain')
      
      const api = await res.text()
      expect(api).toContain('API Reference')
      expect(api).toContain('/inspect Response')
      expect(api).toContain('/tree Options')
      expect(api).toContain('Mutation Batch')
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
    
    it('GET on /click returns self-documenting schema (schemaEndpoint)', async () => {
      // Endpoints using schemaEndpoint() return docs on GET instead of 405
      const res = await fetch(`${BASE_URL}/click`)
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data.endpoint).toBe('/click')
      expect(data.method).toBe('POST')
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
  
  it('GET on /click returns schema documentation', async () => {
    const res = await fetch(`${BASE_URL}/click`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/click')
    expect(data.method).toBe('POST')
    expect(data.summary).toBe('Click an element')
    expect(data.description).toContain('mouseenter')
    expect(data.input).toBeDefined()
    expect(data.input.type).toBe('object')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.properties.selector.type).toBe('string')
    expect(data.input.required).toContain('selector')
    expect(data.usage).toContain('curl -X POST')
  })
  
  it('GET on /type returns schema with all options documented', async () => {
    const res = await fetch(`${BASE_URL}/type`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/type')
    expect(data.method).toBe('POST')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.properties.text).toBeDefined()
    expect(data.input.properties.humanlike).toBeDefined()
    expect(data.input.properties.typoRate).toBeDefined()
    expect(data.input.properties.minDelay).toBeDefined()
    expect(data.input.properties.maxDelay).toBeDefined()
    // Required fields
    expect(data.input.required).toContain('selector')
    expect(data.input.required).toContain('text')
  })
  
  it('GET on /tree returns schema documentation', async () => {
    const res = await fetch(`${BASE_URL}/tree`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/tree')
    expect(data.method).toBe('POST')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.properties.depth).toBeDefined()
    expect(data.input.properties.includeText).toBeDefined()
    expect(data.input.properties.visibleOnly).toBeDefined()
    expect(data.input.properties.pierceShadow).toBeDefined()
    expect(data.input.properties.compact).toBeDefined()
  })
  
  it('GET on /query returns schema documentation', async () => {
    const res = await fetch(`${BASE_URL}/query`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/query')
    expect(data.method).toBe('POST')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.properties.all).toBeDefined()
    expect(data.input.required).toContain('selector')
  })
  
  it('GET on /inspect returns schema documentation', async () => {
    const res = await fetch(`${BASE_URL}/inspect`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.endpoint).toBe('/inspect')
    expect(data.method).toBe('POST')
    expect(data.input.properties.selector).toBeDefined()
    expect(data.input.required).toContain('selector')
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
    expect(data.input.properties.method).toBeDefined()
    expect(data.input.properties.args).toBeDefined()
    expect(data.input.required).toContain('selector')
    expect(data.input.required).toContain('method')
  })
  
  it('/call rejects missing selector', async () => {
    const res = await fetch(`${BASE_URL}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'focus' })
    })
    expect(res.status).toBe(400)
    
    const data = await res.json()
    expect(data.error).toContain('selector')
  })
  
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
