import { makeMachineResponse } from './machine-response.js'
/**
 * Relay for the terminal iframe's machine-control calls (#40).
 *
 * `terminal.html` is loaded from disk as an iframe and has NO preload bridge — which is exactly
 * why it originally reached its own machine over HTTP, and why `/terminal/*` and `/files/*` had to
 * be network-reachable at all. Those routes are now refused on the network listener, so the iframe
 * asks its parent instead: the renderer has `window.haltija`, which reaches main, which owns the
 * pipe to the server.
 *
 * The iframe already talks to us this way for `terminal-cwd`, `agent-status` and `shell-renamed`,
 * so this is an extra message type on a channel that exists, not a new mechanism.
 */


/**
 * Is this the content window of a terminal iframe we created?
 *
 * Identity by object, not by origin string: `terminal.html` is loaded from disk, so its origin is
 * `null`/`file://` — indistinguishable from any other local frame, and trivially claimed. The tab
 * registry holds the actual elements, so comparing `contentWindow` identity is both stronger and
 * simpler than any string check.
 */
function isKnownTerminalFrame(source) {
  if (!source) return false
  // Straight from the DOM rather than through the tab registry: the class is set where the iframe
  // is created (tabs.js), the registry stores it under `webview` (not `iframe`), and reaching
  // across modules for a shape that can be renamed is how this check would silently start
  // returning false — which fails CLOSED here, but would break every terminal tab.
  for (const frame of document.querySelectorAll('iframe.terminal-frame')) {
    if (frame.contentWindow && frame.contentWindow === source) return true
  }
  return false
}

const RELAY_REQUEST = 'hj-machine-request'
const RELAY_RESPONSE = 'hj-machine-response'

export function initMachineRelay() {
  window.addEventListener('message', async (event) => {
    const msg = event.data
    if (!msg || msg.type !== RELAY_REQUEST || typeof msg.id !== 'string') return

    // DEFAULT-DENY on the sender, not just the message shape (review B1).
    //
    // This validated the shape only, then forwarded to shell + filesystem. Today the sole legitimate
    // sender is a terminal iframe — content tabs are <webview> guests and cannot postMessage the
    // embedder — so it was latent. But it is exactly what turns "third-party code in a preview
    // pane" into "third-party code with a shell", and any plain <iframe> added to the renderer
    // later (a docs pane, a preview, an OAuth page) would inherit shell access by accident rather
    // than by decision.
    //
    // Same discipline as isRefusedMachineControlPath: the sender must be recognised, not merely
    // fail to look wrong.
    if (!isKnownTerminalFrame(event.source)) {
      console.warn('[Haltija] machine-request from an unrecognised frame — refused')
      return
    }

    // Answer through the SOURCE window, not a broadcast: several terminal tabs can be open, and
    // posting to all of them would let one tab observe another's file contents and command output.
    const reply = (payload) => {
      try {
        event.source?.postMessage({ type: RELAY_RESPONSE, id: msg.id, ...payload }, '*')
      } catch {}
    }

    if (!window.haltija?.machineRequest) {
      reply({
        status: 503,
        bodyB64: btoa(JSON.stringify({
          success: false,
          error: 'Machine control is unavailable: this window has no preload bridge.',
        })),
      })
      return
    }

    try {
      const res = await window.haltija.machineRequest(msg.path, msg.init || {})
      // Pass base64 through UNTOUCHED. An earlier version decoded with atob() here, which yields a
      // binary string and silently corrupts anything that is not Latin-1 — /files/image is binary,
      // and a source file with any non-ASCII character would have been mangled on the way to the
      // editor. Decoding belongs where the consumer knows whether it wants text or bytes.
      reply({ status: res.status, bodyB64: res.bodyB64 || '', headers: res.headers || {} })
    } catch (err) {
      // Always reply. A pending id that never returns presents as a frozen tab.
      reply({
        status: 500,
        bodyB64: btoa(JSON.stringify({ success: false, error: String(err?.message || err) })),
      })
    }
  })
}

/**
 * fetch()-shaped access to machine control, for renderer modules (#40).
 *
 * The renderer HAS the preload bridge, so it calls `machineRequest` directly — no postMessage hop;
 * that relay exists only for the terminal iframe, which has no bridge.
 *
 * This exists because converting call sites by enumeration missed six of them: `terminal.html` was
 * done thoroughly while `tabs.js` and `agent-status.js` were forgotten entirely, so `/terminal/*`
 * from the renderer silently started returning 410 — which is how "Pick folder…" stopped working
 * (it sends a `cd` via /terminal/command). Keeping the call shape identical to fetch() means the
 * conversion is mechanical and a missed site is visible rather than subtle.
 */
export async function machineFetch(path, init = {}) {
  const respond = makeMachineResponse // shared with terminal.html via src/machine-response.ts

  if (!window.haltija?.machineRequest) {
    return respond(503, btoa(JSON.stringify({
      success: false,
      error: 'Machine control is unavailable: no preload bridge in this window.',
    })))
  }

  const frame = { method: init.method || 'GET', headers: init.headers || {} }
  if (init.body !== undefined) {
    frame.bodyB64 = btoa(typeof init.body === 'string' ? init.body : JSON.stringify(init.body))
  }
  try {
    const res = await window.haltija.machineRequest(path, frame)
    return respond(res.status, res.bodyB64 || '', res.headers || {})
  } catch (err) {
    return respond(500, btoa(JSON.stringify({ success: false, error: String(err?.message || err) })))
  }
}
