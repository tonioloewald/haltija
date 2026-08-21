/** ⚠️  AUTO-GENERATED FROM src/desktop-isolation.ts — DO NOT EDIT. Run: bun run build */
// src/desktop-isolation.ts
var SHARED_PUBLIC_URL = "http://localhost:8700";
var SHARED_INTERNAL_PORT = 8701;
function resolveInternalPort(env) {
  const raw = env.HALTIJA_INTERNAL_PORT;
  if (raw === undefined || raw === "")
    return SHARED_INTERNAL_PORT;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0)
    return 0;
  return parsed;
}
function resolvePublicUrl(env) {
  return env.HALTIJA_PUBLIC_URL || null;
}
function isPrivateInstance(env) {
  return env.HALTIJA_PRIVATE === "1";
}
function resolveServerUrl(inputs) {
  const { injected, isPrivate, persisted, persistedIsUserSet } = inputs;
  if (isPrivate && injected)
    return injected;
  if (persistedIsUserSet && persisted)
    return persisted;
  return injected || persisted || SHARED_PUBLIC_URL;
}
export {
  SHARED_INTERNAL_PORT,
  SHARED_PUBLIC_URL,
  isPrivateInstance,
  resolveInternalPort,
  resolvePublicUrl,
  resolveServerUrl
};
