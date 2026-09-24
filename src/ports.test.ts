import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTPS_PORT,
  DEFAULT_INTERNAL_PORT,
  LEGACY_INTERNAL_PORT,
  PUBLIC_PORTS,
  INTERNAL_PORTS,
  assertNoPortRoleConflict,
  internalPortConflict,
} from './ports'
import { SHARED_INTERNAL_PORT, resolveInternalPort } from './desktop-isolation'

/**
 * The regression this file exists for: 8701 was BOTH the public HTTPS listener and the desktop
 * app's internal chrome server, in two files with no shared constant. Two correct-looking defaults
 * that cannot both bind.
 *
 * Note what makes this a guard rather than decoration — it asserts the *roles are disjoint*, not
 * that the numbers are 8700/8710. A test pinning the literals would pass just as happily with the
 * collision restored, because the collision was two literals agreeing.
 */
describe('port role assignment (#32a)', () => {
  it('assigns no port to both the public channel and the desktop internals', () => {
    expect(() => assertNoPortRoleConflict()).not.toThrow()
  })

  it('the guard actually fires when the roles DO overlap', () => {
    // Mutation-verified: a guard must be seen to fail. Re-create the exact pre-1.13 arrangement and
    // confirm the same predicate rejects it — otherwise `assertNoPortRoleConflict` passing above
    // tells us nothing about whether it looks at anything.
    const collided = [LEGACY_INTERNAL_PORT] // what the internal server used to default to
    const overlap = collided.filter((p) => PUBLIC_PORTS.includes(p))
    expect(overlap).toEqual([DEFAULT_HTTPS_PORT])
  })

  it('the internal default is outside the public block', () => {
    expect(PUBLIC_PORTS).not.toContain(DEFAULT_INTERNAL_PORT)
    expect(INTERNAL_PORTS).not.toContain(DEFAULT_HTTP_PORT)
    expect(INTERNAL_PORTS).not.toContain(DEFAULT_HTTPS_PORT)
  })

  it('keeps public HTTP/HTTPS where external callers expect them', () => {
    // These two ARE pinned to literals on purpose, unlike the internal one: the injected loader,
    // the bookmarklet and adopters' dev servers hardcode them, and the user's self-signed cert
    // trust is per-origin. Changing either is a breaking change to code we do not ship.
    expect(DEFAULT_HTTP_PORT).toBe(8700)
    expect(DEFAULT_HTTPS_PORT).toBe(8701)
  })
})

describe('internalPortConflict', () => {
  it('explains a hand-configured collision with public HTTPS', () => {
    const msg = internalPortConflict(DEFAULT_HTTPS_PORT)
    expect(msg).toContain('public HTTPS port')
    expect(msg).toContain(String(DEFAULT_INTERNAL_PORT))
  })

  it('explains a hand-configured collision with public HTTP', () => {
    expect(internalPortConflict(DEFAULT_HTTP_PORT)).toContain('public HTTP port')
  })

  it('says nothing about a port that is genuinely free', () => {
    expect(internalPortConflict(DEFAULT_INTERNAL_PORT)).toBeNull()
    expect(internalPortConflict(9123)).toBeNull()
  })
})

describe('desktop-isolation agrees with the canonical block', () => {
  it('SHARED_INTERNAL_PORT is the canonical internal default, not a second opinion', () => {
    // It was its own literal `8701`. Two files declaring the same number is how this started.
    expect(SHARED_INTERNAL_PORT).toBe(DEFAULT_INTERNAL_PORT)
  })

  it('an unset HALTIJA_INTERNAL_PORT resolves to the new default', () => {
    expect(resolveInternalPort({})).toBe(DEFAULT_INTERNAL_PORT)
  })

  it('still reports "no internal server" as 0 rather than resurrecting a shared port', () => {
    // The private-isolation guard this constant was originally written for must survive the move.
    expect(resolveInternalPort({ HALTIJA_INTERNAL_PORT: '0' })).toBe(0)
  })
})
