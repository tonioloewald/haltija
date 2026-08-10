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
import { dirname, join as pathJoin } from 'path'
import { fileURLToPath } from 'url'
import { startTestServer, type TestServer } from './playwright-server'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Port choice, readiness and confirmed teardown all live in src/playwright-server.ts, shared by all
// three Playwright suites — this one had the good version and the other two didn't, which is how
// they ended up holding fixed ports with bare `.kill()` teardowns.
let server: TestServer
let SERVER_URL: string
let WS_URL: string

test.beforeAll(async () => {
  server = await startTestServer()
  SERVER_URL = server.serverUrl
  WS_URL = server.wsUrl
})

test.afterAll(async () => {
  await server?.stop()
})

// Helper to inject haltija-dev into page
async function injectDevChannel(page: Page) {
  // Load page first, then add the element after custom element is defined
  // This avoids the HTMLUnknownElement issue when element is parsed before script loads
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Page</title>
      <script src="${SERVER_URL}/component.js"></script>
    </head>
    <body>
      <h1>Test Page</h1>
    </body>
    </html>
  `)
  
  // Wait for DevChannel to be defined and custom element registered
  await page.waitForFunction(() => !!(window as any).DevChannel)
  await page.evaluate(async () => {
    await customElements.whenDefined('haltija-dev')
  })
  
  // Create element using the DevChannel class directly
  await page.evaluate((wsUrl) => {
    const DC = (window as any).DevChannel
    const creator = DC.elementCreator()
    const el = creator()
    el.setAttribute('server', wsUrl)
    document.body.appendChild(el)
  }, WS_URL)
  
  // Wait for element to be attached to DOM
  await page.waitForSelector('haltija-dev', { state: 'attached' })
  
  // Poll /status until a browser is connected (WebSocket established)
  const maxAttempts = 30
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${SERVER_URL}/status`)
    const status = await res.json()
    if (status.browsers > 0) {
      return // Connected!
    }
    await page.waitForTimeout(200)
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
    expect(title).toBe('Haltija - Browser Control for AI Agents')
    
    // Check haltija-dev element exists (auto-injected via __haltija_config__)
    // Wait for the element since auto-inject happens asynchronously after script load
    await page.waitForSelector('haltija-dev', { timeout: 5000 })
    const hasComponent = await page.evaluate(() => 
      document.querySelector('haltija-dev') !== null
    )
    expect(hasComponent).toBe(true)
  })
  
  test('serves inject.js', async () => {
    const res = await fetch(`${SERVER_URL}/inject.js`)
    expect(res.status).toBe(200)
    const text = await res.text()
    // inject.js loads component.js and sets up config - check for key patterns
    expect(text).toContain('__haltija_config__')
    expect(text).toContain('component.js')
  })
  
  test('serves component.js', async () => {
    const res = await fetch(`${SERVER_URL}/component.js`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('DevChannel')
  })
  
  test('serves icon.svg', async () => {
    const res = await fetch(`${SERVER_URL}/icon.svg`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    const text = await res.text()
    expect(text).toContain('<svg')
    expect(text).toContain('</svg>')
  })
  
  test('test page loads icon without errors', async ({ page }) => {
    // Track failed requests
    const failedRequests: string[] = []
    page.on('requestfailed', request => {
      failedRequests.push(request.url())
    })
    
    await page.goto(`${SERVER_URL}/`)
    await page.waitForLoadState('networkidle')
    
    // Check no icon requests failed
    const iconFailures = failedRequests.filter(url => url.includes('icon'))
    expect(iconFailures).toHaveLength(0)
    
    // Verify the image element loaded successfully
    const imgLoaded = await page.evaluate(() => {
      const img = document.querySelector('.header img') as HTMLImageElement
      return img && img.complete && img.naturalWidth > 0
    })
    expect(imgLoaded).toBe(true)
  })

  test('affordance map: DOM fallback is structural and dense; a tosijs agent surface passes through verbatim', async ({ page }) => {
    await injectDevChannel(page)

    // --- Tier 1: no agent surface → DOM reconstruction -----------------------------------------
    await page.evaluate(() => {
      const main = document.createElement('main')
      main.innerHTML = `
        <h1>Shopping</h1>
        <form><input id="filter" placeholder="Filter items" value="milk"><button>Add item</button></form>
        <button style="display:none">hidden button</button>`
      document.body.appendChild(main)
    })

    const domMap = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    expect(domMap.success).toBe(true)
    expect(domMap.data.source).toBe('dom')
    expect(domMap.data.hint).toContain('no binding provenance')

    const flat = JSON.stringify(domMap.data.nodes)
    expect(flat).toContain('Filter items') // labels are captured
    expect(flat).toContain('"ref"') // and each node is directly actionable
    // An invisible control is not an affordance, and must not leak in via a container's text.
    expect(flat).not.toContain('hidden button')

    // --- Tier 2: an agent surface → the app's OWN wiring, unreshaped ----------------------------
    await page.evaluate(() => {
      ;(globalThis as any).tosiAgent = {
        describe: () => ({
          roots: { app: 'app' },
          wiring: [
            { tag: 'input', id: 'filter', label: 'Filter', value: 'milk ⟷ app.filter' },
            { tag: 'button', text: 'Add', on: { click: 'app.addItem' } },
          ],
          actions: ['app.addItem'],
          exposure: 'introspection',
        }),
      }
    })

    const tosiMap = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    expect(tosiMap.data.source).toBe('tosi-agent')
    expect(tosiMap.data.actions).toEqual(['app.addItem'])
    // The binding provenance + DIRECTION must survive verbatim — that's the whole point of tier 2,
    // and it's information the DOM tier cannot reconstruct.
    expect(JSON.stringify(tosiMap.data.wiring)).toContain('⟷ app.filter')
    expect(tosiMap.data.act.note).toContain('write')
  })

  test('contrast audit stays quiet on text-less containers and uncertain backgrounds', async ({ page }) => {
    await injectDevChannel(page)
    await page.evaluate(() => {
      const wrap = document.createElement('main')
      wrap.innerHTML =
        // A container with low-contrast inherited colours but NO text of its own: noise, not a finding.
        '<div id="wrap" style="background:#e5e7eb;color:#d1d5db;padding:10px">' +
        '  <button id="fine" style="background:#123;color:#fff">Fine</button></div>' +
        // Text over a background-IMAGE: the colour-based ratio is not a verdict we can assert.
        '<button id="onimage" style="background-image:linear-gradient(90deg,#000,#fff);color:#888">Gradient</button>' +
        // A genuine failure must still be caught.
        '<button id="bad" style="background:#e5e7eb;color:#d1d5db">Unreadable</button>'
      document.body.appendChild(wrap)
    })

    const map = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    const flat: any[] = []
    const walk = (n: any) => { flat.push(n); (n.children || []).forEach(walk) }
    ;(map.data.nodes || []).forEach(walk)

    const byText = (t: string) => flat.find((n) => n.text === t)
    expect(byText('Unreadable')?.contrastFail).toBeTruthy() // true positive survives
    expect(byText('Fine')?.contrastFail).toBeFalsy()
    expect(byText('Gradient')?.contrastFail).toBeFalsy() // uncertain, so not asserted
    expect(byText('Gradient')?.colors?.uncertain).toBe(true) // …but the uncertainty IS reported

    // No node without readable text may carry a verdict — that's the noise this guards against.
    const textlessFails = flat.filter((n) => n.contrastFail && !(n.text || n.label || n.value))
    expect(textlessFails).toEqual([])
  })

  test('multiple tabs COEXIST — the current rule, replacing two obsolete auto-deactivate tests', async ({ browser }) => {
    // Two permanently-skipped tests asserted that opening a tab deactivates the previous one. That
    // was never implemented and has since been settled the other way: declared-origin routing and
    // the desktop tab-raise both REQUIRE tabs to coexist and be individually addressable. Skipped
    // tests asserting a design we rejected are worse than none — they read as unfinished work.
    const p1 = await browser.newPage()
    const p2 = await browser.newPage()
    try {
      await injectDevChannel(p1)
      await injectDevChannel(p2)
      const { windows, count } = await (await fetch(`${SERVER_URL}/windows`)).json()
      expect(count).toBeGreaterThanOrEqual(2)
      // Both remain live: neither was deactivated by the other's arrival.
      expect(windows.filter((w: any) => !w.hidden).length).toBeGreaterThanOrEqual(2)
    } finally {
      await p1.close()
      await p2.close()
    }
  })

  test('map and schematic exclude ANCESTOR-hidden elements, not just self-hidden ones', async ({ page }) => {
    await injectDevChannel(page)
    await page.evaluate(() => {
      const wrap = document.createElement('main')
      // `display` does not inherit, so the button reports display:block and passed a self-only check.
      wrap.innerHTML =
        '<div style="display:none"><button id="ghost">Delete account</button>' +
        '<canvas id="ghost-canvas" width="40" height="40"></canvas></div>' +
        '<button id="real">Visible action</button>'
      document.body.appendChild(wrap)
      const c = document.getElementById('ghost-canvas') as HTMLCanvasElement
      c.getContext('2d')!.fillRect(0, 0, 40, 40)
    })

    const map = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    const flat = JSON.stringify(map.data.nodes)
    expect(flat).toContain('Visible action')
    // A control nobody can see is not an affordance — and it must not carry a ref, a contrast
    // verdict computed from colours nobody sees, or a box in the schematic.
    expect(flat).not.toContain('Delete account')

    // The schematic embeds canvases; a hidden one was being rasterized into it.
    const shot = await (await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: false, schematic: true }),
    })).json()
    expect(shot.data.canvasesRendered).toBe(0)
  })

  test('map surfaces contrast failures with the page\'s real colours and a WCAG verdict', async ({ page }) => {
    await injectDevChannel(page)
    await page.evaluate(() => {
      const wrap = document.createElement('main')
      wrap.innerHTML =
        '<button id="ok" style="background:#166534;color:#fff;padding:8px">Readable</button>' +
        '<button id="bad" style="background:#e5e7eb;color:#d1d5db;padding:8px">Barely visible</button>'
      document.body.appendChild(wrap)
    })

    const map = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()

    const flat: any[] = []
    const walk = (n: any) => { flat.push(n); (n.children || []).forEach(walk) }
    ;(map.data.nodes || []).forEach(walk)

    const ok = flat.find((n) => n.text === 'Readable')
    const bad = flat.find((n) => n.text === 'Barely visible')
    expect(ok).toBeTruthy()
    expect(bad).toBeTruthy()

    // Real colours are captured, so the schematic can be drawn in the page's own palette.
    expect(ok.colors.bg).toMatch(/^rgb\(/)
    expect(ok.colors.fg).toMatch(/^rgb\(/)

    // And the verdict is machine-checkable, not just eyeballable.
    expect(ok.contrastFail).toBeUndefined()
    expect(bad.contrastFail).toBeTruthy()
    expect(bad.colors.passes).toBe(false)
    expect(bad.colors.contrast).toBeLessThan(4.5)
  })

  test('a tosiAgent surface with an unexpected shape warns instead of silently degrading', async ({ page }) => {
    // The tier is detected by duck-typing ONE method. If upstream renames `wiring`, `describe()`
    // still exists, the map still claims `source: 'tosi-agent'`, and the schematic renders an empty
    // box whose footer still says "wiring · <title>" — silent AND confidently mislabelled.
    await injectDevChannel(page)
    await page.evaluate(() => {
      ;(globalThis as any).tosiAgent = { describe: () => ({ somethingElse: [] }) }
    })
    const res = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    expect(res.data.source).toBe('tosi-agent')
    expect(res.data.warning).toMatch(/wiring/)
    await page.evaluate(() => { delete (globalThis as any).tosiAgent })
  })

  test('a well-shaped tosiAgent surface does NOT warn', async ({ page }) => {
    // The discriminating case — otherwise the assertion above would hold if we warned always.
    await injectDevChannel(page)
    await page.evaluate(() => {
      ;(globalThis as any).tosiAgent = {
        version: '9.9.9',
        describe: () => ({ wiring: [{ tag: 'button', id: 'go', label: 'Go' }] }),
      }
    })
    const res = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    expect(res.data.warning).toBeUndefined()
    expect(res.data.agentSurfaceVersion).toBe('9.9.9') // reported, so a bug report can name it
    await page.evaluate(() => { delete (globalThis as any).tosiAgent })
  })

  test('/map --image honours maxWidth/maxHeight/format — parameters that were accepted and discarded', async ({ page }) => {
    // These were parsed by the handler, threaded into `rasterizeSchematic`, and then not used:
    // `{maxWidth:300, maxHeight:300, format:'jpeg'}` returned a byte-identical 1126x22304 PNG that
    // still reported `format:'png'`. src/schematic-size.test.ts pins the arithmetic; only a real
    // canvas can show that the numbers reach the bitmap and that the encoder honours the format —
    // the original bug was precisely that correct-looking values never reached the drawing.
    await injectDevChannel(page)
    // A page tall enough that the bounds have to do real work.
    await page.evaluate(() => {
      const filler = document.createElement('div')
      filler.innerHTML = Array.from({ length: 200 }, (_, i) => `<p>row ${i}</p>`).join('')
      document.body.appendChild(filler)
    })

    const bounded = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: true, file: false, maxWidth: 300, maxHeight: 300, format: 'jpeg' }),
    })).json()

    expect(bounded.success).toBe(true)
    expect(bounded.data.width).toBeLessThanOrEqual(300)
    expect(bounded.data.height).toBeLessThanOrEqual(300)
    expect(bounded.data.format).toBe('jpeg')
    // The reported format must match the BYTES, not just the field — reporting `jpeg` while
    // encoding PNG is the same lie in a different place.
    expect(bounded.data.image.startsWith('data:image/jpeg;base64,')).toBe(true)

    // The discriminating half: without bounds the same page is bigger. Otherwise every assertion
    // above would hold for a rasterizer that always emitted a 300x300 thumbnail.
    const unbounded = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: true, file: false }),
    })).json()
    expect(unbounded.data.height).toBeGreaterThan(bounded.data.height)
    expect(unbounded.data.format).toBe('png') // and the default is still PNG
  })

  test('map and query pierce open shadow DOM, but never report haltija itself (#19)', async ({ page }) => {
    // `hj tree` has pierced shadow roots since 1.5; `map` and `query` did not, so an agent asking
    // the flagship question — "what's here and what is it wired to" — was told a web component was
    // empty, while `tree` had listed its contents correctly one command earlier.
    await injectDevChannel(page)
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<my-el-19></my-el-19>')
      customElements.define(
        'my-el-19',
        class extends HTMLElement {
          connectedCallback() {
            this.attachShadow({ mode: 'open' }).innerHTML =
              '<h2>shadow heading</h2><button>shadow button</button>'
          }
        },
      )
    })
    await page.waitForTimeout(200)

    const map = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    const flat: string[] = []
    const walk = (n: any) => { flat.push(`${n.tag}:${n.text || ''}`); (n.children || []).forEach(walk) }
    ;(map.data.nodes || []).forEach(walk)

    expect(flat.join(' | ')).toContain('shadow button')
    expect(flat.join(' | ')).toContain('shadow heading')

    // …and NOT haltija's own controls. The widget's buttons live in ITS shadow root, so they were
    // excluded only by accident — nothing crossed shadow boundaries. Piercing removed that
    // protection, and every map briefly listed 👆 / REC / 🖥 / LOG as page affordances. A tool that
    // reports itself as part of the page under test is the observer effect this product exists to
    // avoid.
    for (const ours of ['REC', '🖥', 'LOG', '👆']) {
      expect([ours, flat.join(' | ')]).toEqual([ours, expect.not.stringContaining(ours)])
    }

    // query reaches shadow content too, and is likewise clean.
    const q = await (await fetch(`${SERVER_URL}/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selector: 'button', all: true }),
    })).json()
    const texts = (Array.isArray(q.data) ? q.data : [q.data]).map((d: any) => (d.textContent || '').trim())
    expect(texts).toContain('shadow button')
    expect(texts.join('|')).not.toContain('REC')
  })

  test(':text() matches the INNERMOST element, ignores script/style, and hj find prints (#18)', async ({ page }) => {
    // Four defects, one repro. Reported against 1.12.0-rc.2 by an agent driving a mixed
    // React/tosijs app, and reproduced here exactly.
    await injectDevChannel(page)
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<ul><li role="option">plain Svenska</li></ul>' +
          '<p>unique-needle-string appears exactly once here</p>' +
          '<script>/* the words shadow button appear only in this script */</script>',
      )
    })

    // (2) The smallest element containing the text — not html/body/ul, which all "contain" it.
    // Every singular consumer took the outermost match, so `hj click ":text(X)"` clicked <html>
    // and failed, while `hj click "li:text(X)"` worked: the tag qualifier was doing the
    // pseudo-selector's job.
    const all = await (await fetch(`${SERVER_URL}/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selector: ':text(plain Svenska)', all: true }),
    })).json()
    const tags = (Array.isArray(all.data) ? all.data : [all.data]).map((d: any) => d.tagName)
    expect(tags).toEqual(['li'])

    // …so clicking by bare text works, which is what the not-found message recommends.
    const clicked = await (await fetch(`${SERVER_URL}/click`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selector: ':text(plain Svenska)' }),
    })).json()
    expect(clicked.success).toBe(true)

    // (4) Script source is not page text. `innerText` is rendering-aware only for an ATTACHED node,
    // and getVisibleText clones — so on a detached clone it degraded to textContent and script
    // literals matched.
    const scripty = await (await fetch(`${SERVER_URL}/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selector: ':text(shadow button)', all: true }),
    })).json()
    expect(Array.isArray(scripty.data) ? scripty.data : []).toEqual([])

    // (1) /find answers at the TOP level, not under `data` — so the CLI's unwrap printed nothing
    // and exited 0 on a call that had succeeded. Endpoint was always right; the rendering wasn't.
    const found = await (await fetch(`${SERVER_URL}/find`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'unique-needle-string' }),
    })).json()
    expect(found.found).toBe(true)
    expect(found.element.tag).toBe('p')
  })

  test('/type and /key work BY REF — the documented `hj tree` → `hj <cmd> <ref>` flow', async ({ page }) => {
    // `ref` was declared in the schema, parsed by the CLI, and resolved by the widget — and absent
    // from both handlers' forwarding lists. `hj type <ref> <text>` is the headline example in
    // README, DOCS.md and SKILL.md, and it failed every time with `Element not found: .` — the
    // target name blank because there was none. `/key` was worse: with no ref AND no selector the
    // widget falls back to `document.activeElement`, so it returned **success: true** having typed
    // into whatever happened to be focused.
    //
    // Every /type and /key e2e case used `selector`, which is exactly why this shipped.
    await injectDevChannel(page)
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<input id="by-ref-target"><input id="decoy">',
      )
      ;(document.getElementById('decoy') as HTMLInputElement).focus() // so activeElement is WRONG
    })

    // Refs are assigned by /tree — /query returns element info without one, which is worth knowing:
    // the documented flow really is `hj tree` first.
    const t = await (await fetch(`${SERVER_URL}/tree`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selector: '#by-ref-target' }),
    })).json()
    const ref = String(t.data.ref)
    expect(ref).toBeTruthy()
    expect(ref).not.toBe('undefined')

    const typed = await (await fetch(`${SERVER_URL}/type`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref, text: 'by-ref' }),
    })).json()
    expect(typed.success).toBe(true)

    const keyed = await (await fetch(`${SERVER_URL}/key`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref, key: 'X' }),
    })).json()
    expect(keyed.success).toBe(true)

    // The assertion that matters: the text landed on the REF'd element, not on the focused decoy.
    // Asserting only `success` would have passed against the bug for /key.
    const [target, decoy] = await page.evaluate(() => [
      (document.getElementById('by-ref-target') as HTMLInputElement).value,
      (document.getElementById('decoy') as HTMLInputElement).value,
    ])
    expect(target).toContain('by-ref')
    expect(decoy).toBe('')
  })

  test('hj map --image prints ONLY a path, and is actually cheaper than hj map', async ({ page }) => {
    // The claim README makes, measured rather than asserted. `--image` used to print the entire map
    // JSON and then append the image metadata + cost block + path, so it cost MORE than plain
    // `hj map` (5,910 chars vs 5,447 when measured) — a flag that exists to be cheaper and never
    // once was. Only the real binary can show this: the endpoint returns the same payload either
    // way, and the whole bug lived in how the CLI rendered it.
    await injectDevChannel(page)
    // A page with enough controls that the JSON map is substantial. On the bare fixture the map is
    // ~550 chars and the comparison measures nothing — the image floor would dominate either way,
    // which is exactly the density-dependence the skill tells agents to check for.
    await page.evaluate(() => {
      const form = document.createElement('form')
      form.innerHTML = Array.from(
        { length: 40 },
        (_, i) => `<label for="f${i}">Field ${i}</label><input id="f${i}" name="field-${i}" placeholder="enter value ${i}"><button type="button" id="b${i}">Action ${i}</button>`,
      ).join('')
      document.body.appendChild(form)
    })
    const { execFileSync } = await import('child_process')
    const run = (args: string[]) =>
      execFileSync('bun', [pathJoin(__dirname, '..', 'dist', 'hj.js'), ...args, '--port',
        String(server.port), '--no-launch'], { encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] })

    const plain = run(['map'])
    const image = run(['map', '--image'])

    // stdout is a bare path and nothing else — pipeable straight into a file read.
    expect(image.trim().split('\n').length).toBe(1)
    expect(image).toMatch(/haltija-schematics\/map-[^/]*\.png/)
    // …and the whole point: it is genuinely smaller. Not "about the same" — an order of magnitude.
    expect(image.length).toBeLessThan(plain.length / 5)
    // The discriminating half: `hj map` still prints the full map, so this isn't measuring a
    // CLI that stopped printing anything.
    expect(plain.length).toBeGreaterThan(5000)
    expect(plain).toContain('"tag"')
  })

  test('hj wait for a missing element actually WAITS and fails — never a 0ms success', async ({ page }) => {
    // The unit tests for this asserted the parser's output shape, and both the parser and the tests
    // used a field the endpoint does not read — so `hj wait ".modal"` returned success in ~50ms and
    // the suite stayed green. A parser-shape assertion cannot catch a parser/endpoint MISMATCH; only
    // measuring the elapsed time can. This is that measurement.
    await injectDevChannel(page)

    const t0 = Date.now()
    const res = await (await fetch(`${SERVER_URL}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selector: '.definitely-not-present', timeout: 1200 }),
    })).json()
    const elapsed = Date.now() - t0

    expect(res.success).toBe(false)
    expect(elapsed).toBeGreaterThan(1000) // it really waited
    expect(res.error).toMatch(/not found/)
  })

  test('/wait with nothing to wait for is a 400, not a success', async ({ page }) => {
    // The failure mode that let the mismatch hide: an unrecognised field validates fine, so the
    // handler fell through to "no arguments" and reported success. Refuse instead.
    await injectDevChannel(page)
    const resp = await fetch(`${SERVER_URL}/wait`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/forElement/) // names the field it wanted
  })

  test('hj wait for an element that DOES appear succeeds promptly', async ({ page }) => {
    // The discriminating case — without it the two assertions above would hold if /wait simply
    // always failed.
    await injectDevChannel(page)
    await page.evaluate(() => {
      setTimeout(() => {
        const d = document.createElement('div')
        d.className = 'arrives-late'
        d.textContent = 'here'
        document.body.appendChild(d)
      }, 300)
    })
    const res = await (await fetch(`${SERVER_URL}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selector: '.arrives-late', timeout: 5000 }),
    })).json()
    expect(res.success).toBe(true)
    expect(res.found).toBe(true)
  })

  test('hj key modifiers reach the page — the CLI field name must match the endpoint', async ({ page }) => {
    // `parseModifiers` emits `{ ctrl: true }`; the endpoint reads `ctrlKey`. Same shape as the
    // `hj wait` blocker: the CLI and the endpoint disagree about a field name, the extra key
    // validates fine, and the command reports success having silently dropped the modifier.
    // Asserted against a REAL keydown event, because that is the only thing that can tell.
    await injectDevChannel(page)
    await page.evaluate(() => {
      ;(window as any).__keys = []
      document.addEventListener('keydown', (e) => {
        ;(window as any).__keys.push({ key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey })
      })
    })

    // Drive the REAL CLI, not a hand-written body. Three separate unit tests in this repo have now
    // pinned a CLI/endpoint field-name mismatch by asserting the parser's own output shape — the
    // only tier that can catch that class is one that runs the actual command and looks at what
    // reached the page.
    const { execFileSync } = await import('child_process')
    execFileSync('bun', [
      pathJoin(__dirname, '..', 'dist', 'hj.js'),
      'key', 's', '--ctrl', '--port', String(server.port), '--no-launch',
    ], { encoding: 'utf-8', timeout: 20000 })

    const seen = await page.evaluate(() => (window as any).__keys)
    const hit = seen.find((k: any) => k.key === 's')
    expect(hit).toBeTruthy()
    expect(hit.ctrl).toBe(true) // the modifier survived the whole CLI → REST → widget path
  })

  test('--canvas finds a shadow-DOM canvas hidden behind a light-DOM element of the same name', async ({ page }) => {
    // `resolveCanvasDeep` recorded a non-canvas light-DOM match with an explicit comment saying it
    // was "recorded rather than returned immediately, so the shadow-piercing attempts below still
    // get their turn" — and then returned it immediately, one loop early. So a page with a
    // light-DOM <div class="scene"> and the real <canvas class="scene"> inside a shadow root got a
    // hard "that's a div" instead of the canvas. This is the tosijs-3d shape exactly.
    await injectDevChannel(page)
    await page.evaluate(() => {
      const decoy = document.createElement('div')
      decoy.className = 'scene' // light-DOM match that is NOT a canvas
      document.body.appendChild(decoy)

      const host = document.createElement('div')
      document.body.appendChild(host)
      const sr = host.attachShadow({ mode: 'open' })
      const c = document.createElement('canvas')
      c.className = 'scene'
      c.width = 120
      c.height = 80
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#0af'
      ctx.fillRect(0, 0, 120, 80)
      sr.appendChild(c)
    })

    const res = await (await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas: '.scene', file: false }),
    })).json()

    // It must find the canvas, not report the decoy div.
    expect(JSON.stringify(res)).not.toMatch(/not a canvas|is a div/i)
    expect(res.data?.image || res.image || '').toMatch(/^data:image\//)
  })

  test('--canvas at a genuine non-canvas still says so — the helpful diagnostic is not traded away', async ({ page }) => {
    // The early return existed to produce "that's a div, not a canvas" rather than "not found".
    // Deleting it must not cost that message when there really is no canvas anywhere.
    await injectDevChannel(page)
    await page.evaluate(() => {
      const d = document.createElement('div')
      d.className = 'lonely'
      document.body.appendChild(d)
    })
    const res = await (await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas: '.lonely', file: false }),
    })).json()
    expect(JSON.stringify(res)).toMatch(/div/i) // still names what it found instead
  })

  test('a visually-hidden but operable control is reported, flagged — not silently dropped', async ({ page }) => {
    // The ancestor-aware visibility fix added `rect.width > 0 || rect.height > 0`, which is right
    // for "don't rasterize things nobody can see" and wrong for affordances: the standard
    // accessible file-upload and custom-checkbox pattern is a zero-size <input> driven by a
    // <label>. Dropping it means `hj map` shows a page with no way to upload a file — the map
    // omits a control the user can actually operate, which is a lie of omission.
    //
    // Reported WITH a zeroSize marker, so an agent knows to click the label rather than the input.
    await injectDevChannel(page)
    await page.evaluate(() => {
      const wrap = document.createElement('main')
      wrap.innerHTML =
        '<label id="pick" for="f">Choose a file</label>' +
        '<input id="f" type="file" style="position:absolute;width:0;height:0;opacity:0">' +
        '<button id="real">Visible button</button>'
      document.body.appendChild(wrap)
    })

    const map = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()

    const flat: any[] = []
    const walk = (n: any) => { flat.push(n); (n.children || []).forEach(walk) }
    ;(map.data.nodes || []).forEach(walk)

    // Map nodes carry `ref`/`tag`/`type` — not the DOM id — so match on what a node actually has.
    const fileInput = flat.find((n) => n.tag === 'input' && n.type === 'file')
    expect(fileInput).toBeTruthy()          // present at all — this is the regression
    expect(fileInput.zeroSize).toBe(true)   // and honestly labelled as not occupying space

    // The label is the thing you actually click, so it has to be in the map too.
    expect(flat.find((n) => n.tag === 'label' && /Choose a file/.test(n.text || ''))).toBeTruthy()

    // A normal control carries no marker — so this isn't "report everything", which would be the
    // opposite failure.
    const realButton = flat.find((n) => n.tag === 'button' && /Visible button/.test(n.text || ''))
    expect(realButton).toBeTruthy()
    expect(realButton.zeroSize).toBeUndefined()
  })

  test('a display:none control is still excluded — the guard this replaces still holds', async ({ page }) => {
    await injectDevChannel(page)
    await page.evaluate(() => {
      const wrap = document.createElement('main')
      wrap.innerHTML = '<div style="display:none"><button>Cannot be clicked</button></div>'
      document.body.appendChild(wrap)
    })
    const map = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    // Assert on TEXT, not a DOM id: map nodes carry ref/tag/text and have never carried `id`, so
    // the original `not.toContain('ghost')` was satisfied by a payload that contained the button.
    // It passed under a mutation that deleted the guard entirely — a vacuous assertion certifying
    // the bug, which is exactly the trap this cycle keeps re-learning.
    expect(JSON.stringify(map.data.nodes)).not.toContain('Cannot be clicked')
  })

  test('a zero-height wrapper does NOT prune its visible children', async ({ page }) => {
    // My first draft of the zero-size fix returned null for a zero-size structural element BEFORE
    // recursing, so a wrapper with no box of its own took its entire subtree with it. A container
    // whose children are absolutely positioned legitimately measures 0 high while everything inside
    // it is plainly visible — the review warned about exactly this and I did it anyway. Descend
    // first, decide about the element afterwards.
    await injectDevChannel(page)
    await page.evaluate(() => {
      const wrap = document.createElement('section')
      wrap.style.position = 'relative'
      wrap.style.height = '0' // no box of its own
      wrap.innerHTML =
        '<button style="position:absolute;top:0;left:0;width:120px;height:32px">Still clickable</button>'
      document.body.appendChild(wrap)
    })
    const map = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    expect(JSON.stringify(map.data.nodes)).toContain('Still clickable')
  })

  test('/status and /windows report the SAME window shape, with active/hidden exact inverses', async ({ page }) => {
    // Both endpoints hand-rolled this shape, and the expressions looked different enough that a
    // careful reviewer concluded they disagreed on polarity. They didn't — but `summarizeWindow`
    // was documented (in its own header AND in CLAUDE.md's source table) as "the shape both
    // /status and /windows report" while being called by nothing outside its own test. The docs
    // described an architecture that did not exist, which is how the wrong conclusion got reached.
    // Both now route through the helper; this is what keeps that true.
    await injectDevChannel(page)

    const status = await (await fetch(`${SERVER_URL}/status`)).json()
    const windows = await (await fetch(`${SERVER_URL}/windows`)).json()

    expect(status.windows.length).toBeGreaterThan(0)
    expect(windows.windows.length).toBe(status.windows.length)

    const byId = (list: any[]) => Object.fromEntries(list.map((w) => [w.id, w]))
    const sw = byId(status.windows)
    const ww = byId(windows.windows)

    for (const id of Object.keys(sw)) {
      expect(ww[id]).toBeTruthy() // the same window, visible from both endpoints
      // The fields a consumer might read from either endpoint must agree, and the two polarities
      // must be exact inverses — the whole reason both are emitted.
      for (const field of ['active', 'hidden', 'windowType', 'url']) {
        expect(`${field}:${JSON.stringify(ww[id][field])}`).toBe(`${field}:${JSON.stringify(sw[id][field])}`)
      }
      expect(sw[id].active).toBe(!sw[id].hidden)
      expect(ww[id].active).toBe(!ww[id].hidden)
      expect(typeof sw[id].active).toBe('boolean') // never undefined — that is what broke doctor
    }
  })

  test('map --image writes a real PNG to disk and does NOT return the base64 blob', async ({ page }) => {
    // The v1.9.0 shape change (`data.image` → `data.path`) shipped with no test at any tier, while
    // the write sat inside a bare `catch {}`. So a failed mkdir — read-only /tmp, a sandbox, a full
    // disk — silently restored the ~736k-char base64 response the block exists to prevent, and the
    // whole suite stayed green. Assert the shape AND the bytes.
    await injectDevChannel(page)
    await page.evaluate(() => {
      // APPEND. Assigning to body.innerHTML deletes the injected <haltija-dev> widget along with
      // everything else, the socket drops, and the failure reads as a broken /map endpoint.
      const main = document.createElement('main')
      main.innerHTML = '<h1>Schematic</h1><button>Go</button>'
      document.body.appendChild(main)
    })

    const res = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: true }),
    })).json()

    expect(res.warning).toBeUndefined() // a silent fallback is the bug; a loud one is acceptable
    expect(res.data.image).toBeUndefined()
    expect(typeof res.data.path).toBe('string')

    const { readFileSync, existsSync } = await import('fs')
    expect(existsSync(res.data.path)).toBe(true)
    // Magic bytes, not just a non-empty file: "it wrote something" is not "it wrote a PNG".
    const bytes = readFileSync(res.data.path)
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(bytes.length).toBeGreaterThan(1000)
  })

  test('map --image with file:false returns the data URL, so the fallback shape is real too', async ({ page }) => {
    // The other branch. Without this, `data.path` could become the only shape that ever works and
    // the documented `file:false` escape hatch would rot unnoticed.
    await injectDevChannel(page)
    const res = await (await fetch(`${SERVER_URL}/map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: true, file: false }),
    })).json()

    expect(res.data.path).toBeUndefined()
    expect(res.data.image).toMatch(/^data:image\/png;base64,/)
  })

  test('screenshot with no capture path returns a LABELLED schematic, with canvases as real pixels', async ({ page }) => {
    await injectDevChannel(page)
    // A plain Playwright page: no Electron capturePage, no getDisplayMedia grant — the exact
    // situation where /screenshot used to simply fail.
    await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.id = 'scene'
      c.width = 80
      c.height = 50
      const g = c.getContext('2d')!
      g.fillStyle = '#09f'
      g.fillRect(0, 0, 80, 50)
      document.body.appendChild(c)
      const b = document.createElement('button')
      b.textContent = 'Play'
      document.body.appendChild(b)
    })

    const res = await (await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: false }),
    })).json()

    expect(res.success).toBe(true)
    // Labelled unmistakably: never claims to be a real capture.
    expect(res.data.source).toBe('schematic')
    expect(res.data.image).toContain('data:image/png;base64,')
    // Canvases need no permission, so the actual visual content is still real pixels.
    expect(res.data.canvasesRendered).toBeGreaterThan(0)
    const warning = res.warning || res.data.warning
    expect(warning).toContain('NOT a screenshot')

    // A caller that must not receive a substitute can still demand a hard failure.
    const strict = await (await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: false, fallback: false }),
    })).json()
    expect(strict.success).toBe(false)
    expect(strict.error).toContain('No screenshot capture available')
  })

  test('--canvas pierces shadow DOM (where component renderers put their canvas)', async ({ page }) => {
    await injectDevChannel(page)
    await page.evaluate(() => {
      class TosiB3d extends HTMLElement {
        connectedCallback() {
          const sr = this.attachShadow({ mode: 'open' })
          const c = document.createElement('canvas')
          c.width = 120; c.height = 90
          const g = c.getContext('2d')!
          g.fillStyle = '#7c3aed'; g.fillRect(0, 0, 120, 90)
          sr.appendChild(c)
        }
      }
      if (!customElements.get('tosi-b3d')) customElements.define('tosi-b3d', TosiB3d)
      document.body.appendChild(document.createElement('tosi-b3d'))
    })

    const shoot = async (canvas: string) =>
      (await (await fetch(`${SERVER_URL}/screenshot`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canvas, file: false, chyron: false }),
      })).json())

    // Every shape a caller might reasonably write — all previously failed with "Canvas not found".
    for (const sel of ['tosi-b3d canvas', 'canvas', 'tosi-b3d >>> canvas', '']) {
      const r = await shoot(sel)
      expect(r.success, `selector ${JSON.stringify(sel)} should resolve`).toBe(true)
      expect(r.data.width).toBe(120)
      expect(r.data.canvas.inShadowRoot).toBe('tosi-b3d')
    }

    // A genuine miss lists what IS available, rather than only saying no.
    const miss = await shoot('#nope')
    expect(miss.success).toBe(false)
    expect(miss.error).toContain('tosi-b3d >>> canvas')

    // The schematic embeds the shadow canvas too — that's the page where pixels are all that matter.
    const schematic = await (await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: false, schematic: true }),
    })).json()
    expect(schematic.data.canvasesRendered).toBeGreaterThan(0)
  })

  test('captures a canvas directly — exact pixels, and warns instead of returning a blank image', async ({ page }) => {
    await injectDevChannel(page)

    // A canvas with VARIED content, and a WebGL canvas whose drawing buffer is cleared after
    // compositing (the classic blank-toDataURL trap for 3D scenes).
    await page.evaluate(() => {
      const varied = document.createElement('canvas')
      varied.id = 'varied-canvas'
      varied.width = 120
      varied.height = 80
      const c = varied.getContext('2d')!
      c.fillStyle = '#123'
      c.fillRect(0, 0, 120, 80)
      for (let i = 0; i < 20; i++) {
        c.fillStyle = `hsl(${i * 18},80%,60%)`
        c.fillRect(i * 6, 10 + (i % 5) * 10, 4, 24)
      }
      document.body.appendChild(varied)

      const blank = document.createElement('canvas')
      blank.id = 'blank-canvas'
      blank.width = 120
      blank.height = 80
      const gl = blank.getContext('webgl') // no preserveDrawingBuffer
      if (gl) {
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
      document.body.appendChild(blank)
    })

    // Real content: captured from the canvas itself, no warning.
    const okRes = await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas: '#varied-canvas', file: false, chyron: false }),
    })
    const ok = await okRes.json()
    expect(ok.success).toBe(true)
    expect(ok.data.source).toBe('canvas') // not 'electron'/'getDisplayMedia' — read the canvas
    expect(ok.data.image).toContain('data:image/png;base64,')
    expect(ok.data.width).toBe(120)
    expect(ok.warning).toBeFalsy() // must NOT cry wolf on a legitimate render

    // A non-canvas target fails with an explanation rather than silently screenshotting the page.
    const badRes = await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas: 'body', file: false }),
    })
    const bad = await badRes.json()
    expect(bad.success).toBe(false)
    expect(bad.error).toContain('not a <canvas>')
  })

  test('captures uncaught errors, unhandled rejections, and Error objects — not just console.error strings', async ({ page }) => {
    await injectDevChannel(page)

    // Emit every kind of error a page produces. Before the fix, only the plain string survived:
    // console.error(Error) serialized to "{}", and thrown/rejected errors were never seen at all.
    await page.evaluate(() => {
      console.error('CONSOLE_STRING_e2e')
      console.error(new Error('ERROBJ_e2e'))
      Promise.reject(new Error('REJECT_e2e'))
      setTimeout(() => {
        throw new Error('THROW_e2e')
      }, 0)
    })
    // Let the rejection microtask + the setTimeout throw fire and buffer.
    await page.waitForTimeout(500)

    const res = await fetch(`${SERVER_URL}/console`)
    const body = await res.json()
    const text = JSON.stringify(body)

    expect(text).toContain('CONSOLE_STRING_e2e') // baseline (always worked)
    expect(text).toContain('ERROBJ_e2e') // console.error(new Error) now keeps its message
    expect(text).toContain('REJECT_e2e') // unhandledrejection now captured
    expect(text).toContain('THROW_e2e') // uncaught exception now captured
  })
  
  test('status endpoint works', async () => {
    const res = await fetch(`${SERVER_URL}/status`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('browsers')
    expect(data).toHaveProperty('agents')
    expect(data).toHaveProperty('serverVersion')
    expect(typeof data.serverVersion).toBe('string')
  })
  
  // CRITICAL: These tests verify the single source of truth pattern works.
  // If embedded assets get out of sync with source files, these tests fail.
  // This has been a recurring problem - DO NOT REMOVE THESE TESTS.
  
  test.describe('embedded assets match source files', () => {
    
    test('icon.svg served content matches source file exactly', async () => {
      const fs = await import('fs')
      const path = await import('path')
      
      const sourceIcon = fs.readFileSync(path.join(__dirname, '../haltija-icon.svg'), 'utf-8')
      const res = await fetch(`${SERVER_URL}/icon.svg`)
      const servedIcon = await res.text()
      
      expect(servedIcon).toBe(sourceIcon)
    })
    
    test('app.md content appears in served test page', async () => {
      const fs = await import('fs')
      const path = await import('path')
      
      const appMd = fs.readFileSync(path.join(__dirname, '../docs/getting-started/app.md'), 'utf-8')
      const res = await fetch(`${SERVER_URL}/`)
      const html = await res.text()
      
      // Verify unique phrases from app.md appear in served HTML
      expect(appMd).toContain('browser with superpowers')
      expect(html).toContain('browser with superpowers')
      expect(appMd).toContain('Haltija widget is automatically injected')
      expect(html).toContain('Haltija widget is automatically injected')
    })
    
    test('service.md content appears in served test page', async () => {
      const fs = await import('fs')
      const path = await import('path')
      
      const serviceMd = fs.readFileSync(path.join(__dirname, '../docs/getting-started/service.md'), 'utf-8')
      const res = await fetch(`${SERVER_URL}/`)
      const html = await res.text()
      
      // Verify unique phrases from service.md appear in served HTML
      expect(serviceMd).toContain('Drag the bookmarklet')
      expect(html).toContain('Drag the bookmarklet')
      expect(serviceMd).toContain('inject the widget into a web page')
      expect(html).toContain('inject the widget into a web page')
    })
    
    test('component.js is served and contains expected code', async () => {
      const res = await fetch(`${SERVER_URL}/component.js`)
      expect(res.status).toBe(200)
      const js = await res.text()
      
      // Verify component.js contains expected identifiers
      expect(js).toContain('haltija-dev')
      expect(js).toContain('DevChannel')
      expect(js).toContain('shadowRoot')
    })
    
    test('component.js Unicode characters are properly encoded', async ({ page }) => {
      // This test verifies that UTF-8 special characters in component.js
      // are properly served and rendered in the browser.
      // Previously, characters like ─ ✕ ⌥ were corrupted to âœ• etc.
      
      await page.goto(`${SERVER_URL}/`)
      await page.waitForSelector('haltija-dev')
      
      // Check the actual rendered text in the widget's shadow DOM
      const controlsText = await page.evaluate(() => {
        const widget = document.querySelector('haltija-dev')
        if (!widget || !widget.shadowRoot) return null
        // `querySelector` returns `Element`, and `innerText` is on `HTMLElement`.
        const controls = widget.shadowRoot.querySelector<HTMLElement>('.controls')
        return controls ? controls.innerText : null
      })
      
      expect(controlsText).not.toBeNull()
      // These are the actual Unicode characters that should appear
      expect(controlsText).toContain('─')  // Box drawing horizontal (minimize)
      expect(controlsText).toContain('✕')  // Multiplication X (close)
    })
    
    test('inject.js is served and loads component', async () => {
      const res = await fetch(`${SERVER_URL}/inject.js`)
      expect(res.status).toBe(200)
      const js = await res.text()
      
      // Verify inject.js references the component
      expect(js).toContain('component.js')
      expect(js).toContain('__haltija_config__')
    })
    
    test('all embedded assets are current (meta-test)', async () => {
      const fs = await import('fs')
      const path = await import('path')
      
      // Read the generated embedded-assets.ts to verify it exists and has content
      const embeddedPath = path.join(__dirname, 'embedded-assets.ts')
      expect(fs.existsSync(embeddedPath)).toBe(true)
      
      const embedded = fs.readFileSync(embeddedPath, 'utf-8')
      
      // Verify all expected assets are embedded
      expect(embedded).toContain('export const APP_MD')
      expect(embedded).toContain('export const SERVICE_MD')
      expect(embedded).toContain('export const PLAYGROUND_MD')
      expect(embedded).toContain('export const ICON_SVG')
      expect(embedded).toContain('export const UX_CRIMES_MD')
      
      // Verify the content is not empty stubs
      expect(embedded).toContain('browser with superpowers') // from app.md
      expect(embedded).toContain('Drag the bookmarklet') // from service.md
      expect(embedded).toContain('<svg') // from icon.svg
    })
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
      // `!== null` did NOT exclude `undefined`, which is what the optional chaining above yields
      // when the element or its shadow root is missing — so "no widget at all" reached
      // `undefined.classList` and threw a TypeError instead of reporting `false`. The assertion
      // failed either way, but the reason it gave was wrong, which is the whole complaint.
      return !!widget && !widget.classList.contains('hidden')
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

  test.describe('eval async support', () => {
    const evalCode = async (code: string) => {
      const res = await fetch(`${SERVER_URL}/eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      return res.json()
    }

    test('resolves a returned promise', async () => {
      const data = await evalCode('Promise.resolve(1 + 1)')
      expect(data.success).toBe(true)
      expect(data.data).toBe(2)
    })

    test('supports top-level await', async () => {
      const data = await evalCode('await Promise.resolve("awaited")')
      expect(data.success).toBe(true)
      expect(data.data).toBe('awaited')
    })

    test('supports await in a multi-statement body via return', async () => {
      const data = await evalCode(
        'const n = await Promise.resolve(20); return n + 1'
      )
      expect(data.success).toBe(true)
      expect(data.data).toBe(21)
    })

    test('reports rejections as errors, not results', async () => {
      const data = await evalCode('await Promise.reject(new Error("nope"))')
      expect(data.success).toBe(false)
      expect(data.error).toContain('nope')
    })

    test('a runtime SyntaxError is reported, and the code runs only once', async () => {
      await evalCode('window.__evalRuns = 0')
      // JSON.parse throws SyntaxError at runtime, which must not be mistaken for
      // a parse failure and retried — that would double the side effect.
      const data = await evalCode('window.__evalRuns++; JSON.parse("{")')
      expect(data.success).toBe(false)

      const runs = await evalCode('window.__evalRuns')
      expect(runs.data).toBe(1)
    })
  })

  test('mutation watching via REST', async ({ page }) => {
    // WAIT for the widget, don't skip when it isn't there yet. This was a
    // check-retry-once-then-test.skip() dance, which meant a genuine failure to connect — the
    // precondition every other test in this file depends on — reported as a green skip.
    await page.waitForFunction(
      () => (document.querySelector('haltija-dev') as any)?.state === 'connected',
      undefined,
      { timeout: 5000 },
    )
    
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
    // Was `test.skip()`, which turned a broken endpoint into a green skip — if this
    // regressed for every caller the feature would break with a passing suite.
    expect(watchData.success, 'watchData must succeed; a skip here would hide a real regression').toBe(true)
    
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
    // Was `test.skip()`, which turned a broken endpoint into a green skip — if this
    // regressed for every caller the feature would break with a passing suite.
    expect(watchData.success, 'watchData must succeed; a skip here would hide a real regression').toBe(true)
    
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
  
  test('tree includes part attribute for shadow DOM styling', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'part-test'
      container.innerHTML = `
        <button part="action-button primary">Click me</button>
        <input part="form-input" type="text">
        <span part="label status-label">Status</span>
      `
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#part-test' })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    
    const button = data.data.children.find((c: any) => c.tag === 'button')
    expect(button.attrs.part).toBe('action-button primary')
    
    const input = data.data.children.find((c: any) => c.tag === 'input')
    expect(input.attrs.part).toBe('form-input')
    
    const span = data.data.children.find((c: any) => c.tag === 'span')
    expect(span.attrs.part).toBe('label status-label')
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
    // Wait, don't skip — see the sibling test above.
    await page.waitForFunction(
      () => (document.querySelector('haltija-dev') as any)?.state === 'connected',
      undefined,
      { timeout: 5000 },
    )
    
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

test.describe('haltija-dev visibility and actionable mode', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
    await page.waitForTimeout(500)
  })
  
  test('tree with visibleOnly filters hidden elements', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'visibility-test'
      container.innerHTML = `
        <button id="visible-btn">Visible</button>
        <button id="hidden-btn" hidden>Hidden via attribute</button>
        <button id="display-none" style="display:none">Hidden via display</button>
        <button id="visibility-hidden" style="visibility:hidden">Hidden via visibility</button>
        <button id="aria-hidden" aria-hidden="true">Hidden via aria</button>
        <details id="closed-details">
          <summary>Summary</summary>
          <button id="collapsed-btn">Inside closed details</button>
        </details>
        <details id="open-details" open>
          <summary>Open Summary</summary>
          <button id="expanded-btn">Inside open details</button>
        </details>
      `
      document.body.appendChild(container)
    })
    
    // Without visibleOnly - should see all elements
    const resAll = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#visibility-test', depth: 3, visibleOnly: false })
    })
    const dataAll = await resAll.json()
    expect(dataAll.success).toBe(true)
    
    // Count buttons with specific IDs (our test buttons)
    const findButtons = (node: any, ids: string[]): string[] => {
      const found: string[] = []
      if (node.tag === 'button' && ids.includes(node.id)) {
        found.push(node.id)
      }
      if (node.children) {
        for (const child of node.children) {
          found.push(...findButtons(child, ids))
        }
      }
      return found
    }
    
    const testButtonIds = ['visible-btn', 'hidden-btn', 'display-none', 'visibility-hidden', 'aria-hidden', 'collapsed-btn', 'expanded-btn']
    const allButtons = findButtons(dataAll.data, testButtonIds)
    expect(allButtons.length).toBe(7) // All 7 test buttons (not counting summary buttons)
    
    // With visibleOnly - should only see visible elements
    const resVisible = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#visibility-test', depth: 3, visibleOnly: true })
    })
    const dataVisible = await resVisible.json()
    expect(dataVisible.success).toBe(true)
    const visibleButtons = findButtons(dataVisible.data, testButtonIds)
    expect(visibleButtons.length).toBe(2) // Only visible-btn and expanded-btn
    expect(visibleButtons).toContain('visible-btn')
    expect(visibleButtons).toContain('expanded-btn')
  })
  
  test('tree flags indicate hidden reasons', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'hidden-flags-test'
      container.innerHTML = `
        <div id="hidden-attr" hidden>Hidden</div>
        <div id="aria-hidden" aria-hidden="true">Aria Hidden</div>
        <details id="closed-details">
          <summary>Summary</summary>
          <div id="collapsed-content">Collapsed</div>
        </details>
      `
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#hidden-flags-test', depth: 3, visibleOnly: false })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    
    // Find each element and check flags
    const findNode = (node: any, id: string): any => {
      if (node.id === id) return node
      if (node.children) {
        for (const child of node.children) {
          const found = findNode(child, id)
          if (found) return found
        }
      }
      return null
    }
    
    const hiddenAttr = findNode(data.data, 'hidden-attr')
    expect(hiddenAttr.flags.hidden).toBe(true)
    expect(hiddenAttr.flags.hiddenReason).toBe('hidden-attr')
    
    const ariaHidden = findNode(data.data, 'aria-hidden')
    expect(ariaHidden.flags.hidden).toBe(true)
    expect(ariaHidden.flags.hiddenReason).toBe('aria-hidden')
    
    const collapsedContent = findNode(data.data, 'collapsed-content')
    expect(collapsedContent.flags.hidden).toBe(true)
    expect(collapsedContent.flags.collapsed).toBe(true)
    expect(collapsedContent.flags.hiddenReason).toBe('collapsed-details')
  })
  
  test('tree actionable mode returns summary', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'actionable-test'
      container.innerHTML = `
        <h1>Page Title</h1>
        <h2>Section</h2>
        <button id="btn1">Click Me</button>
        <button id="btn2" disabled>Disabled</button>
        <a href="/about" id="link1">About</a>
        <a href="/contact" id="link2" style="display:none">Hidden Link</a>
        <form>
          <label for="name">Name</label>
          <input type="text" id="name" name="name" placeholder="Enter name" required>
          <input type="email" id="email" name="email" value="test@example.com">
          <select id="country" name="country">
            <option>USA</option>
            <option selected>Canada</option>
            <option>UK</option>
          </select>
        </form>
      `
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#actionable-test', mode: 'actionable' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    
    // Check structure
    expect(data.data.url).toBeDefined()
    expect(data.data.title).toBeDefined()
    
    // Check headings
    expect(data.data.headings.length).toBe(2)
    expect(data.data.headings[0].level).toBe(1)
    expect(data.data.headings[0].text).toBe('Page Title')
    
    // Check buttons
    expect(data.data.buttons.length).toBe(2)
    const btn1 = data.data.buttons.find((b: any) => b.text === 'Click Me')
    expect(btn1).toBeDefined()
    expect(btn1.disabled).toBeUndefined()
    const btn2 = data.data.buttons.find((b: any) => b.text === 'Disabled')
    expect(btn2.disabled).toBe(true)
    
    // Check links — only visible links are collected; hidden (display:none)
    // ones are excluded from the array and reflected in summary.hiddenCount.
    expect(data.data.links.length).toBe(1)
    const visibleLink = data.data.links.find((l: any) => l.text === 'About')
    expect(visibleLink).toBeDefined()
    expect(visibleLink.hidden).toBeUndefined()
    expect(data.data.links.find((l: any) => l.text === 'Hidden Link')).toBeUndefined()
    expect(data.data.summary.hiddenCount).toBeGreaterThanOrEqual(1)
    
    // Check inputs
    expect(data.data.inputs.length).toBe(2)
    const nameInput = data.data.inputs.find((i: any) => i.name === 'name')
    expect(nameInput.label).toBe('Name')
    expect(nameInput.required).toBe(true)
    expect(nameInput.placeholder).toBe('Enter name')
    const emailInput = data.data.inputs.find((i: any) => i.name === 'email')
    expect(emailInput.value).toBe('test@example.com')
    
    // Check selects
    expect(data.data.selects.length).toBe(1)
    expect(data.data.selects[0].options).toContain('Canada')
    expect(data.data.selects[0].selected).toBe('Canada')
    
    // Check summary
    expect(data.data.summary.totalInteractive).toBeGreaterThan(0)
    expect(data.data.summary.formCount).toBe(1)
  })
})

test.describe('test page tab deep-linking', () => {
  test('?tab= lands directly on the tab (no click race)', async ({ page }) => {
    // The playground smoke test relies on this to avoid a flaky
    // navigate → click → assert-visible sequence under headless CI.
    await page.goto(`${SERVER_URL}/?tab=playground`)
    await page.waitForSelector('#tab-playground.active', { timeout: 5000 })
    expect(await page.isVisible('#tab-playground')).toBe(true)
  })
})

test.describe('haltija-dev network error tracking', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
    await page.waitForTimeout(500)
  })
  
  test('captures failed fetch requests in semantic events', async ({ page }) => {
    // Start watching semantic events
    await fetch(`${SERVER_URL}/events/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'debug' }) // debug preset includes console events
    })
    
    await page.waitForTimeout(100)
    
    // Make a fetch request that will fail (404)
    await page.evaluate(async () => {
      try {
        await fetch('/api/nonexistent-endpoint-12345')
      } catch (e) {
        // Expected to fail
      }
    })
    
    await page.waitForTimeout(300)
    
    // Check events for network error
    const eventsRes = await fetch(`${SERVER_URL}/events`)
    const eventsData = await eventsRes.json()
    const events = eventsData.data?.events || []
    
    const networkError = events.find((e: any) => e.type === 'network:error')
    expect(networkError).toBeDefined()
    expect(networkError.payload.url).toContain('nonexistent-endpoint-12345')
    // Status could be 404 (server responded with error) or 0 (network/CORS error)
    expect([0, 404]).toContain(networkError.payload.status)
    expect(networkError.payload.method).toBe('GET')
    
    await fetch(`${SERVER_URL}/events/unwatch`, { method: 'POST' })
  })
})

test.describe('haltija-dev screenshot endpoint', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
    await page.waitForTimeout(500)
  })
  
  test('screenshot in a non-Electron browser returns a labelled schematic (and can still hard-fail)', async ({ page }) => {
    // Behaviour change: this used to be a flat failure. It now degrades to a SCHEMATIC substitute,
    // which is more useful — but the guarantee this test has always protected is unchanged: the
    // caller is never left without an actionable explanation of why there are no real pixels.
    const res = await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.source).toBe('schematic') // never claims to be a real capture
    const warning = data.warning || data.data.warning
    expect(warning).toContain('NOT a screenshot')
    expect(warning).toMatch(/desktop app|🖥|share/i) // still names the routes to real pixels

    // And a caller that must not receive a substitute can still demand the hard error.
    const strict = await (await fetch(`${SERVER_URL}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fallback: false })
    })).json()
    expect(strict.success).toBe(false)
    expect(strict.error).toContain('Haltija Desktop app')
  })
})

test.describe('haltija-dev user recordings', () => {
  test('user recording is saved server-side and retrievable by agent', async ({ page }) => {
    // Navigate and wait for widget to connect
    await page.goto(SERVER_URL)
    await page.waitForSelector('haltija-dev')
    await page.waitForTimeout(500)
    
    // Switch to the Playground tab (where the interactive elements are)
    await page.click('[data-tab="playground"]')
    await page.waitForTimeout(200)
    
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
    
    // Do some interactions (use IDs from the actual test page's Playground tab)
    await page.click('#btn-primary')
    await page.fill('#text-input', 'test recording')
    
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
    
    // Clean up
    await fetch(`${SERVER_URL}/events/unwatch`, { method: 'POST' })
    await fetch(`${SERVER_URL}/recording/${latestRecording.id}`, { method: 'DELETE' })
  })
})

test.describe('haltija-dev new endpoints', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
    await page.waitForTimeout(500)
  })
  
  test('/wait for time delay', async () => {
    const start = Date.now()
    const res = await fetch(`${SERVER_URL}/wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ms: 200 })
    })
    const elapsed = Date.now() - start
    
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.waited).toBe(200)
    expect(elapsed).toBeGreaterThanOrEqual(190)
  })
  
  test('/wait for element to appear', async ({ page }) => {
    // Element doesn't exist yet
    const waitPromise = fetch(`${SERVER_URL}/wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forElement: '#delayed-element', timeout: 3000 })
    })
    
    // Add element after a delay
    setTimeout(async () => {
      await page.evaluate(() => {
        const div = document.createElement('div')
        div.id = 'delayed-element'
        document.body.appendChild(div)
      })
    }, 500)
    
    const res = await waitPromise
    const data = await res.json()
    
    expect(data.success).toBe(true)
    expect(data.found).toBe(true)
    expect(data.waited).toBeGreaterThanOrEqual(400)
    expect(data.waited).toBeLessThan(2000)
  })
  
  test('/wait for element to disappear', async ({ page }) => {
    // Add element first
    await page.evaluate(() => {
      const div = document.createElement('div')
      div.id = 'disappearing-element'
      document.body.appendChild(div)
    })
    
    // Start waiting for it to disappear
    const waitPromise = fetch(`${SERVER_URL}/wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forElement: '#disappearing-element', hidden: true, timeout: 3000 })
    })
    
    // Remove element after delay
    setTimeout(async () => {
      await page.evaluate(() => {
        document.querySelector('#disappearing-element')?.remove()
      })
    }, 500)
    
    const res = await waitPromise
    const data = await res.json()
    
    expect(data.success).toBe(true)
    expect(data.waited).toBeGreaterThanOrEqual(400)
  })
  
  test('/find by text content', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'find-test'
      container.innerHTML = `
        <button id="btn-save">Save Changes</button>
        <button id="btn-cancel">Cancel</button>
        <a href="#" id="link-learn">Learn More</a>
      `
      document.body.appendChild(container)
    })
    
    // Find button by text
    const res = await fetch(`${SERVER_URL}/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Save', tag: 'button' })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.found).toBe(true)
    expect(data.element.tag).toBe('button')
    expect(data.element.text).toContain('Save')
  })
  
  test('/find all matches', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'find-all-test'
      container.innerHTML = `
        <button>Delete Item 1</button>
        <button>Delete Item 2</button>
        <button>Delete Item 3</button>
        <button>Save</button>
      `
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Delete', tag: 'button', all: true })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.found).toBe(true)
    expect(data.count).toBe(3)
    expect(data.elements.length).toBe(3)
  })
  
  test('/click by text', async ({ page }) => {
    await page.evaluate(() => {
      const btn = document.createElement('button')
      btn.id = 'text-click-btn'
      btn.textContent = 'Click Me Please'
      btn.onclick = () => { (window as any).textClickWorked = true }
      document.body.appendChild(btn)
    })
    
    const res = await fetch(`${SERVER_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Click Me', tag: 'button' })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    
    await page.waitForTimeout(100)
    const clicked = await page.evaluate(() => (window as any).textClickWorked)
    expect(clicked).toBe(true)
  })
  
  test('tree shows input values', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'value-test'
      container.innerHTML = `
        <input type="text" id="text-val" value="">
        <input type="checkbox" id="check-val">
        <select id="select-val">
          <option value="a">Option A</option>
          <option value="b" selected>Option B</option>
        </select>
      `
      document.body.appendChild(container)
      // Set values programmatically (like React would)
      const textInput = document.querySelector('#text-val') as HTMLInputElement
      textInput.value = 'Hello World'
      const checkInput = document.querySelector('#check-val') as HTMLInputElement
      checkInput.checked = true
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#value-test', depth: 2 })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    
    const textInput = data.data.children.find((c: any) => c.id === 'text-val')
    expect(textInput.value).toBe('Hello World')
    
    const checkInput = data.data.children.find((c: any) => c.id === 'check-val')
    expect(checkInput.checked).toBe(true)
    
    const selectInput = data.data.children.find((c: any) => c.id === 'select-val')
    expect(selectInput.value).toBe('b')
  })
  
  test('tree with ancestors shows parent path', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'ancestor-outer'
      container.className = 'outer-class'
      container.innerHTML = `
        <div id="ancestor-middle" class="middle-class">
          <div id="ancestor-inner" class="inner-class">
            <button id="deep-button">Deep Button</button>
          </div>
        </div>
      `
      document.body.appendChild(container)
    })
    
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#deep-button', ancestors: true })
    })
    
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.tag).toBe('button')
    expect(data.data.ancestors).toBeDefined()
    expect(data.data.ancestors.length).toBeGreaterThanOrEqual(3)
    
    // Check ancestors include our known elements
    const ancestorIds = data.data.ancestors.map((a: any) => a.id).filter(Boolean)
    expect(ancestorIds).toContain('ancestor-outer')
    expect(ancestorIds).toContain('ancestor-middle')
    expect(ancestorIds).toContain('ancestor-inner')
  })
})

test.describe('haltija-dev :text() pseudo-selectors', () => {
  test.beforeEach(async ({ page }) => {
    await injectDevChannel(page)
    await page.waitForTimeout(500)
    
    // Set up test DOM with various text content
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'text-selector-test'
      container.innerHTML = `
        <button id="signin-btn">Sign in</button>
        <button id="signup-btn">Sign Up</button>
        <button id="logout-btn">Log Out</button>
        <a id="about-link" href="/about">About Us</a>
        <a id="contact-link" href="/contact">Contact Support</a>
        <h1 id="title">Dashboard</h1>
        <h2 id="subtitle">Welcome Back</h2>
        <p id="paragraph">This is a longer paragraph with some text in it.</p>
        <span id="empty-span"></span>
        <div id="nested"><span>Nested Text Content</span></div>
      `
      document.body.appendChild(container)
    })
  })
  
  test(':text() finds element by substring match (case-insensitive)', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text(sign in)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('signin-btn')
  })
  
  test(':text() is case-insensitive', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text(SIGN IN)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('signin-btn')
  })
  
  test(':text() with quoted string', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text("Sign Up")' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('signup-btn')
  })
  
  test(':text() with single-quoted string', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: "button:text('log out')" })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('logout-btn')
  })
  
  test(':text() without tag matches any element', async () => {
    // :text() without a tag qualifier uses '*' as base, matching first element
    // whose innerText contains the search text. This will be the h1 itself.
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: ':text-is(dashboard)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('title')
  })
  
  test(':text() does substring matching', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'a:text(support)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('contact-link')
  })
  
  test(':text-is() requires exact text match (case-insensitive)', async () => {
    // "Sign in" exact match should work
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text-is(sign in)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('signin-btn')
    
    // Substring should NOT match with :text-is()
    const res2 = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text-is(sign)' })
    })
    const data2 = await res2.json()
    expect(data2.success).toBe(true)
    expect(data2.data).toBeNull()
  })
  
  test(':has-text() works as alias for :text()', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:has-text(sign in)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('signin-btn')
  })
  
  test(':text() works with querySelectorAll via query all', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text(sign)', all: true })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.length).toBe(2) // "Sign in" and "Sign Up"
    const ids = data.data.map((d: any) => d.id).sort()
    expect(ids).toEqual(['signin-btn', 'signup-btn'])
  })
  
  test(':text() works with /click', async ({ page }) => {
    // Set up click tracking
    await page.evaluate(() => {
      (window as any).textClickWorked = false
      document.getElementById('signin-btn')!.onclick = () => {
        (window as any).textClickWorked = true
      }
    })
    
    await fetch(`${SERVER_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text(sign in)' })
    })
    
    await page.waitForTimeout(300)
    
    const clicked = await page.evaluate(() => (window as any).textClickWorked)
    expect(clicked).toBe(true)
  })
  
  test(':text() works with /inspect', async () => {
    // First verify the element exists via /query
    const queryRes = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'h1:text(dashboard)' })
    })
    const queryData = await queryRes.json()
    expect(queryData.success).toBe(true)
    expect(queryData.data?.tagName).toBe('h1')
    
    // Now inspect it
    const res = await fetch(`${SERVER_URL}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'h1:text(dashboard)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.tagName).toBe('h1')
    expect(data.data.text.textContent).toContain('Dashboard')
  })
  
  test(':text() works with /tree', async () => {
    const res = await fetch(`${SERVER_URL}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#nested:text(nested text)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.tag).toBe('div')
    expect(data.data.id).toBe('nested')
  })
  
  test(':text() returns null for no match', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text(nonexistent)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data).toBeNull()
  })
  
  test('standard CSS selectors still work unchanged', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#signin-btn' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('signin-btn')
  })
  
  test(':text(/regex/) is case-sensitive by default', async () => {
    // "Sign in" with correct case should match
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text(/Sign in/)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('signin-btn')
    
    // Wrong case should NOT match
    const res2 = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text(/sign in/)' })
    })
    const data2 = await res2.json()
    expect(data2.success).toBe(true)
    expect(data2.data).toBeNull()
  })
  
  test(':text(/regex/i) enables case-insensitive matching', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text(/sign in/i)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('signin-btn')
  })
  
  test(':text(/pattern/) supports regex alternation', async () => {
    // Match buttons containing "Sign" or "Log"
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'button:text(/Sign|Log/)', all: true })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.length).toBe(3) // Sign in, Sign Up, Log Out
  })
  
  test(':text(/^exact$/) anchored regex for exact match', async () => {
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'h1:text(/^Dashboard$/)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('title')
    
    // Partial anchor should NOT match
    const res2 = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'h1:text(/^Dash$/)' })
    })
    const data2 = await res2.json()
    expect(data2.success).toBe(true)
    expect(data2.data).toBeNull()
  })
  
  test(':text(/regex/) with character classes', async () => {
    // Match elements with text starting with "Welcome"
    const res = await fetch(`${SERVER_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: 'h2:text(/^Welcome\\s+Back$/i)' })
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data?.id).toBe('subtitle')
  })
})

test.describe('a framed widget does not steal the tab\'s identity', () => {
  /**
   * sessionStorage is scoped per-origin per-TAB, and a same-origin (or `srcdoc`/`about:blank`)
   * iframe shares its parent's. So a widget injected into a frame read the very same
   * `haltija-window-id` and registered under it — and because the server keys `windows` by that id,
   * the frame OVERWROTE the tab. `/windows` then listed ONE window whose `windowType` had flipped
   * to `iframe` and whose url had become `about:blank`, and every command — including one
   * explicitly targeting the tab's own id — was answered by the frame. The page you meant to drive
   * was gone while still looking present.
   *
   * Framed widgets are wanted (a frame is a legitimate target), so the fix gives the frame its own
   * identity rather than refusing to inject.
   *
   * TWO things make this test representative, and it is worthless without either:
   *  - a REAL http origin (not `page.setContent`, whose `about:blank` document has no usable
   *    sessionStorage — every widget then mints a fresh id anyway and the test passes unfixed);
   *  - component.js loaded INSIDE the frame, so the widget's own `window` is the frame's. Creating
   *    the element with the PARENT's constructor captures the parent's `window`, and the frame then
   *    reports itself as a `tab`.
   */
  test('a same-origin iframe registers as its own window', async ({ page }) => {
    // A real origin, so sessionStorage exists and is shared with the frame.
    await page.goto(SERVER_URL)
    await page.evaluate(async (wsUrl) => {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script')
        s.src = '/component.js'
        s.onload = () => resolve()
        s.onerror = () => reject(new Error('component.js failed to load'))
        document.head.appendChild(s)
      })
      await customElements.whenDefined('haltija-dev')
      if (!document.querySelector('haltija-dev')) {
        const DC = (window as any).DevChannel
        const el = DC.elementCreator()()
        el.setAttribute('server', wsUrl)
        document.body.appendChild(el)
      }
    }, WS_URL)

    let before: any
    for (let i = 0; i < 40; i++) {
      before = await (await fetch(`${SERVER_URL}/windows`)).json()
      if (before.windows.length >= 1) break
      await page.waitForTimeout(200)
    }
    expect(before.windows.length).toBe(1)
    const tabId = before.windows[0].id
    expect(before.windows[0].windowType).toBe('tab')

    // A same-origin frame that loads the component ITSELF, so its widget sees the frame's window
    // — and its frame-shared sessionStorage already holds the tab's id.
    await page.evaluate((wsUrl) => {
      const f = document.createElement('iframe')
      f.style.width = '300px'
      f.style.height = '120px'
      f.srcdoc =
        `<!DOCTYPE html><html><body><button>FrameOnly</button>` +
        `<script src="/component.js"><\/script>` +
        `<script>customElements.whenDefined('haltija-dev').then(() => {` +
        `  const el = window.DevChannel.elementCreator()();` +
        `  el.setAttribute('server', ${JSON.stringify(wsUrl)});` +
        `  document.body.appendChild(el);` +
        `})<\/script></body></html>`
      document.body.appendChild(f)
    }, WS_URL)

    let after: any
    for (let i = 0; i < 40; i++) {
      after = await (await fetch(`${SERVER_URL}/windows`)).json()
      if (after.windows.length > 1) break
      await page.waitForTimeout(200)
    }

    // TWO windows, not one overwritten one. THIS is the assertion that fails without the fix:
    // the frame reuses the tab's id, so the map never grows past one entry.
    expect(after.windows.length).toBe(2)
    expect(new Set(after.windows.map((w: any) => w.id)).size).toBe(2)

    // The tab is still there, still a tab, still the untargeted target.
    const tab = after.windows.find((w: any) => w.id === tabId)
    expect(tab).toBeTruthy()
    expect(tab.windowType).toBe('tab')
    expect(tab.focused).toBe(true)

    // And the frame is present under an id of its own, correctly typed.
    const frame = after.windows.find((w: any) => w.id !== tabId)
    expect(frame.windowType).toBe('iframe')
  })
})

test.describe('/find returns the innermost match, not the whole app', () => {
  /**
   * `/find` carried its OWN text search — `document.querySelectorAll(tag)` in document order,
   * returning the FIRST match. Every ancestor of a hit also contains its text, so the first match
   * is the OUTERMOST one: on a real app it answered `app-layout:nth-of-type(1)` — the entire
   * application — with `found: true` and exit 0. A false positive that reads as success is worse
   * than a miss (issue #24).
   *
   * It survived because `:text()` was fixed to prefer the innermost match in a DIFFERENT code path
   * (`resolveSelectorAll`), and nothing tied the two together. Two implementations of "find me the
   * element with this text" will always diverge; `/find` now gathers candidates through the
   * widget's own resolver, which also gets it shadow-DOM piercing for free.
   */
  test('nested ancestors do not win, and shadow content is reachable', async ({ page }) => {
    await injectDevChannel(page)
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', `
        <app-layout style="display:block">
          <div style="position:fixed;inset:0">
            <nav style="display:block;width:200px;height:300px">
              <a href="/insights" style="display:block;width:200px;height:40px">
                <span style="display:inline-block">Automation Insights</span>
              </a>
            </nav>
          </div>
        </app-layout>`)
      const host = document.createElement('div')
      document.body.appendChild(host)
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<section><a href="/deep" style="display:block;width:180px;height:40px">Deep Shadow Link</a></section>'
    })

    const find = async (text: string) => {
      const res = await fetch(`${SERVER_URL}/find`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      return res.json()
    }

    // The innermost element whose text is the match — NOT app-layout, nav, or the <a>.
    const hit = await find('Automation Insights')
    expect(hit.found).toBe(true)
    expect(hit.element.tag).toBe('span')

    // A `position: fixed` ancestor must not make anything unfindable: the old visibility gate was
    // `offsetParent === null`, which is null for html, body and EVERY fixed element.
    expect(hit.element.text).toContain('Automation Insights')

    // Shadow content is reachable, and flagged — the generated CSS selector cannot cross the
    // boundary, and handing one back unqualified would be a selector that resolves to nothing.
    const deep = await find('Deep Shadow Link')
    expect(deep.found).toBe(true)
    expect(deep.element.tag).toBe('a')
    expect(deep.element.inShadow).toBe(true)
  })
})

test.describe('text selectors prefer the element a human could act on', () => {
  /**
   * Two ways the same selector chose the wrong element (issue #27), both found by an agent driving
   * a real admin app:
   *
   *  - a `display:none` copy that came FIRST in DOM order was selected, then rejected by the
   *    visibility gate — so `hj click` failed with "zero-size bounding rect" while the visible copy
   *    sat right there, and `hj find`, which filters before choosing, returned the right one. One
   *    selector, two answers.
   *  - the `position:absolute; left:-9999px` skip-link idiom has a perfectly normal box (measured:
   *    99x35 at x=-9999), so every size and style check passed it. `click` actuated an element no
   *    human can see and reported SUCCESS — a script then asserts against a state it never produced.
   *
   * The second is the dangerous one: it fails silently and confidently.
   */
  test('a hidden or off-canvas duplicate never wins over a visible one', async ({ page }) => {
    await injectDevChannel(page)
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = '.offscreen { position: absolute; left: -9999px; }'
      document.head.appendChild(style)
      document.body.insertAdjacentHTML('beforeend', `
        <div style="position:fixed;inset:0;padding:20px">
          <button id="hidden-save" style="display:none">Save Changes</button>
          <button id="visible-save">Save Changes</button>
          <a class="offscreen" id="offscreen-link" href="#skip">Export CSV</a>
          <button id="visible-export">Export CSV</button>
        </div>`)
      ;(window as any).__clicked = null
      document.addEventListener(
        'click',
        (e) => { (window as any).__clicked = ((e.target as Element).closest('[id]') as HTMLElement)?.id },
        true,
      )
    })

    const clickText = async (text: string) => {
      const res = await fetch(`${SERVER_URL}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selector: `:text(${text})` }),
      })
      const json = await res.json()
      const actuated = await page.evaluate(() => (window as any).__clicked)
      return { ok: json.success, actuated }
    }

    // The visible copy wins even though the hidden one comes first in DOM order.
    const save = await clickText('Save Changes')
    expect(save.ok).toBe(true)
    expect(save.actuated).toBe('visible-save')

    // ...and even though the off-canvas one has a real, non-zero box.
    const exp = await clickText('Export CSV')
    expect(exp.ok).toBe(true)
    expect(exp.actuated).toBe('visible-export')

    // `find` must agree with `click` — them disagreeing is what made this reportable.
    const found = await (await fetch(`${SERVER_URL}/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Export CSV' }),
    })).json()
    expect(found.element.id).toBe('visible-export')
  })

  test('an off-canvas element alone fails loudly rather than clicking invisibly', async ({ page }) => {
    await injectDevChannel(page)
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = '.offscreen { position: absolute; left: -9999px; }'
      document.head.appendChild(style)
      document.body.insertAdjacentHTML('beforeend', '<a class="offscreen" id="only" href="#s">Skip to content</a>')
    })
    const res = await fetch(`${SERVER_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: ':text(Skip to content)' }),
    })
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(String(json.error)).toContain('off-canvas')
  })
})
