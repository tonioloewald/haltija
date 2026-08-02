/** ⚠️  AUTO-GENERATED FROM src/window-state.ts — DO NOT EDIT. Run: bun run build */
// src/window-state.ts
function isTopLevelTab(w) {
  return (w.windowType || "tab") === "tab";
}
function isVisible(w) {
  if (w.hidden === true)
    return false;
  if (w.active === false)
    return false;
  return true;
}
function visibilityKnown(w) {
  return typeof w.active === "boolean" || typeof w.hidden === "boolean";
}
function isVisibleTab(w) {
  return isTopLevelTab(w) && isVisible(w);
}
function isDrivable(windows) {
  return windows.some(isTopLevelTab);
}
function summarizeWindow(w) {
  return {
    id: w.id,
    url: w.url,
    title: w.title,
    active: isVisible(w),
    hidden: !isVisible(w),
    windowType: w.windowType || "tab"
  };
}
export {
  visibilityKnown,
  summarizeWindow,
  isVisibleTab,
  isVisible,
  isTopLevelTab,
  isDrivable
};
