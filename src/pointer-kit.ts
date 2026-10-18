/**
 * Page-side helpers shared by `clickAt` and `dragFrom` (test-in-browser.ts) and the REST drag
 * (drag.ts), pasted into each probe. `clickAt` and `dragFrom` were two
 * verbatim 20-line copies, and the copies already agreed on a bug: the "outside the document" check
 * compared VIEWPORT coordinates against document size, so on a scrolled page a real element above
 * the fold (negative `getBoundingClientRect().y`) was rejected as outside the document.
 *
 * - `hjPoint(x, y)`: viewport coordinates in, viewport coordinates out, scrolled into view first.
 * - `hjSend(el, kind, x, y, buttons)`: one pointer event and its mouse twin, the order a browser
 *   uses. `buttons` is 1 while pressed, which is what drag handlers test.
 */
export const POINTER_KIT = `
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
