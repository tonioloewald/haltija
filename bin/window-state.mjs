/** ⚠️  AUTO-GENERATED FROM src/window-state.ts — DO NOT EDIT. Run: bun run build */
// src/window-state.ts
function isTopLevelTab(w) {
  return (w.windowType || "tab") === "tab";
}
function isVisible(w) {
  return w.active !== false;
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
  summarizeWindow,
  isVisibleTab,
  isVisible,
  isTopLevelTab,
  isDrivable
};
