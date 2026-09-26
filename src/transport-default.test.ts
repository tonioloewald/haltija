/**
 * The transport DEFAULT, end to end: a spawned server with no mode set (#32a).
 *
 * Every other spawned test server pins `DEV_CHANNEL_MODE=http` (isolatedServerEnv) and the HTTPS
 * suites pass `--https`/`--both` explicitly, so until this file nothing exercised the default at
 * all. Reverting `resolveTransportMode` to `|| 'http'`, or dropping the cert's 0600, failed no test
 * (1.13.0-beta.1 correctness review).
 *
 * It also pins the 8701 policy at the wiring level: a server on a custom port must open HTTPS on an
 * ephemeral port, never the well-known 8701 (`httpsPortFor`). If that regresses, this test reaches
 * for the machine's real 8701 — which is exactly the regression, and the assertion names it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { statSync } from 'fs'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

const dir = isolateTestMachineState()
const HTTP_PORT = uniqueTestPort()
const CERTS_DIR = join(dir, 'certs')

let proc: Subprocess | null = null
let status: any = null

beforeAll(async () => {
  const env: Record<string, string | undefined> = { ...process.env, HALTIJA_PORT: String(HTTP_PORT) }
  // The point of the file: no mode, no HTTPS port. Everything else stays isolated.
  delete env.DEV_CHANNEL_MODE
  delete env.DEV_CHANNEL_HTTPS_PORT
  proc = spawn({
    cmd: ['bun', 'run', 'bin/server.ts'],
    cwd: join(import.meta.dir, '..'),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  for (let i = 0; i < 50 && !status; i++) {
    try {
      const res = await fetch(`http://localhost:${HTTP_PORT}/status`)
      if (res.ok) status = await res.json()
    } catch {}
    if (!status) await Bun.sleep(200)
  }
}, 20000)

afterAll(async () => {
  proc?.kill()
  await proc?.exited
})

describe('the transport default, spawned (#32a)', () => {
  it('opens BOTH transports when no mode is set', () => {
    expect(status).not.toBeNull()
    expect(status.transports.http.listening).toBe(true)
    expect(status.transports.https.listening).toBe(true)
  })

  it('a custom-port server puts HTTPS on an ephemeral port, never the shared 8701', () => {
    expect(status.transports.https.port).not.toBe(8701)
    expect(status.transports.https.port).toBeGreaterThan(0)
  })

  it('that HTTPS port actually serves', async () => {
    const res = await fetch(`https://localhost:${status.transports.https.port}/status`, {
      // @ts-ignore - Bun supports this
      tls: { rejectUnauthorized: false },
    })
    expect(res.ok).toBe(true)
  })

  it('writes the certificate into the configured dir with a 0600 key', () => {
    const mode = statSync(join(CERTS_DIR, 'localhost-key.pem')).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
