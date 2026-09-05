/** ⚠️  AUTO-GENERATED FROM src/machine-response.ts — DO NOT EDIT. Run: bun run build */
// src/machine-response.ts
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
export {
  machineResponseError,
  makeMachineResponse
};
