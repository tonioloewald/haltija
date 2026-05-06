/**
 * Named-instance registry.
 *
 * Each haltija server may register itself by name so `hj --name <foo>`
 * (or `HALTIJA_NAME=<foo> hj`) can resolve back to the right port without
 * the user having to remember it.
 *
 * Registry layout: one file per named instance at
 *   ~/.haltija/servers/<name>.json  → { name, port, pid, cwd, startedAt }
 *
 * On startup the server writes its file; on shutdown it removes it. Stale
 * entries (process no longer alive) are cleaned up lazily on lookup/list.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface NamedInstance {
  name: string
  port: number
  pid: number
  cwd: string
  startedAt: number
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

/** Write (or overwrite) a registry entry. Throws if `name` is invalid. */
export function register(
  name: string,
  port: number,
  opts: { pid?: number; cwd?: string; dir?: string } = {},
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
