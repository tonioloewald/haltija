/**
 * One vocabulary for "can I drive this tab?".
 *
 * The same three questions were answered by four hand-written expressions, and the two endpoints
 * that report them disagreed on polarity: `/status` emits `hidden: active === false` while
 * `/windows` emits `active`. So `hj doctor` read `.hidden`, `routeByDeclaredOrigin` read `.active`,
 * and a consumer moving between the two endpoints silently inverted the meaning — with `undefined`
 * (an older widget that never reported) landing on the *wrong* side of one of them.
 *
 * Three predicates, named for what they actually mean, plus `summarizeWindow` so both endpoints emit
 * BOTH fields. Existing consumers of either name keep working; nobody has to know which endpoint
 * they're holding.
 */

export interface WindowLike {
  id: string
  url?: string
  title?: string
  /** The tab reported itself visible. `undefined` means it never said — treated as visible. */
  active?: boolean
  /**
   * The inverse of `active`, as `/status` reported it before this release. Both names are accepted
   * because both are on the wire from servers we still have to drive; see `isVisible`.
   */
  hidden?: boolean
  /** 'tab' | 'popup' | 'iframe'. `undefined` means a widget too old to say — treated as 'tab'. */
  windowType?: string
}

/**
 * Only a top-level tab can be the target of an untargeted command. An iframe or popup is *part of*
 * a tab, not an alternative to it. `undefined` counts as a tab so an older widget stays addressable.
 */
export function isTopLevelTab(w: WindowLike): boolean {
  return (w.windowType || 'tab') === 'tab'
}

/**
 * The tab is on screen. Note the polarity: only an explicit `false` means hidden — `undefined` is
 * "never reported", and treating that as hidden would silently drop every older widget.
 *
 * Reads **both** field names on purpose. `/status` emitted only `hidden` before this release and
 * `/windows` only `active`; a predicate keyed on one of them silently returns "visible" for every
 * server that speaks the other. That is precisely how `hj doctor` came to print "✓ ready to drive"
 * at a server whose every tab was reporting `hidden: true` (M3) — the worst failure shape we have,
 * because a false green is consumed by CI and a false red is not.
 */
export function isVisible(w: WindowLike): boolean {
  if (w.hidden === true) return false
  if (w.active === false) return false
  return true
}

/**
 * Did the tab actually *tell* us whether it was visible?
 *
 * `isVisible` has to return a boolean, so for a window that reported neither field it returns
 * `true` — a guess, and the right guess, but still a guess. Callers that publish a verdict need to
 * know the difference: "I checked and it is visible" and "nobody told me, so I assumed visible" are
 * different claims, and printing the second as the first is the whole class of bug this release is
 * about. Diagnostics should report *unknown* rather than launder an assumption into a ✓.
 */
export function visibilityKnown(w: WindowLike): boolean {
  return typeof w.active === 'boolean' || typeof w.hidden === 'boolean'
}

/** A tab we can send a command to and trust the answer: top-level AND on screen. */
export function isVisibleTab(w: WindowLike): boolean {
  return isTopLevelTab(w) && isVisible(w)
}

/**
 * Is this server drivable at all?
 *
 * Deliberately *not* the same as "has a visible tab": a hidden tab is reachable, just possibly
 * stale — that's what the hidden-tab warning is for. Reporting `ready: false` for a backgrounded
 * tab would tell a CI lane to give up on a server it could actually use.
 */
export function isDrivable(windows: WindowLike[]): boolean {
  return windows.some(isTopLevelTab)
}

/**
 * The shape both `/status` and `/windows` report for a tab.
 *
 * Emits `active` AND `hidden` — redundant on purpose. They were split across endpoints with opposite
 * polarity, so code that moved between them inverted its own meaning; carrying both makes any
 * consumer correct regardless of which endpoint it happens to be reading.
 */
export function summarizeWindow(w: WindowLike): {
  id: string
  url?: string
  title?: string
  active: boolean
  hidden: boolean
  windowType: string
} {
  return {
    id: w.id,
    url: w.url,
    title: w.title,
    active: isVisible(w),
    hidden: !isVisible(w),
    windowType: w.windowType || 'tab',
  }
}
