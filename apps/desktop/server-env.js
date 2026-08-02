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
  buildServerEnv: () => buildServerEnv
});
module.exports = __toCommonJS(exports_desktop_server_env);
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
