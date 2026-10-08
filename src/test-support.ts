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

import type { Subprocess } from 'bun'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isolatedServerEnv } from './test-ports'

/**
 * Point every machine-scope write at a throwaway location and disable the reach-out actions.
 * Call once at the top of any test module that spawns a server, BEFORE the first spawn.
 * Returns the temp registry dir (children inherit it via process.env).
 */
export function isolateTestMachineState(): string {
  const dir = mkdtempSync(join(tmpdir(), 'haltija-test-'))
  // One definition shared with the Playwright helper and hand-built spawns — see
  // `isolatedServerEnv` for what each variable guards and why there used to be three copies.
  Object.assign(process.env, isolatedServerEnv(dir))
  return dir
}

// Lives in `test-ports.ts` so the Playwright lane — which cannot import Bun-flavoured helpers —
// can share it instead of hardcoding a port, which is what it did until now. Re-exported here so
// existing Bun suites keep their single import.
export { uniqueTestPort } from './test-ports'

/** Longest a spawned server may take to answer. A ceiling for a sick machine, not an expected wait. */
export const SERVER_START_DEADLINE_MS = 30_000
/** Timeout for a `beforeAll` / `it` that starts a server — Bun's default of 5s is below the deadline. */
export const SERVER_START_HOOK_MS = SERVER_START_DEADLINE_MS + 10_000

/**
 * Wait until a spawned server answers `GET <baseUrl>/status`, and return the parsed status.
 *
 * There were nine hand-written copies of this loop, each with its own guess at how long startup
 * takes: 2s, 3s, 4s, 6s, 10s. A deadline is not a measurement. Startup is ~200ms here and took over
 * 4s once on a two-core CI runner at the end of a nine-minute job, which failed a publish dry run
 * as `(fail) (unnamed) [4019.20ms]` (virta #2499). Unnamed because the throw came from a
 * `beforeAll`, with the child's stderr piped and never read, so the failure named neither the test
 * file nor the reason.
 *
 * So: one generous deadline, and a failure that says what happened. A child that EXITS fails at
 * once with its exit code and stderr; only a child that is alive and silent waits the deadline out.
 *
 * Pass `SERVER_START_HOOK_MS` as the timeout of the hook or test that calls this.
 */
export async function waitForServer(
  baseUrl: string,
  proc?: Subprocess | null,
  opts: { init?: RequestInit; timeoutMs?: number } = {},
): Promise<any> {
  const deadline = Date.now() + (opts.timeoutMs ?? SERVER_START_DEADLINE_MS)
  let exited = false
  proc?.exited.then(() => { exited = true })
  let last = 'no answer'
  while (Date.now() < deadline && !exited) {
    try {
      // @ts-ignore - `tls` is Bun's fetch extension, for the self-signed HTTPS listeners
      const res = await fetch(`${baseUrl}/status`, { tls: { rejectUnauthorized: false }, ...opts.init })
      if (res.ok) return await res.json()
      last = `HTTP ${res.status}`
    } catch (e) {
      last = String((e as Error)?.message || e)
    }
    await Bun.sleep(50)
  }
  const what = exited ? `exited with code ${proc?.exitCode} before answering` : `did not answer within ${opts.timeoutMs ?? SERVER_START_DEADLINE_MS}ms (${last})`
  // Reading stderr to the end needs the child gone; it is useless to the test now anyway.
  let stderr = ''
  if (proc && proc.stderr && typeof proc.stderr !== 'number') {
    try { proc.kill() } catch {}
    stderr = await Promise.race([new Response(proc.stderr as ReadableStream).text(), Bun.sleep(2000).then(() => '')])
  }
  throw new Error(`server at ${baseUrl} ${what}${stderr.trim() ? `\n--- its stderr (last 2000 chars) ---\n${stderr.trim().slice(-2000)}` : ''}`)
}
