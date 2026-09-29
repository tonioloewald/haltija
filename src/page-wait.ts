/**
 * After a navigation or reload: has the navigated tab come back? (#54)
 *
 * Pure, so the rule is unit-tested without a browser; `waitForNewPage` in server.ts polls it.
 *
 * Only by IDENTITY: the same windowId with a new browserId. Across origins the widget hands its id
 * over in `window.name` (navigation-url.ts), so a tab keeps its id through same-site navigations, and
 * the desktop app's ids are stable anyway. An earlier version accepted "a new window that appeared",
 * and an unrelated tab opening during a slow load was reported as the page coming back and given
 * focus (beta.2 re-review). That is routing by inference, which this repo refuses.
 *
 * Where identity cannot follow — a cross-SITE navigation clears `window.name` — a new same-kind
 * window on the expected origin, after the tab has gone, is reported as a CANDIDATE: never as
 * "reconnected", and never given focus. The caller is told which window it might be.
 */
/**
 * The most a caller may make a navigation wait. Caller-supplied and reachable by any page (#44), so
 * capped; and under the ~60 s an MCP host gives a tool call, allowing for the 5 s navigation send.
 */
export const MAX_PAGE_WAIT_MS = 50_000

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
    const o = new URL(url, base).origin
    return o === 'null' ? null : o
  } catch {
    return null
  }
}

export type PageReturn<W> = { window: W; confirmed: true } | { window: W; confirmed: false } | undefined

/**
 * The navigated tab, if it is back (`confirmed`), or a window that may be it but cannot be shown to
 * be (`confirmed: false`), or undefined. `known` is the set of window ids when the navigation began.
 */
export function returnedWindow<W extends WindowLike>(
  windows: Map<string, W>,
  target: PageTarget | null,
  known: Set<string>,
  expectedOrigin: string | null,
): PageReturn<W> {
  if (!target) return undefined
  const same = windows.get(target.id)
  if (same && same.browserId !== target.browserId) return { window: same, confirmed: true }
  if (windows.has(target.id)) return undefined // still the old page, or not back yet
  const kind = (w: { windowType?: string }) => w.windowType || 'tab'
  const candidate = Array.from(windows.values()).find(
    (w) => !known.has(w.id) && kind(w) === kind(target) && expectedOrigin !== null && originOf(w.url) === expectedOrigin,
  )
  return candidate ? { window: candidate, confirmed: false } : undefined
}
