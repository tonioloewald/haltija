/**
 * Integration tests for HALTIJA_TOKEN auth gating.
 * Spawns a haltija server subprocess with HALTIJA_TOKEN set and verifies
 * that REST and WebSocket endpoints reject mismatched/missing tokens.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

// Spawned servers register themselves in the instance registry. Point them at a
// throwaway dir: otherwise a transient test server lands in the developer's real
// ~/.haltija/servers/ and — same cwd, newer startedAt — out-ranks their actual dev
// server on a cwd match, so `hj` in this repo silently drives a browserless test
// server. Set before any spawn; sessions.ts resolves the dir per call.
isolateTestMachineState()


const PORT = uniqueTestPort() // Avoid collision with src/server.test.ts (8701) and the dev default (8700).
const TOKEN = 'unit-test-secret-token-9f3c'
const BASE_URL = `http://localhost:${PORT}`

let serverProcess: Subprocess | null = null

beforeAll(async () => {
  serverProcess = spawn({
    cmd: ['bun', 'run', 'bin/server.ts'],
    cwd: import.meta.dir + '/..',
    env: { ...process.env, DEV_CHANNEL_PORT: String(PORT), HALTIJA_TOKEN: TOKEN },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for server to be ready — /status itself is gated, so probe with a token.
  let ready = false
  for (let i = 0; i < 30 && !ready; i++) {
    try {
      const res = await fetch(`${BASE_URL}/status`, { headers: { 'X-Haltija-Token': TOKEN } })
      if (res.ok) ready = true
    } catch {
      await new Promise(r => setTimeout(r, 100))
    }
  }
  if (!ready) throw new Error('Token-gated server failed to start')
})

afterAll(() => {
  serverProcess?.kill()
})

describe('REST gating with HALTIJA_TOKEN', () => {
  it('rejects requests with no token (401)', async () => {
    const res = await fetch(`${BASE_URL}/status`)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toMatch(/X-Haltija-Token/i)
  })

  it('rejects requests with the wrong token (401)', async () => {
    const res = await fetch(`${BASE_URL}/status`, {
      headers: { 'X-Haltija-Token': 'wrong-secret' },
    })
    expect(res.status).toBe(401)
  })

  it('accepts requests with the correct header token', async () => {
    const res = await fetch(`${BASE_URL}/status`, {
      headers: { 'X-Haltija-Token': TOKEN },
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data).toHaveProperty('serverVersion')
  })

  it('accepts requests with the correct ?token= query param', async () => {
    // Convenience for users who can't easily set custom headers (e.g. browser fetch).
    const res = await fetch(`${BASE_URL}/status?token=${TOKEN}`)
    expect(res.ok).toBe(true)
  })

  it('exempts /component.js so the widget can bootstrap', async () => {
    const res = await fetch(`${BASE_URL}/component.js`)
    expect(res.ok).toBe(true)
    const body = await res.text()
    // Sanity: looks like the bundle.
    expect(body.length).toBeGreaterThan(1000)
  })

  it('exempts /inject.js so the bookmarklet can bootstrap', async () => {
    const res = await fetch(`${BASE_URL}/inject.js`)
    expect(res.ok).toBe(true)
  })

  it('rejects POST requests with no token (401)', async () => {
    const res = await fetch(`${BASE_URL}/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '1+1' }),
    })
    expect(res.status).toBe(401)
  })

  it('advertises X-Haltija-Token in CORS Allow-Headers', async () => {
    const res = await fetch(`${BASE_URL}/status`, { method: 'OPTIONS' })
    const allow = res.headers.get('Access-Control-Allow-Headers') || ''
    expect(allow).toMatch(/X-Haltija-Token/i)
  })
})

describe('WebSocket gating with HALTIJA_TOKEN', () => {
  it('rejects WebSocket upgrade without token (401)', async () => {
    const res = await fetch(`${BASE_URL}/ws/browser`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects WebSocket upgrade with wrong token (401)', async () => {
    const res = await fetch(`${BASE_URL}/ws/browser?token=wrong`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    })
    expect(res.status).toBe(401)
  })

  it('accepts WebSocket upgrade with correct ?token=', async () => {
    // Open an actual WebSocket — Bun's server completes the upgrade only
    // when this is a real WebSocket handshake.
    const ws = new WebSocket(`ws://localhost:${PORT}/ws/browser?token=${TOKEN}`)
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true)
      ws.onerror = () => resolve(false)
      setTimeout(() => resolve(false), 2000)
    })
    expect(opened).toBe(true)
    ws.close()
  })

  it('rejects WebSocket upgrade with wrong ?token= via real handshake', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws/browser?token=wrong`)
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true)
      ws.onerror = () => resolve(false)
      setTimeout(() => resolve(false), 2000)
    })
    expect(opened).toBe(false)
  })
})
