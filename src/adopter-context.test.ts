/**
 * Adopter-context lane — the dirty machine, not the clean room.
 *
 * Every field bug this project has shipped (#1 shared-server routing, #7 orphaned Electron, #8
 * cross-project targeting, #11 server-up-with-no-windows) was invisible to the rest of the suite for
 * one structural reason: **the suite starts from nothing and ends at nothing, and an adopter's
 * machine already has haltija on it, in some state.** No amount of depth finds those; the missing
 * variable is context.
 *
 * So this file deliberately sets up the messy situations users actually hit — a server already
 * running, one with no windows, two projects at once — and asserts the signals an adopter relies on
 * to navigate them. Filed by a consumer as the root-cause fix for the whole class (issue #11).
 *
 * Still hermetic: `isolateTestMachineState()` + `uniqueTestPort()` keep every spawn off the shared
 * 8700/8701 and out of the real registry, so running this never disrupts a real server (that
 * discipline is the subject of half these bugs).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

const REGISTRY_DIR = isolateTestMachineState()
const REPO_ROOT = join(import.meta.dir, '..')

const spawned: Subprocess[] = []

/** Spawn a real haltija server on `port`, recording `cwd` (which is what cwd-routing keys on). */
async function startServer(port: number, opts: { cwd?: string; name?: string } = {}) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    DEV_CHANNEL_PORT: String(port),
    HALTIJA_PORT: String(port),
  }
  if (opts.name) env.HALTIJA_NAME = opts.name
  else delete env.HALTIJA_NAME

  const proc = spawn({
    // Absolute path to the entry point, because `cwd` is the *project directory being simulated*
    // (that's what cwd-routing records) — a relative path would not resolve there.
    cmd: ['bun', 'run', join(REPO_ROOT, 'bin/server.ts')],
    cwd: opts.cwd || REPO_ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  spawned.push(proc)

  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/status`)
      if (res.ok) return proc
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`server on ${port} did not start`)
}

/** Connect a fake widget, exactly as the real one announces itself. */
async function connectWindow(port: number, windowId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}/ws/browser`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = reject
    setTimeout(() => reject(new Error('ws connect timeout')), 3000)
  })
  ws.send(JSON.stringify({
    channel: 'system',
    action: 'connected',
    payload: {
      windowId,
      browserId: `browser-${windowId}`,
      url: 'http://example.test/',
      title: 'Adopter Test',
      active: true,
      windowType: 'tab',
    },
    timestamp: Date.now(),
  }))
  await new Promise((r) => setTimeout(r, 150))
  return ws
}

/** Run the real `hj` CLI the way an adopter's lane does, and capture exit code + output. */
async function runHj(args: string[], cwd: string) {
  const proc = spawn({
    cmd: ['node', join(REPO_ROOT, 'bin/hj.mjs'), ...args],
    cwd,
    env: { ...(process.env as Record<string, string>), HALTIJA_REGISTRY_DIR: REGISTRY_DIR },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

afterAll(() => {
  for (const p of spawned) {
    try { p.kill() } catch {}
  }
})

describe('adopter context: a server is ALREADY RUNNING (issue #11)', () => {
  const port = uniqueTestPort()

  beforeAll(async () => {
    await startServer(port)
  })

  it('answers /status 200 while having nothing to drive — "up" is not "drivable"', async () => {
    // This is the reported shape verbatim: the adopter's cheap liveness probe succeeds...
    const status = await (await fetch(`http://localhost:${port}/status`)).json()
    expect(status.serverVersion).toBeTruthy() // ...server is definitely up...
    expect(status.ready).toBe(false) // ...but there is no browser to drive.
  })

  it('/windows says ready:false with count 0, so a reuse probe can tell', async () => {
    const win = await (await fetch(`http://localhost:${port}/windows`)).json()
    expect(win.count).toBe(0)
    expect(win.ready).toBe(false)
  })

  it('hj doctor EXITS NON-ZERO and names the real cause', async () => {
    // The adopter's lane can now fail fast here instead of much later on a navigate timeout
    // that points at their own code.
    const { exitCode, stdout } = await runHj(['--port', String(port), 'doctor'], REPO_ROOT)
    expect(exitCode).not.toBe(0)
    expect(stdout).toContain('NO connected browser tab')
  })

  it('becomes ready — and hj doctor passes — once a tab connects', async () => {
    const ws = await connectWindow(port, 'adopter-win-1')
    try {
      const status = await (await fetch(`http://localhost:${port}/status`)).json()
      expect(status.ready).toBe(true)

      const { exitCode } = await runHj(['--port', String(port), 'doctor'], REPO_ROOT)
      expect(exitCode).toBe(0)
    } finally {
      ws.close()
      await new Promise((r) => setTimeout(r, 150))
    }
  })
})

describe('adopter context: stdout stays machine-parseable (issue #14)', () => {
  const port = uniqueTestPort()

  beforeAll(async () => {
    await startServer(port)
  })

  it('hj windows emits ONLY JSON on stdout — advisory text goes to stderr', async () => {
    // An adopter shipped `JSON.parse(await $`hj windows`)`. It worked on the maintainer's machine and
    // was inert on every npm install, because there a dim hint was appended to STDOUT and the parse
    // threw into an open catch. Anything advisory belongs on stderr; stdout is the data channel.
    const { stdout, exitCode } = await runHj(['--port', String(port), 'windows'], REPO_ROOT)
    expect(exitCode).toBe(0)
    expect(() => JSON.parse(stdout)).not.toThrow()
  })

  it('the hint is still emitted — on stderr, where it cannot corrupt output', async () => {
    const { stderr } = await runHj(['--port', String(port), 'windows'], REPO_ROOT)
    // `windows` has a hint in the generated table; it must reach the user, just not via stdout.
    expect(stderr.length).toBeGreaterThan(0)
  })

  it('hj <cmd> --help describes THAT command, not the global help', async () => {
    // Falling through to global help reads exactly like "unknown command" — a reporter concluded
    // `doctor`/`map` did not exist in their build. haltija's own errors recommend this form.
    const { stdout } = await runHj(['doctor', '--help'], REPO_ROOT)
    expect(stdout.toLowerCase()).toContain('doctor')
  })
})

describe('adopter context: TWO PROJECTS at once (issues #1, #2)', () => {
  // The original complaint as an executable test: two projects, two servers, one machine. Each
  // project's `hj` must reach its OWN server with no flags — a misroute here is silent and looks
  // like a flaky test rather than an error, which is exactly why it needs a test.
  const portA = uniqueTestPort()
  const portB = uniqueTestPort()
  let dirA: string
  let dirB: string

  beforeAll(async () => {
    dirA = mkdtempSync(join(tmpdir(), 'haltija-projA-'))
    dirB = mkdtempSync(join(tmpdir(), 'haltija-projB-'))
    await startServer(portA, { cwd: dirA })
    await startServer(portB, { cwd: dirB })
  })

  it('hj in project A resolves to A’s server (not B’s, not 8700)', async () => {
    const { stdout, exitCode } = await runHj(['where', '--json'], dirA)
    expect(exitCode).toBe(0)
    const where = JSON.parse(stdout)
    expect(where.port).toBe(portA)
  })

  it('hj in project B resolves to B’s server', async () => {
    const { stdout } = await runHj(['where', '--json'], dirB)
    const where = JSON.parse(stdout)
    expect(where.port).toBe(portB)
  })

  it('neither project silently falls back to the shared default port', async () => {
    for (const [dir, port] of [[dirA, portA], [dirB, portB]] as const) {
      const { stdout } = await runHj(['where', '--json'], dir)
      expect(JSON.parse(stdout).port).not.toBe(8700)
      expect(JSON.parse(stdout).port).toBe(port)
    }
  })

  it('hj servers lists both, so a human can pick when several coexist', async () => {
    const { stdout } = await runHj(['servers'], dirA)
    expect(stdout).toContain(String(portA))
    expect(stdout).toContain(String(portB))
  })
})

describe('adopter context: AMBIGUOUS targeting from an unrelated directory (issue #8)', () => {
  // A lane run from a directory that owns no server, while other projects' servers are live: the
  // classic silent misroute. Advisory by default (a human at a prompt), fatal under --strict (a
  // script), which is the whole point of strict mode.
  const port = uniqueTestPort()
  let unrelatedDir: string

  beforeAll(async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'haltija-owner-'))
    unrelatedDir = mkdtempSync(join(tmpdir(), 'haltija-unrelated-'))
    await startServer(port, { cwd: projDir })
  })

  it('warns (but proceeds) by default — right for a human', async () => {
    const { stderr, exitCode } = await runHj(['where'], unrelatedDir)
    expect(exitCode).toBe(0)
    expect(stderr).toContain('warning')
  })

  it('--strict REFUSES with a non-zero exit — right for a lane', async () => {
    const { stderr, exitCode } = await runHj(['--strict', 'tree'], unrelatedDir)
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('strict')
    expect(stderr.toLowerCase()).toContain('ambiguous')
  })

  it('HALTIJA_STRICT=1 is equivalent to the flag', async () => {
    const proc = spawn({
      cmd: ['node', join(REPO_ROOT, 'bin/hj.mjs'), 'tree'],
      cwd: unrelatedDir,
      env: {
        ...(process.env as Record<string, string>),
        HALTIJA_REGISTRY_DIR: REGISTRY_DIR,
        HALTIJA_STRICT: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    spawned.push(proc)
    expect(await proc.exited).not.toBe(0)
  })
})
