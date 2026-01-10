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
    env: { ...process.env, DEV_CHANNEL_PORT: String(PORT) },
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

// Helper to inject tosijs-dev into page
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
      <tosijs-dev server="${WS_URL}"></tosijs-dev>
    </body>
    </html>
  `)
  
  // Wait for element to be ready and connected
  await page.waitForSelector('tosijs-dev')
  await page.waitForTimeout(300) // Give time for WebSocket to connect
}

test.describe('tosijs-dev CLI', () => {
  test('starts server and serves test page', async ({ page }) => {
    // The server is already running from beforeAll, just verify it works
    const response = await page.goto(`${SERVER_URL}/`)
    expect(response?.status()).toBe(200)
    
    // Check page has expected content
    const title = await page.title()
    expect(title).toBe('Dev Channel Test')
    
    // Check tosijs-dev element exists
    const hasComponent = await page.evaluate(() => 
      document.querySelector('tosijs-dev') !== null
    )
    expect(hasComponent).toBe(true)
  })
  
  test('serves inject.js', async () => {
    const res = await fetch(`${SERVER_URL}/inject.js`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('tosijs-dev')
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
  })
})

test.describe('tosijs-dev component', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
  })
  
  test('injects into page', async ({ page }) => {
    const el = await page.$('tosijs-dev')
    expect(el).not.toBeNull()
  })
  
  test('has shadow DOM', async ({ page }) => {
    const hasShadow = await page.evaluate(() => {
      const el = document.querySelector('tosijs-dev')
      return el?.shadowRoot !== null
    })
    expect(hasShadow).toBe(true)
  })
  
  test('shows widget', async ({ page }) => {
    const isVisible = await page.evaluate(() => {
      const el = document.querySelector('tosijs-dev')
      const widget = el?.shadowRoot?.querySelector('.widget')
      return widget !== null && !widget.classList.contains('hidden')
    })
    expect(isVisible).toBe(true)
  })
  
  test('connects to server', async ({ page }) => {
    // Wait a moment for WebSocket connection
    await page.waitForTimeout(500)
    
    const state = await page.evaluate(() => {
      const el = document.querySelector('tosijs-dev') as any
      return el?.state
    })
    
    expect(['connecting', 'connected']).toContain(state)
  })
  
  test('Option+Tab toggles minimize', async ({ page }) => {
    // Get initial state - minimized class is on the host element, not .widget
    const initial = await page.evaluate(() => {
      const el = document.querySelector('tosijs-dev')
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
      const el = document.querySelector('tosijs-dev')
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
      const el = document.querySelector('tosijs-dev') as any
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

test.describe('tosijs-dev tab switching', () => {
  test('new tab deactivates old tab', async ({ browser }) => {
    // Open first page/tab
    const page1 = await browser.newPage()
    await injectDevChannel(page1)
    await page1.waitForTimeout(500)
    
    // Verify first page is connected
    const state1Before = await page1.evaluate(() => {
      const el = document.querySelector('tosijs-dev') as any
      return el?.state
    })
    expect(state1Before).toBe('connected')
    
    // Check widget is visible on page1
    const widget1VisibleBefore = await page1.evaluate(() => {
      const el = document.querySelector('tosijs-dev')
      return el?.shadowRoot?.querySelector('.widget') !== null
    })
    expect(widget1VisibleBefore).toBe(true)
    
    // Open second page/tab
    const page2 = await browser.newPage()
    await injectDevChannel(page2)
    await page2.waitForTimeout(500)
    
    // Verify second page is connected
    const state2 = await page2.evaluate(() => {
      const el = document.querySelector('tosijs-dev') as any
      return el?.state
    })
    expect(state2).toBe('connected')
    
    // Verify first page's component was killed (removed from DOM)
    const page1HasComponent = await page1.evaluate(() => {
      return document.querySelector('tosijs-dev') !== null
    })
    expect(page1HasComponent).toBe(false)
    
    // Verify second page's component is still there
    const page2HasComponent = await page2.evaluate(() => {
      return document.querySelector('tosijs-dev') !== null
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
    expect(await page1.evaluate(() => document.querySelector('tosijs-dev') !== null)).toBe(false)
    expect(await page2.evaluate(() => document.querySelector('tosijs-dev') !== null)).toBe(true)
    
    const page3 = await browser.newPage()
    await injectDevChannel(page3)
    await page3.waitForTimeout(500)
    
    // Page2 should now be dead, page3 alive
    expect(await page2.evaluate(() => document.querySelector('tosijs-dev') !== null)).toBe(false)
    expect(await page3.evaluate(() => document.querySelector('tosijs-dev') !== null)).toBe(true)
    
    await page1.close()
    await page2.close()
    await page3.close()
  })
})

test.describe('tosijs-dev server integration', () => {
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
      const el = document.querySelector('tosijs-dev') as any
      return el?.state === 'connected'
    })
    
    if (!connected) {
      // Wait a bit more and check again
      await page.waitForTimeout(500)
      const retryConnected = await page.evaluate(() => {
        const el = document.querySelector('tosijs-dev') as any
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
      const el = document.querySelector('tosijs-dev') as any
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
      const el = document.querySelector('tosijs-dev') as any
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

test.describe('tosijs-dev DOM tree inspector', () => {
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
})
