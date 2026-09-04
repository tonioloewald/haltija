/** ⚠️  AUTO-GENERATED FROM src/machine-channel.ts — DO NOT EDIT. Run: bun run build */
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

// src/machine-channel.ts
var exports_machine_channel = {};
__export(exports_machine_channel, {
  MACHINE_CHANNEL_ENV: () => MACHINE_CHANNEL_ENV,
  MACHINE_REQ_PREFIX: () => MACHINE_REQ_PREFIX,
  MACHINE_RES_PREFIX: () => MACHINE_RES_PREFIX,
  childEnvWithoutChannel: () => childEnvWithoutChannel,
  formatRequest: () => formatRequest,
  formatResponse: () => formatResponse,
  machineChannelEnabled: () => machineChannelEnabled,
  parseRequestLine: () => parseRequestLine,
  parseResponseLine: () => parseResponseLine,
  splitLines: () => splitLines
});
module.exports = __toCommonJS(exports_machine_channel);
var MACHINE_REQ_PREFIX = "HJ_MACHINE_REQ ";
var MACHINE_RES_PREFIX = "HJ_MACHINE_RES ";
var MACHINE_CHANNEL_ENV = "HALTIJA_MACHINE_CHANNEL";
function machineChannelEnabled(env) {
  return env[MACHINE_CHANNEL_ENV] === "1";
}
function formatRequest(req) {
  return MACHINE_REQ_PREFIX + JSON.stringify(req) + `
`;
}
function formatResponse(res) {
  return MACHINE_RES_PREFIX + JSON.stringify(res) + `
`;
}
function parseRequestLine(line) {
  if (!line.startsWith(MACHINE_REQ_PREFIX))
    return null;
  try {
    const parsed = JSON.parse(line.slice(MACHINE_REQ_PREFIX.length));
    if (typeof parsed?.id !== "string" || typeof parsed?.path !== "string")
      return null;
    if (!parsed.path.startsWith("/"))
      return null;
    return { method: "GET", ...parsed };
  } catch {
    return null;
  }
}
function parseResponseLine(line) {
  if (!line.startsWith(MACHINE_RES_PREFIX))
    return null;
  try {
    const parsed = JSON.parse(line.slice(MACHINE_RES_PREFIX.length));
    if (typeof parsed?.id !== "string" || typeof parsed?.status !== "number")
      return null;
    return { headers: {}, bodyB64: "", ...parsed };
  } catch {
    return null;
  }
}
function splitLines(buffer) {
  const parts = buffer.split(`
`);
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}
function childEnvWithoutChannel(env = process.env) {
  const copy = { ...env };
  delete copy[MACHINE_CHANNEL_ENV];
  return copy;
}
