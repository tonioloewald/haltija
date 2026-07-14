/**
 * Unit tests for src/semver.ts.
 *
 * The case that motivated this module: 1.3.0-beta.12 must be recognized as
 * OLDER than 1.3.4, so a stale beta server can't downgrade a newer global hj.
 */

import { describe, expect, it } from 'bun:test'
import { compareVersions, differsBeyondPatch, isOlderThan, parseVersion } from './semver'

describe('parseVersion', () => {
  it('parses a plain release', () => {
    expect(parseVersion('1.3.4')).toEqual({ major: 1, minor: 3, patch: 4, prerelease: [] })
  })

  it('parses a prerelease', () => {
    expect(parseVersion('1.3.0-beta.12')).toEqual({
      major: 1, minor: 3, patch: 0, prerelease: ['beta', '12'],
    })
  })

  it('tolerates a leading v and ignores build metadata', () => {
    expect(parseVersion('v2.0.1+build.5')?.major).toBe(2)
    expect(parseVersion('2.0.1+build.5')?.prerelease).toEqual([])
  })

  it('returns null for garbage', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('1.3')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
    expect(compareVersions('1.4.0', '1.3.9')).toBe(1)
    expect(compareVersions('1.3.4', '1.3.5')).toBe(-1)
    expect(compareVersions('1.3.4', '1.3.4')).toBe(0)
  })

  it('treats a prerelease as older than its release', () => {
    expect(compareVersions('1.4.0-beta.1', '1.4.0')).toBe(-1)
    expect(compareVersions('1.4.0', '1.4.0-beta.1')).toBe(1)
  })

  it('compares numeric prerelease identifiers numerically, not as strings', () => {
    // the bug a string sort would introduce: "12" < "9" lexicographically
    expect(compareVersions('1.3.0-beta.9', '1.3.0-beta.12')).toBe(-1)
    expect(compareVersions('1.3.0-beta.12', '1.3.0-beta.9')).toBe(1)
  })

  it('ranks a longer prerelease above a shorter prefix', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
  })

  it('ranks numeric identifiers below alphanumeric ones', () => {
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
  })

  it('returns null when either side is unparseable', () => {
    expect(compareVersions('1.3.4', 'latest')).toBeNull()
    expect(compareVersions('nope', '1.3.4')).toBeNull()
  })
})

describe('isOlderThan', () => {
  it('recognizes the stale-beta case that motivated this module', () => {
    expect(isOlderThan('1.3.0-beta.12', '1.3.4')).toBe(true)
    expect(isOlderThan('1.3.4', '1.3.0-beta.12')).toBe(false)
  })

  it('does not treat an unknown version as older', () => {
    // "unknown" must not license a downgrade
    expect(isOlderThan('garbage', '1.3.4')).toBe(false)
  })

  it('is false for equal versions', () => {
    expect(isOlderThan('1.3.4', '1.3.4')).toBe(false)
  })
})

describe('differsBeyondPatch', () => {
  it('ignores patch drift — the normal steady state', () => {
    // One global hj drives many pinned per-project servers. 1.4.0 vs 1.4.2 is fine,
    // and no action the user takes can make those numbers match — warning about it on
    // every command would be a permanent false alarm.
    expect(differsBeyondPatch('1.4.0', '1.4.2')).toBe(false)
    expect(differsBeyondPatch('1.4.2', '1.4.0')).toBe(false)
    expect(differsBeyondPatch('1.4.0', '1.4.0')).toBe(false)
  })

  it('flags a minor or major gap — wide enough to actually break', () => {
    expect(differsBeyondPatch('1.3.4', '1.4.0')).toBe(true)
    expect(differsBeyondPatch('1.4.0', '2.0.0')).toBe(true)
  })

  it('does not cry wolf about a version string it could not parse', () => {
    expect(differsBeyondPatch('garbage', '1.4.0')).toBe(false)
    expect(differsBeyondPatch('1.4.0', '')).toBe(false)
  })
})
