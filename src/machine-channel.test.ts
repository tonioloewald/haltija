import { describe, expect, test } from 'bun:test'
import {
  MACHINE_RES_PREFIX,
  formatRequest,
  formatResponse,
  machineChannelEnabled,
  parseRequestLine,
  parseResponseLine,
  splitLines,
} from './machine-channel'

describe('machine channel framing (#40)', () => {
  test('a request round-trips', () => {
    const req = { id: 'r1', method: 'POST', path: '/terminal/command', bodyB64: 'eA==' }
    expect(parseRequestLine(formatRequest(req).trimEnd())).toEqual(req)
  })

  test('a response round-trips', () => {
    const res = { id: 'r1', status: 200, headers: { 'content-type': 'application/json' }, bodyB64: 'e30=' }
    expect(parseResponseLine(formatResponse(res).trimEnd())).toEqual(res)
  })

  // The stream carries the banner, ordinary logs, and two other prefixed messages. "Not for me" is
  // the common case and must never throw.
  test('ordinary log output is ignored, not thrown on', () => {
    for (const line of ['[haltija] Window connected: abc', '', '====', 'HALTIJA_PRIVATE_READY {"port":1}']) {
      expect(parseRequestLine(line)).toBeNull()
      expect(parseResponseLine(line)).toBeNull()
    }
  })

  // A corrupt frame should drop, not take the server down.
  test('a malformed frame returns null rather than throwing', () => {
    expect(parseRequestLine('HJ_MACHINE_REQ {not json')).toBeNull()
    expect(parseRequestLine('HJ_MACHINE_REQ {"id":"x"}')).toBeNull() // no path
    expect(parseResponseLine(MACHINE_RES_PREFIX + '{"id":"x"}')).toBeNull() // no status
  })

  // A path is used to build a URL on the server side; anything not rooted is rejected rather than
  // resolved, so a frame can never be coaxed into naming a different host.
  test('a non-rooted path is rejected', () => {
    expect(parseRequestLine('HJ_MACHINE_REQ {"id":"x","path":"http://evil/x"}')).toBeNull()
    expect(parseRequestLine('HJ_MACHINE_REQ {"id":"x","path":"files/read"}')).toBeNull()
  })

  // THE bug this function exists to prevent: a pipe splits wherever it likes, so a large
  // /files/tree answer arrives in pieces. Parsing a half-frame drops the response and hangs the
  // caller forever.
  test('a frame split across chunks is reassembled, not dropped', () => {
    const whole = formatResponse({ id: 'r1', status: 200, headers: {}, bodyB64: 'AAAA' })
    const cut = Math.floor(whole.length / 2)
    let buffered = ''
    const seen: string[] = []
    for (const chunk of [whole.slice(0, cut), whole.slice(cut)]) {
      buffered += chunk
      const { lines, rest } = splitLines(buffered)
      buffered = rest
      seen.push(...lines)
    }
    expect(seen.length).toBe(1)
    expect(parseResponseLine(seen[0])!.id).toBe('r1')
  })

  test('several frames in one chunk all come out', () => {
    const two = formatResponse({ id: 'a', status: 200, headers: {}, bodyB64: '' }) +
                formatResponse({ id: 'b', status: 404, headers: {}, bodyB64: '' })
    const { lines, rest } = splitLines(two)
    expect(lines.length).toBe(2)
    expect(rest).toBe('')
    expect(lines.map((l) => parseResponseLine(l)!.id)).toEqual(['a', 'b'])
  })

  // The capability is granted by the spawning parent, never ambient: a plain `bunx haltija` has no
  // machine-control surface on any transport.
  test('the channel is off unless a parent explicitly asks', () => {
    expect(machineChannelEnabled({})).toBe(false)
    expect(machineChannelEnabled({ HALTIJA_MACHINE_CHANNEL: '0' })).toBe(false)
    expect(machineChannelEnabled({ HALTIJA_MACHINE_CHANNEL: 'true' })).toBe(false)
    expect(machineChannelEnabled({ HALTIJA_MACHINE_CHANNEL: '1' })).toBe(true)
  })
})
