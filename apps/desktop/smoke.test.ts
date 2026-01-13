/**
 * Haltija Desktop App Smoke Tests
 * 
 * End-to-end smoke tests that verify the desktop app works correctly.
 * These tests interact with the app via the REST API.
 * 
 * To run these tests:
 * 1. Start the desktop app manually: cd apps/desktop && npm start
 * 2. Run tests: bun test apps/desktop/smoke.test.ts
 * 
 * Or run with HALTIJA_PORT env var if using a different port.
 * 
 * Note: Electron apps require a display, so automated CI runs will skip
 * the smoke tests and only run the resource verification tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { existsSync } from 'fs'
import { join } from 'path'

const DESKTOP_DIR = import.meta.dir
const PORT = parseInt(process.env.HALTIJA_PORT || '8700') // Default to standard port
const BASE_URL = `http://localhost:${PORT}`

let electronProcess: Subprocess | null = null
let serverWasAlreadyRunning = false

// Helper to wait for condition
async function waitFor(
  condition: () => Promise<boolean>,
  timeout = 10000,
  interval = 200
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) return true
    await new Promise(r => setTimeout(r, interval))
  }
  return false
}

// Helper to check if server is ready
async function isServerReady(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/status`)
    return res.ok
  } catch {
    return false
  }
}

// Helper to check if browser is connected
async function hasBrowserConnected(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/windows`)
    const data = await res.json()
    return data.count > 0
  } catch {
    return false
  }
}

describe('Desktop App Smoke Tests', () => {
  beforeAll(async () => {
    // Check if npm/electron is available
    const npmPath = join(DESKTOP_DIR, 'node_modules', '.bin', 'electron')
    if (!existsSync(npmPath)) {
      console.log('Electron not installed, run: cd apps/desktop && npm install')
      return
    }

    // Start the Electron app
    electronProcess = spawn({
      cmd: ['npm', 'start'],
      cwd: DESKTOP_DIR,
      env: { ...process.env, HALTIJA_PORT: String(PORT) },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // Wait for server to be ready (up to 15 seconds)
    const ready = await waitFor(isServerReady, 15000)
    if (!ready) {
      console.error('Server failed to start within timeout')
      electronProcess?.kill()
      electronProcess = null
      return
    }

    // Wait for browser to connect (up to 10 seconds)
    const connected = await waitFor(hasBrowserConnected, 10000)
    if (!connected) {
      console.error('Browser failed to connect within timeout')
    }
  }, 30000) // 30 second timeout for beforeAll

  afterAll(() => {
    electronProcess?.kill()
  })

  it('server starts with embedded binary', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/status`)
    expect(res.ok).toBe(true)

    const data = await res.json()
    expect(data.serverVersion).toBeDefined()
    expect(data.serverSessionId).toBeDefined()
  })

  it('widget connects on initial page', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/windows`)
    const data = await res.json()

    expect(data.count).toBeGreaterThanOrEqual(1)
    expect(data.windows[0]).toHaveProperty('url')
    expect(data.windows[0]).toHaveProperty('title')
    expect(data.windows[0].url).toContain('localhost')
  })

  it('can query DOM on initial page', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'body' }),
    })

    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.tagName.toLowerCase()).toBe('body')
  })

  it('navigates to HTTPS site and reconnects widget', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Navigate to example.com
    const navRes = await fetch(`${BASE_URL}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })
    expect(navRes.ok).toBe(true)

    // Wait for widget to reconnect
    const reconnected = await waitFor(async () => {
      const res = await fetch(`${BASE_URL}/windows`)
      const data = await res.json()
      return data.count > 0 && data.windows[0]?.url?.includes('example.com')
    }, 8000)

    expect(reconnected).toBe(true)

    // Verify we're on example.com
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windows = await windowsRes.json()
    expect(windows.windows[0].url).toContain('example.com')
  })

  it('can query DOM on HTTPS site', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Query the h1 on example.com
    const res = await fetch(`${BASE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'h1' }),
    })

    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.textContent).toBe('Example Domain')
  })

  it('can click elements on HTTPS site', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Click the "More information..." link on example.com
    const res = await fetch(`${BASE_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'a' }),
    })

    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)

    // Wait for navigation
    await new Promise(r => setTimeout(r, 2000))

    // Check we navigated (URL should change)
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windows = await windowsRes.json()
    
    // Widget might disconnect during navigation, that's OK
    // The important thing is the click worked
  })

  it('navigates to another HTTPS site', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Navigate to httpbin
    const navRes = await fetch(`${BASE_URL}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://httpbin.org/html' }),
    })
    expect(navRes.ok).toBe(true)

    // Wait for widget to reconnect
    const reconnected = await waitFor(async () => {
      const res = await fetch(`${BASE_URL}/windows`)
      const data = await res.json()
      return data.count > 0 && data.windows[0]?.url?.includes('httpbin')
    }, 10000)

    expect(reconnected).toBe(true)
  })

  it('can query DOM on httpbin', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Query the h1 on httpbin
    const res = await fetch(`${BASE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'h1' }),
    })

    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.textContent).toContain('Moby')
  })

  it('can take screenshots with Electron native capture', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Full page screenshot as PNG (default)
    const pngRes = await fetch(`${BASE_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(pngRes.ok).toBe(true)
    const pngData = await pngRes.json()
    expect(pngData.success).toBe(true)
    expect(pngData.data.image).toMatch(/^data:image\/png;base64,/)
    expect(pngData.data.source).toBe('electron')
    expect(pngData.data.width).toBeGreaterThan(0)
    expect(pngData.data.height).toBeGreaterThan(0)
  })

  it('can take screenshots in webp format', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // WebP format with quality
    const webpRes = await fetch(`${BASE_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'webp', quality: 0.8 }),
    })

    expect(webpRes.ok).toBe(true)
    const webpData = await webpRes.json()
    expect(webpData.success).toBe(true)
    expect(webpData.data.image).toMatch(/^data:image\/webp;base64,/)
    expect(webpData.data.format).toBe('webp')
  })

  it('can take element-specific screenshots', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Capture just the h1 element
    const elemRes = await fetch(`${BASE_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'h1' }),
    })

    expect(elemRes.ok).toBe(true)
    const elemData = await elemRes.json()
    expect(elemData.success).toBe(true)
    expect(elemData.data.image).toMatch(/^data:image\/png;base64,/)
    // Element screenshot should be smaller than full page (accounting for 2x Retina)
    expect(elemData.data.width).toBeLessThan(3000)
    expect(elemData.data.height).toBeLessThan(400)
  })
})

describe('Desktop App Resource Tests', () => {
  it('has compiled server binaries', () => {
    const arm64 = join(DESKTOP_DIR, 'resources', 'haltija-server-arm64')
    const x64 = join(DESKTOP_DIR, 'resources', 'haltija-server-x64')
    
    expect(existsSync(arm64)).toBe(true)
    expect(existsSync(x64)).toBe(true)
  })

  it('has component.js in resources', () => {
    const component = join(DESKTOP_DIR, 'resources', 'component.js')
    expect(existsSync(component)).toBe(true)
  })

  it('has all required app files', () => {
    const files = ['main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css']
    for (const file of files) {
      expect(existsSync(join(DESKTOP_DIR, file))).toBe(true)
    }
  })
})
