/**
 * Is the tab we just talked to actually awake?
 *
 * From issue #3, and it is the sharpest failure this tool has: a hidden tab **answers**. Run
 * `hj eval 'document.querySelectorAll("tosi-b3d").length'` against a backgrounded tab and you get
 * `0` — not a timeout, not an error. A confident, wrong number. The custom elements are
 * registered and the static markup rendered, but browsers stop `requestAnimationFrame` and
 * throttle timers in a hidden tab, so anything mounted by rAF / IntersectionObserver never runs.
 * The page looks **broken** when it is merely **asleep**, and the reporter burned several rounds
 * diagnosing a component bug that didn't exist.
 *
 * This is the instrument lying in its most dangerous form: not silence, but a plausible answer.
 * So when we route a command to a tab that has told us it is hidden, we say so alongside the
 * result rather than letting the number speak for itself.
 *
 * **Why not `lastSeen` staleness?** The reporter suggested it, and the data does go stale — but
 * there is no periodic heartbeat: `lastSeen` only advances on navigation/visibility events. So an
 * idle-but-perfectly-healthy tab looks exactly as stale as a sleeping one, and labelling on it
 * would add a NEW false signal to fix a lying one. `active` is the honest signal: the widget sets
 * it from `document.visibilityState` on `visibilitychange`, so `active === false` means the tab
 * itself reported being hidden.
 */

/** The bits of a tracked window this decision needs. */
export interface TabLivenessInfo {
  id: string
  title?: string
  /** False when the tab reported itself hidden (visibilitychange → hidden). */
  active?: boolean
}

/**
 * A warning to attach to a result that came from a hidden tab, or null when the tab is awake
 * (or we have no basis to claim otherwise — `active` undefined means the tab never reported,
 * and we do not invent a warning we can't support).
 */
export function hiddenTabWarning(win: TabLivenessInfo | null | undefined): string | null {
  if (!win) return null
  if (win.active !== false) return null
  const which = win.title ? `"${win.title}"` : win.id
  return (
    `The tab that answered (${which}) reports it is HIDDEN — backgrounded, minimized, ` +
    `behind another window, or the display is asleep. Browsers stop requestAnimationFrame and ` +
    `throttle timers in a hidden tab, so anything mounted by rAF/IntersectionObserver may never ` +
    `have run: THIS RESULT CAN BE PLAUSIBLE BUT WRONG (an empty selector here means "not mounted ` +
    `yet", not "broken"). Bring the tab to the front, or target a visible one with --window <id>.`
  )
}
