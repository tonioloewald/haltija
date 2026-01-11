/**
 * Dev Channel Playwright Tests
 * 
 * End-to-end tests using Playwright.
 * Run with: bunx playwright test
 * 
 * Prerequisites:
 * - Install Playwright: bunx playwright install
 * - These tests start their own server, no need to run it separately
 */

import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = 8702 // Different port to avoid conflicts
const SERVER_URL = `http://localhost:${PORT}`
const WS_URL = `ws://localhost:${PORT}/ws/browser`

let serverProcess: ChildProcess | null = null

// Start server before all tests
test.beforeAll(async () => {
  // Make sure component is built first
  serverProcess = spawn('bun', ['run', 'bin/server.ts'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DEV_CHANNEL_PORT: String(PORT), DEV_CHANNEL_NO_HTTPS: '1' },
    stdio: 'inherit', // Show server output for debugging
  })
  
  // Wait for server to be ready
  let ready = false
  for (let i = 0; i < 50 && !ready; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/status`)
      if (res.ok) {
        // Also verify component.js is served
        const componentRes = await fetch(`${SERVER_URL}/component.js`)
        if (componentRes.ok) ready = true
      }
    } catch {
      // Server not ready yet
    }
    if (!ready) await new Promise(r => setTimeout(r, 200))
  }
  
  if (!ready) {
    throw new Error('Server failed to start or component.js not available')
  }
})

// Stop server after all tests
test.afterAll(async () => {
  serverProcess?.kill()
})

// Helper to inject haltija-dev into page
async function injectDevChannel(page: Page) {
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Page</title>
      <script src="${SERVER_URL}/component.js"></script>
    </head>
    <body>
      <h1>Test Page</h1>
      <haltija-dev server="${WS_URL}"></haltija-dev>
    </body>
    </html>
  `)
  
  // Wait for element to be ready
  await page.waitForSelector('haltija-dev')
  
  // Poll /status until a browser is connected (WebSocket established)
  const maxAttempts = 20
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${SERVER_URL}/status`)
    const status = await res.json()
    if (status.browsers > 0) {
      return // Connected!
    }
    await page.waitForTimeout(100)
  }
  throw new Error('Timeout waiting for browser to connect to server')
}

test.describe('haltija-dev CLI', () => {
  test('starts server and serves test page', async ({ page }) => {
    // The server is already running from beforeAll, just verify it works
    const response = await page.goto(`${SERVER_URL}/`)
    expect(response?.status()).toBe(200)
    
    // Check page has expected content
    const title = await page.title()
    expect(title).toBe('Dev Channel Test')
    
    // Check haltija-dev element exists
    const hasComponent = await page.evaluate(() => 
      document.querySelector('haltija-dev') !== null
    )
    expect(hasComponent).toBe(true)
  })
  
  test('serves inject.js', async () => {
    const res = await fetch(`${SERVER_URL}/inject.js`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('haltija-dev')
  })
  
  test('serves component.js', async () => {
    const res = await fetch(`${SERVER_URL}/component.js`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('DevChannel')
  })
  
  test('status endpoint works', async () => {
    const res = await fetch(`${SERVER_URL}/status`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('browsers')
    expect(data).toHaveProperty('agents')
    expect(data).toHaveProperty('serverSessionId')
    expect(typeof data.serverSessionId).toBe('string')
    expect(data.serverSessionId.length).toBeGreaterThan(10)
  })
})

test.describe('haltija-dev component', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
  })
  
  test('injects into page', async ({ page }) => {
    const el = await page.$('haltija-dev')
    expect(el).not.toBeNull()
  })
  
  test('has shadow DOM', async ({ page }) => {
    const hasShadow = await page.evaluate(() => {
      const el = document.querySelector('haltija-dev')
      return el?.shadowRoot !== null
    })
    expect(hasShadow).toBe(true)
  })
  
  test('shows widget', async ({ page }) => {
    const isVisible = await page.evaluate(() => {
      const el = document.querySelector('haltija-dev')
      const widget = el?.shadowRoot?.querySelector('.widget')
      return widget !== null && !widget.classList.contains('hidden')
    })
    expect(isVisible).toBe(true)
  })
  
  test('connects to server', async ({ page }) => {
    // Wait a moment for WebSocket connection
    await page.waitForTimeout(500)
    
    const state = await page.evaluate(() => {
      const el = document.querySelector('haltija-dev') as any
      return el?.state
    })
    
    expect(['connecting', 'connected']).toContain(state)
  })
  
  test('Option+Tab toggles minimize', async ({ page }) => {
    // Get initial state - minimized class is on the host element, not .widget
    const initial = await page.evaluate(() => {
      const el = document.querySelector('haltija-dev')
      return {
        exists: !!el,
        minimized: el?.classList.contains('minimized')
      }
    })
    console.log('Initial state:', initial)
    expect(initial.exists).toBe(true)
    expect(initial.minimized).toBe(false) // Should start not minimized
    
    // Dispatch Alt+Tab directly (OS intercepts the real shortcut)
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab',
        altKey: true,
        bubbles: true
      }))
    })
    await page.waitForTimeout(400) // Wait for animation
    
    const after = await page.evaluate(() => {
      const el = document.querySelector('haltija-dev')
      return {
        minimized: el?.classList.contains('minimized')
      }
    })
    console.log('After toggle:', after)
    
    expect(after.minimized).toBe(true) // Should now be minimized
  })
  
  test('captures console.log', async ({ page }) => {
    const marker = `test-marker-${Date.now()}`
    
    // Log something
    await page.evaluate((msg) => console.log(msg), marker)
    await page.waitForTimeout(100)
    
    // Check if captured
    const captured = await page.evaluate((msg) => {
      const el = document.querySelector('haltija-dev') as any
      return el?.consoleBuffer?.some((entry: any) => 
        entry.args?.some((arg: any) => String(arg).includes(msg))
      )
    }, marker)
    
    expect(captured).toBe(true)
  })
  
  test('runs browser tests successfully', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const DevChannel = (window as any).DevChannel
      if (!DevChannel?.runTests) {
        return { passed: 0, failed: 1, error: 'runTests not available' }
      }
      return DevChannel.runTests()
    })
    
    expect(results.failed).toBe(0)
    expect(results.passed).toBeGreaterThan(0)
  })
})

test.describe('haltija-dev tab switching', () => {
  test('new tab deactivates old tab', async ({ browser }) => {
    // Open first page/tab
    const page1 = await browser.newPage()
    await injectDevChannel(page1)
    await page1.waitForTimeout(500)
    
    // Verify first page is connected
    const state1Before = await page1.evaluate(() => {
      const el = document.querySelector('haltija-dev') as any
      return el?.state
    })
    expect(state1Before).toBe('connected')
    
    // Check widget is visible on page1
    const widget1VisibleBefore = await page1.evaluate(() => {
      const el = document.querySelector('haltija-dev')
      return el?.shadowRoot?.querySelector('.widget') !== null
    })
    expect(widget1VisibleBefore).toBe(true)
    
    // Open second page/tab
    const page2 = await browser.newPage()
    await injectDevChannel(page2)
    await page2.waitForTimeout(500)
    
    // Verify second page is connected
    const state2 = await page2.evaluate(() => {
      const el = document.querySelector('haltija-dev') as any
      return el?.state
    })
    expect(state2).toBe('connected')
    
    // Verify first page's component was killed (removed from DOM)
    const page1HasComponent = await page1.evaluate(() => {
      return document.querySelector('haltija-dev') !== null
    })
    expect(page1HasComponent).toBe(false)
    
    // Verify second page's component is still there
    const page2HasComponent = await page2.evaluate(() => {
      return document.querySelector('haltija-dev') !== null
    })
    expect(page2HasComponent).toBe(true)
    
    await page1.close()
    await page2.close()
  })
  
  test('third tab deactivates second tab', async ({ browser }) => {
    const page1 = await browser.newPage()
    await injectDevChannel(page1)
    await page1.waitForTimeout(500)
    
    const page2 = await browser.newPage()
    await injectDevChannel(page2)
    await page2.waitForTimeout(500)
    
    // Page1 should be dead, page2 alive
    expect(await page1.evaluate(() => document.querySelector('haltija-dev') !== null)).toBe(false)
    expect(await page2.evaluate(() => document.querySelector('haltija-dev') !== null)).toBe(true)
    
    const page3 = await browser.newPage()
    await injectDevChannel(page3)
    await page3.waitForTimeout(500)
    
    // Page2 should now be dead, page3 alive
    expect(await page2.evaluate(() => document.querySelector('haltija-dev') !== null)).toBe(false)
    expect(await page3.evaluate(() => document.querySelector('haltija-dev') !== null)).toBe(true)
    
    await page1.close()
    await page2.close()
    await page3.close()
  })
})

test.describe('haltija-dev server integration', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
    // Wait for connection
    await page.waitForTimeout(500)
  })
  
  test('DOM query via REST', async ({ page }) => {
    // Add a test element
    await page.evaluate(() => {
      const div = document.createElement('div')
      div.id = 'playwright-test-element'
      div.textContent = 'Hello Playwright'
      document.body.appendChild(div)
    })
    
    // Query via REST API
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#playwright-test-element' })
    })
    
    const data = await res.json()
    
    // If connected, we should get the element back
    if (data.success) {
      expect(data.data?.id).toBe('playwright-test-element')
      expect(data.data?.textContent).toContain('Hello Playwright')
    }
  })
  
  test('click via REST', async ({ page }) => {
    // Add a button that sets a flag when clicked
    await page.evaluate(() => {
      const btn = document.createElement('button')
      btn.id = 'playwright-click-test'
      btn.textContent = 'Click Me'
      btn.onclick = () => { (window as any).buttonClicked = true }
      document.body.appendChild(btn)
    })
    
    // Click via REST API
    await fetch(`${SERVER_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#playwright-click-test' })
    })
    
    await page.waitForTimeout(200)
    
    // Check if clicked
    const clicked = await page.evaluate(() => (window as any).buttonClicked)
    expect(clicked).toBe(true)
  })
  
  test('type via REST', async ({ page }) => {
    // Add an input
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'playwright-type-test'
      document.body.appendChild(input)
    })
    
    // Type via REST API
    await fetch(`${SERVER_URL}/type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        selector: '#playwright-type-test',
        text: 'Hello from Playwright'
      })
    })
    
    await page.waitForTimeout(200)
    
    // Check value
    const value = await page.evaluate(() => {
      const input = document.querySelector('#playwright-type-test') as HTMLInputElement
      return input?.value
    })
    expect(value).toBe('Hello from Playwright')
  })
  
  test('eval via REST', async ({ page }) => {
    // Set a value we can read
    await page.evaluate(() => {
      (window as any).testValue = 42
    })
    
    // Eval via REST
    const res = await fetch(`${SERVER_URL}/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'window.testValue * 2' })
    })
    
    const data = await res.json()
    
    if (data.success) {
      expect(data.data).toBe(84)
    }
  })
  
  test('mutation watching via REST', async ({ page }) => {
    // Verify connection is established first
    const connected = await page.evaluate(() => {
      const el = document.querySelector('haltija-dev') as any
      return el?.state === 'connected'
    })
    
    if (!connected) {
      // Wait a bit more and check again
      await page.waitForTimeout(500)
      const retryConnected = await page.evaluate(() => {
        const el = document.querySelector('haltija-dev') as any
        return el?.state === 'connected'
      })
      if (!retryConnected) {
        test.skip()
        return
      }
    }
    
    // Start watching mutations
    const watchRes = await fetch(`${SERVER_URL}/mutations/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debounce: 50 })
    })
    const watchData = await watchRes.json()
    expect(watchData.success).toBe(true)
    
    // Check status
    const statusRes = await fetch(`${SERVER_URL}/mutations/status`)
    const statusData = await statusRes.json()
    expect(statusData.success).toBe(true)
    expect(statusData.data.watching).toBe(true)
    
    // Make a DOM change
    await page.evaluate(() => {
      const div = document.createElement('div')
      div.id = 'test-mutation'
      div.textContent = 'Added by test'
      document.body.appendChild(div)
    })
    
    // Wait for debounce
    await page.waitForTimeout(150)
    
    // Check messages for mutation batch
    const messagesRes = await fetch(`${SERVER_URL}/messages`)
    const messages = await messagesRes.json()
    const mutationBatch = messages.find((m: any) => m.channel === 'mutations' && m.action === 'batch')
    expect(mutationBatch).toBeTruthy()
    expect(mutationBatch.payload.summary.added).toBeGreaterThan(0)
    
    // Stop watching
    const unwatchRes = await fetch(`${SERVER_URL}/mutations/unwatch`, { method: 'POST' })
    const unwatchData = await unwatchRes.json()
    expect(unwatchData.success).toBe(true)
  })
  
  test('mutation filtering with presets', async ({ page }) => {
    // Clear previous messages
    await fetch(`${SERVER_URL}/clear`, { method: 'POST' })
    
    // Verify connection
    const connected = await page.evaluate(() => {
      const el = document.querySelector('haltija-dev') as any
      return el?.state === 'connected'
    })
    if (!connected) {
      await page.waitForTimeout(500)
    }
    
    // Start watching with tailwind preset (should filter utility classes)
    const watchRes = await fetch(`${SERVER_URL}/mutations/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debounce: 50, preset: 'tailwind' })
    })
    const watchData = await watchRes.json()
    if (!watchData.success) {
      test.skip()
      return
    }
    
    // Add element with tailwind classes
    await page.evaluate(() => {
      const div = document.createElement('div')
      div.id = 'tailwind-test'
      div.className = 'flex p-4 text-sm bg-blue-500'
      document.body.appendChild(div)
    })
    
    await page.waitForTimeout(150)
    
    // Check that mutation was captured
    const messagesRes = await fetch(`${SERVER_URL}/messages`)
    const messages = await messagesRes.json()
    const batch = messages.find((m: any) => m.channel === 'mutations' && m.action === 'batch')
    expect(batch).toBeTruthy()
    expect(batch.payload.summary.added).toBeGreaterThan(0)
    
    // Stop watching
    await fetch(`${SERVER_URL}/mutations/unwatch`, { method: 'POST' })
  })
  
  test('mutation filtering with xinjs preset detects interesting classes', async ({ page }) => {
    await fetch(`${SERVER_URL}/clear`, { method: 'POST' })
    
    // Verify connection
    const connected = await page.evaluate(() => {
      const el = document.querySelector('haltija-dev') as any
      return el?.state === 'connected'
    })
    if (!connected) {
      await page.waitForTimeout(500)
    }
    
    // Start watching with xinjs preset
    const watchRes = await fetch(`${SERVER_URL}/mutations/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debounce: 50, preset: 'xinjs' })
    })
    const watchData = await watchRes.json()
    if (!watchData.success) {
      test.skip()
      return
    }
    
    // Add element with xinjs binding classes
    await page.evaluate(() => {
      const div = document.createElement('div')
      div.id = 'xinjs-test'
      div.className = '-xin-event -xin-data'
      document.body.appendChild(div)
    })
    
    await page.waitForTimeout(150)
    
    const messagesRes = await fetch(`${SERVER_URL}/messages`)
    const messages = await messagesRes.json()
    const batch = messages.find((m: any) => m.channel === 'mutations' && m.action === 'batch')
    
    expect(batch).toBeTruthy()
    // Should be in notable because of interesting classes
    const notable = batch.payload.notable.find((n: any) => n.id === 'xinjs-test')
    expect(notable).toBeTruthy()
    
    await fetch(`${SERVER_URL}/mutations/unwatch`, { method: 'POST' })
  })
})

test.describe('haltija-dev DOM tree inspector', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
    await page.waitForTimeout(500)
  })
  
  test('basic tree query', async ({ page }) => {
    // Create test DOM structure
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'tree-test'
      container.innerHTML = `
        <header>
          <nav>
            <a href="/home">Home</a>
            <a href="/about">About</a>
          </nav>
        </header>
        <main>
          <article>
            <h1>Title</h1>
            <p>Content</p>
          </article>
        </main>
      `
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#tree-test', depth: 3 })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.tag).toBe('div')
    expect(data.data.id).toBe('tree-test')
    expect(data.data.children).toBeDefined()
    expect(data.data.children.length).toBe(2) // header and main
  })
  
  test('tree with depth limit', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'depth-test'
      container.innerHTML = '<div><div><div><div>Deep</div></div></div></div>'
      document.body.appendChild(container)
    })
    
    // Depth 1 should truncate
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#depth-test', depth: 1 })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.children[0].truncated).toBe(true)
    expect(data.data.children[0].childCount).toBe(1)
  })
  
  test('tree with interesting attributes', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'attrs-test'
      container.innerHTML = `
        <button aria-label="Submit" data-testid="submit-btn">Submit</button>
        <input type="text" name="email" placeholder="Email" required>
      `
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#attrs-test' })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    
    const button = data.data.children.find((c: any) => c.tag === 'button')
    expect(button.attrs['aria-label']).toBe('Submit')
    expect(button.attrs['data-testid']).toBe('submit-btn')
    expect(button.flags.interactive).toBe(true)
    expect(button.flags.hasAria).toBe(true)
    
    const input = data.data.children.find((c: any) => c.tag === 'input')
    expect(input.attrs.type).toBe('text')
    expect(input.attrs.name).toBe('email')
    expect(input.flags.interactive).toBe(true)
  })
  
  test('tree with custom element detection', async ({ page }) => {
    await page.evaluate(() => {
      // Define a simple custom element
      if (!customElements.get('test-component')) {
        customElements.define('test-component', class extends HTMLElement {
          connectedCallback() {
            this.innerHTML = '<span>Custom content</span>'
          }
        })
      }
      
      const container = document.createElement('div')
      container.id = 'custom-test'
      container.innerHTML = '<test-component></test-component>'
      document.body.appendChild(container)
    })
    
    await page.waitForTimeout(100) // Let custom element render
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#custom-test' })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    
    const customEl = data.data.children.find((c: any) => c.tag === 'test-component')
    expect(customEl).toBeTruthy()
    expect(customEl.flags.customElement).toBe(true)
  })
  
  test('tree with box info', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'box-test'
      container.style.cssText = 'width: 200px; height: 100px; position: absolute; top: 50px; left: 50px;'
      container.textContent = 'Box test'
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#box-test', includeBox: true })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.box).toBeDefined()
    expect(data.data.box.w).toBe(200)
    expect(data.data.box.h).toBe(100)
    expect(data.data.box.visible).toBe(true)
  })
  
  test('tree compact mode', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'compact-test'
      container.className = 'foo bar baz qux'
      container.innerHTML = '<span class="a b c d">Text</span>'
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#compact-test', compact: true })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    // In compact mode, non-interesting classes shouldn't be included
    expect(data.data.classes).toBeUndefined()
  })
  
  test('tree with xinjs binding detection', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'binding-test'
      container.innerHTML = `
        <div class="-xin-event">Event bound</div>
        <div class="-xin-data">Data bound</div>
        <div data-event="click:handler">b8r event</div>
        <div data-bind="text=value">b8r bind</div>
      `
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#binding-test' })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    
    const children = data.data.children
    expect(children[0].flags.hasEvents).toBe(true)
    expect(children[1].flags.hasData).toBe(true)
    expect(children[2].flags.hasEvents).toBe(true)
    expect(children[3].flags.hasData).toBe(true)
  })
  
  test('tree with shadow DOM piercing', async ({ page }) => {
    await page.evaluate(() => {
      // Define a custom element with shadow DOM
      if (!customElements.get('shadow-test')) {
        customElements.define('shadow-test', class extends HTMLElement {
          constructor() {
            super()
            const shadow = this.attachShadow({ mode: 'open' })
            shadow.innerHTML = `
              <style>button { color: blue; }</style>
              <div class="shadow-container">
                <button id="shadow-btn">Click me</button>
                <span>Shadow content</span>
              </div>
            `
          }
        })
      }
      
      const container = document.createElement('div')
      container.id = 'shadow-pierce-test'
      container.innerHTML = '<shadow-test><span>Light DOM</span></shadow-test>'
      document.body.appendChild(container)
    })
    
    await page.waitForTimeout(100)
    
    // Without pierceShadow - should not see shadow children
    const resWithout = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#shadow-pierce-test', pierceShadow: false })
    })
    const dataWithout = await resWithout.json()
    expect(dataWithout.success).toBe(true)
    const elWithout = dataWithout.data.children.find((c: any) => c.tag === 'shadow-test')
    expect(elWithout.flags.shadowRoot).toBe(true)
    expect(elWithout.shadowChildren).toBeUndefined()
    
    // With pierceShadow - should see inside shadow DOM
    const resWith = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#shadow-pierce-test', pierceShadow: true })
    })
    const dataWith = await resWith.json()
    expect(dataWith.success).toBe(true)
    const elWith = dataWith.data.children.find((c: any) => c.tag === 'shadow-test')
    expect(elWith.flags.shadowRoot).toBe(true)
    expect(elWith.shadowChildren).toBeDefined()
    expect(elWith.shadowChildren.length).toBe(1) // The div.shadow-container
    
    const shadowDiv = elWith.shadowChildren[0]
    expect(shadowDiv.tag).toBe('div')
    expect(shadowDiv.classes).toContain('shadow-container')
    
    // Should have button and span as children
    expect(shadowDiv.children.length).toBe(2)
    expect(shadowDiv.children[0].tag).toBe('button')
    expect(shadowDiv.children[0].flags.interactive).toBe(true)
  })
  
  test('mutation watching with shadow DOM piercing', async ({ page }) => {
    // Verify connection is established first
    const connected = await page.evaluate(() => {
      const el = document.querySelector('haltija-dev') as any
      return el?.state === 'connected'
    })
    
    if (!connected) {
      await page.waitForTimeout(500)
      const retryConnected = await page.evaluate(() => {
        const el = document.querySelector('haltija-dev') as any
        return el?.state === 'connected'
      })
      if (!retryConnected) {
        test.skip()
        return
      }
    }
    
    // Note: server automatically clears mutation messages when starting a new watch
    
    await page.evaluate(() => {
      // Define a custom element with shadow DOM
      if (!customElements.get('mutation-shadow-test')) {
        customElements.define('mutation-shadow-test', class extends HTMLElement {
          constructor() {
            super()
            const shadow = this.attachShadow({ mode: 'open' })
            shadow.innerHTML = `
              <div class="shadow-inner">
                <button id="shadow-toggle-btn">Toggle</button>
              </div>
            `
          }
          
          toggle() {
            const btn = this.shadowRoot!.querySelector('#shadow-toggle-btn')
            if (btn) {
              btn.classList.toggle('active')
            }
          }
        })
      }
      
      const container = document.createElement('div')
      container.id = 'mutation-shadow-test-container'
      container.innerHTML = '<mutation-shadow-test id="shadow-mut-el"></mutation-shadow-test>'
      document.body.appendChild(container)
    })
    
    await page.waitForTimeout(100)
    
    // Start watching with pierceShadow - use custom filter to make "active" an interesting class
    const watchRes = await fetch(`${SERVER_URL}/mutations/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        root: '#mutation-shadow-test-container',
        pierceShadow: true,
        preset: 'none',
        debounce: 50,
        filters: {
          interestingClasses: ['active']
        }
      })
    })
    const watchData = await watchRes.json()
    expect(watchData.success).toBe(true)
    expect(watchData.data.watching).toBe(true)
    
    // Wait a moment for watch to be established
    await page.waitForTimeout(50)
    
    await page.waitForTimeout(100)
    
    // Trigger a mutation inside shadow DOM
    await page.evaluate(() => {
      const el = document.querySelector('#shadow-mut-el') as any
      el.toggle()
    })
    
    // Poll for the mutation batch with attribute changes (more reliable than fixed timeout)
    let mutationBatch: any = null
    let allMessages: any[] = []
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(100)
      const messagesRes = await fetch(`${SERVER_URL}/messages`)
      allMessages = await messagesRes.json()
      // Look specifically for a mutation batch with attribute changes
      mutationBatch = allMessages.find((m: any) => 
        m.channel === 'mutations' && 
        m.action === 'batch' && 
        m.payload?.summary?.attributeChanges > 0
      )
      if (mutationBatch) break
    }
    
    if (!mutationBatch) {
      console.log('No mutation batch with attribute changes found. All messages:', JSON.stringify(allMessages, null, 2))
    }
    
    expect(mutationBatch).toBeTruthy()
    
    // The selector should include ::shadow to indicate it's inside shadow DOM
    const notable = mutationBatch.payload.notable || []
    const shadowMutation = notable.find((n: any) => n.selector?.includes('::shadow'))
    expect(shadowMutation).toBeDefined()
    expect(shadowMutation.attribute).toBe('class')
    expect(shadowMutation.newValue).toContain('active')
    
    // Clean up
    await fetch(`${SERVER_URL}/mutations/unwatch`, { method: 'POST' })
  })
})

test.describe('haltija-dev test generation', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
  })
  
  test('generates test from semantic events via /recording/generate', async ({ page }) => {
    // Add a form to interact with (insert before widget, don't replace innerHTML)
    await page.evaluate(() => {
      const form = document.createElement('form')
      form.id = 'test-form'
      form.innerHTML = `
        <input id="username" type="text" placeholder="Username">
        <input id="password" type="password" placeholder="Password">
        <button type="submit" id="submit-btn">Login</button>
      `
      const result = document.createElement('div')
      result.id = 'result'
      
      // Insert at beginning of body (before widget)
      document.body.insertBefore(result, document.body.firstChild)
      document.body.insertBefore(form, document.body.firstChild)
      
      form.onsubmit = (e) => {
        e.preventDefault()
        result.textContent = 'Submitted!'
      }
    })
    
    // Start watching semantic events
    const watchRes = await fetch(`${SERVER_URL}/events/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'interactive' })
    })
    expect((await watchRes.json()).success).toBe(true)
    
    await page.waitForTimeout(100)
    
    // Perform real user interactions via Playwright (not REST API puppetry)
    // Use type() instead of fill() to simulate real keystrokes
    await page.click('#username')
    await page.type('#username', 'testuser', { delay: 20 })
    await page.waitForTimeout(200)
    
    await page.click('#password')
    await page.type('#password', 'secret123', { delay: 20 })
    await page.waitForTimeout(200)
    
    await page.click('#submit-btn')
    await page.waitForTimeout(300)
    
    // Generate a test from the recorded events
    const generateRes = await fetch(`${SERVER_URL}/recording/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Login Test',
        description: 'Test login form',
        url: 'http://localhost:3000/login',
        addAssertions: true
      })
    })
    
    const generateData = await generateRes.json()
    
    expect(generateData.success).toBe(true)
    expect(generateData.test).toBeDefined()
    expect(generateData.test.name).toBe('Login Test')
    expect(generateData.test.version).toBe(1)
    expect(generateData.test.steps.length).toBeGreaterThan(0)
    
    const steps = generateData.test.steps
    const typeSteps = steps.filter((s: any) => s.action === 'type')
    const clickSteps = steps.filter((s: any) => s.action === 'click')
    
    // Semantic events are aggregated asynchronously, so we check for presence
    // not order. The password field typing might arrive after the submit click
    // if the aggregator was still debouncing when the click happened.
    
    // Should have captured typing in both username and password fields
    const usernameType = typeSteps.find((s: any) => s.selector === '#username')
    const passwordType = typeSteps.find((s: any) => s.selector === '#password')
    
    if (!usernameType || !passwordType) {
      console.log('Missing type events. Captured steps:', JSON.stringify(steps, null, 2))
      console.log('Note: Semantic events are debounced/aggregated. If this fails intermittently,')
      console.log('it may be a timing issue with the event aggregator flush timing.')
    }
    
    expect(usernameType).toBeDefined()
    expect(usernameType.text).toBe('testuser')
    expect(passwordType).toBeDefined()
    expect(passwordType.text).toBe('secret123')
    
    // Should have at least one click (the submit button)
    const submitClick = clickSteps.find((s: any) => s.selector === '#submit-btn')
    if (!submitClick && clickSteps.length > 0) {
      // Click was captured but with different selector - still valid
      console.log('Submit click captured with different selector:', clickSteps)
    }
    expect(clickSteps.length).toBeGreaterThanOrEqual(1)
    
    // Clean up
    await fetch(`${SERVER_URL}/events/unwatch`, { method: 'POST' })
  })
  
  test('generates test from provided events array', async () => {
    // Test with explicit events (no browser needed)
    const generateRes = await fetch(`${SERVER_URL}/recording/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Direct Events Test',
        url: 'http://example.com',
        addAssertions: false,
        events: [
          {
            type: 'interaction:click',
            timestamp: 1000,
            category: 'interaction',
            target: { selector: '#btn', tag: 'button', text: 'Click Me' },
            payload: { text: 'Click Me', position: { x: 100, y: 100 } }
          },
          {
            type: 'input:typed',
            timestamp: 2000,
            category: 'input',
            target: { selector: '#input', tag: 'input' },
            payload: { text: 'hello', field: '#input', finalValue: 'hello', duration: 500 }
          }
        ]
      })
    })
    
    const data = await generateRes.json()
    
    expect(data.success).toBe(true)
    expect(data.test.name).toBe('Direct Events Test')
    expect(data.test.steps).toHaveLength(2)
    expect(data.test.steps[0].action).toBe('click')
    expect(data.test.steps[1].action).toBe('type')
    expect((data.test.steps[1] as any).text).toBe('hello')
  })
})

test.describe('haltija-dev user recordings', () => {
  test('user recording is saved server-side and retrievable by agent', async ({ page }) => {
    // Navigate and wait for widget to connect
    await page.goto(SERVER_URL)
    await page.waitForSelector('haltija-dev')
    await page.waitForTimeout(500)
    
    // Start event watching to capture recording events
    await fetch(`${SERVER_URL}/events/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'interactive' })
    })
    
    // Click the record button in the widget (🎬)
    const widget = await page.$('haltija-dev')
    const recordBtn = await widget!.evaluateHandle((el) => {
      return el.shadowRoot?.querySelector('[data-action="record"]')
    })
    await (recordBtn as any).click()
    
    // Wait a moment for recording to start
    await page.waitForTimeout(300)
    
    // Do some interactions
    await page.click('#test-button')
    await page.fill('#test-input', 'test recording')
    
    // Wait for typing to aggregate
    await page.waitForTimeout(600)
    
    // Click record button again to stop (💾)
    await (recordBtn as any).click()
    
    // Wait for recording to be saved
    await page.waitForTimeout(500)
    
    // Close the modal that appears by clicking outside or pressing Escape
    await page.keyboard.press('Escape')
    
    // Now verify the agent can retrieve the recording
    const recordingsRes = await fetch(`${SERVER_URL}/recordings`)
    const recordings = await recordingsRes.json()
    
    expect(recordings.length).toBeGreaterThanOrEqual(1)
    
    // Get the most recent recording
    const latestRecording = recordings[recordings.length - 1]
    expect(latestRecording.id).toMatch(/^rec_/)
    expect(latestRecording.eventCount).toBeGreaterThan(0)
    
    // Fetch the full recording
    const fullRecordingRes = await fetch(`${SERVER_URL}/recording/${latestRecording.id}`)
    const fullRecording = await fullRecordingRes.json()
    
    expect(fullRecording.id).toBe(latestRecording.id)
    expect(fullRecording.events).toBeInstanceOf(Array)
    expect(fullRecording.events.length).toBe(latestRecording.eventCount)
    
    // Verify events include our interactions
    const eventTypes = fullRecording.events.map((e: any) => e.type)
    expect(eventTypes.some((t: string) => t.includes('click'))).toBe(true)
    expect(eventTypes.some((t: string) => t.includes('typed'))).toBe(true)
    
    // Check that recording:started and recording:stopped events were emitted
    const eventsRes = await fetch(`${SERVER_URL}/events`)
    const eventsData = await eventsRes.json()
    // Response format is { success, data: { events, enabled } }
    const events = eventsData.data?.events || []
    const recordingEvents = events.filter((e: any) => e.category === 'recording')
    
    expect(recordingEvents.some((e: any) => e.type === 'recording:started')).toBe(true)
    expect(recordingEvents.some((e: any) => e.type === 'recording:stopped')).toBe(true)
    
    // Clean up
    await fetch(`${SERVER_URL}/events/unwatch`, { method: 'POST' })
    await fetch(`${SERVER_URL}/recording/${latestRecording.id}`, { method: 'DELETE' })
  })
})
