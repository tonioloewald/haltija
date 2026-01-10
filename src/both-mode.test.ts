/**
 * Both Mode Tests
 * 
 * Tests that --both mode runs both HTTP and HTTPS servers correctly.
 * Run with: bun test packages/tosijs-dev/src/both-mode.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'

const HTTP_PORT = 8703
const HTTPS_PORT = 8704
const HTTP_URL = `http://localhost:${HTTP_PORT}`
const HTTPS_URL = `https://localhost:${HTTPS_PORT}`

let serverProcess: Subprocess | null = null

beforeAll(async () => {
  // Start server in both mode
  serverProcess = spawn({
    cmd: ['bun', 'run', 'bin/tosijs-dev.ts', '--both'],
    cwd: import.meta.dir + '/..',
    env: { 
      ...process.env, 
      DEV_CHANNEL_PORT: String(HTTP_PORT),
      DEV_CHANNEL_HTTPS_PORT: String(HTTPS_PORT),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  
  // Wait for both servers to be ready
  let httpReady = false
  let httpsReady = false
  
  for (let i = 0; i < 30 && (!httpReady || !httpsReady); i++) {
    try {
      if (!httpReady) {
        const res = await fetch(`${HTTP_URL}/status`)
        if (res.ok) httpReady = true
      }
    } catch {}
    
    try {
      if (!httpsReady) {
        const res = await fetch(`${HTTPS_URL}/status`, {
          // @ts-ignore - Bun supports this
          tls: { rejectUnauthorized: false }
        })
        if (res.ok) httpsReady = true
      }
    } catch {}
    
    if (!httpReady || !httpsReady) {
      await new Promise(r => setTimeout(r, 200))
    }
  }
  
  if (!httpReady || !httpsReady) {
    throw new Error(`Servers failed to start: HTTP=${httpReady}, HTTPS=${httpsReady}`)
  }
}, 15000)

afterAll(() => {
  serverProcess?.kill()
})

describe('tosijs-dev --both mode', () => {
  describe('HTTP server', () => {
    it('responds on HTTP port', async () => {
      const res = await fetch(`${HTTP_URL}/status`)
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data).toHaveProperty('serverVersion')
    })
    
    it('inject.js contains HTTP URLs', async () => {
      const res = await fetch(`${HTTP_URL}/inject.js`)
      const code = await res.text()
      
      expect(code).toContain(`http://localhost:${HTTP_PORT}`)
      expect(code).toContain(`ws://localhost:${HTTP_PORT}/ws/browser`)
    })
  })
  
  describe('HTTPS server', () => {
    it('responds on HTTPS port', async () => {
      const res = await fetch(`${HTTPS_URL}/status`, {
        // @ts-ignore
        tls: { rejectUnauthorized: false }
      })
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data).toHaveProperty('serverVersion')
    })
    
    it('inject.js contains HTTPS URLs', async () => {
      const res = await fetch(`${HTTPS_URL}/inject.js`, {
        // @ts-ignore
        tls: { rejectUnauthorized: false }
      })
      const code = await res.text()
      
      expect(code).toContain(`https://localhost:${HTTPS_PORT}`)
      expect(code).toContain(`wss://localhost:${HTTPS_PORT}/ws/browser`)
    })
  })
  
  describe('shared state', () => {
    it('both servers share the same session ID', async () => {
      const httpRes = await fetch(`${HTTP_URL}/status`)
      const httpsRes = await fetch(`${HTTPS_URL}/status`, {
        // @ts-ignore
        tls: { rejectUnauthorized: false }
      })
      
      const httpData = await httpRes.json()
      const httpsData = await httpsRes.json()
      
      expect(httpData.serverSessionId).toBe(httpsData.serverSessionId)
    })
  })
})
