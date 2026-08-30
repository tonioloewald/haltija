/**
 * Tests for the hidden-tab warning (issue #3).
 *
 * The failure it guards: a hidden tab ANSWERS — `hj eval '…querySelectorAll(x).length'` returns 0
 * rather than erroring — because rAF/IntersectionObserver-driven content never mounts while
 * hidden. A confident wrong number. The warning must fire exactly when the tab told us it's
 * hidden, and never on a guess.
 */

import { describe, expect, it } from 'bun:test'
import { PAINT_STALE_MS, hiddenTabWarning, stalePaintWarning } from './tab-liveness'

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

/**
 * Tests for the MEASURED counterpart (issue #41, mechanism from #28).
 *
 * `active` comes from `visibilityState`, which answers "is this tab selected" — not "is this tab
 * painting". They diverge for an occluded window, an offscreen window and a sleeping display, and
 * in that gap the instrument lies in its most expensive form: a plausible answer about rendered
 * content from a tab that never rendered.
 */
describe('stalePaintWarning', () => {
  it('warns when a self-reportedly VISIBLE tab has not painted — the case `active` cannot see', () => {
    const w = stalePaintWarning({ id: 'w1', title: 'Editor', active: true }, 9000)
    expect(w).toContain('Editor')
    expect(w).toContain('9.0s')
    expect(w).toContain('not being composited')
    // It must say why the result is untrustworthy, not merely that something is odd.
    expect(w).toContain('requestAnimationFrame')
    expect(w).toContain('stale frame')
  })

  it('stays quiet for a tab that is painting', () => {
    expect(stalePaintWarning({ id: 'w1', active: true }, 0)).toBeNull()
    expect(stalePaintWarning({ id: 'w1', active: true }, PAINT_STALE_MS - 1)).toBeNull()
  })

  it('fires exactly at the threshold', () => {
    expect(stalePaintWarning({ id: 'w1', active: true }, PAINT_STALE_MS)).not.toBeNull()
  })

  // Same discipline as hiddenTabWarning: no measurement, no claim. An older widget sends no
  // paintAgeMs at all, and inventing a warning from its absence would be the lying instrument
  // this module exists to prevent.
  it('says nothing when the widget reported no measurement', () => {
    expect(stalePaintWarning({ id: 'w1', active: true }, undefined)).toBeNull()
    expect(stalePaintWarning({ id: 'w1', active: true }, NaN)).toBeNull()
  })

  // One condition, one warning. hiddenTabWarning already explains a hidden tab, and a hidden tab
  // ALSO stops painting — so without this the common case emits two blocks saying the same thing,
  // which is how agents learn to skim warnings.
  it('defers to hiddenTabWarning when the tab already said it is hidden', () => {
    expect(stalePaintWarning({ id: 'w1', active: false }, 60_000)).toBeNull()
    expect(hiddenTabWarning({ id: 'w1', active: false })).not.toBeNull()
  })

  it('falls back to the id, then to a neutral phrase, when there is no title', () => {
    expect(stalePaintWarning({ id: 'abc123', active: true }, 5000)).toContain('abc123')
    expect(stalePaintWarning(null, 5000)).toContain('the answering tab')
  })
})
