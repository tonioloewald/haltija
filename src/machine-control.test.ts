import { describe, expect, test } from 'bun:test'
import {
  MACHINE_CONTROL_ALLOWED,
  isRefusedMachineControlPath,
  machineControlRefusal,
} from './machine-control'

describe('machine control is not served over the network (#40)', () => {
  test('the routes that made this a remote-execution hole are refused', () => {
    for (const p of ['/terminal/command', '/terminal/agent-prompt', '/files/write', '/files/read']) {
      expect(isRefusedMachineControlPath(p)).toBe(true)
    }
  })

  // The whole reason this is a PREFIX refusal. A first pass at "remove the four bad routes" would
  // have left these three serving directory listings and file contents, because they were not on
  // the list anyone was looking at.
  test('the filesystem routes that a denylist would have missed are refused too', () => {
    for (const p of ['/files/tree', '/files/image', '/files/touches']) {
      expect(isRefusedMachineControlPath(p)).toBe(true)
    }
  })

  // Fail-closed: a route added later is refused until someone deliberately allows it. A denylist
  // can only ever omit the next thing someone adds.
  test('a route nobody has written yet is refused by default', () => {
    expect(isRefusedMachineControlPath('/terminal/some-future-route')).toBe(true)
    expect(isRefusedMachineControlPath('/files/anything-at-all')).toBe(true)
  })

  // The widget's agent-list read MOVED to /agents rather than being allowlisted, so the refusal
  // has no exceptions at all. If someone reintroduces an exception here, this test is the thing
  // that should make them justify it.
  test('the allowlist is empty — the rule has no exceptions', () => {
    expect(MACHINE_CONTROL_ALLOWED.size).toBe(0)
    expect(isRefusedMachineControlPath('/terminal/agents')).toBe(true)
  })

  test('the relocated agent-list route is not under a refused prefix', () => {
    expect(isRefusedMachineControlPath('/agents')).toBe(false)
  })

  test('browser control is untouched', () => {
    for (const p of ['/tree', '/click', '/eval', '/screenshot', '/status', '/windows', '/find']) {
      expect(isRefusedMachineControlPath(p)).toBe(false)
    }
  })

  // Not a 404: the likeliest caller is an older desktop app against a newer server, and a "not
  // found" would send someone looking for a typo instead of reading the reason.
  test('the refusal explains itself and points at the issue', () => {
    const r = machineControlRefusal('/terminal/command')
    expect(r.status).toBe(410)
    expect(String(r.body.error)).toContain('/terminal/command')
    expect(String(r.body.error)).toContain('issues/40')
    expect(String(r.body.error)).toContain('Browser control')
  })
})
