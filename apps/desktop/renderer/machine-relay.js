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

const RELAY_REQUEST = 'hj-machine-request'
const RELAY_RESPONSE = 'hj-machine-response'

export function initMachineRelay() {
  window.addEventListener('message', async (event) => {
    const msg = event.data
    if (!msg || msg.type !== RELAY_REQUEST || typeof msg.id !== 'string') return

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
