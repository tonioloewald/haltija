import { describe, it, expect } from 'bun:test'
import { fitSchematicSize, MAX_SCHEMATIC_PIXELS } from './schematic-size'

/**
 * The bug being pinned: `maxWidth` / `maxHeight` were accepted, parsed, threaded all the way into
 * the rasterizer, and then not used. `{maxWidth: 300, maxHeight: 300}` on a 1126×22304 page
 * returned 1126×22304. It was fixed and shipped untested at every tier, because "it needs a
 * canvas" — but the part that was wrong is arithmetic.
 */

describe('the caller\'s bounds are actually applied', () => {
  it('maxWidth shrinks, and preserves aspect ratio', () => {
    const { width, height } = fitSchematicSize(1000, 500, 1, { maxWidth: 300 })
    expect(width).toBe(300)
    expect(height).toBe(150) // 2:1 in, 2:1 out
  })

  it('maxHeight shrinks, and preserves aspect ratio', () => {
    const { width, height } = fitSchematicSize(1000, 500, 1, { maxHeight: 100 })
    expect(height).toBe(100)
    expect(width).toBe(200)
  })

  it('the TIGHTER of the two wins — not the last one evaluated', () => {
    // 1000x500 under {maxWidth:300, maxHeight:100}: width alone says k=0.3, height says k=0.2.
    // Taking width's factor would produce 300x150, violating maxHeight while reporting success.
    const { width, height } = fitSchematicSize(1000, 500, 1, { maxWidth: 300, maxHeight: 100 })
    expect(width).toBeLessThanOrEqual(300)
    expect(height).toBeLessThanOrEqual(100)
    expect(height).toBe(100)
    expect(width).toBe(200)
  })

  it('the exact reported case: 1126x22304 under 300x300 does not come back unchanged', () => {
    const { width, height } = fitSchematicSize(1126, 22304, 1, { maxWidth: 300, maxHeight: 300 })
    expect(width).not.toBe(1126)
    expect(height).not.toBe(22304)
    expect(width).toBeLessThanOrEqual(300)
    expect(height).toBeLessThanOrEqual(300)
  })

  it('a limit LARGER than the image does not upscale it', () => {
    // `limit / value` unguarded is a multiplier > 1. Asking for maxWidth:4000 on a 300px page must
    // not manufacture 4000px of blur — and would blow the pixel budget doing it.
    const { width, height } = fitSchematicSize(300, 200, 1, { maxWidth: 4000, maxHeight: 4000 })
    expect(width).toBe(300)
    expect(height).toBe(200)
  })

  it('scale is applied before the limits, not instead of them', () => {
    const { width } = fitSchematicSize(1000, 500, 2, { maxWidth: 400 })
    expect(width).toBe(400) // 2000 scaled down to 400, not 1000*2 ignored
  })

  it('scale alone still works when no limits are given', () => {
    expect(fitSchematicSize(100, 50, 3)).toEqual({ width: 300, height: 150 })
  })

  it('zero and negative limits are ignored rather than collapsing the image', () => {
    // A 0 limit is "unset" from the caller's side; treating it as a bound yields a 1x1 image and a
    // useless answer that still reports success.
    expect(fitSchematicSize(800, 600, 1, { maxWidth: 0 })).toEqual({ width: 800, height: 600 })
    expect(fitSchematicSize(800, 600, 1, { maxWidth: -5 })).toEqual({ width: 800, height: 600 })
  })
})

describe('the pixel budget holds regardless of what was asked for', () => {
  it('a very long page is brought under the budget', () => {
    // The real case: 25 Mpx / ~100 MB of RGBA, on the DEFAULT path for an injected widget with no
    // share grant — i.e. the paved deployment, not an exotic option.
    const { width, height } = fitSchematicSize(1126, 22304, 1)
    expect(width * height).toBeLessThanOrEqual(MAX_SCHEMATIC_PIXELS)
    // …and it is still recognisably the same picture, not clamped to a square.
    const aspectIn = 1126 / 22304
    expect(width / height).toBeCloseTo(aspectIn, 2)
  })

  it('scale cannot be used to exceed the budget', () => {
    const { width, height } = fitSchematicSize(4000, 3000, 8)
    expect(width * height).toBeLessThanOrEqual(MAX_SCHEMATIC_PIXELS)
  })

  it('an image already under the budget is left alone', () => {
    // The discriminating half — a function that always shrank would pass every test above.
    expect(fitSchematicSize(1000, 800, 1)).toEqual({ width: 1000, height: 800 })
  })

  it('bounds are applied BEFORE the budget, so a small maxWidth still wins', () => {
    // Wrong order: shrink 25 Mpx to 8 Mpx first, then find the result already under maxWidth and
    // "honour" it by doing nothing — leaving a 1500px-wide image for a caller who asked for 300.
    const { width } = fitSchematicSize(1126, 22304, 1, { maxWidth: 300, maxPixels: 8_000_000 })
    expect(width).toBeLessThanOrEqual(300)
  })
})

describe('the result is always a usable canvas size', () => {
  it('never zero — a 0-width canvas throws in the browser', () => {
    // Aggressive shrink on an extreme aspect ratio drives one dimension below 1px.
    const { width, height } = fitSchematicSize(1, 100000, 1, { maxPixels: 100 })
    expect(width).toBeGreaterThanOrEqual(1)
    expect(height).toBeGreaterThanOrEqual(1)
  })

  it('integers, since canvas dimensions are truncated silently otherwise', () => {
    const { width, height } = fitSchematicSize(333, 777, 1, { maxWidth: 100 })
    expect(Number.isInteger(width)).toBe(true)
    expect(Number.isInteger(height)).toBe(true)
  })
})

describe('vision-token estimate: the ceiling was published as a floor', () => {
  it('a small image is CHEAP — there is no ~1000-token floor', async () => {
    const { approxVisionTokens } = await import('./schematic-size')
    // Six sites asserted "~1000-1600 vision tokens regardless of content". The release's own
    // worked example is 491x480, and the flags this cycle added make it far smaller still.
    expect(approxVisionTokens(491, 480)).toBeLessThan(400)
    expect(approxVisionTokens(200, 196)).toBeLessThan(100)
  })

  it('matches Anthropic\'s (w*h)/750 approximation', async () => {
    const { approxVisionTokens } = await import('./schematic-size')
    expect(approxVisionTokens(491, 480)).toBe(Math.round((491 * 480) / 750))
    expect(approxVisionTokens(1500, 1000)).toBe(2000)
  })

  it('scales with pixels — the property the old constant denied', async () => {
    const { approxVisionTokens } = await import('./schematic-size')
    // "Regardless of content" was really "regardless of SIZE", which is what made capping the
    // schematic look pointless. Halving each edge quarters the cost.
    expect(approxVisionTokens(400, 400)).toBeCloseTo(approxVisionTokens(800, 800) / 4, 0)
  })

  it('degenerate sizes report 0 rather than a misleading estimate', async () => {
    const { approxVisionTokens } = await import('./schematic-size')
    expect(approxVisionTokens(0, 500)).toBe(0)
    expect(approxVisionTokens(-1, 500)).toBe(0)
  })
})
