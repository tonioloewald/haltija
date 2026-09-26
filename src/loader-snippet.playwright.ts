/**
 * The pasted loader snippet falls back across transports (#32c) — and the claim that makes that
 * legal is held to a control.
 *
 * The claim, which is ENGINE-SPECIFIC: Chromium and Firefox let an https page reach
 * `http://localhost` (loopback is a potentially trustworthy origin); WebKit/Safari blocks it as
 * mixed content. This repo has been wrong both ways — "always blocked", then "never blocked" from a
 * Chromium-only measurement — so each engine's answer is asserted here, not just the one we like.
 *
 * A test that only shows "it connected" is not enough either: an earlier attempt showed "localhost
 * works" in an environment where the LAN IP ALSO worked, i.e. a permissive environment that proved
 * nothing. So the control is here too: the same reach from a LAN-IP page must be refused. If the
 * control ever passes, this suite fails, because then the localhost result means nothing.
 *
 * The app pages are served by REAL http/https servers (throwaway self-signed cert), not
 * `page.route`. A route-fulfilled page has no IP address space, so Chromium's Local Network Access
 * check refuses its loopback subresources ("Permission was denied for this request to access the
 * `unknown` address space") — the fallback "failed" for a reason no real page ever meets. A genuine
 * `https://localhost` page is loopback → loopback and is not subject to it. `isSecureContext` is
 * asserted, not assumed. The CHANNEL is a real haltija server, http-only — the configuration #32 hit.
 *
 * `bun run test:e2e` runs it in Chromium only (`playwright.config.ts`). Run all three engines with
 * `bun run test:engines` (needs `npx playwright install firefox webkit`).
 */
import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { createServer as createHttpServer, type Server } from 'http'
import { createServer as createHttpsServer } from 'https'
import { networkInterfaces, tmpdir } from 'os'
import { join } from 'path'
import { startTestServer, type TestServer } from './playwright-server'
import { uniqueTestPort } from './test-ports'
import { loaderSnippetHtml } from './loader-snippet'

/**
 * Engines that block https → http://localhost as mixed content. Measured, not assumed: WebKit's
 * console says "[blocked] The page at https://localhost:… requested insecure content from http://…".
 */
const blocksLoopbackFromHttps = (browserName: string) => browserName === 'webkit'

let server: TestServer
/** Nothing listens here: it stands in for an https transport that is down. */
let deadHttpsPort: number
/** The app ("dev server") pages, over each scheme. Bound on all interfaces for the LAN control. */
let httpsApp: { port: number; server: Server }
let httpApp: { port: number; server: Server }
/** What the app servers return for any path — set per test. */
let appBody = ''
let certDir: string

// The page is self-signed https; accepting the cert here is the test equivalent of the user
// clicking through once. It does not touch the mixed-content or loopback rules under test.
test.use({ ignoreHTTPSErrors: true })

// 0.0.0.0, not 127.0.0.1, on purpose: the LAN-IP control needs the same page reachable over the
// machine's LAN address. It serves a static test page for the suite's duration only.
const listen = (srv: Server, port: number) =>
  new Promise<{ port: number; server: Server }>((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(port, '0.0.0.0', () => resolve({ port, server: srv }))
  })

test.beforeAll(async () => {
  server = await startTestServer({ logPrefix: '[loader-server]' })
  deadHttpsPort = uniqueTestPort()

  certDir = mkdtempSync(join(tmpdir(), 'haltija-loader-cert-'))
  const key = join(certDir, 'key.pem')
  const cert = join(certDir, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' })

  const handler = (_req: any, res: any) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!doctype html><title>app</title>${appBody}`)
  }
  httpsApp = await listen(createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, handler), uniqueTestPort())
  httpApp = await listen(createHttpServer(handler), uniqueTestPort())
})
test.afterAll(async () => {
  httpsApp?.server.close()
  httpApp?.server.close()
  if (certDir) rmSync(certDir, { recursive: true, force: true })
  await server?.stop()
})

function lanIPv4(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
}

async function serveApp(pw: Page, url: string, body = '') {
  appBody = body
  await pw.goto(url)
}

async function browsers(): Promise<number> {
  return (await (await fetch(`${server.serverUrl}/status`)).json()).browsers
}

async function waitForBrowsers(atLeast: number, ms = 10000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) {
    if ((await browsers()) >= atLeast) return true
  }
  return false
}

test.describe('loader snippet — transport fallback (#32c)', () => {
  test('an https localhost page falls back to an http-only channel — except in WebKit', async ({ page, browserName }) => {
    const warnings: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
    const before = await browsers()
    const snippet = loaderSnippetHtml({ httpPort: server.port, httpsPort: deadHttpsPort })
    await serveApp(page, `https://localhost:${httpsApp.port}/`, snippet)

    expect(await page.evaluate(() => isSecureContext)).toBe(true)

    if (blocksLoopbackFromHttps(browserName)) {
      // Safari's users get the honest failure, not a silent one: both attempts fail, both tags are
      // gone, and the warning names the HTTPS address that would fix it.
      await expect.poll(() => warnings.some((w) => w.includes('no channel reachable'))).toBe(true)
      expect(await page.$$('script[src*="component.js"]')).toHaveLength(0)
      expect(await browsers()).toBe(before)
      return
    }

    expect(await waitForBrowsers(before + 1)).toBe(true)

    // Exactly one component tag survives, and it is the http one — the failed https tag was
    // removed, or `autoInject()` would have read ITS serverUrl and dialled the dead transport.
    const srcs = await page.$$eval('script[src*="component.js"]', (ss) => ss.map((s) => s.getAttribute('src')))
    expect(srcs).toHaveLength(1)
    expect(srcs[0]).toContain(`http://localhost:${server.port}/`)
  })

  test('control: the same reach from an https LAN-IP page is refused by the browser', async ({ page, browserName }) => {
    const ip = lanIPv4()
    test.skip(!ip, 'no non-internal IPv4 interface, so there is no LAN origin to use as the control')

    await serveApp(page, `https://${ip}:${httpsApp.port}/`)
    expect(await page.evaluate(() => isSecureContext)).toBe(true)

    // Same probe from both origins: open a ws:// to the channel's own host. Only the
    // loopback one may succeed, and only in engines that exempt loopback.
    const probe = (wsUrl: string) =>
      page.evaluate(
        (u) =>
          new Promise<string>((resolve) => {
            try {
              const ws = new WebSocket(u)
              ws.onopen = () => { ws.close(); resolve('open') }
              ws.onerror = () => resolve('error')
            } catch (e: any) {
              resolve(`threw ${e?.name}`)
            }
          }),
        wsUrl,
      )

    const blocks = blocksLoopbackFromHttps(browserName)
    // Chromium/Firefox throw synchronously; WebKit blocks and reports it as an error event.
    expect(await probe(`ws://${ip}:${server.port}/ws/browser`)).toBe(blocks ? 'error' : 'threw SecurityError')

    await serveApp(page, `https://localhost:${httpsApp.port}/`)
    expect(await probe(`ws://localhost:${server.port}/ws/browser`)).toBe(blocks ? 'error' : 'open')
  })

  test('an https LAN-IP page does not even try http, and says why it gave up', async ({ page }) => {
    const ip = lanIPv4()
    test.skip(!ip, 'no non-internal IPv4 interface')

    const warnings: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
    const requested: string[] = []
    page.on('request', (r) => requested.push(r.url()))

    await serveApp(page, `https://${ip}:${httpsApp.port}/`, loaderSnippetHtml({ httpPort: server.port, httpsPort: deadHttpsPort }))
    await expect.poll(() => warnings.some((w) => w.includes('no channel reachable'))).toBe(true)
    expect(requested.filter((u) => u.startsWith('http://'))).toEqual([])
  })

  test('with nothing reachable, an http page warns once instead of failing silently', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })

    const dead = uniqueTestPort()
    await serveApp(page, `http://localhost:${httpApp.port}/`, loaderSnippetHtml({ httpPort: dead, httpsPort: deadHttpsPort }))
    await expect.poll(() => warnings.filter((w) => w.includes('no channel reachable')).length).toBe(1)
    expect(await page.$$('script[src*="component.js"]')).toHaveLength(0)
  })
})
