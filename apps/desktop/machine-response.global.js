/** ⚠️  AUTO-GENERATED FROM src/machine-response.ts — DO NOT EDIT. Run: bun run build */
(() => {
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

  // src/machine-response.ts
  var exports_machine_response = {};
  __export(exports_machine_response, {
    machineResponseError: () => machineResponseError,
    makeMachineResponse: () => makeMachineResponse
  });
  function makeMachineResponse(status, bodyB64, headers = {}) {
    let decoded = null;
    const decode = () => {
      if (decoded === null) {
        const bytes = Uint8Array.from(atob(bodyB64 || ""), (c) => c.charCodeAt(0));
        decoded = new TextDecoder().decode(bytes);
      }
      return decoded;
    };
    return {
      ok: status >= 200 && status < 300,
      status,
      headers,
      b64: bodyB64 || "",
      dataUrl: () => `data:${headers["content-type"] || "application/octet-stream"};base64,${bodyB64 || ""}`,
      json: async () => JSON.parse(decode() || "{}"),
      text: async () => decode()
    };
  }
  function machineResponseError(status, message) {
    return makeMachineResponse(status, btoa(JSON.stringify({ success: false, error: message })), {
      "content-type": "application/json"
    });
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.document !== "undefined") {
    globalThis.__hjMachineResponse = { makeMachineResponse, machineResponseError };
  }
})();
