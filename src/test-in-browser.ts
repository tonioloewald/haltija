/**
 * `testInBrowser` — jest-shaped tests whose ASSERTIONS run on the host and whose PROBES run in a
 * real browser (#51).
 *
 * ## The design, and why it is this way round
 *
 * The first proposal shipped the whole test body into the page. That single assumption generated
 * every constraint it then had to apologise for: no closure capture, an `expect` shim to maintain
 * in the page, stack traces pointing at an eval, and an unanswerable question about how host-side
 * interactions could interleave with in-page assertions.
 *
 * tosijs-3d inverted it: **keep the body on the host, ship only the smallest expression.** Three of
 * the four constraints disappear rather than improve —
 *
 * - the body is an ordinary closure, so fixtures, loops and `beforeEach` state just work; only the
 *   tiny arrow inside `read()` is re-parsed, where its scope is obvious;
 * - the host's REAL `expect` asserts a marshalled value, so there is no second assertion library to
 *   keep honest and `toEqual` on a structured object works because it is the real one;
 * - failures are thrown by the host runner at a host line, so there is nothing to map — which also
 *   avoids the trap tosijs-ui hit, where the `Function` constructor's synthesized header offset
 *   every reported line by two;
 * - and interleaving stops being a design problem, becoming ordinary `await`.
 *
 * ## Coordinates are first-class, not an escape hatch
 *
 * tosijs-3d-ensemble's `widgets3d` has no selectable elements *by construction*: custom elements in
 * the SVG namespace never upgrade, and `attachShadow` on an SVG element throws `NotSupportedError`.
 * So its UI is factory functions returning SVG subtrees — no element identity, no role, no focus,
 * no accessible name. Their entire Playwright suite contains two locators and neither touches a
 * widget.
 *
 * For that consumer the selector is the wrong primitive, and the right one falls out of the probe
 * design: ask the widget for its own geometry, then act on the coordinate.
 *
 *     const box = await page.read(() => mySlider.hitTest())
 *     await page.dragFrom(box.x, box.y, 40, 0)
 *
 * Their coordinate bugs — clicking below the fold where `elementFromPoint` returns null, hitting a
 * list row instead of the field — are why a point is scrolled into view and re-based before anything
 * is dispatched (see POINTER_KIT below). What is then dispatched IS synthetic events at a point:
 * pointer events and mouse events, both, with `buttons` set. An earlier version of this comment
 * claimed it routed through haltija's actionability handling while the code sent bare MouseEvents,
 * and pointer-driven controls (3D orbit cameras listen for pointer events and check `buttons`)
 * would have ignored the drag and still reported success (1.13.0-beta.1 correctness review).
 */


/**
 * Coordinates are VIEWPORT-relative, and that is the footgun tosijs-3d-ensemble reported: a point
 * measured from `getBoundingClientRect()` on an element below the fold is outside the viewport, so
 * `document.elementFromPoint` returns null and the event dispatches into nothing — silently, reading
 * exactly like a control refusing input. It cost them three runs to find.
 *
 * Reproduced here while writing these tests (the fixture sat at y=2306 on a long page), which is
 * how it earned this. So the point is scrolled into view first and the coordinate re-based, rather
 * than making every caller remember.
 */
/** How this talks to a browser. Structural, so any haltija client satisfies it. */
export interface BrowserBridge {
  eval(code: string): Promise<any>
  click(selector: string, options?: any): Promise<any>
  type(selector: string, text: string): Promise<any>
  press(key: string, modifiers?: any): Promise<any>
}

/**
 * Serialize an expression for the page.
 *
 * The ONLY thing that crosses. Closure capture does not survive — the arrow is re-parsed in the
 * browser — so anything it needs arrives as an argument. That constraint does not vanish here, it
 * shrinks to a place where it is visible, which is a better answer than a better error message.
 */
export function serializeProbe(fn: (...a: any[]) => any, args: readonly unknown[] = []): string {
  return `(${fn.toString()})(...${JSON.stringify(args)})`
}

/** Raised when the browser side fails, so the host runner reports it like any other failure. */
export class BrowserProbeError extends Error {
  constructor(message: string, readonly probe: string) {
    super(message)
    this.name = 'BrowserProbeError'
  }
}

export interface BrowserPage {
  /** Run an expression in the page and return its value. The only thing that crosses. */
  read<T = any>(fn: (...a: any[]) => T, args?: readonly unknown[]): Promise<T>
  /** Realistic click — scroll into view, full mouse sequence, prefers the actionable match. */
  click(selector: string): Promise<void>
  /** Per-character typing with the full key lifecycle (what triggers framework validation). */
  type(selector: string, text: string): Promise<void>
  press(key: string): Promise<void>
  /** Coordinate click, for UI with no selectable element (see widgets3d above). */
  clickAt(x: number, y: number): Promise<void>
  /** Coordinate drag by a delta — sliders, handles, orbit controls. */
  dragFrom(x: number, y: number, dx: number, dy: number, steps?: number): Promise<void>
}

/**
 * Page-side helpers shared by `clickAt` and `dragFrom`, pasted into each probe. They were two
 * verbatim 20-line copies, and the copies already agreed on a bug: the "outside the document" check
 * compared VIEWPORT coordinates against document size, so on a scrolled page a real element above
 * the fold (negative `getBoundingClientRect().y`) was rejected as outside the document.
 *
 * - `hjPoint(x, y)`: viewport coordinates in, viewport coordinates out, scrolled into view first.
 * - `hjSend(el, kind, x, y, buttons)`: one pointer event and its mouse twin, the order a browser
 *   uses. `buttons` is 1 while pressed, which is what drag handlers test.
 */
const POINTER_KIT = `
  const hjPoint = (x, y) => {
    // Reject a point outside the DOCUMENT before scrolling, in document coordinates. Otherwise
    // scrolling clamps a wild coordinate back into the viewport and we act on whatever is there.
    const docX = x + scrollX, docY = y + scrollY
    const docW = Math.max(document.documentElement.scrollWidth, innerWidth)
    const docH = Math.max(document.documentElement.scrollHeight, innerHeight)
    if (docX < 0 || docY < 0 || docX > docW || docY > docH) {
      throw new Error('(' + x + ', ' + y + ') is outside the document (' + docW + 'x' + docH + ')')
    }
    if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) {
      // Adjust by the ACTUAL scroll, not the requested one: the page may refuse to scroll that
      // far (already at an edge), and over-correcting puts the point somewhere else.
      const beforeY = scrollY, beforeX = scrollX
      scrollBy(x - innerWidth / 2, y - innerHeight / 2)
      x -= scrollX - beforeX
      y -= scrollY - beforeY
    }
    return { x, y }
  }
  const hjSend = (el, kind, x, y, buttons) => {
    const common = { clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, buttons, button: 0 }
    el.dispatchEvent(new PointerEvent('pointer' + kind, { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mouse' + kind, common))
  }
`

export function createBrowserPage(bridge: BrowserBridge): BrowserPage {
  const unwrap = (res: any) => (res && typeof res === 'object' && 'data' in res ? res.data : res)

  /**
   * Every page interaction goes through here, because `/eval` reports a page-side throw as
   * `{ success: false, error }` rather than rejecting. An earlier version called `bridge.eval`
   * directly from `clickAt`/`dragFrom` and ignored the envelope — so a click at a coordinate where
   * `elementFromPoint` returns null "succeeded", and a drag that never started reported nothing.
   * Both tests passed for the wrong reason until the assertions were tightened.
   *
   * This is precisely the failure this feature exists to catch, committed inside the feature.
   */
  const checked = (res: any, what: string, code = what) => {
    if (res && typeof res === 'object' && res.success === false) {
      throw new BrowserProbeError(res.error || `${what} failed in the page`, code)
    }
    return res
  }
  const evalChecked = async (code: string, what: string) => unwrap(checked(await bridge.eval(code), what, code))

  return {
    async read(fn, args = []) {
      const probe = serializeProbe(fn, args)
      const out = await evalChecked(`(async () => {
        try { return { ok: true, value: await ${probe} } }
        catch (e) { return { ok: false, error: String((e && e.message) || e) } }
      })()`, 'probe')
      // A probe that answers nothing is NOT a passing probe. Without this, a browser that never
      // responded would surface as `undefined` and read like a legitimate empty value.
      if (!out || typeof out !== 'object') {
        throw new BrowserProbeError('probe returned no result — is a browser connected?', probe)
      }
      if (!out.ok) throw new BrowserProbeError(out.error || 'probe threw', probe)
      return out.value
    },
    // Same envelope check as eval. `BrowserBridge` is structural, and a raw-REST bridge reports a
    // missing selector as `{ success: false }` rather than throwing, which these used to swallow.
    async click(selector) { checked(await bridge.click(selector), `click ${selector}`) },
    async type(selector, text) { checked(await bridge.type(selector, text), `type into ${selector}`) },
    async press(key) { checked(await bridge.press(key), `press ${key}`) },
    async clickAt(x, y) {
      await evalChecked(`(() => {${POINTER_KIT}
        const p = hjPoint(${x}, ${y})
        const el = document.elementFromPoint(p.x, p.y)
        if (!el) throw new Error('nothing at (' + p.x + ', ' + p.y + ') even after scrolling it into view')
        hjSend(el, 'over', p.x, p.y, 0)
        hjSend(el, 'down', p.x, p.y, 1)
        hjSend(el, 'up', p.x, p.y, 0)
        el.dispatchEvent(new MouseEvent('click', { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, composed: true, button: 0, detail: 1 }))
        return true
      })()`, 'clickAt')
    },
    async dragFrom(x, y, dx, dy, steps = 12) {
      await evalChecked(`(async () => {${POINTER_KIT}
        const p = hjPoint(${x}, ${y})
        const el = document.elementFromPoint(p.x, p.y)
        if (!el) throw new Error('nothing at (' + p.x + ', ' + p.y + ') even after scrolling it into view')
        hjSend(el, 'down', p.x, p.y, 1)
        // Moves go to whatever is under the pointer, as a browser sends them, falling back to the
        // pressed element. They bubble, so a document-level handler still sees them.
        let last = el
        for (let i = 1; i <= ${steps}; i++) {
          const px = p.x + (${dx} * i) / ${steps}, py = p.y + (${dy} * i) / ${steps}
          last = document.elementFromPoint(px, py) || el
          hjSend(last, 'move', px, py, 1)
        }
        hjSend(last, 'up', p.x + ${dx}, p.y + ${dy}, 0)
        return true
      })()`, 'dragFrom')
    },
  }
}

/**
 * Corpus liveness (#51, from tosijs-3d-ensemble).
 *
 * Their doc-test tier **stopped existing for a week and everything stayed green** — an upstream
 * change dropped it from a barrel, the site rendered perfectly, every fence was inert, and nothing
 * was red because a suite that runs nothing has no failures.
 *
 * So "ran nothing" is a distinct state here, not silence. Counting is this module's job rather than
 * each adopter's, because the adopter who forgets is exactly the one who needs it.
 */
let ranCount = 0
export function markBrowserTestRan(): void { ranCount++ }
export function browserTestsRan(): number { return ranCount }
export function resetBrowserTestCount(): void { ranCount = 0 }

/**
 * Assert the tier actually executed. Call once at the end of a run.
 *
 * `expect(failures).toBe(0)` is trivially true of a corpus that ran nothing, which is precisely how
 * the week-long outage stayed invisible.
 */
export function assertBrowserTierRan(minimum = 1): void {
  if (ranCount < minimum) {
    throw new Error(
      `browser test tier ran ${ranCount} test(s), expected at least ${minimum}. ` +
        `A suite that runs nothing has no failures — this is that state, reported rather than ` +
        `passed silently (#51).`,
    )
  }
}
