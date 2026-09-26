/**
 * A bad certificate must cost HTTPS, never HTTP (1.13.0-beta.1 security review).
 *
 * The machine-level cert dir is shared by every haltija on the machine, so a broken pair there — a
 * hand-replaced half, an interrupted write — used to be rethrown from the TLS bind and stop EVERY
 * server from starting, HTTP included, although HTTP needs no certificate. Reproduced with
 * `ERR_OSSL_X509_KEY_VALUES_MISMATCH`: a cert and a key that each parse but do not belong together.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { execSync } from 'child_process'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

const dir = isolateTestMachineState()
const HTTP_PORT = uniqueTestPort()
const HTTPS_PORT = uniqueTestPort()
const certs = join(dir, 'certs')

let proc: Subprocess | null = null
let status: any = null

beforeAll(async () => {
  mkdirSync(certs, { recursive: true, mode: 0o700 })
  const gen = (keyOut: string, certOut: string) =>
    execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyOut}" -out "${certOut}" -days 90 -nodes -subj "/CN=localhost"`, { stdio: 'pipe' })
  // Two unrelated pairs; keep the cert of one and the key of the other. Both parse and are in
  // date, so planCertSetup says `use` and the failure happens at the TLS bind, where it bit.
  gen(join(certs, 'localhost-key.pem'), join(dir, 'other-cert.pem'))
  gen(join(dir, 'other-key.pem'), join(certs, 'localhost.pem'))

  proc = spawn({
    cmd: ['bun', 'run', 'bin/server.ts'],
    cwd: join(import.meta.dir, '..'),
    env: {
      ...process.env,
      DEV_CHANNEL_MODE: 'both',
      HALTIJA_PORT: String(HTTP_PORT),
      DEV_CHANNEL_HTTPS_PORT: String(HTTPS_PORT),
    },
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

describe('a mismatched certificate pair', () => {
  it('leaves HTTP serving', () => {
    expect(status).not.toBeNull()
    expect(status.transports.http.listening).toBe(true)
  })

  it('reports HTTPS as down rather than pretending', () => {
    expect(status.transports.https.listening).toBe(false)
  })
})
