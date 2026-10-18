import { describe, it, expect } from 'bun:test'
import { isLoopbackAddress, refusesRemoteCaller } from './remote-gate'

describe('isLoopbackAddress (#815)', () => {
  it('accepts every loopback spelling Bun reports', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.1']) {
      expect(isLoopbackAddress(a)).toBe(true)
    }
  })

  it('rejects LAN, public, link-local and look-alike addresses', () => {
    for (const a of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', 'fe80::1', '8.8.8.8', '0.0.0.0', '128.0.0.1', '127.0.0.1.evil', '::2', '']) {
      expect(isLoopbackAddress(a)).toBe(false)
    }
  })

  it('rejects an unknown address rather than failing open', () => {
    expect(isLoopbackAddress(null)).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })
})

describe('refusesRemoteCaller (#815)', () => {
  it('without a token, refuses everything that is not loopback', () => {
    expect(refusesRemoteCaller('192.168.1.20', '')).toBe(true)
    expect(refusesRemoteCaller(null, '')).toBe(true)
    expect(refusesRemoteCaller('127.0.0.1', '')).toBe(false)
  })

  it('with a token, leaves the decision to the token check', () => {
    expect(refusesRemoteCaller('192.168.1.20', 'secret')).toBe(false)
  })
})
