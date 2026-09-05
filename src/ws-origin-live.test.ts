import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawn, type ChildProcess } from 'child_process'
import http from 'http'
import { join } from 'path'

/**
 * The machine-scope socket policy, against a REAL server (review M1).
 *
 * `ws-origin.test.ts` covers the predicate; this covers the wiring — that the server reads the
 * nonce from its environment, reads Origin off the upgrade, and answers 403 or 101 accordingly.
 * The regression that motivated it was invisible to 977 unit tests precisely because every layer
 * was individually correct and nothing exercised them together.
 *
 * A raw HTTP upgrade rather than a WebSocket client: it needs no dependency, and it lets us set an
 * Origin header, which the browser WebSocket API deliberately forbids.
 */
const NONCE = 'test-launch-nonce-1234'
let proc: ChildProcess | null = null
let port = 0

function upgrade(path: string, origin?: string): Promise<number> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    }
    if (origin !== undefined) headers.Origin = origin
    const req = http.request({ host: '127.0.0.1', port, path, headers })
    // 101 never arrives as a normal response — an accepted upgrade fires 'upgrade'.
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(101) })
    req.on('response', (res) => { res.resume(); resolve(res.statusCode ?? 0) })
    req.on('error', () => resolve(0))
    req.end()
    setTimeout(() => resolve(0), 5000)
  })
}

beforeAll(async () => {
  proc = spawn('bun', [join(import.meta.dir, '../dist/server.js')], {
    env: {
      ...process.env,
      HALTIJA_PRIVATE: '1',        // ephemeral port, registers nothing, touches no shared server
      HALTIJA_NO_RETIRE: '1',
      HALTIJA_NO_INSTALL: '1',
      HALTIJA_WS_NONCE: NONCE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise<void>((resolve) => {
    const done = setTimeout(resolve, 15000)
    proc!.stdout!.on('data', (d) => {
      const m = String(d).match(/"port":(\d+)/)
      if (m && !port) { port = Number(m[1]); clearTimeout(done); resolve() }
    })
  })
})

afterAll(() => { proc?.kill() })

describe('machine-scope socket policy, live', () => {
  it('started a private server', () => { expect(port).toBeGreaterThan(0) })

  // The vector the review reproduced with real Chromium: a sandboxed/srcdoc frame on a hostile
  // page serialises its opaque origin to the literal string "null".
  it('refuses a forged opaque origin without the nonce', async () => {
    expect(await upgrade('/ws/terminal', 'null')).toBe(403)
    expect(await upgrade('/ws/terminal', 'file://')).toBe(403)
  })

  it('refuses a foreign origin even holding the nonce', async () => {
    expect(await upgrade(`/ws/terminal?nonce=${NONCE}`, 'https://evil.example')).toBe(403)
  })

  // The legitimate desktop frame: file:// origin, presenting the launch nonce.
  it('admits the app’s own frame, which presents the nonce', async () => {
    expect(await upgrade(`/ws/terminal?nonce=${NONCE}`, 'file://')).toBe(101)
  })

  it('admits a loopback origin with no nonce', async () => {
    expect(await upgrade('/ws/terminal', `http://localhost:${port}`)).toBe(101)
  })

  // /ws/browser MUST stay open to any origin — the widget is injected into arbitrary pages and
  // connects from theirs. Tightening it would break the bookmarklet and every embedder.
  it('leaves /ws/browser open to any origin', async () => {
    expect(await upgrade('/ws/browser', 'https://any-page.example')).toBe(101)
  })
})
