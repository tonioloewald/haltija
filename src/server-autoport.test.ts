/**
 * Auto-port fallback test — when no port preference is given and the
 * canonical default (8700) is occupied, the server should bind a kernel-
 * assigned ephemeral port and record it in the registry under HALTIJA_NAME.
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


const REGISTRY_DIR = join(homedir(), '.haltija', 'servers')
const trackedNames = new Set<string>()
const trackedProcs = new Set<Subprocess>()
let occupiedSocket: ReturnType<typeof Bun.serve> | null = null

afterEach(async () => {
  for (const proc of trackedProcs) {
    try { proc.kill() } catch {}
  }
  if (occupiedSocket) {
    try { occupiedSocket.stop() } catch {}
    occupiedSocket = null
  }
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

it('falls back to an ephemeral port when 8700 is taken and no preference is given', async () => {
  // Make sure 8700 is occupied so the launching server has to fall back.
  // If something else on this machine is already holding it (common during
  // dev), that's fine — we just skip occupying it ourselves.
  try {
    occupiedSocket = Bun.serve({
      port: 8700,
      fetch: () => new Response('decoy', { status: 200 }),
    })
  } catch (err: unknown) {
    if (!(err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE')) {
      throw err
    }
    // 8700 is already busy — that's the precondition this test needs.
  }

  const name = uniqueName('autoport')
  trackedNames.add(name)

  const proc = spawn({
    cmd: ['bun', 'run', 'bin/server.ts'],
    cwd: import.meta.dir + '/..',
    env: {
      // Strip every port-preference env so the server has to choose itself.
      // (Inheriting process.env would forward HALTIJA_PORT/DEV_CHANNEL_PORT
      // from the test runner.)
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      HALTIJA_NAME: name,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  trackedProcs.add(proc)

  // Poll the registry for the entry — once it appears, we know the server
  // bound a port and registered itself.
  const path = join(REGISTRY_DIR, `${name}.json`)
  let entry: { port: number; pid: number } | null = null
  for (let i = 0; i < 50 && !entry; i++) {
    if (existsSync(path)) {
      try { entry = JSON.parse(readFileSync(path, 'utf-8')) } catch {}
    }
    if (!entry) await new Promise(r => setTimeout(r, 100))
  }

  expect(entry).not.toBeNull()
  expect(entry!.port).not.toBe(8700)
  expect(entry!.port).toBeGreaterThan(0)

  // And the server is actually reachable on the recorded port.
  const res = await fetch(`http://localhost:${entry!.port}/status`)
  expect(res.ok).toBe(true)
})
