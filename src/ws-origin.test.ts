import { describe, expect, it } from 'bun:test'
import { isLoopbackOrigin, mayOpenMachineSocket, requiresLocalOrigin } from './ws-origin'

describe('machine-scope WebSocket origin policy (review B3)', () => {
  it('refuses a foreign origin', () => {
    for (const o of ['https://evil.example', 'http://attacker.test', 'https://localhost.evil.com']) {
      expect(isLoopbackOrigin(o)).toBe(false)
    }
  })

  // The desktop renderer is loaded from disk, so its frames send `Origin: null`. Refusing that
  // would break the very client this socket exists for.
  // These were ASSERTED ALLOWED by the first version of this file — the test encoded the bug.
  // A null/absent origin is not loopback; it must present the launch nonce instead (see below).
  it('does not treat a null or absent origin as loopback', () => {
    for (const o of [null, undefined, '', 'null']) expect(isLoopbackOrigin(o)).toBe(false)
  })

  it('allows loopback', () => {
    for (const o of ['http://localhost:8700', 'http://127.0.0.1:3000', 'http://[::1]:8080']) {
      expect(isLoopbackOrigin(o)).toBe(true)
    }
  })

  // Refuse rather than guess: an origin we cannot parse is not evidence of anything good.
  it('refuses an unparseable origin', () => {
    expect(isLoopbackOrigin('not a url')).toBe(false)
  })

  // /ws/browser MUST stay open to any origin: the widget is injected into arbitrary pages and
  // connects from theirs. Restricting it would break the bookmarklet and every embedder — this
  // test exists so a future tightening has to argue with it rather than break the product.
  it('leaves /ws/browser unrestricted, and covers the machine-scope sockets', () => {
    expect(requiresLocalOrigin('/ws/browser')).toBe(false)
    expect(requiresLocalOrigin('/ws/terminal')).toBe(true)
    // /ws/agent is NOT gated: programmatic agents are non-browser clients, so gating it only
    // regressed them. Its residual is the same LAN exposure the REST surface has (--token).
    expect(requiresLocalOrigin('/ws/agent')).toBe(false)
  })
})

/**
 * The hole review M1 reproduced with real Chromium: a hostile page embeds
 * `<iframe sandbox="allow-scripts" srcdoc="…">`, whose opaque origin serialises to the literal
 * string `null` — the same thing the legitimate desktop renderer sends, because it is loadFile().
 * Origin alone cannot separate them, so `null` must prove itself.
 */
describe('a null origin must prove itself (review M1)', () => {
  const NONCE = 'launch-secret'

  it('refuses a forged opaque origin with no nonce', () => {
    for (const o of ['null', 'file://', 'file:///Users/x/index.html']) {
      expect(mayOpenMachineSocket({ origin: o, nonce: null, expectedNonce: NONCE })).toBe(false)
      expect(mayOpenMachineSocket({ origin: o, nonce: 'wrong', expectedNonce: NONCE })).toBe(false)
    }
  })

  // Electron's renderer is loadFile(), so the REAL terminal sends `Origin: file://` — not `null`,
  // which an earlier version of this assumed. It refused the legitimate app outright.
  it('admits the desktop file:// frame when it presents the nonce', () => {
    expect(mayOpenMachineSocket({ origin: 'file://', nonce: NONCE, expectedNonce: NONCE })).toBe(true)
  })

  // A browser always sends Origin cross-origin, so an ABSENT header is a non-browser client (the
  // CLI, an agent harness) and cannot be a hostile page. Refusing these broke agents outright.
  it('admits non-browser clients, which send no Origin at all', () => {
    expect(mayOpenMachineSocket({ origin: null, nonce: null, expectedNonce: NONCE })).toBe(true)
    expect(mayOpenMachineSocket({ origin: undefined, nonce: null, expectedNonce: NONCE })).toBe(true)
  })

  it('admits the desktop frame, which presents the nonce', () => {
    expect(mayOpenMachineSocket({ origin: 'null', nonce: NONCE, expectedNonce: NONCE })).toBe(true)
  })

  // The haltija UI and <task-board> are served BY the server, so they are named and same-machine.
  it('still admits loopback origins with no nonce', () => {
    expect(mayOpenMachineSocket({ origin: 'http://localhost:8700', nonce: null, expectedNonce: NONCE })).toBe(true)
  })

  // This test was written with the right NAME and the wrong assertion (`toBe(true)`), and it
  // passed — the implementation really did let a foreign origin in on a nonce. A test whose name
  // and assertion disagree is worse than no test: it reads as coverage. The name was correct.
  it('still refuses a foreign origin even holding a nonce', () => {
    expect(mayOpenMachineSocket({ origin: 'https://evil.example', nonce: NONCE, expectedNonce: NONCE })).toBe(false)
  })

  // Fail CLOSED when no nonce was minted (a plain `bunx haltija`): nothing legitimately opens a
  // machine-scope socket from a null origin there.
  it('refuses null origins entirely when no nonce exists', () => {
    expect(mayOpenMachineSocket({ origin: 'null', nonce: 'anything', expectedNonce: null })).toBe(false)
  })
})
