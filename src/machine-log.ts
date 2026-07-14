/**
 * The receipt for everything Haltija does outside its own project.
 *
 * Haltija deliberately acts at **machine** scope: it installs a shared `hj` onto the
 * PATH and stops haltija servers that would clobber it. That is the right scope — "which
 * `hj` does every shell on this box run" is not a question a per-project fix can answer,
 * and pretending otherwise would just leave the problem unsolved. It is a feature.
 *
 * But it is only a feature *if it is accountable*, and there is a specific way this goes
 * wrong: haltija is very often a **transitive** dependency. Someone runs another project's
 * `test-browser` script, that script spawns haltija, and haltija touches their machine.
 * They have never read our README and never run `haltija --help` — they are not our user.
 * And our log goes to the stdout of a spawned subprocess, which the harness swallows.
 *
 * So every machine-scope action is recorded here, append-only, and printed to **stderr**
 * (which harnesses swallow far less often than stdout). There must always be an answer to
 * "what did this thing do to my machine, and when?" — reachable long after the run, by
 * someone who does not know what haltija is.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { VERSION } from './version'

/** Where the receipt lives. Deliberately a plain, greppable text file. */
export function machineLogPath(): string {
  return process.env.HALTIJA_MACHINE_LOG || join(homedir(), '.haltija', 'machine-actions.log')
}

export type MachineAction =
  /** We wrote the shared `hj` binary onto the PATH. */
  | { kind: 'hj-install'; detail: string }
  /** We asked another haltija server to stop. */
  | { kind: 'server-stopped'; detail: string }
  /** We found something harmful and deliberately did NOT act on it. */
  | { kind: 'declined'; detail: string }

/**
 * Record — and announce — something we did to the user's machine.
 *
 * Prints to stderr, because the human who needs to see this is usually running some
 * *other* tool that spawned us, and stdout is where their harness isn't looking.
 */
export function recordMachineAction(action: MachineAction): void {
  const line = `${new Date().toISOString()} haltija ${VERSION} pid=${process.pid} cwd=${process.cwd()} ${action.kind}: ${action.detail}`

  try {
    const p = machineLogPath()
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, line + '\n')
  } catch {
    // Best effort. Failing to write the receipt must never fail the server.
  }

  // stderr, not stdout — see the note above.
  console.error(`  [haltija] ${action.detail}`)
  console.error(`  [haltija] (machine-scope action — recorded in ${machineLogPath()})`)
}

/** The most recent machine-scope actions, newest last. For `hj where` / support. */
export function readMachineActions(limit = 20): string[] {
  try {
    const p = machineLogPath()
    if (!existsSync(p)) return []
    const lines = readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit)
  } catch {
    return []
  }
}
