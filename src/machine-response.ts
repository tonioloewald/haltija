/**
 * ONE fetch-shaped wrapper around a base64 machine-channel response.
 *
 * There were two: `respond()` inside `renderer/machine-relay.js` and `makeResponse()` inside
 * `terminal.html`. They were written days apart from the same idea and had ALREADY diverged —
 * only the second grew `dataUrl()`, which the image preview needs. That is the structural-twin
 * shape `CLAUDE.md` names, and the machine channel had already produced one regression from
 * exactly it (`main.js` hand-rolling the wire protocol, which is where `__NEED_WINDOW__` broke).
 *
 * Decoding lives here, once, because getting it wrong is silent: `atob` alone yields a Latin-1
 * binary string, so any non-ASCII character in a source file is mangled on its way to the editor
 * and looks like a bad file rather than a bad decoder.
 *
 * Built twice by `scripts/build.ts` — ESM for the renderer's modules, and a global for
 * `terminal.html`, which is an inline-script page with no import mechanism.
 */

export interface MachineResponseLike {
  ok: boolean
  status: number
  headers: Record<string, string>
  /** Raw base64, for consumers that want bytes rather than text (images, models, media). */
  b64: string
  /** `data:` URL built from the body and its content type. */
  dataUrl(): string
  json(): Promise<any>
  text(): Promise<string>
}

export function makeMachineResponse(
  status: number,
  bodyB64: string,
  headers: Record<string, string> = {},
): MachineResponseLike {
  let decoded: string | null = null
  const decode = (): string => {
    if (decoded === null) {
      // TextDecoder, not bare atob: atob produces a Latin-1 string and corrupts UTF-8.
      const bytes = Uint8Array.from(atob(bodyB64 || ''), (c) => c.charCodeAt(0))
      decoded = new TextDecoder().decode(bytes)
    }
    return decoded
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    b64: bodyB64 || '',
    dataUrl: () =>
      `data:${headers['content-type'] || 'application/octet-stream'};base64,${bodyB64 || ''}`,
    json: async () => JSON.parse(decode() || '{}'),
    text: async () => decode(),
  }
}

/** A refusal shaped like a response, so callers need no special case for "could not ask". */
export function machineResponseError(status: number, message: string): MachineResponseLike {
  return makeMachineResponse(status, btoa(JSON.stringify({ success: false, error: message })), {
    'content-type': 'application/json',
  })
}

/**
 * Publish onto the global for `terminal.html`, which loads the IIFE build with a plain script tag
 * and has no import mechanism. Harmless in the ESM build (the renderer imports the named exports
 * and never reads this), and guarded so it is inert under Bun/Node where `globalThis` is shared
 * with everything else.
 */
declare const globalThis: any
if (typeof globalThis !== 'undefined' && typeof (globalThis as any).document !== 'undefined') {
  ;(globalThis as any).__hjMachineResponse = { makeMachineResponse, machineResponseError }
}
