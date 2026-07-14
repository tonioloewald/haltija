/**
 * Unit tests for src/legacy-servers.ts.
 *
 * The policy these lock down: retire pre-1.4.0 servers (they clobber the shared
 * hj), never retire something we can't identify, never kill a running desktop
 * app, and — critically — never kill a peer just for being a slightly older
 * 1.4.x, which would have two projects killing each other forever.
 */

import { describe, expect, it } from 'bun:test'
import { candidatePorts, isLegacy, planForServer, type ServerProbe } from './legacy-servers'

const SELF = 4242

function probe(over: Partial<ServerProbe> = {}): ServerProbe {
  return { port: 8700, version: '1.3.0-beta.12', desktopApp: false, pid: 999, ...over }
}

describe('isLegacy', () => {
  it('flags servers below 1.4.0 — they overwrite the shared hj', () => {
    expect(isLegacy('1.3.0-beta.12')).toBe(true)
    expect(isLegacy('1.3.4')).toBe(true)
    expect(isLegacy('0.9.0')).toBe(true)
  })

  it('does not flag 1.4.0 or later', () => {
    expect(isLegacy('1.4.0')).toBe(false)
    expect(isLegacy('1.4.1')).toBe(false)
    expect(isLegacy('2.0.0')).toBe(false)
  })

  it('treats a 1.4.0 prerelease as legacy (the guards landed in the release)', () => {
    expect(isLegacy('1.4.0-beta.1')).toBe(true)
  })

  it('does not flag an unknown version — we never kill what we cannot identify', () => {
    expect(isLegacy(null)).toBe(false)
    expect(isLegacy('garbage')).toBe(false)
  })
})

describe('planForServer', () => {
  it('retires a legacy server with a known pid', () => {
    const plan = planForServer(probe(), SELF)
    expect(plan.action).toBe('retire')
    expect(plan).toMatchObject({ pid: 999 })
  })

  it('never retires itself', () => {
    expect(planForServer(probe({ pid: SELF }), SELF).action).toBe('ignore')
  })

  it('leaves a current server alone', () => {
    expect(planForServer(probe({ version: '1.4.0' }), SELF).action).toBe('ignore')
  })

  it('NEVER kills a peer just for being an older 1.4.x', () => {
    // The tail this policy exists to avoid: if the rule were "older than me",
    // a 1.4.1 server would kill a 1.4.0 server on every boot, forever, and two
    // projects pinned to different 1.4.x releases would fight permanently.
    expect(planForServer(probe({ version: '1.4.0' }), SELF).action).toBe('ignore')
    expect(planForServer(probe({ version: '1.4.5' }), SELF).action).toBe('ignore')
  })

  it('ignores a port where nothing answered', () => {
    expect(planForServer(probe({ version: null }), SELF).action).toBe('ignore')
  })

  it('complains rather than killing a running desktop app', () => {
    const plan = planForServer(probe({ desktopApp: true }), SELF)
    expect(plan.action).toBe('complain')
    if (plan.action === 'complain') {
      expect(plan.remedy).toMatch(/quit Haltija/i)
    }
  })

  it('complains when a legacy server has no discoverable pid', () => {
    const plan = planForServer(probe({ pid: null }), SELF)
    expect(plan.action).toBe('complain')
    if (plan.action === 'complain') {
      expect(plan.remedy).toMatch(/lsof/)
    }
  })
})

describe('candidatePorts', () => {
  it('probes the well-known defaults', () => {
    expect(candidatePorts()).toEqual([8700, 8701])
  })

  it('includes registry ports and dedupes', () => {
    expect(candidatePorts({ registryPorts: [9123, 8700] })).toEqual([8700, 8701, 9123])
  })

  it('excludes our own port', () => {
    expect(candidatePorts({ exclude: [8700] })).toEqual([8701])
  })
})
