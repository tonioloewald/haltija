/**
 * `--private` isolation and teardown — the guarantee with the highest blast radius and, until now,
 * no test at any tier.
 *
 * A single `IS_PRIVATE &&` conjunct in `src/server.ts` is the only thing separating "a private run
 * tears itself down when its spawner dies" from "**every** user's long-lived server exits the moment
 * some unrelated pid disappears". Delete that conjunct and the whole suite stays green. No workflow
 * passes `--private` either, so CI never exercised it.
 *
 * The negative case matters more than the positive one here: it is cheap to notice that teardown
 * stopped working, and catastrophic not to notice that it started applying to shared servers.
 */

import { describe, it, expect, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

const REGISTRY_DIR = isolateTestMachineState()
const REPO_ROOT = join(import.meta.dir, '..')
const spawned: Subprocess[] = []

/**
 * Start a server child directly, standing in for the launcher. `spawnerPid` is what the child
 * watches: pointing it at a pid that is already gone simulates a launcher that was SIGKILLed.
 */
function startServer(opts: { port: number; isPrivate: boolean; spawnerPid?: number }) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HALTIJA_PORT: String(opts.port),
    DEV_CHANNEL_PORT: String(opts.port),
    HALTIJA_REGISTRY_DIR: REGISTRY_DIR,
  }
  if (opts.isPrivate) env.HALTIJA_PRIVATE = '1'
  else delete env.HALTIJA_PRIVATE
  if (opts.spawnerPid !== undefined) env.HALTIJA_SPAWNER_PID = String(opts.spawnerPid)

  const proc = spawn({
    cmd: ['bun', 'run', join(REPO_ROOT, 'bin/server.ts')],
    cwd: REPO_ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  spawned.push(proc)
  return proc
}

/** A pid that is guaranteed not to be running, so the watchdog sees a dead spawner. */
async function deadPid(): Promise<number> {
  const p = spawn({ cmd: ['true'], stdout: 'ignore', stderr: 'ignore' })
  const pid = p.pid
  await p.exited
  // Give the OS a moment to reap it so `kill(pid, 0)` genuinely fails.
  await new Promise((r) => setTimeout(r, 200))
  return pid
}

const stillRunning = (proc: Subprocess) => proc.exitCode === null && !proc.killed

afterAll(() => {
  for (const p of spawned) {
    try { p.kill() } catch {}
  }
})

describe('--private: teardown applies to private runs', () => {
  it('a private server exits when its spawner is gone', async () => {
    const proc = startServer({ port: uniqueTestPort(), isPrivate: true, spawnerPid: await deadPid() })
    // The watchdog polls every second; allow a few cycles plus startup.
    const exited = await Promise.race([
      proc.exited.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 8000)),
    ])
    expect(exited).toBe(true)
  }, 20_000)
})

describe('--private: teardown must NOT apply to shared servers', () => {
  it('a NON-private server ignores a dead spawner pid and keeps running', async () => {
    // This is the conjunct under test. If `IS_PRIVATE &&` is ever dropped, every ordinary server
    // would exit as soon as some unrelated pid vanished — killing a developer's live session.
    const proc = startServer({ port: uniqueTestPort(), isPrivate: false, spawnerPid: await deadPid() })
    const exited = await Promise.race([
      proc.exited.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 6000)),
    ])
    expect(exited).toBe(false)
    expect(stillRunning(proc)).toBe(true)
  }, 20_000)

  it('a private server with NO spawner pid keeps running (nothing to watch)', async () => {
    // `--private` alone must not be a suicide pact; the watchdog only arms when told whom to watch.
    const proc = startServer({ port: uniqueTestPort(), isPrivate: true })
    const exited = await Promise.race([
      proc.exited.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 5000)),
    ])
    expect(exited).toBe(false)
  }, 20_000)
})

describe('--private: isolation from shared state', () => {
  it('a private server does NOT register in the instance registry', async () => {
    // Registration is how interactive `hj` and cwd-routing discover a server. A private instance
    // appearing there would let an unrelated shell adopt an ephemeral automation run.
    const before = existsSync(REGISTRY_DIR) ? readdirSync(REGISTRY_DIR).length : 0
    const proc = startServer({ port: uniqueTestPort(), isPrivate: true })
    await new Promise((r) => setTimeout(r, 2500))
    const after = existsSync(REGISTRY_DIR) ? readdirSync(REGISTRY_DIR).length : 0
    expect(after).toBe(before)
    try { proc.kill() } catch {}
  }, 20_000)

  it('a non-private server DOES register — proving the check above can fail', async () => {
    // Without this, the assertion above would pass just as well if registration were broken
    // entirely, which is the vacuous-test trap.
    const proc = startServer({ port: uniqueTestPort(), isPrivate: false })
    let registered = 0
    for (let i = 0; i < 30; i++) {
      registered = existsSync(REGISTRY_DIR) ? readdirSync(REGISTRY_DIR).length : 0
      if (registered > 0) break
      await new Promise((r) => setTimeout(r, 200))
    }
    expect(registered).toBeGreaterThan(0)
    try { proc.kill() } catch {}
  }, 20_000)
})
