/**
 * Both Mode Tests
 * 
 * Tests that --both mode runs both HTTP and HTTPS servers correctly.
 * Run with: bun test packages/tosijs-dev/src/both-mode.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort, waitForServer, SERVER_START_HOOK_MS } from './test-support'

// Spawned servers register themselves in the instance registry. Point them at a
// throwaway dir: otherwise a transient test server lands in the developer's real
// ~/.haltija/servers/ and — same cwd, newer startedAt — out-ranks their actual dev
// server on a cwd match, so `hj` in this repo silently drives a browserless test
// server. Set before any spawn; sessions.ts resolves the dir per call.
isolateTestMachineState()


const HTTP_PORT = uniqueTestPort()
const HTTPS_PORT = uniqueTestPort()
const HTTP_URL = `http://localhost:${HTTP_PORT}`
const HTTPS_URL = `https://localhost:${HTTPS_PORT}`

let serverProcess: Subprocess | null = null

beforeAll(async () => {
  // Start server in both mode
  serverProcess = spawn({
    // The SHIPPED launcher, not the unshipped bin/tosijs-dev.ts twin (#1080).
    cmd: ['bun', 'bin/tosijs-dev.mjs', '--server', '--both'],
    cwd: import.meta.dir + '/..',
    env: { 
      ...process.env, 
      DEV_CHANNEL_PORT: String(HTTP_PORT),
      DEV_CHANNEL_HTTPS_PORT: String(HTTPS_PORT),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  
  await waitForServer(HTTP_URL, serverProcess)
  await waitForServer(HTTPS_URL, serverProcess)
}, SERVER_START_HOOK_MS)

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
