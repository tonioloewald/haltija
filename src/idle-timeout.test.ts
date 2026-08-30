import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PRIVATE_IDLE_HOURS,
  POLL_ONLY_PATHS,
  countsAsActivity,
  expiryMessage,
  isExpired,
  resolveIdlePolicy,
} from './idle-timeout'

const HOUR = 3_600_000

describe('what counts as activity (issue #39)', () => {
  // THE test for this feature. The desktop app's renderer polls GET /status every 5 seconds
  // forever (apps/desktop/renderer.js → checkHaltija). If that counted as activity, a
  // `--private --app` instance would refresh its own idle timer from its own UI and never
  // expire — which is precisely the configuration #39 found running for twelve days at 5.7 GB.
  // The guard would have looked correct and done nothing.
  test('the desktop app polling its own /status does NOT keep the instance alive', () => {
    const policy = resolveIdlePolicy({ isPrivate: true })
    let lastActivityAt = 0
    let now = 0

    // Nine hours of the renderer's 5-second poll, and nothing else.
    for (; now < 9 * HOUR; now += 5000) {
      if (countsAsActivity('/status', 'GET')) lastActivityAt = now
    }

    expect(lastActivityAt).toBe(0)
    expect(isExpired(now, lastActivityAt, policy.timeoutMs)).toBe(true)
  })

  test('the terminal pane polling /terminal/status does not either', () => {
    expect(countsAsActivity('/terminal/status', 'GET')).toBe(false)
  })

  test('a client actually driving the browser does keep it alive', () => {
    for (const path of ['/click', '/eval', '/tree', '/screenshot', '/test/run', '/type']) {
      expect(countsAsActivity(path, 'POST')).toBe(true)
    }
  })

  // The exclusion is for pollers, not for the paths themselves. A POST is a command whatever it
  // is addressed to, and keying the rule on the path alone would let the exclusion widen
  // silently if either of these ever gained a POST form.
  test('a POST to a poll path is still activity', () => {
    for (const path of POLL_ONLY_PATHS) {
      expect(countsAsActivity(path, 'POST')).toBe(true)
    }
  })

  test('every excluded path is one we actually serve', () => {
    // Fake precision guard: this set exists to name real pollers. `/health` and `/ping` are not
    // endpoints of this server, and listing them would imply coverage the set does not have.
    expect(POLL_ONLY_PATHS.has('/health')).toBe(false)
    expect(POLL_ONLY_PATHS.has('/ping')).toBe(false)
  })
})

describe('policy resolution', () => {
  test('private gets a default bound; shared does not', () => {
    expect(resolveIdlePolicy({ isPrivate: true }).timeoutMs).toBe(
      DEFAULT_PRIVATE_IDLE_HOURS * HOUR,
    )
    // A shared interactive server is the developer's, and its stickiness is the feature. Exiting
    // one on a timer is the harm 1.4.0 was spent eliminating.
    expect(resolveIdlePolicy({ isPrivate: false }).timeoutMs).toBeNull()
  })

  test('the env var overrides in both directions', () => {
    expect(
      resolveIdlePolicy({ HALTIJA_IDLE_TIMEOUT_HOURS: '0', isPrivate: true }).timeoutMs,
    ).toBeNull()
    expect(
      resolveIdlePolicy({ HALTIJA_IDLE_TIMEOUT_HOURS: '2', isPrivate: false }).timeoutMs,
    ).toBe(2 * HOUR)
    expect(
      resolveIdlePolicy({ HALTIJA_IDLE_TIMEOUT_HOURS: '0.5', isPrivate: true }).timeoutMs,
    ).toBe(HOUR / 2)
  })

  // Reading a typo as "disable the safety net" is how another twelve-day instance survives, and
  // it would do so silently. An unparseable value falls back to the default and is reported.
  test('an unparseable value falls back to the default and is flagged, not read as 0', () => {
    const p = resolveIdlePolicy({ HALTIJA_IDLE_TIMEOUT_HOURS: '8h', isPrivate: true })
    expect(p.timeoutMs).toBe(DEFAULT_PRIVATE_IDLE_HOURS * HOUR)
    expect(p.invalid).toBe('8h')
  })

  test('a negative value is rejected the same way', () => {
    const p = resolveIdlePolicy({ HALTIJA_IDLE_TIMEOUT_HOURS: '-1', isPrivate: true })
    expect(p.timeoutMs).toBe(DEFAULT_PRIVATE_IDLE_HOURS * HOUR)
    expect(p.invalid).toBe('-1')
  })

  test('an empty value is treated as unset', () => {
    expect(
      resolveIdlePolicy({ HALTIJA_IDLE_TIMEOUT_HOURS: '  ', isPrivate: true }).timeoutMs,
    ).toBe(DEFAULT_PRIVATE_IDLE_HOURS * HOUR)
  })
})

describe('expiry', () => {
  test('never expires when disabled', () => {
    expect(isExpired(Date.now(), 0, null)).toBe(false)
  })

  test('expires only at or past the bound', () => {
    expect(isExpired(8 * HOUR - 1, 0, 8 * HOUR)).toBe(false)
    expect(isExpired(8 * HOUR, 0, 8 * HOUR)).toBe(true)
  })

  // #39 asks for this explicitly: an instance that vanishes without saying why is
  // indistinguishable from a crash, and someone will go looking for the crash.
  test('the exit message says it is not a crash, and how to turn it off', () => {
    const msg = expiryMessage(8 * HOUR, resolveIdlePolicy({ isPrivate: true }))
    expect(msg).toContain('8.0h')
    expect(msg).toContain('not a crash')
    expect(msg).toContain('HALTIJA_IDLE_TIMEOUT_HOURS=0')
    expect(msg).toContain('#39')
  })

  test('a sub-hour span reads honestly instead of "0.0h"', () => {
    const msg = expiryMessage(72_000, resolveIdlePolicy({ isPrivate: true }))
    expect(msg).toContain('72s')
    expect(msg).not.toContain('0.0h')
  })
})
