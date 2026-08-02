/**
 * Per-tab routing by **declaration**, not inference (issues #1 and #2).
 *
 * cwd routing gets an untargeted `hj` command to the right *server*; which **tab** answers then
 * falls back to whatever is focused. On a shared server that means two projects can drive each
 * other's pages — the original complaint.
 *
 * The obvious fix is to rank tabs by "this origin looks like the project you're standing in", and
 * it was rejected twice for a good reason: there is no reliable map from an origin to a directory
 * (proxies, several ports per project, static previews, `about:blank` mid-navigation). A ranking
 * that is *usually* right picks confidently and wrongly — reintroducing the silent misroute that
 * cwd routing exists to eliminate.
 *
 * So the project states it. A `.haltija.json` in the project (found by walking up from the shell's
 * cwd, like package.json) declares which origins are *its* pages:
 *
 * ```json
 * { "origins": ["https://localhost:8030", "http://localhost:3000"] }
 * ```
 *
 * That's an assertion by the person who knows, not a guess by us. Two consequences follow, and both
 * matter:
 *
 *  - **Opt-in.** No config → behaviour is exactly as before. Nothing silently changes for anyone.
 *  - **Never silently wrong.** If a declaration is present but no connected tab matches it, we do
 *    NOT quietly fall back to the focused tab — that would be the very failure mode this replaces.
 *    The caller is told the declaration matched nothing.
 */

import { existsSync, readFileSync } from 'fs'
import { isTopLevelTab, isVisible } from './window-state'
import { dirname, join, parse as parsePath } from 'path'

/**
 * The declaration filename, in one place.
 *
 * It was hardcoded in the reader and again in the remedy text that tells users to create it — so a
 * rename would have left the warning confidently instructing people to write a file nothing reads.
 */
export const ORIGINS_FILE = '.haltija.json'

export interface ProjectOrigins {
  /** Origins the project declared, normalized (scheme://host:port, no trailing slash). */
  origins: string[]
  /** Where the declaration was found — surfaced by `hj where` and `hj doctor`. */
  source: string
}

/** Normalize to a bare origin so `https://x:8030/path` and `https://x:8030` compare equal. */
export function normalizeOrigin(value: string): string | null {
  const v = String(value || '').trim()
  if (!v) return null
  const parse = (candidate: string): string | null => {
    try {
      const origin = new URL(candidate).origin
      // `new URL('localhost:8030')` does NOT throw — it parses as scheme `localhost:` with path
      // `8030`, and an opaque origin serializes to the STRING "null". So a failed parse has to be
      // detected by value, not by exception.
      return origin && origin !== 'null' ? origin : null
    } catch {
      return null
    }
  }
  // Allow a bare `localhost:8030` for convenience — people will write it.
  return parse(v) ?? parse(`http://${v}`)
}

/**
 * Find the nearest `.haltija.json` at or above `cwd` and read its declared origins.
 * `HALTIJA_ORIGINS` (comma-separated) overrides, for one-off shells and CI.
 */
export function findProjectOrigins(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): ProjectOrigins | null {
  const fromEnv = env.HALTIJA_ORIGINS
  if (fromEnv && fromEnv.trim()) {
    const origins = fromEnv.split(',').map(normalizeOrigin).filter((o): o is string => !!o)
    if (origins.length) return { origins, source: 'HALTIJA_ORIGINS env' }
  }

  let dir = cwd
  const { root } = parsePath(cwd)
  // Walk up to the filesystem root; stop there rather than looping forever on a malformed path.
  for (let depth = 0; depth < 64; depth++) {
    const file = join(dir, ORIGINS_FILE)
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf-8'))
        const raw = Array.isArray(parsed?.origins) ? parsed.origins : []
        const origins = raw.map(normalizeOrigin).filter((o: string | null): o is string => !!o)
        // A file that exists but declares nothing usable is a config error worth surfacing, not a
        // silent no-op — return it so the caller can say so.
        return { origins, source: file }
      } catch {
        return { origins: [], source: `${file} (unreadable or invalid JSON)` }
      }
    }
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export interface TabLike {
  id: string
  url?: string
  active?: boolean
  windowType?: string
}

export type OriginRouting =
  | { kind: 'no-declaration' }
  | { kind: 'matched'; windowId: string; origin: string; candidates: number }
  | { kind: 'no-match'; declared: string[]; sawOrigins: string[] }

/**
 * Pick the tab a declared-origin project meant.
 *
 * Only top-level tabs are candidates (an iframe/popup is part of a tab, not a target of its own).
 * Among matches, a VISIBLE tab wins over a hidden one — a hidden tab answers with throttled,
 * possibly stale state — and the focused tab wins among equals so repeated commands stay on one tab.
 */
export function routeByDeclaredOrigin(
  declared: string[],
  tabs: TabLike[],
  focusedWindowId?: string | null,
): OriginRouting {
  if (!declared.length) return { kind: 'no-declaration' }

  const wanted = new Set(declared)
  const topLevel = tabs.filter(isTopLevelTab)
  const matches = topLevel.filter((t) => {
    const o = normalizeOrigin(t.url || '')
    return o !== null && wanted.has(o)
  })

  if (!matches.length) {
    const sawOrigins = [...new Set(topLevel.map((t) => normalizeOrigin(t.url || '')).filter((o): o is string => !!o))]
    return { kind: 'no-match', declared, sawOrigins }
  }

  const visible = matches.filter(isVisible)
  const pool = visible.length ? visible : matches
  const focused = pool.find((t) => t.id === focusedWindowId)
  const chosen = focused || pool[0]
  return {
    kind: 'matched',
    windowId: chosen.id,
    origin: normalizeOrigin(chosen.url || '')!,
    candidates: matches.length,
  }
}
