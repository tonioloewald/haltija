/**
 * Shared setup for tests that SPAWN a real haltija server.
 *
 * NOT shipped (excluded in tsconfig.build.json). Its whole job is to keep the test suite from
 * touching the machine it runs on — which matters more than it sounds, because this machine is
 * routinely SHARED: CI, and dev boxes running other haltija servers, including other agents'.
 *
 * Two hazards it removes:
 *   1. Machine-scope side effects — a spawned server installs `hj` onto the real PATH, registers
 *      in the real ~/.haltija, and (pre-fix) could stop other servers. `isolateTestMachineState()`
 *      redirects all of that to a temp dir and disables the reach-out actions.
 *   2. Port collisions — tests used to bind fixed 87xx ports, exactly where real haltija servers
 *      live (8700/8701). On a shared machine that collides with a dev server, another agent's
 *      server, a leaked previous run, or another test. `uniqueTestPort()` hands out high,
 *      per-process-unique ports far from that range.
 *
 * This is the same friction 1.4.0 is *about* (servers colliding on shared ports) — the test suite
 * had it too, and a suite that fails or disrupts others the moment the machine isn't pristine is a
 * suite nobody can trust. If it bites us, with full context, it bites every user.
 */

import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Point every machine-scope write at a throwaway location and disable the reach-out actions.
 * Call once at the top of any test module that spawns a server, BEFORE the first spawn.
 * Returns the temp registry dir (children inherit it via process.env).
 */
export function isolateTestMachineState(): string {
  const dir = mkdtempSync(join(tmpdir(), 'haltija-test-'))
  process.env.HALTIJA_REGISTRY_DIR = dir
  process.env.HALTIJA_MACHINE_LOG = join(dir, 'machine-actions.log')
  process.env.HALTIJA_NO_RETIRE = '1' // never stop another server (also gates freePort)
  process.env.HALTIJA_NO_INSTALL = '1' // never write ~/.local/bin/hj
  return dir
}

// High base, per-process-unique (pid keeps concurrent runs apart), well clear of the 87xx range
// real haltija servers use. A shared counter hands out distinct ports across files in one run.
const PORT_BASE = 20000 + (process.pid % 20000)
let portOffset = 0

/** A port unlikely to collide with a real server, another agent, a leaked run, or another test. */
export function uniqueTestPort(): number {
  return PORT_BASE + (portOffset++)
}
