/**
 * Tests for the hidden-tab warning (issue #3).
 *
 * The failure it guards: a hidden tab ANSWERS — `hj eval '…querySelectorAll(x).length'` returns 0
 * rather than erroring — because rAF/IntersectionObserver-driven content never mounts while
 * hidden. A confident wrong number. The warning must fire exactly when the tab told us it's
 * hidden, and never on a guess.
 */

import { describe, expect, it } from 'bun:test'
import { hiddenTabWarning } from './tab-liveness'

describe('hiddenTabWarning', () => {
  it('warns when the tab reported itself hidden', () => {
    const w = hiddenTabWarning({ id: 'w1', title: 'b3d-terrain', active: false })
    expect(w).toBeTruthy()
    expect(w).toMatch(/HIDDEN/)
    expect(w).toMatch(/PLAUSIBLE BUT WRONG/)
    expect(w).toContain('b3d-terrain')
  })

  it('does NOT warn about a visible tab', () => {
    expect(hiddenTabWarning({ id: 'w1', active: true })).toBeNull()
  })

  it('does NOT warn when the tab never reported visibility — no inventing signals', () => {
    // `active` undefined means we have no basis to claim it's hidden. Warning here would be the
    // same lying-instrument problem in the other direction.
    expect(hiddenTabWarning({ id: 'w1' })).toBeNull()
  })

  it('does not warn when there is no window', () => {
    expect(hiddenTabWarning(null)).toBeNull()
    expect(hiddenTabWarning(undefined)).toBeNull()
  })

  it('falls back to the id when the tab has no title', () => {
    expect(hiddenTabWarning({ id: 'abc123', active: false })).toContain('abc123')
  })
})
