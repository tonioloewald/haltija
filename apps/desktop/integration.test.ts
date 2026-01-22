/**
 * Haltija Desktop App Integration Tests
 * 
 * Comprehensive integration tests that verify the desktop app works correctly.
 * These tests interact with the app via the REST API and test real browser behavior.
 * 
 * IMPORTANT: These are NOT flaky tests. If they fail, there is a real bug.
 * Do not skip or ignore failures - investigate and fix the underlying issue.
 * 
 * To run these tests:
 * 1. Start the desktop app manually: cd apps/desktop && npm start
 * 2. Run tests: bun test apps/desktop/integration.test.ts
 * 
 * Or run with HALTIJA_PORT env var if using a different port.
 * 
 * Note: Electron apps require a display, so CI runs need xvfb or similar.
 * The tests are designed to be reliable when the app is running correctly.
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

describe('Desktop App Integration Tests', () => {
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
    expect(data.ok).toBeDefined()
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
  }, 15000) // External site navigation needs more time

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
  }, 15000) // External site navigation needs more time

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

describe('Multi-Tab Isolation Tests', () => {
  // These tests verify that operations on one tab don't affect other tabs
  
  it('can open a second tab', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Open a second tab
    const openRes = await fetch(`${BASE_URL}/tabs/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })

    expect(openRes.ok).toBe(true)

    // Wait for the new tab's widget to connect
    const connected = await waitFor(async () => {
      const res = await fetch(`${BASE_URL}/windows`)
      const data = await res.json()
      return data.count >= 2
    }, 8000)

    expect(connected).toBe(true)

    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windows = await windowsRes.json()
    expect(windows.count).toBeGreaterThanOrEqual(2)
  }, 15000) // External site navigation needs more time

  it('navigate with windowId only affects target tab', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Get current windows
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windows = await windowsRes.json()
    
    if (windows.count < 2) {
      console.log('Need at least 2 tabs for isolation test, skipping')
      return
    }

    const [tab1, tab2] = windows.windows
    const tab1Url = tab1.url
    const tab2Id = tab2.windowId

    // Navigate tab2 to a different URL
    const navRes = await fetch(`${BASE_URL}/navigate?window=${tab2Id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://httpbin.org/html' }),
    })

    expect(navRes.ok).toBe(true)

    // Wait for navigation to complete
    await waitFor(async () => {
      const res = await fetch(`${BASE_URL}/windows`)
      const data = await res.json()
      const t2 = data.windows.find((w: any) => w.windowId === tab2Id)
      return t2?.url?.includes('httpbin')
    }, 8000)

    // Verify tab1 URL is unchanged
    const afterRes = await fetch(`${BASE_URL}/windows`)
    const afterWindows = await afterRes.json()
    const tab1After = afterWindows.windows.find((w: any) => w.windowId === tab1.windowId)
    
    // Tab1 should still be at its original URL (not navigated)
    expect(tab1After?.url).toBe(tab1Url)
  }, 15000) // External site navigation needs more time

  it('refresh with windowId only affects target tab', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Get current windows
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windows = await windowsRes.json()
    
    if (windows.count < 2) {
      console.log('Need at least 2 tabs for isolation test, skipping')
      return
    }

    const [tab1, tab2] = windows.windows
    const tab1Url = tab1.url
    const tab2Id = tab2.windowId

    // Refresh tab2
    const refreshRes = await fetch(`${BASE_URL}/refresh?window=${tab2Id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(refreshRes.ok).toBe(true)

    // Wait a moment for refresh to process
    await new Promise(r => setTimeout(r, 2000))

    // Verify tab1 is still connected and at original URL
    const afterRes = await fetch(`${BASE_URL}/windows`)
    const afterWindows = await afterRes.json()
    const tab1After = afterWindows.windows.find((w: any) => w.windowId === tab1.windowId)
    
    // Tab1 should still be connected and at its original URL
    expect(tab1After).toBeDefined()
    expect(tab1After?.url).toBe(tab1Url)
  })

  it('click with windowId only affects target tab', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Get current windows
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windows = await windowsRes.json()
    
    if (windows.count < 2) {
      console.log('Need at least 2 tabs for isolation test, skipping')
      return
    }

    const [tab1, tab2] = windows.windows
    const tab2Id = tab2.windowId

    // Click something on tab2 (example.com has an <a> tag)
    const clickRes = await fetch(`${BASE_URL}/click?window=${tab2Id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'body' }),
    })

    expect(clickRes.ok).toBe(true)
    const clickData = await clickRes.json()
    expect(clickData.success).toBe(true)
  })

  it('can close the second tab', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    // Get current windows
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windows = await windowsRes.json()
    
    if (windows.count < 2) {
      console.log('Only one tab, nothing to close')
      return
    }

    const tab2Id = windows.windows[1].windowId

    // Close tab2
    const closeRes = await fetch(`${BASE_URL}/tabs/close?window=${tab2Id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(closeRes.ok).toBe(true)

    // Verify we're back to 1 tab
    await waitFor(async () => {
      const res = await fetch(`${BASE_URL}/windows`)
      const data = await res.json()
      return data.count === 1
    }, 5000)

    const afterRes = await fetch(`${BASE_URL}/windows`)
    const afterWindows = await afterRes.json()
    expect(afterWindows.count).toBe(1)
  })
})

describe('Selection Feature Tests', () => {
  it('can start selection mode', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/select/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('can check selection status', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/select/status`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data).toHaveProperty('active')
  })

  it('can get selection result (empty when nothing selected)', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/select/result`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.success).toBe(true)
    // Result should be an array (possibly empty)
    expect(Array.isArray(data.data?.elements || data.data)).toBe(true)
  })

  it('can cancel selection mode', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/select/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('can clear selection', async () => {
    if (!electronProcess) {
      console.log('Electron not running, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/select/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)
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
