/**
 * A server run from a source checkout installs hj by COPY, never by symlink.
 *
 * The old fallback symlinked ~/.local/bin/hj to the checkout's bin/hj.mjs. A symlinked hj is
 * treated as a deliberate developer choice and never touched again, so one `bun run bin/server.ts`
 * pinned a machine's hj to that checkout permanently, exempt from every later repair. It happened
 * to a real machine during the 1.13.0-beta.1 review.
 *
 * HOME is a temp dir here, so install is left ON without touching the real one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { existsSync, lstatSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

isolateTestMachineState()
const REPO = join(import.meta.dir, '..')
const fakeHome = mkdtempSync(join(tmpdir(), 'haltija-fake-home-'))
const hjTarget = join(fakeHome, '.local', 'bin', 'hj')
const PORT = uniqueTestPort()
let proc: Subprocess | null = null

beforeAll(async () => {
  const env: Record<string, string | undefined> = { ...process.env, HOME: fakeHome, HALTIJA_PORT: String(PORT) }
  delete env.HALTIJA_NO_INSTALL
  proc = spawn({ cmd: ['bun', 'run', 'bin/server.ts'], cwd: REPO, env, stdout: 'pipe', stderr: 'pipe' })
  for (let i = 0; i < 50 && !existsSync(hjTarget); i++) await Bun.sleep(200)
}, 20000)

afterAll(async () => {
  proc?.kill()
  await proc?.exited
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('hj install from a source checkout', () => {
  it('installs hj', () => {
    expect(existsSync(join(REPO, 'dist', 'hj.js'))).toBe(true) // precondition: built
    expect(existsSync(hjTarget)).toBe(true)
  })

  it('as a regular file — a symlink would be exempt from every later repair', () => {
    expect(lstatSync(hjTarget).isSymbolicLink()).toBe(false)
  })
})
