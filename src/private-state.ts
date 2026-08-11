/**
 * Which private-run leftovers in tmpdir are safe to delete.
 *
 * A `--private` run leaves two things named `haltija-private-<pid>` behind: the port-file
 * (`<pid>.json`) the launcher writes, and — since issue #31 — the Electron profile directory, which
 * is several MB of cache per run. 175 port-files had accumulated on one machine.
 *
 * Swept at the START of the next private run, not on exit, because Chromium flushes its caches
 * AFTER Electron's `will-quit`: deleting the profile there just gets it recreated (observed —
 * both directories survived a clean shutdown).
 *
 * **The safety property is the reason this is a separate, tested function rather than a loop inside
 * the launcher.** A sweep must never touch a LIVE peer's state: private mode exists so concurrent
 * runs can't interfere, and a cleanup that deleted a running instance's profile would be far worse
 * than the litter it tidied. Liveness is the only criterion, and `EPERM` from `kill(pid, 0)` means
 * the process EXISTS but belongs to another user — alive, so hands off. That distinction is exactly
 * the kind of thing that is easy to get backwards and impossible to notice.
 */

export interface SweepDeps {
  /** This process — never sweep our own state out from under ourselves. */
  selfPid: number
  /** True when a pid is still running. Injected so the decision is testable without real processes. */
  isAlive: (pid: number) => boolean
}

/** Entry names (not paths) that belong to private runs which have exited. */
export function stalePrivateEntries(names: string[], deps: SweepDeps): string[] {
  const out: string[] = []
  for (const name of names) {
    const m = /^haltija-private-(\d+)(\.json)?$/.exec(name)
    if (!m) continue
    const pid = parseInt(m[1], 10)
    if (!pid || pid === deps.selfPid) continue
    if (deps.isAlive(pid)) continue
    out.push(name)
  }
  return out
}

/**
 * Default liveness test: signal 0 delivers nothing and only asks "does this pid exist".
 *
 * `EPERM` is a YES — the process exists and is owned by someone else. Treating it as "gone" would
 * make the sweep delete live state belonging to another user, which is the one outcome this must
 * never produce.
 */
export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}
