/**
 * Unit tests for src/legacy-servers.ts.
 *
 * The policy these lock down: retire pre-1.4.0 servers (they clobber the shared
 * hj), never retire something we can't identify, never kill a running desktop
 * app, and — critically — never kill a peer just for being a slightly older
 * 1.4.x, which would have two projects killing each other forever.
 */

import { describe, expect, it } from 'bun:test'
import { candidatePorts, isLegacy, planForServer, planFreePort, type ServerProbe } from './legacy-servers'

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

  it('does NOT treat a 1.4.0 prerelease as legacy — betas must not fight each other', () => {
    // Strict semver says 1.4.0-beta.1 < 1.4.0, which would make every 1.4.0 beta
    // "legacy" — so two betas would stop each other on boot and the first
    // `npm publish --tag beta` would ship servers that fight. A 1.4.0 prerelease is
    // built from this code and HAS the guards.
    expect(isLegacy('1.4.0-beta.1')).toBe(false)
    expect(isLegacy('1.4.0-rc.2')).toBe(false)
  })

  it('does not flag an unknown version — we never kill what we cannot identify', () => {
    expect(isLegacy(null)).toBe(false)
    expect(isLegacy('garbage')).toBe(false)
  })
})

describe('planForServer', () => {
  it('retires a legacy server', () => {
    expect(planForServer(probe(), SELF).action).toBe('retire')
  })

  it('retires a legacy server even with no pid — we ask it to stop, not signal it', () => {
    // Retirement is POST /shutdown, so no pid is needed. This used to be a
    // "complain, I cannot find the pid" case; needing a pid at all was the bug.
    expect(planForServer(probe({ pid: null }), SELF).action).toBe('retire')
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

  it('never advises the user to run an unfiltered lsof kill', () => {
    // The remedy string used to suggest `lsof -ti :PORT | xargs kill` — the exact
    // command that kills connected browsers. Do not print the bug as guidance.
    for (const p of [probe({ desktopApp: true }), probe({ pid: null })]) {
      const plan = planForServer(p, SELF)
      if (plan.action === 'complain') {
        expect(plan.remedy).not.toMatch(/lsof/)
      }
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

describe('unknown desktopApp (pre-1.3.0 /status had no such field)', () => {
  it('never retires a server that cannot say whether it is the desktop app', () => {
    // Collapsing undefined into false made a running pre-1.3.0 Haltija.app look like an
    // ordinary squatter — so we would shut it down and orphan a GUI the user can see.
    // "Could not tell" must fall on the safe side.
    const plan = planForServer(probe({ version: '1.1.7', desktopApp: null }), SELF)
    expect(plan.action).toBe('complain')
  })
})

describe('planFreePort (the EADDRINUSE decision — the blocker lived here)', () => {
  const p = (over: Partial<ServerProbe> = {}): ServerProbe =>
    ({ port: 8700, version: '1.4.0', desktopApp: false, pid: 999, ...over })

  it('stops a positively-identified haltija server that is not the desktop app', () => {
    expect(planFreePort(p({ version: '1.3.4', desktopApp: false }))).toBe('stop')
  })

  it('DECLINES an unidentified server (null) — the blocker: false let it through', () => {
    // A token-gated /status 401s and a slow one times out; both probe as unidentified. This
    // used to arrive as desktopApp:false and get SIGTERMed, including a running desktop app.
    expect(planFreePort(p({ version: null, desktopApp: null }))).toBe('decline')
  })

  it('DECLINES the desktop app', () => {
    expect(planFreePort(p({ desktopApp: true }))).toBe('decline')
  })

  it('DECLINES anything without a version, even if desktopApp is somehow false', () => {
    // Belt and braces: no positive haltija identification -> hands off.
    expect(planFreePort(p({ version: null, desktopApp: false }))).toBe('decline')
  })
})
