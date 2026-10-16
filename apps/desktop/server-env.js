/** ⚠️  AUTO-GENERATED FROM src/desktop-server-env.ts — DO NOT EDIT. Run: bun run build */
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

// src/desktop-server-env.ts
var exports_desktop_server_env = {};
__export(exports_desktop_server_env, {
  buildServerEnv: () => buildServerEnv,
  overriddenModeNotice: () => overriddenModeNotice
});
module.exports = __toCommonJS(exports_desktop_server_env);
function overriddenModeNotice(base, role) {
  const asked = base.DEV_CHANNEL_MODE?.trim();
  if (role !== "public" || !asked || asked.toLowerCase() === "both")
    return null;
  return `[haltija] ignoring DEV_CHANNEL_MODE=${asked} for the desktop app's public server: it serves ` + `HTTP and HTTPS ('both'), because it serves other projects' pages too and one project's ` + `transport choice would decide for all of them whether https:// pages can connect (#32). For a ` + `single-transport server of your own, run \`haltija --server\` with that mode instead.`;
}
function buildServerEnv(base, opts) {
  const port = String(opts.port);
  const env = {};
  for (const [k, v] of Object.entries(base))
    if (v !== undefined)
      env[k] = v;
  env.PORT = port;
  env.HALTIJA_PORT = port;
  env.DEV_CHANNEL_PORT = port;
  env.HALTIJA_DESKTOP = "1";
  env.HALTIJA_DESKTOP_PUBLIC = opts.role === "public" ? "1" : "0";
  if (opts.role === "internal")
    env.DEV_CHANNEL_MODE = "http";
  else
    delete env.DEV_CHANNEL_MODE;
  if (opts.role === "public")
    env.HALTIJA_MACHINE_CHANNEL = "1";
  else
    delete env.HALTIJA_MACHINE_CHANNEL;
  if (opts.wsNonce)
    env.HALTIJA_WS_NONCE = opts.wsNonce;
  else
    delete env.HALTIJA_WS_NONCE;
  if (opts.isPrivate) {
    env.HALTIJA_PRIVATE = "1";
    env.HALTIJA_NO_RETIRE = "1";
    env.HALTIJA_NO_INSTALL = "1";
    if (opts.portFile)
      env.HALTIJA_PORT_FILE = opts.portFile;
    delete env.HALTIJA_PORT;
    delete env.DEV_CHANNEL_PORT;
  } else {
    delete env.HALTIJA_PRIVATE;
    delete env.HALTIJA_PORT_FILE;
  }
  return env;
}
