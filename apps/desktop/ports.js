/** ⚠️  AUTO-GENERATED FROM src/ports.ts — DO NOT EDIT. Run: bun run build */
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

// src/ports.ts
var exports_ports = {};
__export(exports_ports, {
  DEFAULT_HTTPS_PORT: () => DEFAULT_HTTPS_PORT,
  DEFAULT_HTTP_PORT: () => DEFAULT_HTTP_PORT,
  DEFAULT_INTERNAL_PORT: () => DEFAULT_INTERNAL_PORT,
  INTERNAL_PORTS: () => INTERNAL_PORTS,
  LEGACY_INTERNAL_PORT: () => LEGACY_INTERNAL_PORT,
  PUBLIC_PORTS: () => PUBLIC_PORTS,
  RESERVED_INTERNAL_HTTPS_PORT: () => RESERVED_INTERNAL_HTTPS_PORT,
  assertNoPortRoleConflict: () => assertNoPortRoleConflict,
  internalPortConflict: () => internalPortConflict
});
module.exports = __toCommonJS(exports_ports);
var DEFAULT_HTTP_PORT = 8700;
var DEFAULT_HTTPS_PORT = 8701;
var DEFAULT_INTERNAL_PORT = 8710;
var RESERVED_INTERNAL_HTTPS_PORT = 8711;
var LEGACY_INTERNAL_PORT = 8701;
var PUBLIC_PORTS = [DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT];
var INTERNAL_PORTS = [
  DEFAULT_INTERNAL_PORT,
  RESERVED_INTERNAL_HTTPS_PORT
];
function internalPortConflict(port) {
  if (port === DEFAULT_HTTPS_PORT) {
    return `HALTIJA_INTERNAL_PORT=${port} is the public HTTPS port. The desktop app's internal ` + `chrome-widget server would contend with the channel that serves https:// pages — and in ` + `'builtin' server mode it shuts down whatever it finds there, taking a --both server's HTTP ` + `listener with it. Default is ${DEFAULT_INTERNAL_PORT}. See ` + `https://github.com/tonioloewald/haltija/issues/32`;
  }
  if (port === DEFAULT_HTTP_PORT) {
    return `HALTIJA_INTERNAL_PORT=${port} is the public HTTP port — the internal server would contend ` + `with the channel agents drive. Default is ${DEFAULT_INTERNAL_PORT}.`;
  }
  return null;
}
function assertNoPortRoleConflict() {
  const overlap = INTERNAL_PORTS.filter((p) => PUBLIC_PORTS.includes(p));
  if (overlap.length > 0) {
    throw new Error(`Port role conflict: ${overlap.join(", ")} assigned to both the public channel and the ` + `desktop app's internals. That is issue #32a — one number, two defaults, neither aware of ` + `the other. Pick a free number in the internal block rather than reusing a public one.`);
  }
}
