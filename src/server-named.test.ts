/**
 * Integration tests for HALTIJA_NAME — verify that a haltija server
 * registers itself in ~/.haltija/servers/<name>.json on startup and
 * removes the entry on shutdown.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { existsSync, readFileSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

// Spawned servers register themselves in the instance registry. Point them at a
// throwaway dir: otherwise a transient test server lands in the developer's real
// ~/.haltija/servers/ and — same cwd, newer startedAt — out-ranks their actual dev
// server on a cwd match, so `hj` in this repo silently drives a browserless test
// server. Set before any spawn; sessions.ts resolves the dir per call.
process.env.HALTIJA_REGISTRY_DIR = mkdtempSync(join(tmpdir(), 'haltija-test-registry-'))


// The same throwaway dir the spawned servers write to (set above, inherited by
// children via process.env), NOT the developer's real ~/.haltija/servers/.
const REGISTRY_DIR = process.env.HALTIJA_REGISTRY_DIR!

// Track every name we register so we can clean up even if the test fails.
const trackedNames = new Set<string>()
const trackedProcs = new Set<Subprocess>()

afterEach(async () => {
  for (const proc of trackedProcs) {
    try { proc.kill() } catch {}
  }
  // Give shutdown handlers a moment to fire (they remove the registry file).
  await new Promise(r => setTimeout(r, 200))
  for (const name of trackedNames) {
    const path = join(REGISTRY_DIR, `${name}.json`)
    if (existsSync(path)) rmSync(path, { force: true })
  }
  trackedProcs.clear()
  trackedNames.clear()
})

function uniqueName(prefix: string): string {
  return `${prefix}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
}

async function spawnNamedServer(name: string, port: number): Promise<Subprocess> {
  trackedNames.add(name)
  const proc = spawn({
    cmd: ['bun', 'run', 'bin/server.ts'],
    cwd: import.meta.dir + '/..',
    env: {
      ...process.env,
      DEV_CHANNEL_PORT: String(port),
      HALTIJA_NAME: name,
      // Make sure no token is required on this test server.
      HALTIJA_TOKEN: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  trackedProcs.add(proc)
  // Wait for the server to be reachable.
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/status`)
      if (res.ok) return proc
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Named server "${name}" failed to start on port ${port}`)
}

describe('HALTIJA_NAME registration', () => {
  it('writes a registry entry on startup', async () => {
    const name = uniqueName('reg')
    const port = 8741
    await spawnNamedServer(name, port)

    const path = join(REGISTRY_DIR, `${name}.json`)
    expect(existsSync(path)).toBe(true)

    const entry = JSON.parse(readFileSync(path, 'utf-8'))
    expect(entry.name).toBe(name)
    expect(entry.port).toBe(port)
    expect(typeof entry.pid).toBe('number')
    expect(typeof entry.startedAt).toBe('number')
    expect(typeof entry.cwd).toBe('string')
  })

  it('cleans up the registry entry on SIGTERM', async () => {
    const name = uniqueName('cleanup')
    const port = 8742
    const proc = await spawnNamedServer(name, port)

    const path = join(REGISTRY_DIR, `${name}.json`)
    expect(existsSync(path)).toBe(true)

    proc.kill('SIGTERM')
    await proc.exited

    // Give the exit handler a chance to fire.
    for (let i = 0; i < 20 && existsSync(path); i++) {
      await new Promise(r => setTimeout(r, 50))
    }
    expect(existsSync(path)).toBe(false)
  })

  it('two servers with different names register independently', async () => {
    const nameA = uniqueName('multi-a')
    const nameB = uniqueName('multi-b')
    await spawnNamedServer(nameA, 8743)
    await spawnNamedServer(nameB, 8744)

    const a = JSON.parse(readFileSync(join(REGISTRY_DIR, `${nameA}.json`), 'utf-8'))
    const b = JSON.parse(readFileSync(join(REGISTRY_DIR, `${nameB}.json`), 'utf-8'))
    expect(a.port).toBe(8743)
    expect(b.port).toBe(8744)
    expect(a.pid).not.toBe(b.pid)
  })
})

describe('hj --name resolution', () => {
  it('routes hj to the registered port', async () => {
    const name = uniqueName('hj-resolve')
    const port = 8745
    await spawnNamedServer(name, port)

    // Run hj via the cli-subcommand resolver against the named instance.
    // We don't exec the actual hj.mjs binary here; we replicate its
    // resolution and call /status with the resolved port.
    const path = join(REGISTRY_DIR, `${name}.json`)
    const entry = JSON.parse(readFileSync(path, 'utf-8'))
    expect(entry.port).toBe(port)

    const res = await fetch(`http://localhost:${entry.port}/status`)
    expect(res.ok).toBe(true)
  })

  it('hj.mjs binary resolves --name end-to-end', async () => {
    const name = uniqueName('hj-bin')
    const port = 8746
    await spawnNamedServer(name, port)

    // Invoke hj.mjs in a subprocess with --name and --no-launch (don't
    // try to auto-spawn a server — one is already running). `hj status`
    // is an info command so it doesn't trigger ensureBrowserConnected.
    const hj = spawn({
      cmd: ['node', 'bin/hj.mjs', '--name', name, 'status'],
      cwd: import.meta.dir + '/..',
      // Pass env explicitly: hj must read the same throwaway registry the test
      // server registered into, and a spawn without `env` does not pick up a
      // process.env mutated after startup.
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await hj.exited
    const stdout = await new Response(hj.stdout).text()
    expect(exitCode).toBe(0)
    // The status response includes serverVersion — confirms hj reached the right server.
    expect(stdout).toMatch(/serverVersion|Server|version/i)
  })
})

/**
 * Auto-registration is what makes cwd routing work — and what makes it dangerous
 * when it registers the wrong thing. These lock down the three shapes that matter.
 */
describe('auto-registration (cwd routing)', () => {
  /** Spawn a plain server (no --name) with arbitrary extra env. */
  async function spawnServer(port: number, extraEnv: Record<string, string> = {}): Promise<Subprocess> {
    const proc = spawn({
      cmd: ['bun', 'run', 'bin/server.ts'],
      cwd: import.meta.dir + '/..',
      env: { ...process.env, DEV_CHANNEL_PORT: String(port), HALTIJA_TOKEN: '', ...extraEnv },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    trackedProcs.add(proc)
    return proc
  }

  /** Registry entries settle shortly after boot; give the server a moment. */
  async function settle(ms = 1500) {
    await new Promise(r => setTimeout(r, ms))
  }

  it('an unnamed server registers as auto-<port> with its cwd', async () => {
    const port = 8751
    trackedNames.add(`auto-${port}`)
    await spawnServer(port)
    await settle()

    const path = join(REGISTRY_DIR, `auto-${port}.json`)
    expect(existsSync(path)).toBe(true)

    const entry = JSON.parse(readFileSync(path, 'utf-8'))
    expect(entry.port).toBe(port)
    expect(entry.auto).toBe(true)
    // The cwd is the whole point — without it there is nothing to match against.
    expect(entry.cwd).toBe(join(import.meta.dir, '..'))
  })

  it('the desktop app never auto-registers', async () => {
    // The desktop app owns the default port and launches from an arbitrary
    // directory, so its cwd says nothing about which project it serves. If it
    // registered, it would cwd-capture every project on the machine — the exact
    // misroute cwd routing exists to prevent. This one line is the only thing
    // preventing that, so it gets a test.
    const port = 8752
    trackedNames.add(`auto-${port}`)
    await spawnServer(port, { HALTIJA_DESKTOP: '1' })
    await settle()

    expect(existsSync(join(REGISTRY_DIR, `auto-${port}.json`))).toBe(false)
  })

  it('an HTTPS-only server does not register a phantom HTTP port', async () => {
    // Regression: under --https the HTTP listener never binds, but PORT keeps the
    // value it would have used. Registering it published an entry claiming this
    // project lived on an HTTP port nothing was listening on — or, at 8700, the
    // port the desktop app owns. Every plain `hj` under this tree then cwd-matched
    // to it and either failed or silently drove the wrong browser.
    //
    // Uses a private port rather than the real 8700 default: the bug is not
    // specific to 8700, and binding the default would collide with a desktop app
    // or dev server on the developer's machine.
    const port = 8753
    trackedNames.add(`auto-${port}`)
    await spawnServer(port, { DEV_CHANNEL_MODE: 'https', DEV_CHANNEL_HTTPS_PORT: '9453' })
    await settle(2500)

    expect(existsSync(join(REGISTRY_DIR, `auto-${port}.json`))).toBe(false)
  })
})

describe('hj port precedence', () => {
  /**
   * Regression: the fallback warning used to be emitted before --port was parsed,
   * so `hj --port N` warned "you're on the default 8700 — use --name/--port" and
   * then correctly used N. A single run contradicting itself, telling the user to
   * reach for the flag they had just used. SKILL.md instructs agents to trust that
   * warning ("misroutes are silent"), so a false one sends them chasing a phantom.
   */
  it('does not emit the default-port warning when --port is given', async () => {
    const name = uniqueName('precedence')
    const port = 8748
    await spawnNamedServer(name, port)

    const hj = spawn({
      cmd: ['node', 'bin/hj.mjs', '--port', String(port), 'status'],
      cwd: import.meta.dir + '/..',
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await hj.exited
    const stderr = await new Response(hj.stderr).text()

    expect(exitCode).toBe(0)
    expect(stderr).not.toMatch(/targeting the default port/i)
  })

  it('still warns when nothing selected a port and other servers are live', async () => {
    // The warning must keep firing in the case it exists for, or fixing the false
    // positive would just have deleted the feature.
    const name = uniqueName('warns')
    await spawnNamedServer(name, 8749)

    const hj = spawn({
      // Absolute — cwd below is deliberately outside the repo.
      cmd: ['node', join(import.meta.dir, '..', 'bin', 'hj.mjs'), 'where'],
      // A cwd no registered server owns, so resolution falls all the way through.
      cwd: tmpdir(),
      env: { ...process.env, HALTIJA_PORT: '', DEV_CHANNEL_PORT: '', HALTIJA_NAME: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    await hj.exited
    const stderr = await new Response(hj.stderr).text()

    expect(stderr).toMatch(/targeting the default port/i)
  })
})
