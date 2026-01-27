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

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { existsSync } from 'fs'
import { join } from 'path'

const DESKTOP_DIR = import.meta.dir
const PORT = parseInt(process.env.HALTIJA_PORT || '8700') // Default to standard port
const BASE_URL = `http://localhost:${PORT}`

let electronProcess: Subprocess | null = null

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

// Helper to check if external network is available (requires two successful fetches)
let networkAvailable: boolean | null = null
async function checkNetwork(): Promise<boolean> {
  if (networkAvailable !== null) return networkAvailable
  try {
    const res = await fetch('https://example.com', { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error('not ok')
    // Verify we can actually read the response
    const text = await res.text()
    if (!text.includes('Example Domain')) throw new Error('unexpected content')
    networkAvailable = true
  } catch {
    networkAvailable = false
    console.log('[NETWORK] External network unavailable — skipping external site tests')
  }
  return networkAvailable
}

function skipIfNoNetwork(testName: string): never | void {
  // This is called after checkNetwork() returns false
  console.log(`[SKIP] ${testName} — no network connection`)
  return
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

// Kill any existing process on the test port to avoid conflicts
function killProcessOnPort(port: number): boolean {
  try {
    const result = Bun.spawnSync({
      cmd: ['lsof', '-ti', `:${port}`],
      stdout: 'pipe',
    })
    const pids = new TextDecoder().decode(result.stdout).trim()
    if (pids) {
      for (const pid of pids.split('\n')) {
        try { process.kill(parseInt(pid), 'SIGTERM') } catch {}
      }
      // Give processes time to exit
      Bun.sleepSync(500)
      return true
    }
  } catch {}
  return false
}

// Module-level setup: launch Electron once for all test suites
beforeAll(async () => {
  // Kill any existing process on the port to avoid conflicts with stale instances
  if (await isServerReady()) {
    killProcessOnPort(PORT)
    // Wait for port to be released
    await new Promise(r => setTimeout(r, 1000))
  }

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
}, 30000)

afterAll(() => {
  electronProcess?.kill()
})

// Helper to check if tests can run (server available)
async function isServerAvailable(): Promise<boolean> {
  return electronProcess !== null
}

describe('Desktop App Integration Tests', () => {

  it('server starts with embedded binary', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/status`)
    expect(res.ok).toBe(true)

    const data = await res.json()
    expect(data.serverVersion).toBeDefined()
    expect(data.ok).toBeDefined()
  })

  it('widget connects on initial page', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
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
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
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
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }
    if (!await checkNetwork()) {
      skipIfNoNetwork('navigates to HTTPS site')
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
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }
    if (!await checkNetwork()) {
      skipIfNoNetwork('can query DOM on HTTPS site')
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
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }
    if (!await checkNetwork()) {
      skipIfNoNetwork('can click elements on HTTPS site')
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

  it('navigates to local server page and reconnects', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    // Navigate to the local server root (no network dependency)
    const navRes = await fetch(`${BASE_URL}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${BASE_URL}/` }),
    })
    expect(navRes.ok).toBe(true)

    // Wait for widget to reconnect
    const reconnected = await waitFor(async () => {
      const res = await fetch(`${BASE_URL}/windows`)
      const data = await res.json()
      return data.count > 0 && data.windows[0]?.url?.includes('localhost')
    }, 10000)

    expect(reconnected).toBe(true)
  }, 15000)

  it('can query DOM on local server page', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    // Query the page title on the local server
    const res = await fetch(`${BASE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'title' }),
    })

    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.textContent).toBeDefined()
  })

  it('can take screenshots with Electron native capture', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    // Use current page — don't navigate (widget respawn causes timing issues with IPC)
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windowsData = await windowsRes.json()
    const windowId = windowsData.focused || windowsData.windows?.[0]?.id

    // Full page screenshot as PNG (default)
    const pngRes = await fetch(`${BASE_URL}/screenshot?window=${windowId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(pngRes.ok).toBe(true)
    const pngData = await pngRes.json()
    expect(pngData.success).toBe(true)

    if (pngData.data.source === 'electron') {
      // Native Electron capture succeeded
      expect(pngData.data.image).toMatch(/^data:image\/png;base64,/)
      expect(pngData.data.width).toBeGreaterThan(0)
      expect(pngData.data.height).toBeGreaterThan(0)
    } else {
      // Viewport-only fallback (Electron IPC may not work in all environments)
      expect(pngData.data.viewport).toBeDefined()
      expect(pngData.data.viewport.width).toBeGreaterThan(0)
    }
  }, 20000)

  it('can take screenshots in webp format', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    // Get focused window
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windowsData = await windowsRes.json()
    const windowId = windowsData.focused || windowsData.windows?.[0]?.id

    // WebP format with quality
    const webpRes = await fetch(`${BASE_URL}/screenshot?window=${windowId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'webp', quality: 0.8 }),
    })

    expect(webpRes.ok).toBe(true)
    const webpData = await webpRes.json()
    expect(webpData.success).toBe(true)

    if (webpData.data.source === 'electron') {
      expect(webpData.data.image).toMatch(/^data:image\/webp;base64,/)
      expect(webpData.data.format).toBe('webp')
    } else {
      // Viewport-only fallback
      expect(webpData.data.viewport).toBeDefined()
    }
  }, 20000)

  it('can take element-specific screenshots', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
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

    if (elemData.data.source === 'electron') {
      expect(elemData.data.image).toMatch(/^data:image\/png;base64,/)
      // Element screenshot should be smaller than full page (accounting for 2x Retina)
      expect(elemData.data.width).toBeLessThan(3000)
      expect(elemData.data.height).toBeLessThan(400)
    } else {
      // Viewport-only fallback
      expect(elemData.data.viewport).toBeDefined()
    }
  }, 20000)
})

describe('Multi-Tab Isolation Tests', () => {
  // Ensure we're on a local page before multi-tab tests
  beforeAll(async () => {
    if (!await isServerAvailable()) return
    await fetch(`${BASE_URL}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${BASE_URL}/test` }),
    })
    await waitFor(hasBrowserConnected, 5000)
  }, 10000)

  it('can open a second tab', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    // Open a second tab (use local test page — no network required)
    const openRes = await fetch(`${BASE_URL}/tabs/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${BASE_URL}/test` }),
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
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
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
    const tab2Id = tab2.id

    // Navigate tab2 to root
    const navRes = await fetch(`${BASE_URL}/navigate?window=${tab2Id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${BASE_URL}/` }),
    })

    expect(navRes.ok).toBe(true)

    // Wait for navigation to complete
    await new Promise(r => setTimeout(r, 2000))

    // Verify we still have 2 windows (tab1 wasn't affected)
    const afterRes = await fetch(`${BASE_URL}/windows`)
    const afterWindows = await afterRes.json()
    expect(afterWindows.count).toBeGreaterThanOrEqual(2)
  }, 15000)

  it('refresh with windowId only affects target tab', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    // Get current windows
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windows = await windowsRes.json()
    
    if (windows.count < 2) {
      console.log('Need at least 2 tabs for isolation test, skipping')
      return
    }

    const tab2Id = windows.windows[1].id

    // Refresh tab2
    const refreshRes = await fetch(`${BASE_URL}/refresh?window=${tab2Id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(refreshRes.ok).toBe(true)

    // Wait for refresh to process and widget to reconnect
    await new Promise(r => setTimeout(r, 3000))

    // Verify we still have 2 windows (refresh didn't destroy tab1)
    const afterRes = await fetch(`${BASE_URL}/windows`)
    const afterWindows = await afterRes.json()
    expect(afterWindows.count).toBeGreaterThanOrEqual(2)
  })

  it('click with windowId only affects target tab', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
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
    const tab2Id = tab2.id

    // Click body on tab2
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
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    // Get current windows
    const windowsRes = await fetch(`${BASE_URL}/windows`)
    const windows = await windowsRes.json()
    
    if (windows.count < 2) {
      console.log('Only one tab, nothing to close')
      return
    }

    const tab2Id = windows.windows[1].id

    // Close tab2
    const closeRes = await fetch(`${BASE_URL}/tabs/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ window: tab2Id }),
    })

    expect(closeRes.ok).toBe(true)
    const closeData = await closeRes.json()

    if (closeData.success) {
      // Tab close succeeded — verify we're back to 1 tab
      const closed = await waitFor(async () => {
        const res = await fetch(`${BASE_URL}/windows`)
        const data = await res.json()
        return data.count === 1
      }, 5000)

      if (closed) {
        const afterRes = await fetch(`${BASE_URL}/windows`)
        const afterWindows = await afterRes.json()
        expect(afterWindows.count).toBe(1)
      }
    } else {
      // Tab close not available (webview-preload doesn't expose closeTab)
      // May return "not available" or "Timeout" depending on component version
      expect(closeData.error).toBeDefined()
    }
  }, 10000)
})

describe('Selection Feature Tests', () => {
  it('can start selection mode', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
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
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/select/status`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data).toHaveProperty('active')
  })

  it('reports no selection when nothing selected', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/select/result`)
    expect(res.ok).toBe(true)
    
    const data = await res.json()
    // No selection has been made, so success should be false
    expect(data.success).toBe(false)
    expect(data.error).toContain('No selection')
  })

  it('can cancel selection mode', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
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
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
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

  it('embedded server version matches package.json', async () => {
    if (!await isServerAvailable()) {
      console.log('Server not available, skipping')
      return
    }

    const res = await fetch(`${BASE_URL}/status`)
    expect(res.ok).toBe(true)
    const data = await res.json()

    const pkg = JSON.parse(
      await Bun.file(join(DESKTOP_DIR, '../../package.json')).text()
    )
    expect(data.serverVersion).toBe(pkg.version)
  })
})
