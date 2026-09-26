/**
 * The machine-level certificate, end to end (1.13.0-beta.1 review and re-review).
 *
 * The cert dir is shared by every haltija on the machine, so each failure here used to be
 * machine-wide:
 *   - a bad pair was rethrown from the TLS bind and stopped EVERY server, HTTP included;
 *   - a mismatched pair (two servers renewing at once can interleave their renames) passed every
 *     later check, so HTTPS stayed down until someone deleted the dir;
 *   - nothing checked the date, so the openssl cert would lapse after a year;
 *   - /status blamed "port N is held by another process" for a certificate problem.
 */

import { describe, it, expect, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { execSync } from 'child_process'
import { X509Certificate } from 'crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

isolateTestMachineState()
const REPO = join(import.meta.dir, '..')
const procs: Subprocess[] = []

afterAll(async () => {
  for (const p of procs) p.kill()
  await Promise.all(procs.map((p) => p.exited))
})

const openssl = (keyOut: string, certOut: string, days: number) =>
  execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyOut}" -out "${certOut}" -days ${days} -nodes -subj "/CN=localhost"`, { stdio: 'pipe' })

/** A server with its own cert dir and receipt log; returns its /status once it answers. */
async function start(certs: string, extraEnv: Record<string, string> = {}) {
  const port = uniqueTestPort()
  const log = join(mkdtempSync(join(tmpdir(), 'haltija-receipts-')), 'receipts.log')
  const proc = spawn({
    cmd: ['bun', 'run', 'bin/server.ts'],
    cwd: REPO,
    env: {
      ...process.env,
      DEV_CHANNEL_MODE: 'both',
      HALTIJA_PORT: String(port),
      DEV_CHANNEL_HTTPS_PORT: String(uniqueTestPort()),
      HALTIJA_CERTS_DIR: certs,
      HALTIJA_MACHINE_LOG: log,
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  procs.push(proc)
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/status`)
      if (res.ok) return { status: await res.json(), log: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') }
    } catch {}
    await Bun.sleep(200)
  }
  throw new Error('server never answered')
}

const freshCertDir = () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'haltija-certtest-')), 'certs')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

describe('the machine-level certificate', () => {
  it('a MISMATCHED pair heals: replaced, old pair kept as .bak, with a receipt', async () => {
    const certs = freshCertDir()
    // Keep the cert of one pair and the key of another. Both parse and are in date.
    openssl(join(certs, 'localhost-key.pem'), join(certs, '..', 'other-cert.pem'), 90)
    openssl(join(certs, '..', 'other-key.pem'), join(certs, 'localhost.pem'), 90)
    const { status, log } = await start(certs)
    expect(status.transports.http.listening).toBe(true)
    expect(status.transports.https.listening).toBe(true)
    expect(existsSync(join(certs, 'localhost.pem.bak'))).toBe(true)
    expect(log()).toContain('mismatched')
  }, 30000)

  it('an EXPIRING cert is renewed, with a receipt', async () => {
    const certs = freshCertDir()
    openssl(join(certs, 'localhost-key.pem'), join(certs, 'localhost.pem'), 5)
    const before = new Date(new X509Certificate(readFileSync(join(certs, 'localhost.pem'))).validTo)
    const { status, log } = await start(certs)
    const after = new Date(new X509Certificate(readFileSync(join(certs, 'localhost.pem'))).validTo)
    expect(status.transports.https.listening).toBe(true)
    expect(after.getTime()).toBeGreaterThan(before.getTime())
    expect(log()).toContain('renewed')
  }, 30000)

  it('with no way to write a cert, HTTP serves and /status names the real reason', async () => {
    // A cert dir under a read-only parent, so every route fails — generate AND adopt (a checkout
    // has its own gitignored certs/ to adopt, which is why a PATH without openssl is not enough).
    const parent = mkdtempSync(join(tmpdir(), 'haltija-certtest-ro-'))
    chmodSync(parent, 0o555)
    try {
      const { status } = await start(join(parent, 'certs'))
      expect(status.transports.http.listening).toBe(true)
      expect(status.transports.https.listening).toBe(false)
      expect(status.transports.https.reason).toContain('could not obtain a TLS certificate')
      expect(status.transports.https.reason).not.toContain('held by another process')
    } finally {
      chmodSync(parent, 0o755)
    }
  }, 30000)
})
