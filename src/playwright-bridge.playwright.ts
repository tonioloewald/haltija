/**
 * `playwrightBridge` in every engine (virta #3088).
 *
 * `testInBrowser` over haltija's own headless launch is Chromium only. The bridge is the supported
 * route to Firefox and WebKit, so it is exercised in all three (`bun run test:engines`); a claim
 * about "any engine" measured in one engine is a claim about that engine.
 *
 * No haltija server here on purpose: this path does not use one.
 */
import { test, expect } from '@playwright/test'
import { BrowserProbeError, createBrowserPage, playwrightBridge } from './test-in-browser'

const FIXTURE = `
  <style>body { margin: 0 } #pad { width: 300px; height: 120px; background: #ccd }</style>
  <input id="name">
  <button id="go" onclick="document.title = 'clicked ' + document.querySelector('#name').value">Go</button>
  <div id="pad"></div>
  <script>
    window.log = []
    const pad = document.getElementById('pad')
    for (const kind of ['pointerdown', 'pointermove', 'pointerup', 'click']) {
      pad.addEventListener(kind, (e) => window.log.push(kind + ':' + e.buttons))
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.title = 'escaped' })
  </script>
`

test.describe('playwrightBridge', () => {
  test.beforeEach(async ({ page }) => { await page.setContent(FIXTURE) })

  test('read returns the value, awaits promises, and takes arguments', async ({ page }) => {
    const hj = createBrowserPage(playwrightBridge(page))
    expect(await hj.read(() => document.querySelectorAll('input').length)).toBe(1)
    expect(await hj.read((a: number, b: number) => Promise.resolve(a + b), [2, 3])).toBe(5)
    expect(await hj.read(() => ({ w: innerWidth > 0, tags: ['a', 'b'] }))).toEqual({ w: true, tags: ['a', 'b'] })
  })

  test('a probe that throws fails with its own message', async ({ page }) => {
    const hj = createBrowserPage(playwrightBridge(page))
    const err = await hj.read(() => { throw new Error('page-side boom') }).catch((e) => e)
    expect(err).toBeInstanceOf(BrowserProbeError)
    expect(err.message).toBe('page-side boom')
  })

  test('type, click and press drive the page', async ({ page }) => {
    const hj = createBrowserPage(playwrightBridge(page))
    await hj.type('#name', 'Aino')
    await hj.click('#go')
    expect(await hj.read(() => document.title)).toBe('clicked Aino')
    await hj.press('Escape')
    expect(await hj.read(() => document.title)).toBe('escaped')
  })

  test('clickAt and dragFrom dispatch at a coordinate', async ({ page }) => {
    const hj = createBrowserPage(playwrightBridge(page))
    const box = await hj.read(() => {
      const r = document.getElementById('pad')!.getBoundingClientRect()
      return { x: r.x + 20, y: r.y + 20 }
    })
    await hj.clickAt(box.x, box.y)
    expect(await hj.read(() => (window as any).log)).toEqual(['pointerdown:1', 'pointerup:0', 'click:0'])
    await hj.read(() => { (window as any).log.length = 0 })
    await hj.dragFrom(box.x, box.y, 60, 0, 3)
    expect(await hj.read(() => (window as any).log)).toEqual([
      'pointerdown:1', 'pointermove:1', 'pointermove:1', 'pointermove:1', 'pointerup:0',
    ])
  })

  test('a missing coordinate target fails instead of passing', async ({ page }) => {
    const hj = createBrowserPage(playwrightBridge(page))
    await expect(hj.clickAt(99999, 99999)).rejects.toThrow('outside the document')
  })
})
