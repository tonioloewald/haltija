/**
 * A `--private` instance must not outlive the run that spawned it — and pid-watching is not
 * enough (issue #39).
 *
 * The existing bound is `HALTIJA_SPAWNER_PID` polling in `server.ts`: the child watches the
 * launcher and exits when it dies. That is necessary and **cannot be sufficient**, because it
 * depends on three things being true that are outside this process's control — the launcher
 * actually set the variable, the launcher actually died, and the pid was not recycled onto some
 * other long-lived process in the meantime. #39 found the result: a `--private --app` instance
 * **twelve days old**, 5.7 GB resident and ~150% CPU, on a machine at load average 212, with
 * nothing talking to it. The slowdown it caused was blamed on an unrelated code change.
 *
 * An idle timeout depends on nothing and nobody. It is the backstop for every case where
 * teardown never runs at all: a SIGKILLed session, a laptop that slept through it, a crash, an
 * agent harness that exits without unwinding.
 *
 * ## Why this is private-only by default
 *
 * A **shared** interactive server is the developer's, and its stickiness is the feature — they
 * expect the browser they left open to still be there in the morning. Exiting one out from under
 * someone is precisely the harm 1.4.0 was spent eliminating, so we do not do it on a timer
 * either. `--private` is the opposite: ephemeral by construction, spawned by agent sessions that
 * end abruptly, and invisible — nothing surfaces an agent-spawned Electron until the machine is
 * thrashing. Setting the env var explicitly opts a shared server in for anyone who wants it.
 *
 * ## Why "any request" is the wrong definition of activity
 *
 * This is the part that would have shipped a guard that never fires. The desktop app's own
 * renderer polls `GET /status` **every five seconds, forever**
 * (`apps/desktop/renderer.js` → `checkHaltija`), and the terminal page polls
 * `/terminal/status`. Under a naive "any REST request resets the clock" rule, a
 * `--private --app` instance — which is exactly what #39 found running for twelve days — would
 * refresh its own idle timer from its own UI and never expire, while looking completely correct
 * from the outside.
 *
 * So activity means *a client doing work*, and the poll endpoints are excluded by name. The list
 * is deliberately short and every entry is justified by a real poller in this repo; adding a
 * path here that nothing polls would be fake precision, and adding one that a client legitimately
 * uses to do work would silently shorten the instance's life.
 */

/** Milliseconds in an hour, named so the arithmetic below reads as intent. */
const HOUR_MS = 3_600_000

/**
 * The default for `--private`. Generous on purpose: this is a backstop against abandonment, not
 * a session limit, and expiring a run someone is slowly working through would be a worse bug
 * than the leak it prevents. #39 reports 8 hours as what tosijs-ui's dev server settled on.
 */
export const DEFAULT_PRIVATE_IDLE_HOURS = 8

/**
 * Paths that something polls on a timer, and which therefore are NOT evidence that anyone is
 * using this instance. Each one is here because a poller in this repo hits it:
 *
 * - `/status` — `apps/desktop/renderer.js` every 5s, for the connection dot
 * - `/terminal/status` — `apps/desktop/terminal.html`, for the terminal pane
 *
 * `/health` and `/ping` are deliberately absent: they do not exist. Listing endpoints we do not
 * serve would imply a coverage this set does not have.
 */
export const POLL_ONLY_PATHS: ReadonlySet<string> = new Set(['/status', '/terminal/status'])

/**
 * Does this request mean someone is using the instance?
 *
 * Only GETs to the poll paths are discounted. A POST to the same path would be a command, and
 * the method check keeps the exclusion from widening beyond the pollers it was written for.
 */
export function countsAsActivity(path: string, method: string): boolean {
  if (method.toUpperCase() === 'GET' && POLL_ONLY_PATHS.has(path)) return false
  return true
}

/** Where the configured timeout came from — used to make the exit log explain itself. */
export interface IdlePolicy {
  /** Milliseconds of inactivity before exiting, or null to never expire. */
  timeoutMs: number | null
  /** Human-readable origin of the setting, for the log line. */
  source: string
}

/**
 * Resolve the idle policy from the environment.
 *
 * `HALTIJA_IDLE_TIMEOUT_HOURS` accepts a positive number of hours, or `0` to disable. It wins
 * over the private-mode default in both directions: it can turn the bound off for a private run
 * that legitimately needs to sit idle, and turn it on for a shared server.
 *
 * A value we cannot parse is treated as *unset* rather than as zero. Reading a typo as "disable
 * the safety net" is the failure mode that leaves another twelve-day instance on someone's
 * machine, and it would do so silently; the caller logs the rejection.
 */
export function resolveIdlePolicy(env: {
  HALTIJA_IDLE_TIMEOUT_HOURS?: string
  isPrivate: boolean
}): IdlePolicy & { invalid?: string } {
  const raw = env.HALTIJA_IDLE_TIMEOUT_HOURS?.trim()

  if (raw !== undefined && raw !== '') {
    const hours = Number(raw)
    if (Number.isFinite(hours) && hours >= 0) {
      return hours === 0
        ? { timeoutMs: null, source: 'HALTIJA_IDLE_TIMEOUT_HOURS=0 (disabled)' }
        : { timeoutMs: hours * HOUR_MS, source: `HALTIJA_IDLE_TIMEOUT_HOURS=${raw}` }
    }
    // Unparseable: fall through to the default, and tell the caller so it can complain.
    const fallback = env.isPrivate
      ? {
          timeoutMs: DEFAULT_PRIVATE_IDLE_HOURS * HOUR_MS,
          source: `default for --private (${DEFAULT_PRIVATE_IDLE_HOURS}h)`,
        }
      : { timeoutMs: null, source: 'shared server (no idle bound)' }
    return { ...fallback, invalid: raw }
  }

  return env.isPrivate
    ? {
        timeoutMs: DEFAULT_PRIVATE_IDLE_HOURS * HOUR_MS,
        source: `default for --private (${DEFAULT_PRIVATE_IDLE_HOURS}h)`,
      }
    : { timeoutMs: null, source: 'shared server (no idle bound)' }
}

/** Has the instance been idle long enough to exit? */
export function isExpired(now: number, lastActivityAt: number, timeoutMs: number | null): boolean {
  if (timeoutMs === null) return false
  return now - lastActivityAt >= timeoutMs
}

/**
 * The line printed on the way out.
 *
 * #39 asks for this explicitly, and the reason is worth keeping: an instance that vanishes
 * without saying why is indistinguishable from a crash, and someone will spend an afternoon
 * looking for the crash. It names the elapsed time, the setting that caused it, and how to turn
 * it off.
 */
export function expiryMessage(idleMs: number, policy: IdlePolicy): string {
  // Sub-hour spans read as "0.0h", which looks like a bug in the very message meant to reassure
  // someone that this was not one. Short bounds are configurable and used in testing, so the
  // message has to degrade honestly.
  const elapsed =
    idleMs < HOUR_MS ? `${Math.round(idleMs / 1000)}s` : `${(idleMs / HOUR_MS).toFixed(1)}h`
  return (
    `idle for ${elapsed} with no client activity — exiting (${policy.source}). ` +
    `This is not a crash: a --private instance exits on its own so an ended agent session ` +
    `cannot leave one running for days (issue #39). ` +
    `Set HALTIJA_IDLE_TIMEOUT_HOURS=0 to disable, or a number of hours to change it.`
  )
}
