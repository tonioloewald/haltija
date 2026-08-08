import { describe, it, expect } from 'bun:test'

/**
 * The displayed contrast ratio must never sit on the wrong side of the threshold it is being
 * judged against.
 *
 * Reported from real use: `{"contrast": 3, "passes": false}` with the message
 * `"3:1 (needs 3:1)"` — a failure phrased as a pass. True ratio 2.9910, rounded to 1dp. The
 * underlying maths was verified correct by the reporter against a hand implementation of the WCAG
 * formula; only the presentation lied.
 */
const display = (ratio: number) => Math.floor(ratio * 10) / 10
const passes = (ratio: number, large: boolean) => ratio >= (large ? 3 : 4.5)

describe('a failing ratio never displays as its own threshold', () => {
  it('the reported case: 2.991 must not render as 3', () => {
    expect(passes(2.991, true)).toBe(false)
    expect(display(2.991)).toBeLessThan(3)
  })

  it('holds across the boundary for both thresholds', () => {
    // Rounding fails here at 2.95+ and 4.45+; flooring cannot.
    for (const [ratio, large] of [[2.97, true], [2.999, true], [4.47, false], [4.4999, false]] as const) {
      expect([ratio, passes(ratio, large)]).toEqual([ratio, false])
      expect([ratio, display(ratio) < (large ? 3 : 4.5)]).toEqual([ratio, true])
    }
  })

  it('and a PASSING ratio still displays as passing — the discriminating half', () => {
    // Flooring must not manufacture the opposite lie. Both thresholds have one decimal place, so
    // for any ratio >= T the floored value is still >= T.
    for (const [ratio, large] of [[3.0, true], [3.04, true], [4.5, false], [4.52, false], [21, false]] as const) {
      expect([ratio, passes(ratio, large)]).toEqual([ratio, true])
      expect([ratio, display(ratio) >= (large ? 3 : 4.5)]).toEqual([ratio, true])
    }
  })
})
