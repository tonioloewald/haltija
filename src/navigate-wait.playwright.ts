/**
 * /navigate and /refresh wait for the NEW page (#54, reported by Snowfox).
 *
 * They used to reply as soon as the navigation started. Driving 8 routes with an evaluate sent
 * straight after each navigate, the first answer came from the OLD page, or was "No browser
 * connected", or timed out after 5 s, on every route. With a 2.5 s pause, never. These tests send
 * the evaluate immediately, as an agent or script naturally would, and require the new page.
 */
import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'http'
import { startTestServer, type TestServer } from './playwright-server'
import { uniqueTestPort } from './test-ports'

let hal: TestServer
let app: Server
let APP: string

test.beforeAll(async () => {
  hal = await startTestServer({})
  const port = uniqueTestPort()
  APP = `http://localhost:${port}`
  app = createServer((req, res) => {
    const path = new URL(req.url!, APP).pathname
    res.writeHead(200, { 'content-type': 'text/html' })
    // Every load gets a fresh boot id, so a reload is distinguishable from the page before it.
    res.end(`<!doctype html><title>${path}</title>
<script>globalThis.__boot = Math.random().toString(36).slice(2)</script>
<script src="${hal.serverUrl}/component.js?autoInject=true&serverUrl=${hal.wsUrl}"></script>
<h1>${path}</h1>`)
  })
  await new Promise<void>((r) => app.listen(port, r))
})
test.afterAll(async () => {
  app?.close()
  await hal?.stop()
})

const post = async (p: string, b: any) =>
  (await fetch(hal.serverUrl + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json()
const here = () => post('/eval', { code: '({ path: location.pathname, boot: globalThis.__boot })' })

test.beforeEach(async ({ page }) => {
  await page.goto(APP + '/start')
  await expect.poll(async () => (await (await fetch(hal.serverUrl + '/status')).json()).browsers).toBeGreaterThan(0)
})

test('the first command after /navigate is answered by the NEW page, every time', async () => {
  for (let i = 0; i < 6; i++) {
    const nav = await post('/navigate', { url: `${APP}/route-${i}` })
    expect(nav.success).toBe(true)
    expect(nav.data.reconnected).toBe(true)
    const first = await here()
    expect(first.success).toBe(true)
    expect(first.data.path).toBe(`/route-${i}`)
  }
})

test('the first command after /refresh is answered by the RELOADED page', async () => {
  const before = await here()
  const r = await post('/refresh', { soft: true })
  expect(r.data.reconnected).toBe(true)
  const after = await here()
  expect(after.success).toBe(true)
  expect(after.data.boot).not.toBe(before.data.boot)
})

test('a #hash-only navigation returns at once; there is no new page to wait for', async () => {
  const t0 = Date.now()
  const nav = await post('/navigate', { url: `${APP}/start#section` })
  expect(nav.success).toBe(true)
  expect(nav.data.sameDocument).toBe(true)
  expect(Date.now() - t0).toBeLessThan(1500)
})

test('wait: false keeps the old immediate reply', async () => {
  const nav = await post('/navigate', { url: `${APP}/nowait`, wait: false })
  expect(nav.success).toBe(true)
  expect(nav.data?.reconnected).toBeUndefined()
})
