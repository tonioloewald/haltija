/**
 * Every test file that spawns a haltija server must isolate it from the machine.
 *
 * A spawned server re-reads the real $HOME: registry, receipt log, certificates, the shared `hj`
 * on the PATH. Isolation lives in one place (`isolatedServerEnv` in test-ports.ts, applied to
 * process.env by `isolateTestMachineState`, and by `startTestServer` for Playwright). The 1.13.0
 * review found FOUR spawn sites that each did it by hand, and three had drifted: one relied on a
 * variable nothing read, one built its env field by field, and one stayed clean in CI only because
 * other files happened to run first in the same process.
 *
 * CI's footprint gate (scripts/assert-no-machine-footprint.sh) catches a leak after the fact, and
 * only for the order the files ran in. This catches the missing isolation when it is written.
 * File-level, so it cannot see a spawn inside an isolated file that builds its env without
 * inheriting process.env — reviewers still need to look at that.
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const SRC = import.meta.dir
const SPAWNS = /\bspawn(Sync)?\(|Bun\.spawn/
const SERVER_ENTRY = /bin\/server\.ts|bin\/tosijs-dev\.(ts|mjs)|dist\/server\.js/
const ISOLATED = /isolateTestMachineState|isolatedServerEnv|startTestServer/

const spawners = readdirSync(SRC)
  .filter((f) => /\.test\.ts$|\.playwright\.ts$|^playwright-server\.ts$/.test(f))
  .filter((f) => f !== 'spawn-isolation.test.ts')
  .map((f) => ({ f, body: readFileSync(join(SRC, f), 'utf8') }))
  .filter(({ body }) => SPAWNS.test(body) && SERVER_ENTRY.test(body))

describe('test spawn sites are isolated from the machine', () => {
  it('finds the spawn sites (not a vacuous check)', () => {
    expect(spawners.length).toBeGreaterThan(10)
  })

  for (const { f, body } of spawners) {
    it(`${f} isolates the servers it spawns`, () => {
      expect(ISOLATED.test(body)).toBe(true)
    })
  }
})
