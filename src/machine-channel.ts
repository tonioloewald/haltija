/**
 * Machine control over the server child's stdio (#40).
 *
 * `/terminal/*` and `/files/*` are refused on the network listener (`machine-control.ts`). The
 * desktop app's terminal / agent / file-browser tabs are genuinely useful though, so they get the
 * functionality back over a channel a browser cannot address.
 *
 * ## Why stdio, after the Unix socket failed
 *
 * The first attempt served these routes on a Unix domain socket. Bun 1.4.0 cannot: `Bun.serve
 * ({unix})`, `node:http` listening on a socket path, and raw `Bun.listen({unix})` all accept the
 * connection and never respond, while a Node↔Node control over the same UDS works. That code was
 * backed out rather than shipped half-working.
 *
 * A pipe has no address. There is no origin, no port, no URL — `fetch()` cannot name a file
 * descriptor, so the drive-by class is structurally excluded rather than checked for. Electron main
 * already spawns this process and already parses its stdout (`HALTIJA_PRIVATE_READY`,
 * `__NEED_WINDOW__`), so the channel exists and is in use; this adds a framing to it.
 *
 * ## The capability is granted, not ambient
 *
 * The reader starts only when the spawning parent sets `HALTIJA_MACHINE_CHANNEL=1`. So a plain
 * `bunx haltija` has **no machine-control surface on any transport** — which is a stronger position
 * than before this whole exercise, when it was on by default and reachable by any web page.
 *
 * ## Framing
 *
 *   in  (stdin) : HJ_MACHINE_REQ {"id","method","path","headers"?,"bodyB64"?}
 *   out (stdout): HJ_MACHINE_RES {"id","status","headers","bodyB64"}
 *
 * One line each, prefixed, so responses stay distinguishable from ordinary logging on the same
 * stream — the parent already filters stdout by prefix for two other messages.
 *
 * Bodies are **base64 in both directions**, unconditionally. `/files/image` returns binary, and a
 * rule that encodes "only when it looks binary" is a rule that eventually guesses wrong on a UTF-8
 * boundary and corrupts a file the user is editing. Uniform is cheaper to reason about than
 * conditional, and the cost is ~33% on a channel that carries source files, not video.
 */

export const MACHINE_REQ_PREFIX = 'HJ_MACHINE_REQ '
export const MACHINE_RES_PREFIX = 'HJ_MACHINE_RES '

/** Set by the spawning parent to open the channel at all. */
export const MACHINE_CHANNEL_ENV = 'HALTIJA_MACHINE_CHANNEL'

export interface MachineRequest {
  id: string
  method: string
  /** Path plus query, e.g. `/files/read?path=/tmp/x`. Never a full URL — there is no host here. */
  path: string
  headers?: Record<string, string>
  bodyB64?: string
}

export interface MachineResponse {
  id: string
  status: number
  headers: Record<string, string>
  bodyB64: string
}

/** Is the channel requested? */
export function machineChannelEnabled(env: Record<string, string | undefined>): boolean {
  return env[MACHINE_CHANNEL_ENV] === '1'
}

export function formatRequest(req: MachineRequest): string {
  return MACHINE_REQ_PREFIX + JSON.stringify(req) + '\n'
}

export function formatResponse(res: MachineResponse): string {
  return MACHINE_RES_PREFIX + JSON.stringify(res) + '\n'
}

/**
 * Parse one line, returning null for anything that is not ours.
 *
 * Deliberately tolerant: the streams carry log output, banners and two other prefixed messages, so
 * "not for me" is the common case and must never throw. A line that IS ours but malformed also
 * returns null rather than throwing — a corrupt frame should drop, not take the server down.
 */
export function parseRequestLine(line: string): MachineRequest | null {
  if (!line.startsWith(MACHINE_REQ_PREFIX)) return null
  try {
    const parsed = JSON.parse(line.slice(MACHINE_REQ_PREFIX.length))
    if (typeof parsed?.id !== 'string' || typeof parsed?.path !== 'string') return null
    if (!parsed.path.startsWith('/')) return null
    return { method: 'GET', ...parsed }
  } catch {
    return null
  }
}

export function parseResponseLine(line: string): MachineResponse | null {
  if (!line.startsWith(MACHINE_RES_PREFIX)) return null
  try {
    const parsed = JSON.parse(line.slice(MACHINE_RES_PREFIX.length))
    if (typeof parsed?.id !== 'string' || typeof parsed?.status !== 'number') return null
    return { headers: {}, bodyB64: '', ...parsed }
  } catch {
    return null
  }
}

/**
 * Split a byte stream into complete lines, keeping the remainder.
 *
 * A pipe delivers chunks, not lines: a 40 KB file listing arrives in pieces and a JSON.parse on a
 * half-frame would drop the response and hang the caller. Callers keep the returned `rest` and pass
 * it back on the next chunk.
 */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}
