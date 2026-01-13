/**
 * Focused mutation testing
 * Run with: bunx playwright test src/mutation.test.ts
 */

import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = 8703 // Different port to isolate
const SERVER_URL = `http://localhost:${PORT}`
const WS_URL = `ws://localhost:${PORT}/ws/browser`

let serverProcess: ChildProcess | null = null

test.beforeAll(async () => {
  serverProcess = spawn('bun', ['run', 'bin/server.ts'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DEV_CHANNEL_PORT: String(PORT) },
    stdio: 'pipe', // Capture output
  })
  
  // Log server output for debugging
  serverProcess.stdout?.on('data', (data) => {
    console.log('[server]', data.toString().trim())
  })
  serverProcess.stderr?.on('data', (data) => {
    console.error('[server err]', data.toString().trim())
  })
  
  // Wait for server
  let ready = false
  for (let i = 0; i < 50 && !ready; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/status`)
      if (res.ok) ready = true
    } catch {}
    if (!ready) await new Promise(r => setTimeout(r, 200))
  }
  
  if (!ready) throw new Error('Server failed to start')
})

test.afterAll(async () => {
  serverProcess?.kill()
})

async function injectAndWaitForConnection(page: Page) {
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Mutation Test</title>
      <script src="${SERVER_URL}/component.js"></script>
    </head>
    <body>
      <div id="root"></div>
      <tosijs-dev server="${WS_URL}"></tosijs-dev>
    </body>
    </html>
  `)
  
  // Wait for component
  await page.waitForSelector('tosijs-dev')
  
  // Wait for connected state
  await page.waitForFunction(() => {
    const el = document.querySelector('tosijs-dev') as any
    console.log('Component state:', el?.state)
    return el?.state === 'connected'
  }, { timeout: 10000 })
  
  // Extra buffer
  await page.waitForTimeout(200)
  
  // Verify server sees browser
  const status = await fetch(`${SERVER_URL}/status`).then(r => r.json())
  console.log('Server status:', status)
  expect(status.browsers).toBeGreaterThan(0)
  
  // Test a simple request to verify communication works
  const testRes = await fetch(`${SERVER_URL}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '1 + 1' })
  })
  const testData = await testRes.json()
  console.log('Eval test:', testData)
  if (!testData.success) {
    throw new Error(`Communication test failed: ${testData.error}`)
  }
}

test('mutation watching - isolated test', async ({ page }) => {
  await injectAndWaitForConnection(page)
  
  // Clear any buffered messages
  await fetch(`${SERVER_URL}/clear`, { method: 'POST' })
  
  // Start watching
  console.log('Starting mutation watch...')
  const watchRes = await fetch(`${SERVER_URL}/mutations/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debounce: 100, preset: 'smart' })
  })
  const watchData = await watchRes.json()
  console.log('Watch response:', watchData)
  expect(watchData.success).toBe(true)
  
  // Make a simple DOM change
  console.log('Adding element...')
  await page.evaluate(() => {
    const div = document.createElement('div')
    div.id = 'mutation-test-element'
    div.textContent = 'Hello mutation'
    document.getElementById('root')!.appendChild(div)
  })
  
  // Wait for debounce + buffer
  await page.waitForTimeout(200)
  
  // Check messages
  const messagesRes = await fetch(`${SERVER_URL}/messages`)
  const messages = await messagesRes.json()
  console.log('Messages:', JSON.stringify(messages, null, 2))
  
  const batch = messages.find((m: any) => m.channel === 'mutations' && m.action === 'batch')
  expect(batch).toBeTruthy()
  expect(batch.payload.summary.added).toBeGreaterThan(0)
  
  // Stop watching
  await fetch(`${SERVER_URL}/mutations/unwatch`, { method: 'POST' })
})

test('mutation filtering - xinjs classes highlighted', async ({ page }) => {
  await injectAndWaitForConnection(page)
  await fetch(`${SERVER_URL}/clear`, { method: 'POST' })
  
  // Start watching with xinjs preset
  const watchRes = await fetch(`${SERVER_URL}/mutations/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debounce: 100, preset: 'xinjs' })
  })
  expect((await watchRes.json()).success).toBe(true)
  
  // Add element with xinjs classes
  await page.evaluate(() => {
    const div = document.createElement('div')
    div.id = 'xinjs-element'
    div.className = '-xin-event -xin-data some-other-class'
    document.getElementById('root')!.appendChild(div)
  })
  
  await page.waitForTimeout(200)
  
  const messages = await fetch(`${SERVER_URL}/messages`).then(r => r.json())
  console.log('Xinjs messages:', JSON.stringify(messages, null, 2))
  
  const batch = messages.find((m: any) => m.channel === 'mutations' && m.action === 'batch')
  expect(batch).toBeTruthy()
  
  // Check that xinjs classes are in notable
  const notable = batch.payload.notable.find((n: any) => n.id === 'xinjs-element')
  expect(notable).toBeTruthy()
  expect(notable.className).toContain('-xin-event')
  
  await fetch(`${SERVER_URL}/mutations/unwatch`, { method: 'POST' })
})

test('mutation flood protection', async ({ page }) => {
  await injectAndWaitForConnection(page)
  await fetch(`${SERVER_URL}/clear`, { method: 'POST' })
  
  // Start watching with minimal debounce
  const watchRes = await fetch(`${SERVER_URL}/mutations/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debounce: 50 })
  })
  expect((await watchRes.json()).success).toBe(true)
  
  // Create a LOT of mutations rapidly
  console.log('Creating 100 elements rapidly...')
  await page.evaluate(() => {
    const root = document.getElementById('root')!
    for (let i = 0; i < 100; i++) {
      const div = document.createElement('div')
      div.className = `item-${i}`
      div.textContent = `Item ${i}`
      root.appendChild(div)
    }
  })
  
  // Wait for debounce to flush
  await page.waitForTimeout(200)
  
  const messages = await fetch(`${SERVER_URL}/messages`).then(r => r.json())
  const batches = messages.filter((m: any) => m.channel === 'mutations' && m.action === 'batch')
  
  console.log(`Received ${batches.length} mutation batches`)
  console.log('Total added:', batches.reduce((sum: number, b: any) => sum + b.payload.summary.added, 0))
  
  // Should have batched mutations, not 100 separate messages
  expect(batches.length).toBeLessThan(10)
  
  // But total added should reflect all elements
  const totalAdded = batches.reduce((sum: number, b: any) => sum + b.payload.summary.added, 0)
  expect(totalAdded).toBeGreaterThanOrEqual(100)
  
  await fetch(`${SERVER_URL}/mutations/unwatch`, { method: 'POST' })
})

test('mutation class change filtering', async ({ page }) => {
  await injectAndWaitForConnection(page)
  await fetch(`${SERVER_URL}/clear`, { method: 'POST' })
  
  // Add an element first
  await page.evaluate(() => {
    const div = document.createElement('div')
    div.id = 'class-change-test'
    div.className = 'initial'
    document.getElementById('root')!.appendChild(div)
  })
  
  await page.waitForTimeout(100)
  await fetch(`${SERVER_URL}/clear`, { method: 'POST' })
  
  // Start watching with tailwind preset
  await fetch(`${SERVER_URL}/mutations/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debounce: 100, preset: 'tailwind' })
  })
  
  // Change classes - should filter tailwind utilities
  await page.evaluate(() => {
    const el = document.getElementById('class-change-test')!
    el.className = 'flex p-4 text-sm bg-blue-500 -xin-event'
  })
  
  await page.waitForTimeout(200)
  
  const messages = await fetch(`${SERVER_URL}/messages`).then(r => r.json())
  const batch = messages.find((m: any) => m.channel === 'mutations' && m.action === 'batch')
  
  console.log('Class change batch:', JSON.stringify(batch?.payload, null, 2))
  
  // Should have captured the mutation
  expect(batch).toBeTruthy()
  
  // Check if tailwind classes were filtered and xinjs was highlighted
  if (batch.payload.notable.length > 0) {
    const classChange = batch.payload.notable.find((n: any) => n.attribute === 'class')
    if (classChange) {
      console.log('Class change notable:', classChange)
      // Should show +xin-event as interesting, not the tailwind ones
      expect(classChange.newValue).toContain('-xin-event')
    }
  }
  
  await fetch(`${SERVER_URL}/mutations/unwatch`, { method: 'POST' })
})
