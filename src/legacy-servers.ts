/**
 * Retiring legacy haltija servers.
 *
 * Servers before 1.4.0 do two things that break every *other* project on the
 * machine, and neither can be fixed in the old code — it has already shipped:
 *
 *   - They overwrite the shared `~/.local/bin/hj` with their own bundled copy on
 *     every boot (the symlink/downgrade guards arrived in 1.4.0). So a stale
 *     `bunx haltija@beta` left running quietly hands every project on the box an
 *     old `hj` — including one with no cwd routing, which then drives the wrong
 *     browser.
 *   - They squat the default port 8700 without registering themselves, so they're
 *     invisible to the registry and can only be found by probing.
 *
 * The only remedy is to stop them running. A 1.4.0+ server therefore retires any
 * pre-1.4.0 server it finds when it starts.
 *
 * **The rule keys on harm, not on age.** We retire servers below GUARDS_VERSION —
 * not servers merely "older than me". If it were the latter, a 1.4.1 server would
 * kill a 1.4.0 server forever, and two projects pinned to different 1.4.x releases
 * would murder each other's sessions on every boot. Keyed this way it is instead
 * self-terminating: once no 1.3.x servers are left, this never fires again.
 */

import { isOlderThan, parseVersion } from './semver'

/** The release that added the hj-install guards. Servers below this are harmful. */
export const GUARDS_VERSION = '1.4.0'

/** What probing a port told us. */
export interface ServerProbe {
  port: number
  /** From /status. Null when nothing answered, or it isn't a haltija server. */
  version: string | null
  /** True when hosted by the Haltija desktop app. NULL = we could not tell. */
  desktopApp: boolean | null
  /** Process id, if we could determine one. */
  pid: number | null
}

export type RetirementPlan =
  /** Leave it alone. */
  | { action: 'ignore'; reason: string }
  /** Ask it to stop — it's a pre-1.4.0 server that will clobber the shared hj. */
  | { action: 'retire'; reason: string }
  /** It's harmful but we must not stop it. Tell the user plainly. */
  | { action: 'complain'; reason: string; remedy: string }

/**
 * True when a server predates the hj-install guards and will therefore clobber
 * the shared `hj`. An unknown/unparseable version is NOT legacy — we will not
 * kill something we cannot identify.
 */
export function isLegacy(version: string | null): boolean {
  if (!version) return false
  const v = parseVersion(version)
  const guards = parseVersion(GUARDS_VERSION)
  if (!v || !guards) return false

  // Compare the RELEASE BASE, ignoring any prerelease tag.
  //
  // By strict semver `1.4.0-beta.1 < 1.4.0`, which would make a 1.4.0 beta "legacy"
  // — so two 1.4.0 betas would stop each other on every boot, and the first
  // `npm publish --tag beta` would ship servers that fight. But a 1.4.0 prerelease is
  // built from this code: it HAS the guards. The question this predicate asks is
  // "does that server clobber the shared hj?", and the answer depends on the release
  // line, not on the prerelease tag.
  const base = (p: { major: number; minor: number; patch: number }) =>
    `${p.major}.${p.minor}.${p.patch}`
  return isOlderThan(base(v), base(guards))
}

/**
 * Decide what to do about one probed server. Pure — all IO (probing, killing)
 * happens in the caller, so the policy itself stays testable.
 */
export function planForServer(probe: ServerProbe, selfPid: number): RetirementPlan {
  if (probe.pid !== null && probe.pid === selfPid) {
    return { action: 'ignore', reason: 'this is us' }
  }
  if (!probe.version) {
    return { action: 'ignore', reason: 'nothing answered, or not a haltija server' }
  }
  if (!isLegacy(probe.version)) {
    return { action: 'ignore', reason: `haltija ${probe.version} has the hj guards` }
  }

  // Legacy from here down: this server WILL clobber ~/.local/bin/hj.

  if (probe.desktopApp || probe.desktopApp === null) {
    // Stopping this orphans a GUI app the user can see on screen — a far more
    // startling outcome than the problem we're solving. Complain instead.
    //
    // `null` means we could not tell (pre-1.3.0 /status had no desktopApp field), and
    // "could not tell" must fall on the SAFE side. Treating unknown as false is how a
    // running pre-1.3.0 Haltija.app got classified as an ordinary squatter and shut
    // down. Same rule as everywhere else here: never act on what you cannot identify.
    const what = probe.desktopApp === null
      ? `the haltija server on :${probe.port} (${probe.version}) is too old to say whether it is the desktop app`
      : `the Haltija desktop app on :${probe.port} is running ${probe.version}`
    return {
      action: 'complain',
      reason: `${what}, and it overwrites the shared ~/.local/bin/hj`,
      remedy: 'quit Haltija.app and update it (or run: bunx haltija@latest)',
    }
  }

  // No pid needed: we retire a server by ASKING it to stop (POST /shutdown), not by
  // signalling a process. See `requestShutdown` in src/server.ts for why that
  // distinction is the whole safety story.
  return {
    action: 'retire',
    reason: `haltija ${probe.version} on :${probe.port} predates ${GUARDS_VERSION} and overwrites the shared ~/.local/bin/hj`,
  }
}

/**
 * May we stop the server on a port we were explicitly told to bind (the EADDRINUSE path)?
 *
 * Pure and tested because it decides whether to SIGTERM a process on the user's machine —
 * the most dangerous decision in the codebase, and one that shipped a blocker while it was an
 * inline conditional. The rule is the same as retirement's: act only on what we positively
 * identified, and never on the desktop app.
 *
 *   'decline' — a running desktop app (visible GUI), OR anything we could not identify
 *               (`desktopApp === null`: timeout, 401, non-haltija). Do not touch it.
 *   'stop'    — a positively-identified haltija server. Ask it first; signal only as a last
 *               resort (the caller handles that escalation).
 */
export function planFreePort(probe: ServerProbe): 'decline' | 'stop' {
  // Unidentified (null) or the desktop app → hands off. `desktopApp` is only ever true, false,
  // or null; null and true both decline.
  if (probe.desktopApp || probe.desktopApp === null) return 'decline'
  // Identified as NOT the desktop app, but is it identified as haltija at all?
  if (!probe.version) return 'decline'
  return 'stop'
}

/**
 * Ports worth probing. Legacy servers don't register themselves, so there's no
 * list to consult — we check the well-known defaults plus anything the registry
 * knows about. Deliberately NOT a port scan: we are looking for the specific
 * squatters that cause this bug, not surveying the machine.
 */
export function candidatePorts(opts: {
  defaults?: number[]
  registryPorts?: number[]
  exclude?: number[]
} = {}): number[] {
  const defaults = opts.defaults ?? [8700, 8701]
  const all = [...defaults, ...(opts.registryPorts ?? [])]
  const exclude = new Set(opts.exclude ?? [])
  return [...new Set(all)].filter((p) => !exclude.has(p)).sort((a, b) => a - b)
}
