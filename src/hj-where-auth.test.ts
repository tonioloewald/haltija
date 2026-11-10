import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { REMOTE_REFUSAL } from './remote-gate'

// `hj where` names the remedy for a refusal. A 403 from the #815 gate (no token on the server, and
// this shell reaches it as another machine) is not fixed by anything in this shell, so it must not
// be told "export HALTIJA_TOKEN" alone, which is the remedy for a token the shell is missing (#3382).
const refusing = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () => Response.json({ error: REMOTE_REFUSAL }, { status: 403 }),
})
const registry = mkdtempSync(join(tmpdir(), 'hj-where-auth-'))
afterAll(() => {
  refusing.stop(true)
  rmSync(registry, { recursive: true, force: true })
})

// Async on purpose: the refusing server lives in this process, so a sync spawn would block it.
async function where(env: Record<string, string> = {}) {
  const r = Bun.spawn(['node', join(import.meta.dir, '..', 'bin', 'hj.mjs'), 'where', '--json'], {
    cwd: tmpdir(),
    stdout: 'pipe',
    env: {
      ...process.env,
      HALTIJA_PORT: String(refusing.port),
      HALTIJA_NAME: '',
      HALTIJA_TOKEN: '',
      HALTIJA_REGISTRY_DIR: registry,
      HALTIJA_NO_SKEW_WARN: '1',
      ...env,
    },
  })
  return JSON.parse(await new Response(r.stdout).text())
}

describe('hj where on an auth refusal (#3382)', () => {
  it('a remote-machine refusal says to restart the server with --token', async () => {
    const out = await where()
    expect(out.authRefused).toBe(true)
    expect(out.error).toContain('Restart the server with haltija --token')
  })
})
