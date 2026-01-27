/**
 * HTTPS Mode Tests
 * 
 * Tests that HTTPS mode works correctly with auto-generated certs.
 * Run with: bun test packages/tosijs-dev/src/https.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'

const HTTPS_PORT = 8702 // Use different port for HTTPS tests
const HTTPS_URL = `https://localhost:${HTTPS_PORT}`

let serverProcess: Subprocess | null = null

beforeAll(async () => {
  // Start server in HTTPS mode
  serverProcess = spawn({
    cmd: ['bun', 'run', 'bin/tosijs-dev.ts', '--https'],
    cwd: import.meta.dir + '/..',
    env: { 
      ...process.env, 
      DEV_CHANNEL_HTTPS_PORT: String(HTTPS_PORT),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  
  // Wait for server to be ready (need to ignore cert errors)
  let ready = false
  for (let i = 0; i < 30 && !ready; i++) {
    try {
      const res = await fetch(`${HTTPS_URL}/status`, {
        // @ts-ignore - Bun supports this
        tls: { rejectUnauthorized: false }
      })
      if (res.ok) ready = true
    } catch {
      await new Promise(r => setTimeout(r, 200))
    }
  }
  
  if (!ready) {
    throw new Error('HTTPS server failed to start')
  }
}, 15000) // Longer timeout for cert generation

afterAll(() => {
  serverProcess?.kill()
})

// Helper to fetch with self-signed cert
async function fetchHttps(path: string) {
  return fetch(`${HTTPS_URL}${path}`, {
    // @ts-ignore - Bun supports this
    tls: { rejectUnauthorized: false }
  })
}

describe('tosijs-dev HTTPS mode', () => {
  describe('GET /status', () => {
    it('returns server status over HTTPS', async () => {
      const res = await fetchHttps('/status')
      expect(res.ok).toBe(true)
      
      const data = await res.json()
      expect(data).toHaveProperty('browsers')
      expect(data).toHaveProperty('serverVersion')
    })
  })
  
  describe('GET /inject.js', () => {
    it('contains correct HTTPS URLs for HTTPS request', async () => {
      const res = await fetchHttps('/inject.js')
      expect(res.ok).toBe(true)
      
      const code = await res.text()
      
      // Should contain https:// URLs since we're requesting over HTTPS
      expect(code).toContain(`https://localhost:${HTTPS_PORT}`)
      expect(code).toContain(`wss://localhost:${HTTPS_PORT}/ws/browser`)
      // Should NOT contain http:// URLs
      expect(code).not.toContain('http://localhost')
      expect(code).not.toContain('ws://localhost:')
    })
  })
  
  describe('GET /docs', () => {
    it('returns hj CLI docs over HTTPS', async () => {
      const res = await fetchHttps('/docs')
      expect(res.ok).toBe(true)
      
      const docs = await res.text()
      expect(docs).toContain('hj status')
      expect(docs).toContain('hj tree')
    })
  })
  
  describe('GET /api', () => {
    it('returns API reference over HTTPS', async () => {
      const res = await fetchHttps('/api')
      expect(res.ok).toBe(true)
      
      const api = await res.text()
      expect(api).toContain('API Reference')
    })
  })
})
