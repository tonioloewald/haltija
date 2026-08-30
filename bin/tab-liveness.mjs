/** ⚠️  AUTO-GENERATED FROM src/tab-liveness.ts — DO NOT EDIT. Run: bun run build */
// src/tab-liveness.ts
function hiddenTabWarning(win) {
  if (!win)
    return null;
  if (win.active !== false)
    return null;
  const which = win.title ? `"${win.title}"` : win.id;
  return `The tab that answered (${which}) reports it is HIDDEN — backgrounded, minimized, ` + `behind another window, or the display is asleep. Browsers stop requestAnimationFrame and ` + `throttle timers in a hidden tab, so anything mounted by rAF/IntersectionObserver may never ` + `have run: THIS RESULT CAN BE PLAUSIBLE BUT WRONG (an empty selector here means "not mounted ` + `yet", not "broken"). Bring the tab to the front, or target a visible one with --window <id>.`;
}
var PAINT_STALE_MS = 3000;
function stalePaintWarning(win, paintAgeMs) {
  if (typeof paintAgeMs !== "number" || !Number.isFinite(paintAgeMs))
    return null;
  if (paintAgeMs < PAINT_STALE_MS)
    return null;
  if (win?.active === false)
    return null;
  const which = win?.title ? `"${win.title}"` : win?.id ?? "the answering tab";
  const seconds = (paintAgeMs / 1000).toFixed(1);
  return `The tab that answered (${which}) says it is VISIBLE but HAS NOT PAINTED A FRAME IN ` + `${seconds}s — it is not being composited. That happens when a window is occluded by another, ` + `is offscreen, or the display is asleep, and it is not something visibilityState reports. ` + `Anything driven by requestAnimationFrame (React's scheduler, tosijs queueRender, animations, ` + `virtual scrollers) is NOT RUNNING, so a missing element is not evidence of an application ` + `bug and a screenshot may show a stale frame the compositor is still holding. Raise the ` + `window (or wake the display) and re-run before believing this result.`;
}
export {
  PAINT_STALE_MS,
  hiddenTabWarning,
  stalePaintWarning
};
