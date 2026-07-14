/**
 * Minimal semver comparison — just enough to answer "is this one older?".
 *
 * Used to keep a haltija server from *downgrading* the `hj` binary it shares
 * with every other project on the machine. A stale `bunx haltija@beta` booting
 * up must not stomp a newer `hj` installed by an up-to-date project, so we need
 * to know that `1.3.0-beta.12` is older than `1.3.4`.
 *
 * Not a general semver implementation: no ranges, no build metadata ordering.
 * Prerelease identifiers are compared per spec (numeric identifiers compare
 * numerically, a prerelease is older than its release), which is all we need.
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Dot-separated prerelease identifiers; empty for a release version. */
  prerelease: string[]
}

/** Parse `1.3.0-beta.12` (build metadata after `+` is ignored). Null if unparseable. */
export function parseVersion(v: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  }
}

/** Compare two prerelease identifier lists per semver rules. */
function comparePrerelease(a: string[], b: string[]): number {
  // A version with no prerelease outranks one that has any.
  if (!a.length && !b.length) return 0
  if (!a.length) return 1
  if (!b.length) return -1

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    // A larger set of identifiers outranks a smaller one when all else is equal.
    if (i >= a.length) return -1
    if (i >= b.length) return 1

    const x = a[i]!
    const y = b[i]!
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)

    if (xNum && yNum) {
      // Numeric identifiers compare numerically: beta.9 < beta.12.
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff < 0 ? -1 : 1
    } else if (xNum !== yNum) {
      // Numeric identifiers are always lower precedence than alphanumeric ones.
      return xNum ? -1 : 1
    } else {
      if (x !== y) return x < y ? -1 : 1
    }
  }
  return 0
}

/**
 * -1 if `a` is older than `b`, 1 if newer, 0 if equal.
 * Returns null when either version can't be parsed — callers must decide what
 * to do with "unknown" rather than silently treating it as equal or older.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return comparePrerelease(pa.prerelease, pb.prerelease)
}

/** True when `a` is strictly older than `b`. Unparseable versions are not "older". */
export function isOlderThan(a: string, b: string): boolean {
  return compareVersions(a, b) === -1
}

/**
 * True when two versions differ by more than a patch.
 *
 * Used to decide whether a client/server version mismatch is worth warning about.
 * `hj` is ONE global binary driving MANY per-project servers, so patch-level skew is
 * the normal steady state — a project pinned to 1.4.0 while the CLI is 1.4.2 is fine,
 * and nothing the user does can "fix" it. Warning about it on every command would be
 * a permanent false alarm, and a warning that always fires is one agents learn to
 * ignore — including the ones that matter.
 *
 * Unparseable versions do NOT count as differing: we don't cry wolf about a version
 * string we failed to understand.
 */
export function differsBeyondPatch(a: string, b: string): boolean {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return false
  return pa.major !== pb.major || pa.minor !== pb.minor
}
