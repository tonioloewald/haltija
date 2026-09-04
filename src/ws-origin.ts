/**
 * Who may open the machine-scope WebSocket (review B3, extending #40).
 *
 * `/ws/terminal` is the shell's own socket: on connect it volunteers
 * `{type:'identity', shellId, cwd}` — the developer's working directory — and it carries
 * file-touch notifications naming absolute paths. It accepted **unauthenticated cross-origin
 * upgrades**, so any web page could open it and read that stream. The stdio channel (#40) removed
 * the request path for machine control but not this disclosure path.
 *
 * That mattered beyond its own severity: the release stated "no machine-control surface on any
 * transport at all" in three hand-written places, one of which (`CLAUDE.md`) agents read as ground
 * truth. A false completeness claim in a security note propagates outside the repo.
 *
 * ## Why `/ws/browser` is deliberately NOT restricted
 *
 * The widget is injected into arbitrary pages and connects from whatever origin that page has —
 * that is the entire product. Restricting it would break the bookmarklet, the tunnel case, and
 * every embedder. `/ws/terminal` has no such requirement: its only legitimate clients are the
 * desktop app's own local frames.
 */

/**
 * Loopback origins are self-evidently same-machine and NAMED, so they need nothing further. The
 * haltija UI and the `<task-board>` component connect this way (they are served by the server
 * itself), which is why this stays permissive.
 */
export function isLoopbackOrigin(origin: string | null | undefined): boolean {
  if (!origin || origin === 'null') return false
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return false // unparseable: refuse rather than guess
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/**
 * May this connection open a machine-scope socket?
 *
 * The first version of this accepted `Origin: null` outright, and review M1 reproduced the hole
 * end-to-end with real Chromium: a page on a hostile origin embeds
 * `<iframe sandbox="allow-scripts" srcdoc="…new WebSocket('ws://localhost:8700/ws/terminal')…">`,
 * the opaque origin serialises to the literal string `null`, and the server then volunteers
 * `{type:'identity', shellId, cwd}` and a stream of absolute file paths. Reproduced: a real
 * sandboxed srcdoc frame got `101` and `STOLEN: {"shellId":"shell-1","cwd":"/Users/…"}`.
 *
 * A loopback *peer-IP* check does not help, because that traffic genuinely comes from the
 * developer's own browser on 127.0.0.1. Origin alone cannot separate the legitimate frame from the
 * hostile one — the desktop renderer is `loadFile()`, so it sends `Origin: null` too.
 *
 * So `null` must PROVE itself with a per-launch secret the desktop app passes to its own terminal
 * frame. An attacker's frame cannot read it: it is never sent to a page, only embedded in the URL
 * of an iframe the app itself creates.
 *
 * Absent Origin (a non-browser client: the CLI, a test harness) is treated the same as `null` —
 * browsers always send Origin on a cross-origin WebSocket, so absence is not forgeable BY a page,
 * but it IS forgeable by anything on the LAN, and the server binds 0.0.0.0.
 */
export function mayOpenMachineSocket(opts: {
  origin: string | null | undefined
  nonce: string | null | undefined
  expectedNonce: string | null | undefined
}): boolean {
  if (isLoopbackOrigin(opts.origin)) return true

  // ABSENT is not the same as `null`, and conflating them broke both directions.
  //
  // A browser ALWAYS sends Origin on a cross-origin WebSocket, so a missing header means a
  // NON-BROWSER client — the CLI, an agent harness, a test. Those are legitimate and cannot be a
  // hostile page, so they are allowed. (Anything on the LAN can also omit it; that exposure is
  // real, pre-dates this gate, and is the `--token` story — this gate is not what closes it, and
  // saying otherwise is the false-claim mistake M1 was actually about.)
  if (opts.origin === null || opts.origin === undefined) return true

  // A BROWSER frame with an opaque or file origin: `null` from a sandboxed/srcdoc/data frame, and
  // `file://` from Electron's own disk-loaded renderer — which is what the legitimate terminal
  // sends. Measured, after an earlier version of this assumed `null` and refused the real app.
  // Indistinguishable by origin, so the app's frame proves itself with the launch nonce.
  const origin = String(opts.origin)
  const isOpaqueBrowserOrigin = origin === 'null' || origin.startsWith('file:')
  if (!isOpaqueBrowserOrigin) return false // a foreign origin; the nonce cannot buy it in

  if (!opts.expectedNonce) return false // no nonce minted: fail closed
  return !!opts.nonce && opts.nonce === opts.expectedNonce
}

/**
 * Sockets that expose the machine rather than the browser. `/ws/browser` is absent on purpose: the
 * widget is injected into arbitrary pages and connects from theirs, which is the entire product.
 */
// Only /ws/terminal. `/ws/agent` was included first and it broke programmatic agents outright —
// they are non-browser clients, which the rule above already admits, so gating the path added
// nothing except a regression. Its residual disclosure (broadcast forwards command responses) is
// the same LAN exposure the whole REST surface has, and `--token` is what addresses that.
const MACHINE_SCOPE_SOCKETS = new Set(['/ws/terminal'])

export function requiresLocalOrigin(pathname: string): boolean {
  return MACHINE_SCOPE_SOCKETS.has(pathname)
}
