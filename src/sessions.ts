/**
 * Instance registry.
 *
 * Each haltija server registers itself so `hj` can find it again. Two ways
 * in:
 *
 *   - **By name** — `haltija --name <foo>` lets `hj --name <foo>` (or
 *     `HALTIJA_NAME=<foo> hj`) resolve back to the right port.
 *   - **By cwd** — every project-scoped server also registers automatically
 *     under `auto-<port>`, recording the directory it was started in, so
 *     that plain `hj` run *inside that project* routes to it with no flags,
 *     no env vars, and nothing to remember. See `resolveByCwd`.
 *
 * cwd routing is what keeps two projects from stepping on each other: without
 * it every `hj` in every directory falls back to the global default port and
 * silently drives whichever browser happens to be focused there.
 *
 * Registry layout: one file per instance at
 *   ~/.haltija/servers/<name>.json  → { name, port, pid, cwd, startedAt, auto? }
 *
 * On startup the server writes its file; on shutdown it removes it. Stale
 * entries (process no longer alive) are cleaned up lazily on lookup/list.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, sep } from 'path'

export interface NamedInstance {
  name: string
  port: number
  pid: number
  cwd: string
  startedAt: number
  /** True when the server registered itself (no explicit --name). */
  auto?: boolean
}

export const DEFAULT_REGISTRY_DIR = join(homedir(), '.haltija', 'servers')

/** Validate a name: alphanumerics, dashes, underscores, dots. No path separators. */
export function isValidName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name.length > 0 && name.length <= 64
}

/** True if a process with the given pid is alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 is a "is this pid valid?" probe — doesn't actually signal
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function pathFor(name: string, dir: string): string {
  return join(dir, `${name}.json`)
}

/** The registry name an unnamed server registers itself under. */
export function autoNameFor(port: number): string {
  return `auto-${port}`
}

/** Write (or overwrite) a registry entry. Throws if `name` is invalid. */
export function register(
  name: string,
  port: number,
  opts: { pid?: number; cwd?: string; dir?: string; auto?: boolean } = {},
): NamedInstance {
  if (!isValidName(name)) {
    throw new Error(`Invalid haltija instance name: ${JSON.stringify(name)}. Use alphanumerics, dashes, underscores, dots.`)
  }
  const dir = opts.dir || DEFAULT_REGISTRY_DIR
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const entry: NamedInstance = {
    name,
    port,
    pid: opts.pid ?? process.pid,
    cwd: opts.cwd ?? process.cwd(),
    startedAt: Date.now(),
  }
  if (opts.auto) entry.auto = true
  writeFileSync(pathFor(name, dir), JSON.stringify(entry, null, 2))
  return entry
}

/** Remove a registry entry. No-op if it doesn't exist. */
export function unregister(name: string, opts: { dir?: string } = {}): void {
  const dir = opts.dir || DEFAULT_REGISTRY_DIR
  const p = pathFor(name, dir)
  try {
    rmSync(p, { force: true })
  } catch {
    // already gone
  }
}

/**
 * Read a registry entry by name. Returns null if missing, malformed, or
 * stale (pid no longer alive) — stale entries are removed as a side effect.
 */
export function lookup(name: string, opts: { dir?: string } = {}): NamedInstance | null {
  const dir = opts.dir || DEFAULT_REGISTRY_DIR
  const p = pathFor(name, dir)
  if (!existsSync(p)) return null
  let entry: NamedInstance
  try {
    entry = JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    // malformed
    try { rmSync(p, { force: true }) } catch {}
    return null
  }
  if (!isProcessAlive(entry.pid)) {
    try { rmSync(p, { force: true }) } catch {}
    return null
  }
  return entry
}

/**
 * List all live named instances. Stale entries are cleaned up as a side
 * effect of the listing.
 */
export function list(opts: { dir?: string } = {}): NamedInstance[] {
  const dir = opts.dir || DEFAULT_REGISTRY_DIR
  if (!existsSync(dir)) return []
  const out: NamedInstance[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const name = file.slice(0, -'.json'.length)
    const entry = lookup(name, { dir })
    if (entry) out.push(entry)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * True if `dir` is `p` itself or one of its ancestors.
 *
 * Compared segment-wise, not by raw prefix: `/a/foo` must NOT be treated as
 * an ancestor of `/a/foobar`.
 */
export function isAncestorOf(dir: string, p: string): boolean {
  if (!dir || !p) return false
  if (dir === p) return true
  return p.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}

/**
 * A cwd so broad that matching against it would capture unrelated projects.
 * `/` and `~` are ancestors of everything, so a server started there must not
 * win a cwd match — that would recreate the very misrouting this prevents.
 */
export function isTooBroadForCwdMatch(cwd: string): boolean {
  return cwd === sep || cwd === homedir()
}

/**
 * Find the live server that owns `cwd` — the one whose recorded directory is
 * the *nearest ancestor* of it. This is what lets plain `hj`, run anywhere
 * inside a project, reach that project's server without flags or env vars.
 *
 * Nearest wins, so a server started in a subdirectory beats one started at the
 * repo root. Ties (same cwd, e.g. a restarted server that leaked an entry)
 * break toward the most recently started.
 */
export function resolveByCwd(
  cwd: string = process.cwd(),
  opts: { dir?: string } = {},
): NamedInstance | null {
  const candidates = list(opts).filter(
    (e) => e.cwd && !isTooBroadForCwdMatch(e.cwd) && isAncestorOf(e.cwd, cwd),
  )
  if (!candidates.length) return null
  candidates.sort((a, b) => b.cwd.length - a.cwd.length || b.startedAt - a.startedAt)
  return candidates[0]
}
