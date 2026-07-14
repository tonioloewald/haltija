/**
 * Playwright test for the getDisplayMedia screenshot path.
 *
 * Real `navigator.mediaDevices.getDisplayMedia` in headless Chromium needs
 * sandbox flags, OS permissions, and a desktop-source picker — all of which
 * are flaky-to-impossible in CI. So we mock it: install a `getDisplayMedia`
 * that returns `canvas.captureStream()`, which is a *real* MediaStream
 * carrying *real* pixel data. The widget never knows the difference, and the
 * entire pipeline (offscreen video → drawImage → toDataURL → server) gets
 * exercised end-to-end.
 */

import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'

const TEST_REGISTRY_DIR = mkdtempSync(pathJoin(tmpdir(), 'haltija-pw-registry-'))


const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = 8709 // Avoid collision with other Playwright tests
const SERVER_URL = `http://localhost:${PORT}`
const WS_URL = `ws://localhost:${PORT}/ws/browser`

let serverProcess: ChildProcess | null = null

test.beforeAll(async () => {
  serverProcess = spawn('bun', ['run', 'bin/server.ts'], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env, DEV_CHANNEL_PORT: String(PORT), DEV_CHANNEL_NO_HTTPS: '1',
      // Same guards as the Bun tests: a spawned server registers itself, SIGTERMs
      // "legacy" servers it finds, and installs hj into ~/.local/bin. None of that
      // belongs in a test run — it would corrupt the developer's own registry and
      // CLI, and hijack `hj` in this repo for the duration of the suite.
      HALTIJA_REGISTRY_DIR: TEST_REGISTRY_DIR,
      HALTIJA_NO_RETIRE: '1',
      HALTIJA_NO_INSTALL: '1',
    },
    stdio: 'inherit',
  })
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/status`)
      if (res.ok) {
        const compRes = await fetch(`${SERVER_URL}/component.js`)
        if (compRes.ok) return
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('Server failed to start')
})

test.afterAll(() => {
  serverProcess?.kill()
})

async function injectWidget(page: Page) {
  // Land on the haltija server (a localhost URL → "potentially trustworthy"
  // origin) so navigator.mediaDevices is available for the mock later.
  // setContent / about:blank would drop us out of secure context and
  // mediaDevices would be undefined.
  await page.goto(`${SERVER_URL}/`)
  // The /test page auto-injects a widget on load via window.__haltija_config__.
  // Tear that down and clear the config so we end up with exactly one widget
  // (the one we create explicitly below) — otherwise the button click and
  // the WS-routed screenshot request can target different instances.
  await page.evaluate(() => {
    document.querySelectorAll('haltija-dev').forEach(w => w.remove())
    delete (window as any).__haltija_config__
  })
  await page.waitForFunction(() => !!(window as any).DevChannel)
  await page.evaluate(async () => {
    await customElements.whenDefined('haltija-dev')
  })
  await page.evaluate((wsUrl) => {
    const DC = (window as any).DevChannel
    const el = DC.elementCreator()()
    el.setAttribute('server', wsUrl)
    document.body.appendChild(el)
  }, WS_URL)
  await page.waitForSelector('haltija-dev', { state: 'attached' })
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${SERVER_URL}/status`)
    const status = await res.json()
    if (status.browsers > 0) return
    await page.waitForTimeout(200)
  }
  throw new Error('Browser failed to connect to server')
}

/**
 * Replace navigator.mediaDevices.getDisplayMedia with a stub that returns
 * a real MediaStream from a coloured canvas. Drawing into the canvas
 * before captureStream() gives the stream a deterministic first frame,
 * so the widget's `videoWidth`/`videoHeight` are non-zero by the time
 * `/screenshot` runs.
 */
async function mockGetDisplayMedia(page: Page, color = 'rgb(255, 64, 32)') {
  await page.evaluate((color) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = color
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // Animate to keep the stream "alive" (some browsers stop a static
    // captureStream track immediately).
    setInterval(() => {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }, 100)
    // @ts-ignore — captureStream is on HTMLCanvasElement in browsers
    const stream = canvas.captureStream(5) as MediaStream
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => stream,
    })
  }, color)
}

test.describe('getDisplayMedia screenshot path', () => {
  test('🖥 button appears in the widget header', async ({ page }) => {
    await injectWidget(page)
    const visible = await page.evaluate(() => {
      const widget = document.querySelector('haltija-dev')
      const btn = widget?.shadowRoot?.querySelector('.btn[data-action="screen"]')
      return !!btn
    })
    expect(visible).toBe(true)
  })

  test('clicking 🖥 opens a stream and marks the button as sharing', async ({ page }) => {
    await injectWidget(page)
    await mockGetDisplayMedia(page)

    await page.evaluate(() => {
      const widget = document.querySelector('haltija-dev') as HTMLElement
      const btn = widget.shadowRoot?.querySelector('.btn[data-action="screen"]') as HTMLElement
      btn.click()
    })
    // Wait for the stream to bind + the .sharing class to flip on.
    await page.waitForFunction(() => {
      const w: any = document.querySelector('haltija-dev')
      const btn = w?.shadowRoot?.querySelector('.btn[data-action="screen"]')
      return btn?.classList.contains('sharing')
    }, null, { timeout: 5000 })
  })

  test('/screenshot uses the open stream and returns getDisplayMedia source', async ({ page }) => {
    await injectWidget(page)
    await mockGetDisplayMedia(page, 'rgb(50, 200, 100)')

    // Start the share session (simulated user gesture).
    await page.evaluate(() => {
      const widget = document.querySelector('haltija-dev') as HTMLElement
      const btn = widget.shadowRoot?.querySelector('.btn[data-action="screen"]') as HTMLElement
      btn.click()
    })
    await page.waitForFunction(() => {
      const w: any = document.querySelector('haltija-dev')
      return w?.shadowRoot?.querySelector('.btn[data-action="screen"]')?.classList.contains('sharing')
    }, null, { timeout: 5000 })

    // Give the video element a frame to load — videoWidth/height are 0
    // until the first frame arrives.
    await page.waitForTimeout(500)

    // Call /screenshot via the REST API and verify the response is fed by
    // getDisplayMedia (source field) with real base64 PNG payload.
    const res = await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // file:false → keep image inline as base64 instead of writing to /tmp,
      // so the test can verify the bytes directly.
      body: JSON.stringify({ file: false, chyron: false }),
    })
    expect(res.ok).toBe(true)
    const json = await res.json()
    if (!json.success) {
      // Surface the server-side error so test failures are diagnosable
      throw new Error(`screenshot failed: ${json.error}`)
    }
    expect(json.success).toBe(true)
    expect(json.data?.source).toBe('getDisplayMedia')
    expect(typeof json.data?.image).toBe('string')
    expect(json.data.image.startsWith('data:image/')).toBe(true)
    // Sanity-check the image is non-trivial in size (real pixels, not a 1×1).
    const base64 = json.data.image.split(',', 2)[1]
    expect(base64.length).toBeGreaterThan(200)
  })

  test('clicking 🖥 again stops the stream', async ({ page }) => {
    await injectWidget(page)
    await mockGetDisplayMedia(page)

    const click = () => page.evaluate(() => {
      const widget = document.querySelector('haltija-dev') as HTMLElement
      const btn = widget.shadowRoot?.querySelector('.btn[data-action="screen"]') as HTMLElement
      btn.click()
    })

    await click()
    await page.waitForFunction(() => {
      const w: any = document.querySelector('haltija-dev')
      return w?.shadowRoot?.querySelector('.btn[data-action="screen"]')?.classList.contains('sharing')
    }, null, { timeout: 5000 })

    await click()
    await page.waitForFunction(() => {
      const w: any = document.querySelector('haltija-dev')
      return !w?.shadowRoot?.querySelector('.btn[data-action="screen"]')?.classList.contains('sharing')
    }, null, { timeout: 5000 })
  })

  test('without an open stream, /screenshot reports the actionable error', async ({ page }) => {
    await injectWidget(page)
    // Do NOT start the screen-share session.

    const res = await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: false }),
    })
    const json = await res.json()
    expect(json.success).toBe(false)
    // The error should mention BOTH paths the user could take.
    expect(json.error).toMatch(/desktop app|🖥|share/i)
  })
})
