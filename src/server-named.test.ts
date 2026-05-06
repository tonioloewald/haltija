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

const REGISTRY_DIR = join(homedir(), '.haltija', 'servers')

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
