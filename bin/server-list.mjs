/** ⚠️  AUTO-GENERATED FROM src/server-list.ts — DO NOT EDIT. Run: bun run build */
// src/server-list.ts
function collectCandidates(instances, resolvedPort, defaults = [8700, 8701]) {
  const byPort = new Map;
  for (const e of instances) {
    byPort.set(String(e.port), { port: String(e.port), name: e.name, cwd: e.cwd ?? null });
  }
  for (const p of [...defaults, resolvedPort]) {
    const key = String(p);
    if (!byPort.has(key))
      byPort.set(key, { port: key, name: null, cwd: null });
  }
  return [...byPort.values()];
}
function describeServer(candidate, status, probe = {}) {
  if (!status && probe.authRefused) {
    return { ...candidate, up: true, authRefused: true, version: "?", tabs: 0 };
  }
  if (!status)
    return { ...candidate, up: false };
  return {
    ...candidate,
    up: true,
    version: status.serverVersion || "?",
    desktopApp: !!status.desktopApp,
    tabs: Array.isArray(status.windows) ? status.windows.length : status.browsers ?? 0,
    ready: typeof status.ready === "boolean" ? status.ready : undefined
  };
}
function sortRows(rows) {
  return rows.filter((r) => r.up).sort((a, b) => Number(a.port) - Number(b.port));
}
function labelFor(row) {
  return row.desktopApp ? "desktop" : row.name || "(unnamed)";
}
function isAmbiguousTarget(portSourceKind, resolvedPort, liveInstances) {
  const others = liveInstances.filter((e) => String(e.port) !== String(resolvedPort));
  return { ambiguous: portSourceKind === "default" && others.length > 0, others };
}
export {
  collectCandidates,
  describeServer,
  isAmbiguousTarget,
  labelFor,
  sortRows
};
