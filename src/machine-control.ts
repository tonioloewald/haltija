/**
 * The `/terminal/*` and `/files/*` surface is not served over the network (issue #40).
 *
 * ## What was reachable
 *
 * A default `bunx haltija` answered, from any caller on the port:
 *
 * - `POST /terminal/command`      → `spawn('sh', ['-c', cmd])`
 * - `POST /terminal/agent-prompt` → `claude --permission-mode dontAsk`
 * - `GET  /files/read`, `/files/tree`, `/files/image`, `POST /files/write`
 *
 * Verified 2026-09-04: a **cross-origin** POST with a `text/plain` body — which is a CORS-*simple*
 * request, so the browser issues no preflight — returned 200 and its shell command wrote a file.
 * The `Origin` header was present and ignored. That makes it reachable from any web page open in
 * the browser, not merely from the LAN; and we send `Access-Control-Allow-Private-Network: true`,
 * which opts out of the browser mitigation built to stop exactly this.
 *
 * ## Why refuse the prefix rather than gate the endpoints
 *
 * The decision (tonioloewald, #40) was: *exposing an endpoint explicitly to enable remote execution
 * is bonkers; we should simply not do it.* A token gate leaves `spawn('sh','-c')` reachable and
 * depends on the gate staying correct forever; refusing makes the class stop existing.
 *
 * And it must be the PREFIX, not a list of the dangerous routes. There are 21 routes under these
 * two prefixes. An initial pass at "remove the four bad ones" would have left `/files/tree`
 * (directory listing) and `/files/image` (arbitrary file read) serving happily. This is the same
 * lesson as `docs-drift.yml` naming no file list: **a denylist can only ever omit the next thing
 * someone adds.** So the prefix is default-deny and new routes are refused until someone
 * deliberately adds them below.
 *
 * ## No exceptions
 *
 * The allowlist is EMPTY, and keeping it that way was worth a small change elsewhere. One route
 * under this prefix had a legitimate cross-origin caller — the injected widget reads the running
 * agent list for its indicator — so the first version carved it out as an allowlist entry. That is
 * a permanent hole in a default-deny, and holes get widened by whoever needs the next one.
 * Relocating that route to `/agents` (tonioloewald's suggestion) means the rule is "nothing under
 * these prefixes is served", which is a sentence you cannot get subtly wrong.
 *
 * Everything remaining — the shell, the agent prompt, and every filesystem route — is desktop-app
 * plumbing with no legitimate cross-origin caller, and no presence in `API.md`, `DOCS.md`,
 * `llms.txt` or `api-schema.ts`.
 *
 * The cost is the desktop app's terminal / agent / file-browser tabs, which reached their own
 * machine over HTTP because `terminal.html` is a disk-loaded iframe with no preload bridge. Those
 * tabs are already deprioritised (`CLAUDE.md`: "don't invest until/unless they become a burden"),
 * and they became a burden the moment they were the sole reason for this surface. Restoring them
 * means a non-TCP channel — a Unix socket, or moving shell state into Electron main — which is
 * tracked on #40 and deliberately not done here.
 */

/** Prefixes that expose the host machine rather than the browser. */
const MACHINE_CONTROL_PREFIXES = ['/terminal/', '/files/']

/**
 * Routes under those prefixes that ARE served, because something legitimate calls them
 * cross-origin. Keep this list tiny and justify every entry — each one is a hole in a default-deny.
 */
export const MACHINE_CONTROL_ALLOWED: ReadonlySet<string> = new Set([
  // Deliberately empty — see "No exceptions" above. Anything that needs to be reachable should
  // move OFF these prefixes, as /terminal/agents did, rather than be listed here.
])

/** Is this path part of the machine-control surface we no longer serve? */
export function isRefusedMachineControlPath(path: string): boolean {
  if (!MACHINE_CONTROL_PREFIXES.some((p) => path.startsWith(p))) return false
  return !MACHINE_CONTROL_ALLOWED.has(path)
}

/**
 * What a caller gets instead.
 *
 * It names the reason rather than pretending the route never existed, because the people most
 * likely to hit this are running an older desktop app against a newer server, and "404" would send
 * them looking for a typo.
 */
export function machineControlRefusal(path: string): { status: number; body: Record<string, unknown> } {
  return {
    status: 410,
    body: {
      success: false,
      error:
        `${path} is no longer served over HTTP. This surface (shell execution, agent prompts, ` +
        `filesystem read/write) was reachable by any caller on this port — including script on ` +
        `any web page open in your browser, since a text/plain POST is a CORS-simple request and ` +
        `is never preflighted. It was removed rather than gated: a development tool has no ` +
        `business offering remote code execution on a network port at all. See ` +
        `https://github.com/tonioloewald/haltija/issues/40. Browser control (/tree, /click, ` +
        `/eval, /screenshot, …) is unaffected.`,
    },
  }
}
