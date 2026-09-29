/**
 * After a navigation or reload: which window is the navigated tab now? (#54, beta.2 review)
 *
 * Pure, so the rule is unit-tested without a browser; `waitForNewPage` in server.ts polls it.
 *
 * Two shapes of "came back":
 *  - the SAME windowId with a new browserId: a same-origin load, and every load in the desktop app,
 *    whose windowId is injected and stable;
 *  - a NEW windowId: outside the desktop app the id lives in sessionStorage, which is PER-ORIGIN, so
 *    a tab that moves to another origin (another localhost port, an OAuth redirect) reconnects under
 *    a fresh id, and an iframe mints one on every load. The first version watched only the old id,
 *    waited out the whole timeout and reported "no widget reconnected" ~20 ms after it was back.
 *    Accepted: a window of the same kind that did not exist when the navigation began and is on the
 *    requested origin — or the navigated tab is gone, which covers a redirect to another origin.
 */

/** The most a caller may make a navigation wait. Caller-supplied, and reachable by any page (#44). */
export const MAX_PAGE_WAIT_MS = 60_000

/** Clamp a caller-supplied wait: default when absent, never negative, never beyond the cap. */
export function clampPageWait(timeoutMs: unknown, fallback = 10_000): number {
  const n = timeoutMs === undefined || timeoutMs === null ? fallback : Number(timeoutMs)
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, 0), MAX_PAGE_WAIT_MS)
}

/** The tab a navigation is about to go to, snapshotted before it is sent. */
export interface PageTarget {
  id: string
  browserId: string | null
  windowType?: string
  focused: boolean
  /** The page it was on, so a relative navigation URL resolves to the origin to expect. */
  url: string
}

export interface WindowLike {
  id: string
  browserId: string | null
  windowType?: string
  url: string
}

export function originOf(url: string, base?: string): string | null {
  try {
    return new URL(url, base).origin
  } catch {
    return null
  }
}

/**
 * The window the navigated tab came back as, or undefined if it has not come back yet.
 * `known` is the set of window ids that existed when the navigation began.
 */
export function returnedWindow<W extends WindowLike>(
  windows: Map<string, W>,
  target: PageTarget | null,
  known: Set<string>,
  expectedOrigin: string | null,
): W | undefined {
  const kind = (w: { windowType?: string }) => w.windowType || 'tab'
  if (!target) return Array.from(windows.values()).find((w) => !known.has(w.id))
  const same = windows.get(target.id)
  if (same && same.browserId !== target.browserId) return same
  return Array.from(windows.values()).find(
    (w) =>
      !known.has(w.id) &&
      kind(w) === kind(target) &&
      ((expectedOrigin !== null && originOf(w.url) === expectedOrigin) || !windows.has(target.id)),
  )
}
