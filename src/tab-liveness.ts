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

/**
 * How long a tab may go without painting before we stop trusting what it says about rendered
 * content. The widget asks for a frame once a second, so a compositing tab answers with an age
 * near zero and never above ~1s. Three seconds is loose enough that ordinary jank cannot trip it
 * and tight enough to catch a tab that has genuinely stopped.
 */
export const PAINT_STALE_MS = 3000

/**
 * The case `active` cannot see: a tab that reports itself VISIBLE and is not being composited.
 *
 * `visibilityState` answers "is this tab selected", not "is this tab painting", and the two
 * diverge for an occluded window, an offscreen window and a sleeping display. `hj doctor` has
 * probed for this since #28 — where an agent found four routes "not mounting" on hard navigation,
 * had a coherent mechanism for it, reproduced it four times, and nearly filed an application bug
 * that opening a second tab made vanish. But doctor is a pre-flight you run once, if you think to;
 * the lie shows up on results, which is where the check now also lives.
 *
 * Deliberately silent when `paintAgeMs` is undefined: a widget older than this feature reports
 * nothing, and inventing a warning we have no measurement for is the failure this module exists
 * to prevent. Also silent when the tab already self-reported hidden — `hiddenTabWarning` says it
 * better, and two warnings for one condition is noise that trains agents to skim.
 */
export function stalePaintWarning(
  win: TabLivenessInfo | null | undefined,
  paintAgeMs: number | undefined,
): string | null {
  if (typeof paintAgeMs !== 'number' || !Number.isFinite(paintAgeMs)) return null
  if (paintAgeMs < PAINT_STALE_MS) return null
  if (win?.active === false) return null // hiddenTabWarning covers this, with a better explanation
  const which = win?.title ? `"${win.title}"` : (win?.id ?? 'the answering tab')
  const seconds = (paintAgeMs / 1000).toFixed(1)
  return (
    `The tab that answered (${which}) says it is VISIBLE but HAS NOT PAINTED A FRAME IN ` +
    `${seconds}s — it is not being composited. That happens when a window is occluded by another, ` +
    `is offscreen, or the display is asleep, and it is not something visibilityState reports. ` +
    `Anything driven by requestAnimationFrame (React's scheduler, tosijs queueRender, animations, ` +
    `virtual scrollers) is NOT RUNNING, so a missing element is not evidence of an application ` +
    `bug and a screenshot may show a stale frame the compositor is still holding. Raise the ` +
    `window (or wake the display) and re-run before believing this result.`
  )
}
