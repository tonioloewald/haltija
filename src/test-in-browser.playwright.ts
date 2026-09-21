/**
 * `testInBrowser`, probe-based (#51).
 *
 * These replace an earlier suite that proved the OTHER design — the one where the whole body
 * crossed into the page. That design is superseded (tosijs-3d), so tests vouching for it were a
 * lane certifying an abandoned approach: green, and meaningless.
 *
 * What is proven here: the body stays on the host with its real `expect`; only the probe crosses;
 * haltija's realistic actions interleave as ordinary `await`; coordinates work where selectors
 * cannot; and a tier that runs nothing says so instead of passing quietly.
 */
import { test, expect, type Page } from '@playwright/test'
import { startTestServer, type TestServer } from './playwright-server'
import {
  BrowserProbeError,
  assertBrowserTierRan,
  createBrowserPage,
  markBrowserTestRan,
  resetBrowserTestCount,
  serializeProbe,
} from './test-in-browser'

let server: TestServer
let SERVER_URL: string

test.beforeAll(async () => {
  server = await startTestServer({ logPrefix: '[tib-server]' })
  SERVER_URL = server.serverUrl
})
test.afterAll(async () => { await server?.stop() })

const post = async (path: string, body: any) =>
  (await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json()

/** A bridge over the live server — what `HaltijaTestClient` would supply in real use. */
const bridge = {
  eval: (code: string) => post('/eval', { code }),
  click: (selector: string) => post('/click', { selector }),
  type: (selector: string, text: string) => post('/type', { selector, text }),
  press: (key: string) => post('/key', { key }),
}
const page = createBrowserPage(bridge)

async function inject(pw: Page) {
  await pw.goto(`${SERVER_URL}/`)
  await pw.addScriptTag({ url: `${SERVER_URL}/component.js` })
  await pw.waitForFunction(() => !!document.querySelector('haltija-dev'), { timeout: 15000 })
  for (let i = 0; i < 40; i++) {
    if ((await (await fetch(`${SERVER_URL}/status`)).json()).browsers > 0) return
    await pw.waitForTimeout(250)
  }
  throw new Error('widget never connected')
}

test.describe('testInBrowser — probe-based (#51)', () => {
  test.beforeEach(async ({ page: pw }) => {
    await inject(pw)
    await pw.evaluate(() => {
      document.querySelectorAll('#tib-fx').forEach((n) => n.remove())
      const d = document.createElement('div')
      d.id = 'tib-fx'
      d.innerHTML =
        '<input id="tib-email" style="width:200px"><span id="tib-err"></span>' +
        '<button id="tib-btn" style="width:80px;height:30px">Add</button><span id="tib-count">0</span>' +
        '<svg width="200" height="40"><rect id="tib-track" x="0" y="10" width="200" height="20" fill="#ddd"/>' +
        '<rect id="tib-thumb" x="0" y="10" width="20" height="20" fill="#39f"/></svg>'
      document.body.appendChild(d)
      d.querySelector('#tib-btn')!.addEventListener('click', () => {
        const c = document.getElementById('tib-count')!
        c.textContent = String(Number(c.textContent) + 1)
      })
      d.querySelector('#tib-email')!.addEventListener('input', (e) => {
        const v = (e.target as HTMLInputElement).value
        document.getElementById('tib-err')!.textContent = v.includes('@') ? '' : 'not a valid email'
      })
      // An SVG "widget" with no element identity to select — the widgets3d shape.
      const thumb = d.querySelector('#tib-thumb') as SVGRectElement
      let dragging = false, startX = 0, base = 0
      thumb.addEventListener('mousedown', (e: any) => {
        dragging = true; startX = e.clientX; base = Number(thumb.getAttribute('x'))
      })
      document.addEventListener('mousemove', (e: any) => {
        if (dragging) thumb.setAttribute('x', String(Math.max(0, base + e.clientX - startX)))
      })
      document.addEventListener('mouseup', () => { dragging = false })
      ;(window as any).tibSlider = { hitTest: () => thumb.getBoundingClientRect() }
    })
  })

  // FIRST. Everything else is worthless if a browser-side failure can reach the host as a pass.
  test('a probe that throws fails the HOST, with the host’s own expect', async () => {
    markBrowserTestRan()
    await expect(
      page.read(() => { throw new Error('boom from the page') }),
    ).rejects.toThrow(/boom from the page/)
  })

  // The design's whole point: real DOM measurement, asserted by the REAL expect.
  test('the host asserts a marshalled value — real geometry, real matchers', async () => {
    markBrowserTestRan()
    const rect = await page.read(() => {
      const r = document.getElementById('tib-btn')!.getBoundingClientRect()
      return { width: r.width, height: r.height }
    })
    // happy-dom returns 0 for both. `toEqual` works because this is jest's real matcher.
    expect(rect).toEqual({ width: 80, height: 30 })
  })

  // The differentiator over page.evaluate: driving and asserting compose as ordinary await.
  test('realistic typing interleaves with probing, no special syntax', async () => {
    markBrowserTestRan()
    await page.type('#tib-email', 'not-an-email')
    // Per-character typing fires the real key lifecycle, which is what triggers framework
    // validation that `.value = x` does not.
    expect(await page.read(() => document.getElementById('tib-err')!.textContent))
      .toContain('not a valid email')
    await page.click('#tib-btn')
    expect(await page.read(() => document.getElementById('tib-count')!.textContent)).toBe('1')
  })

  // The widgets3d case: no element identity, so ask the widget for its geometry and act on it.
  test('coordinates work where selectors cannot (SVG widget with no identity)', async () => {
    markBrowserTestRan()
    const box = await page.read(() => (window as any).tibSlider.hitTest())
    expect(box.width).toBeGreaterThan(0)
    await page.dragFrom(box.x + box.width / 2, box.y + box.height / 2, 60, 0)
    const moved = await page.read(() => Number(document.getElementById('tib-thumb')!.getAttribute('x')))
    expect(moved).toBeGreaterThan(30)
  })

  test('a coordinate hitting nothing fails loudly, rather than dispatching into the void', async () => {
    markBrowserTestRan()
    await expect(page.clickAt(99999, 99999)).rejects.toThrow()
  })

  test('closures do not cross, arguments do', async () => {
    markBrowserTestRan()
    const wanted = '#tib-count'
    expect(await page.read((sel: string) => document.querySelector(sel)!.textContent, [wanted])).toBe('0')
    expect(serializeProbe((a: number) => a, [1])).toContain('(...[1])')
  })
})

/**
 * The failure tosijs-3d-ensemble actually hit: their tier stopped existing for a week and stayed
 * green, because a suite that runs nothing has no failures.
 */
test.describe('corpus liveness (#51)', () => {
  test('a tier that ran nothing reports it, instead of passing quietly', () => {
    resetBrowserTestCount()
    expect(() => assertBrowserTierRan(1)).toThrow(/ran 0 test\(s\)/)
    markBrowserTestRan()
    expect(() => assertBrowserTierRan(1)).not.toThrow()
  })

  test('a probe with no browser is an error, not an empty value', async () => {
    const dead = createBrowserPage({
      eval: async () => undefined,           // a server that answers nothing
      click: async () => {}, type: async () => {}, press: async () => {},
    })
    await expect(dead.read(() => 1)).rejects.toThrow(BrowserProbeError)
  })
})
