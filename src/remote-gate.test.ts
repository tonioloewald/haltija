import { describe, it, expect } from 'bun:test'
import { isLoopbackAddress, refusalLogLine, refusesRemoteCaller } from './remote-gate'

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

describe('refusalLogLine (#815 review)', () => {
  it('names the peer and the remedy, once per peer', () => {
    const told = new Set<string>()
    const line = refusalLogLine('172.17.0.1', told)!
    expect(line).toContain('172.17.0.1')
    expect(line).toContain('--token')
    expect(line).toContain('container')
    expect(refusalLogLine('172.17.0.1', told)).toBeNull()
    expect(refusalLogLine('10.0.0.5', told)).toContain('10.0.0.5')
  })

  it('an unknown address is still reported, and the set stays bounded', () => {
    const told = new Set<string>()
    expect(refusalLogLine(null, told)).toContain('unknown address')
    for (let i = 0; i < 1000; i++) refusalLogLine(`10.0.${i >> 8}.${i & 255}`, told)
    expect(told.size).toBeLessThanOrEqual(256)
  })
})
