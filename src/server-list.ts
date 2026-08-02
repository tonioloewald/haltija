/**
 * Pure logic behind `hj servers` — which servers to probe, and how to describe what answered.
 *
 * Extracted from `bin/hj.mjs` because that file accumulated ~100 lines of untested runtime logic
 * (`runServers`, `hj shutdown`) and `bin/` ships to users. The rule this follows: enumeration,
 * resolution and formatting belong in a tested `src/` module that the CLI thinly calls — the same
 * reasoning that put `semver` and `project-origins` here rather than hand-copying them.
 */

export interface RegistryEntry {
  name: string
  port: number
  cwd?: string
}

export interface ServerCandidate {
  port: string
  name: string | null
  cwd: string | null
}

/** A `/status` body, as far as this module cares. */
export interface StatusLike {
  serverVersion?: string
  desktopApp?: boolean
  windows?: unknown[]
  browsers?: number
  ready?: boolean
}

export interface ServerRow extends ServerCandidate {
  up: boolean
  version?: string
  desktopApp?: boolean
  tabs?: number
  ready?: boolean
}

/**
 * Everything worth probing: registry entries, the well-known defaults, and whatever this shell
 * resolved to.
 *
 * The defaults are included deliberately even though they're usually in the registry — a legacy or
 * unregistered server on 8700/8701 is invisible to the registry, and "several haltijas are running,
 * which is which?" is exactly the question this answers. Deduped by port, registry entries winning,
 * so a named server isn't listed twice as "(unnamed)".
 */
export function collectCandidates(
  instances: RegistryEntry[],
  resolvedPort: string | number,
  defaults: Array<string | number> = [8700, 8701],
): ServerCandidate[] {
  const byPort = new Map<string, ServerCandidate>()
  for (const e of instances) {
    byPort.set(String(e.port), { port: String(e.port), name: e.name, cwd: e.cwd ?? null })
  }
  for (const p of [...defaults, resolvedPort]) {
    const key = String(p)
    if (!byPort.has(key)) byPort.set(key, { port: key, name: null, cwd: null })
  }
  return [...byPort.values()]
}

/** Fold a `/status` response into a display row. `null` status means the probe failed. */
export function describeServer(candidate: ServerCandidate, status: StatusLike | null): ServerRow {
  if (!status) return { ...candidate, up: false }
  return {
    ...candidate,
    up: true,
    version: status.serverVersion || '?',
    desktopApp: !!status.desktopApp,
    // `windows` is authoritative; `browsers` is the legacy field, and 0 is a meaningful answer, so
    // fall back only when `windows` is genuinely absent.
    tabs: Array.isArray(status.windows) ? status.windows.length : (status.browsers ?? 0),
    ready: typeof status.ready === 'boolean' ? status.ready : undefined,
  }
}

/** Live servers, lowest port first — a stable order so repeated runs are diffable. */
export function sortRows(rows: ServerRow[]): ServerRow[] {
  return rows.filter((r) => r.up).sort((a, b) => Number(a.port) - Number(b.port))
}

/** The label shown for a server: the desktop app is always `desktop`, whatever the registry says. */
export function labelFor(row: ServerRow): string {
  return row.desktopApp ? 'desktop' : row.name || '(unnamed)'
}
