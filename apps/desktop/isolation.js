/** ⚠️  AUTO-GENERATED FROM src/desktop-isolation.ts — DO NOT EDIT. Run: bun run build */
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/desktop-isolation.ts
var exports_desktop_isolation = {};
__export(exports_desktop_isolation, {
  resolveServerUrl: () => resolveServerUrl,
  resolvePublicUrl: () => resolvePublicUrl,
  resolveInternalPort: () => resolveInternalPort,
  isPrivateInstance: () => isPrivateInstance,
  SHARED_PUBLIC_URL: () => SHARED_PUBLIC_URL,
  SHARED_INTERNAL_PORT: () => SHARED_INTERNAL_PORT
});
module.exports = __toCommonJS(exports_desktop_isolation);
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
