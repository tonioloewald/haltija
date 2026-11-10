import { describe, it, expect, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isolatedServerEnv, uniqueTestPort } from './test-ports'
import { waitForServer, SERVER_START_HOOK_MS } from './test-support'

// freePort end to end (#3122, #1079's spawned test). It is the one path where a server stops
// ANOTHER server, so the rest of the suite turns it off (HALTIJA_NO_RETIRE). Here it is on, with the
// legacy sweep alone off (HALTIJA_NO_LEGACY_SWEEP), because the sweep probes the shared 8700/8701
// and freePort only ever touches the port it was explicitly told to bind: temp ports, below.
const dir = mkdtempSync(join(tmpdir(), 'haltija-freeport-'))
const env = (extra: Record<string, string>) => ({
  ...(process.env as Record<string, string>),
  ...isolatedServerEnv(dir),
  HALTIJA_NO_RETIRE: '0',
  HALTIJA_NO_LEGACY_SWEEP: '1',
  ...extra,
})
const procs: Subprocess[] = []
function start(extra: Record<string, string>) {
  const p = spawn({ cmd: ['bun', 'run', join(import.meta.dir, '..', 'bin', 'server.ts')], env: env(extra), stdout: 'pipe', stderr: 'pipe' })
  procs.push(p)
  return p
}
const exitedWithin = (p: Subprocess, ms: number) =>
  Promise.race([p.exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))])

afterAll(() => {
  for (const p of procs) p.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe('freePort, spawned (#3122)', () => {
  it('a strict --port stops the haltija server holding it, then binds it', async () => {
    const port = uniqueTestPort()
    const a = start({ HALTIJA_PORT: String(port) })
    await waitForServer(`http://localhost:${port}`, a)
    const b = start({ HALTIJA_PORT: String(port) })
    expect(await exitedWithin(a, 15_000)).toBe(true)
    await waitForServer(`http://localhost:${port}`, b)
    expect(b.exitCode).toBeNull()
  }, SERVER_START_HOOK_MS * 2)

  it('an explicit HTTPS port is reclaimed from a both-mode holder over TLS (#1079)', async () => {
    const https = uniqueTestPort()
    const a = start({ HALTIJA_PORT: String(uniqueTestPort()), DEV_CHANNEL_MODE: 'both', DEV_CHANNEL_HTTPS_PORT: String(https) })
    await waitForServer(`https://localhost:${https}`, a, { init: { tls: { rejectUnauthorized: false } } as any })
    const b = start({ HALTIJA_PORT: String(uniqueTestPort()), DEV_CHANNEL_MODE: 'both', DEV_CHANNEL_HTTPS_PORT: String(https) })
    expect(await exitedWithin(a, 15_000)).toBe(true)
    await waitForServer(`https://localhost:${https}`, b, { init: { tls: { rejectUnauthorized: false } } as any })
    expect(b.exitCode).toBeNull()
  }, SERVER_START_HOOK_MS * 2)

  it('control: a holder that is not haltija is left alone, and the bind fails', async () => {
    const port = uniqueTestPort()
    const stranger = Bun.serve({ port, fetch: () => new Response('not haltija', { status: 404 }) })
    try {
      const b = start({ HALTIJA_PORT: String(port) })
      expect(await exitedWithin(b, 20_000)).toBe(true)
      expect(b.exitCode).not.toBe(0)
      expect(await (await fetch(`http://localhost:${port}/`)).text()).toBe('not haltija')
    } finally {
      stranger.stop(true)
    }
  }, SERVER_START_HOOK_MS)
})
