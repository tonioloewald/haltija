import { describe, expect, it } from 'bun:test'
import { isLocalOrigin, requiresLocalOrigin } from './ws-origin'

describe('machine-scope WebSocket origin policy (review B3)', () => {
  it('refuses a foreign origin', () => {
    for (const o of ['https://evil.example', 'http://attacker.test', 'https://localhost.evil.com']) {
      expect(isLocalOrigin(o)).toBe(false)
    }
  })

  // The desktop renderer is loaded from disk, so its frames send `Origin: null`. Refusing that
  // would break the very client this socket exists for.
  it('allows the disk-loaded desktop renderer (Origin: null) and non-browser clients', () => {
    for (const o of [null, undefined, '', 'null']) expect(isLocalOrigin(o)).toBe(true)
  })

  it('allows loopback', () => {
    for (const o of ['http://localhost:8700', 'http://127.0.0.1:3000', 'http://[::1]:8080']) {
      expect(isLocalOrigin(o)).toBe(true)
    }
  })

  // Refuse rather than guess: an origin we cannot parse is not evidence of anything good.
  it('refuses an unparseable origin', () => {
    expect(isLocalOrigin('not a url')).toBe(false)
  })

  // /ws/browser MUST stay open to any origin: the widget is injected into arbitrary pages and
  // connects from theirs. Restricting it would break the bookmarklet and every embedder — this
  // test exists so a future tightening has to argue with it rather than break the product.
  it('leaves /ws/browser unrestricted, and covers the machine-scope sockets', () => {
    expect(requiresLocalOrigin('/ws/browser')).toBe(false)
    expect(requiresLocalOrigin('/ws/terminal')).toBe(true)
    expect(requiresLocalOrigin('/ws/agent')).toBe(true)
  })
})
