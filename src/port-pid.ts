/**
 * Port → pid resolution, and identifying a process before we signal it.
 *
 * Extracted from server.ts so it can be tested against real sockets: this is the
 * code that decides which process gets a SIGTERM on the user's machine, and it
 * had a bug that made it pick the wrong one.
 *
 * POSIX only (lsof/ps). See CLAUDE.md → "Platform support".
 */

import { execSync } from 'child_process'

/**
 * The pids **listening** on a port. Never our own.
 *
 * `-sTCP:LISTEN` is load-bearing — do not drop it.
 *
 * `lsof -i :PORT` matches any socket whose local **or remote** port is PORT, so
 * without the filter the result also contains every connected **client** — including
 * the user's browser, holding a WebSocket open to the very server we're inspecting.
 * lsof prints in ascending pid order, and a browser that has been running since login
 * has the *lower* pid, so it sorts **first**. Taking `pids[0]` from the unfiltered
 * list therefore SIGTERMs the user's browser while the actual server survives — and
 * the caller logs a cheerful "retired pid N".
 */
export function listenerPidsOnPort(port: number): number[] {
  try {
    const output = execSync(`lsof -ti :${port} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf-8' }).trim()
    if (!output) return []
    return output
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((pid) => Number.isFinite(pid) && pid !== process.pid)
  } catch {
    // Nothing listening, or lsof unavailable (non-POSIX).
    return []
  }
}

/** The single listener on a port, if there is one. */
export function listenerPidOnPort(port: number): number | null {
  return listenerPidsOnPort(port)[0] ?? null
}

/**
 * Positively identify a pid as a haltija server before signalling it.
 *
 * Belt and braces on top of `-sTCP:LISTEN`. We are about to kill a process on
 * someone's machine, and a wrong answer costs them work — so if we cannot read the
 * process at all, this returns false. **Never signal a pid you have not identified.**
 */
export function isHaltijaProcess(pid: number): boolean {
  try {
    const cmd = execSync(`ps -p ${pid} -o command= 2>/dev/null`, { encoding: 'utf-8' }).trim()
    if (!cmd) return false
    // Covers `bun …/haltija/dist/server.js`, the compiled `haltija-server-*` binary,
    // and `bunx haltija`.
    return /haltija|tosijs-dev/i.test(cmd)
  } catch {
    return false
  }
}
