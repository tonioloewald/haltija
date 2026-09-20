/**
 * The `testInBrowser` bridge (#51) — proven rather than asserted.
 *
 * This exists because the proposal was originally backed only by a throwaway script and a
 * transcript. A capability demonstrated in conversation is not one the repo knows: nobody can
 * re-run it, and nothing notices when it stops working. The claim in #51 should be checked by
 * something, so here it is.
 *
 * What is being proven: a test body written as a FUNCTION in a Node/Bun process can be shipped
 * into a real browser, execute against real DOM, and — critically — **fail the host when it
 * fails**. A bridge that swallowed browser-side failures would report green for work it never
 * did, which is the defect this project exists to eliminate, so that case is tested first.
 */
import { test, expect, type Page } from '@playwright/test'
import { startTestServer, type TestServer } from './playwright-server'

let server: TestServer
let SERVER_URL: string
let WS_URL: string

test.beforeAll(async () => {
  server = await startTestServer({ logPrefix: '[tib-server]' })
  SERVER_URL = server.serverUrl
  WS_URL = server.wsUrl
})
test.afterAll(async () => { await server?.stop() })

/**
 * THE BRIDGE. Serialize the closure, eval it in the page, marshal the verdict back.
 *
 * No closure capture: the body is re-parsed in the page, so anything it needs must arrive as an
 * argument — the same constraint as `page.evaluate`, and the thing adopters will trip over.
 */
function serialize(fn: (...a: any[]) => any, args: any[] = []): string {
  return `(${fn.toString()})(...${JSON.stringify(args)})`
}

async function runInBrowser(
  evalCode: (code: string) => Promise<any>,
  fn: (...a: any[]) => any,
  args: any[] = [],
): Promise<{ pass: boolean; error?: string }> {
  const res = await evalCode(`(async () => {
    const expect = (actual) => ({
      toBe: (e) => { if (actual !== e) throw new Error('expected ' + JSON.stringify(e) + ', got ' + JSON.stringify(actual)) },
      toContain: (e) => { if (!String(actual).includes(e)) throw new Error('expected to contain ' + JSON.stringify(e)) },
    })
    try { await ${serialize(fn, args)}; return { pass: true } }
    catch (e) { return { pass: false, error: String((e && e.message) || e) } }
  })()`)
  return res?.data ?? res
}

async function inject(page: Page) {
  await page.goto(`${SERVER_URL}/`)
  await page.addScriptTag({ url: `${SERVER_URL}/component.js` })
  await page.waitForFunction(() => !!document.querySelector('haltija-dev'), { timeout: 15000 })
  for (let i = 0; i < 40; i++) {
    const s = await (await fetch(`${SERVER_URL}/status`)).json()
    if (s.browsers > 0) return
    await page.waitForTimeout(250)
  }
  throw new Error('widget never connected')
}

const evalOnServer = async (code: string) => {
  const r = await fetch(`${SERVER_URL}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  return r.json()
}

test.describe('testInBrowser bridge (#51)', () => {
  test.beforeEach(async ({ page }) => {
    await inject(page)
    await page.evaluate(() => {
      document.querySelectorAll('#tib-fx').forEach((n) => n.remove())
      const d = document.createElement('div')
      d.id = 'tib-fx'
      d.innerHTML =
        '<button id="tib-btn" style="width:80px;height:30px">Add</button><span id="tib-count">0</span>'
      document.body.appendChild(d)
      d.querySelector('#tib-btn')!.addEventListener('click', () => {
        const c = document.getElementById('tib-count')!
        c.textContent = String(Number(c.textContent) + 1)
      })
    })
  })

  // FIRST, because everything else is worthless if this does not hold. A harness that reports
  // success for a failing assertion is worse than no harness.
  test('a failing assertion fails the HOST — the bridge is not vacuous', async () => {
    const r = await runInBrowser(evalOnServer, () => {
      // @ts-expect-error `expect` is injected into the page, not imported here
      expect(1).toBe(2)
    })
    expect(r.pass).toBe(false)
    expect(r.error).toContain('expected 2, got 1')
  })

  test('the body executes against REAL DOM, with real geometry', async () => {
    const r = await runInBrowser(evalOnServer, () => {
      const rect = document.getElementById('tib-btn')!.getBoundingClientRect()
      // happy-dom returns 0 here — this is the whole argument for the feature.
      // @ts-expect-error injected
      expect(rect.width).toBe(80)
    })
    expect(r.error ?? '').toBe('')
    expect(r.pass).toBe(true)
  })

  test('arguments cross the boundary, since closures cannot', async () => {
    const r = await runInBrowser(
      evalOnServer,
      (sel: string, want: string) => {
        // @ts-expect-error injected
        expect(document.querySelector(sel).textContent).toBe(want)
      },
      ['#tib-count', '0'],
    )
    expect(r.pass).toBe(true)
  })

  // The differentiator over page.evaluate: haltija DRIVES, the body ASSERTS.
  test("haltija's realistic click composes with an in-page assertion", async () => {
    const clicked = await fetch(`${SERVER_URL}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#tib-btn' }),
    }).then((r) => r.json())
    expect(clicked.success).toBe(true)

    const r = await runInBrowser(evalOnServer, () => {
      // @ts-expect-error injected
      expect(document.getElementById('tib-count').textContent).toBe('1')
    })
    expect(r.error ?? '').toBe('')
    expect(r.pass).toBe(true)
  })
})
