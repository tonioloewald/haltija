/**
 * The launcher takes its server with it.
 *
 * `haltija --server` runs the server as a CHILD process. Nothing forwarded a signal, so stopping
 * the launcher left the server alive with ppid 1, holding its ports, and a shared server never
 * times out. This suite's own HTTPS tests did exactly that: 34 orphans accumulated on the
 * development machine over a week before the 1.13.0-beta.3 review counted them.
 */
import { describe, it, expect, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort, waitForServer, SERVER_START_HOOK_MS } from './test-support'

isolateTestMachineState()
const REPO_ROOT = join(import.meta.dir, '..')
const procs: Subprocess[] = []
afterAll(() => { for (const p of procs) try { p.kill('SIGKILL') } catch {} })

const answers = async (port: number) => {
  try { return (await fetch(`http://localhost:${port}/status`)).ok } catch { return false }
}

describe('launcher teardown', () => {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    it(`${signal} to the launcher stops the server it started`, async () => {
      const port = uniqueTestPort()
      const launcher = spawn({
        cmd: ['bun', 'bin/tosijs-dev.mjs', '--server'],
        cwd: REPO_ROOT,
        env: { ...(process.env as Record<string, string>), DEV_CHANNEL_PORT: String(port) },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      procs.push(launcher)
      const status = await waitForServer(`http://localhost:${port}`, launcher)
      // The server is a different process from the one we are about to signal, or this proves nothing.
      expect(status.pid).not.toBe(launcher.pid)

      launcher.kill(signal)
      await launcher.exited
      let up = true
      for (let i = 0; i < 100 && up; i++) { up = await answers(port); if (up) await Bun.sleep(50) }
      if (up) { try { process.kill(status.pid, 'SIGKILL') } catch {} } // don't leak what we just caught
      expect(up).toBe(false)
    }, SERVER_START_HOOK_MS)
  }
})
