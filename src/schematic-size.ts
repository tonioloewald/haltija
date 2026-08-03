/**
 * How big the rasterized schematic ends up — the pure arithmetic, extracted so it can be checked.
 *
 * This sizing contract was broken in a way that is worth remembering: `maxWidth`, `maxHeight`,
 * `format` and `quality` were accepted by the schema, parsed by the handler, threaded into
 * `rasterizeSchematic`, and then **not used**. Asking for `{maxWidth: 300, maxHeight: 300, format:
 * 'jpeg'}` returned a byte-identical 1126×22304 PNG that still reported `format: 'png'`. Not waste —
 * an API that answers a question you didn't ask while claiming you asked it.
 *
 * It was fixed and then shipped with no test at any tier, because everything that could exercise it
 * needed a real canvas and a real SVG. But the part that was WRONG is arithmetic, and arithmetic
 * doesn't need a browser. The drawing still needs one (there's an e2e case for format/quality); the
 * numbers are here.
 */

export interface SizeLimits {
  maxWidth?: number
  maxHeight?: number
  /**
   * Hard ceiling regardless of the caller's bounds. A long page produced 25 Mpx — roughly 100 MB of
   * RGBA — on the DEFAULT path for an injected widget with no share grant, i.e. the paved
   * deployment. Overridable only so tests don't have to build 8-megapixel fixtures.
   */
  maxPixels?: number
}

export const MAX_SCHEMATIC_PIXELS = 8_000_000

/**
 * Final canvas dimensions for a schematic, in device pixels.
 *
 * Order matters: apply the caller's bounds first, then the global budget. Doing it the other way
 * means a page over the budget gets shrunk to 8 Mpx and then *ignores* a smaller `maxWidth`, which
 * is the same class of "your parameter was noted and discarded" bug this exists to prevent.
 *
 * Aspect ratio is preserved throughout — both limits scale by a single factor, never independently.
 */
export function fitSchematicSize(
  width: number,
  height: number,
  scale = 1,
  limits: SizeLimits = {},
): { width: number; height: number } {
  let w = width * scale
  let h = height * scale

  // A limit only ever shrinks. `limit / value` when the value is already under the limit would
  // ENLARGE it — asking for maxWidth:4000 on a 300px page must not upscale to 4000.
  const fit = (limit: number | undefined, value: number) =>
    limit && limit > 0 && value > limit ? limit / value : 1
  const k = Math.min(fit(limits.maxWidth, w), fit(limits.maxHeight, h))
  w *= k
  h *= k

  const maxPixels = limits.maxPixels ?? MAX_SCHEMATIC_PIXELS
  const over = (w * h) / maxPixels
  if (over > 1) {
    const shrink = Math.sqrt(1 / over)
    w *= shrink
    h *= shrink
  }

  // `ceil` after all scaling, and never below 1: a canvas of width 0 throws, and a sub-pixel result
  // from an aggressive shrink is otherwise easy to produce.
  let W = Math.max(1, Math.ceil(w))
  let H = Math.max(1, Math.ceil(h))

  // …but rounding UP is how the shipped version quietly exceeded the budget it had just enforced:
  // 1126×22304 came back as 8,006,604 pixels against a limit described in the code as "a hard pixel
  // budget regardless". Only 0.08% over, and harmless — which is exactly why it would never have
  // been noticed, and exactly the kind of small false claim this release is about. Trim whole
  // rows/columns until it genuinely holds. `ceil` adds under 1px per side, so each pass removes
  // thousands of pixels and this converges in one or two iterations.
  //
  // Rounding DOWN instead is tempting and wrong: `22304 * (300 / 22304)` is 299.99999999999994 in
  // binary floating point, so `floor` would return 299 for a caller who asked for exactly 300.
  while (W * H > maxPixels && (W > 1 || H > 1)) {
    if (W >= H) W--
    else H--
  }

  return { width: W, height: H }
}
