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

/** Origins a machine-scope socket may come from. */
export function isLocalOrigin(origin: string | null | undefined): boolean {
  // A file:// page sends `Origin: null`, and Electron's disk-loaded renderer is exactly that.
  // Absent means a non-browser client (the CLI, a test harness) — browsers always send Origin on
  // a cross-origin WebSocket, so absence cannot be forged BY a page.
  if (origin === null || origin === undefined || origin === '' || origin === 'null') return true
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return false // unparseable: refuse rather than guess
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/**
 * Sockets that expose the machine rather than the browser, and therefore require a local origin.
 * `/ws/browser` is absent on purpose — see above.
 */
const MACHINE_SCOPE_SOCKETS = new Set(['/ws/terminal', '/ws/agent'])

export function requiresLocalOrigin(pathname: string): boolean {
  return MACHINE_SCOPE_SOCKETS.has(pathname)
}
