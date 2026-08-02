/**
 * `hj doctor` must never print a green it did not earn.
 *
 * This is the highest-stakes output we have: `docs/CI-INTEGRATION.md` documents `until hj doctor`
 * as the gate a lane blocks on, so a false ✓ is consumed by automation and turns into a run whose
 * results are plausible and wrong. A false ✗ costs someone a minute; a false ✓ costs them the
 * conclusion.
 *
 * It shipped a false ✓ anyway (M3). `isVisible` read only `active`, `/status` sent only `hidden`
 * before this release, and one global `hj` driving many pinned per-project servers is — per our own
 * skew doctrine — the *normal* steady state. So the check silently passed at every older server,
 * including ones where every tab was asleep.
 *
 * The unit tests next door cover the predicate. This file covers the thing the predicate exists
 * for: it drives the REAL `dist/hj.js` against servers that speak each historical `/status` dialect
 * and asserts on the verdict and the EXIT CODE, which is what a CI lane actually reads.
 */

import { describe, it, expect, afterAll } from 'bun:test'
import { spawn } from 'bun'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

const REGISTRY_DIR = isolateTestMachineState()
const REPO_ROOT = join(import.meta.dir, '..')
const HJ = join(REPO_ROOT, 'dist/hj.js')

const servers: Array<{ stop: () => void }> = []
afterAll(() => {
  for (const s of servers) {
    try { s.stop() } catch {}
  }
})

/** A stand-in haltija that serves exactly the `/status` body we hand it, and nothing else. */
function fakeServer(body: Record<string, unknown>): number {
  const port = uniqueTestPort()
  const server = Bun.serve({
    port,
    fetch(req) {
      if (new URL(req.url).pathname === '/status') {
        return new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    },
  })
  servers.push(server)
  return port
}

/** Run the real `hj doctor` against `port` and return its verdict. */
async function doctor(port: number, extraArgs: string[] = [], env: Record<string, string> = {}) {
  const proc = spawn({
    cmd: ['bun', HJ, ...extraArgs, 'doctor', '--json', '--port', String(port)],
    cwd: REPO_ROOT,
    env: {
      ...(process.env as Record<string, string>),
      HALTIJA_REGISTRY_DIR: REGISTRY_DIR,
      HALTIJA_NO_LAUNCH: '1',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
  return { json, code }
}

const tab = (over: Record<string, unknown>) => ({ id: 'w1', url: 'http://localhost:3000', ...over })

describe('a hidden tab is caught in every /status dialect', () => {
  it('OLD shape {hidden:true} — the exact payload that produced a false ✓', async () => {
    // Pre-1.11.4 servers send this and only this. Before the fix: "✓ ready to drive", exit 0.
    const port = fakeServer({ serverVersion: '1.11.3', windows: [tab({ hidden: true })] })
    const { json, code } = await doctor(port)
    expect(json.ok).toBe(false)
    expect(code).toBe(1)
    expect(json.problems.join(' ')).toContain('HIDDEN')
  }, 30_000)

  it('NEW shape {hidden:true, active:false}', async () => {
    const port = fakeServer({
      serverVersion: '1.12.0',
      windows: [tab({ hidden: true, active: false })],
    })
    const { json, code } = await doctor(port)
    expect(json.ok).toBe(false)
    expect(code).toBe(1)
  }, 30_000)

  it('a visible tab still passes — proving the checks above can actually pass', async () => {
    // Without this the suite would be equally green if doctor failed unconditionally, which is
    // the vacuous-assertion trap that let the last round of this bug through review.
    const port = fakeServer({
      serverVersion: '1.12.0',
      windows: [tab({ hidden: false, active: true })],
    })
    const { json, code } = await doctor(port)
    expect(json.ok).toBe(true)
    expect(code).toBe(0)
    expect(json.unchecked).toEqual([])
  }, 30_000)
})

describe('what we could not check is reported as unknown, not as a pass', () => {
  const silent = { serverVersion: '1.6.0', windows: [tab({})] } // reports neither field

  it('a tab that reported no visibility lands in `unchecked`, not in a bare ✓', async () => {
    const { json, code } = await doctor(fakeServer(silent))
    // Default: advisory. Exiting 1 at every older server would be crying wolf, and a diagnostic
    // nobody believes is no better than one that lies.
    expect(code).toBe(0)
    expect(json.ok).toBe(true)
    expect(json.unchecked.length).toBeGreaterThan(0)
    expect(json.unchecked.join(' ')).toMatch(/did not report visibility/)
    // It must say what it assumed, so a user chasing a stale result can find the assumption.
    expect(json.unchecked.join(' ')).toMatch(/ASSUMED/)
  }, 30_000)

  it('--strict makes an unperformed check fatal', async () => {
    // A lane that asked for no surprises would rather stop here than consume a guess.
    const port = fakeServer(silent)
    const { json, code } = await doctor(port, ['--strict'])
    expect(json.ok).toBe(false)
    expect(code).toBe(1)
  }, 30_000)

  it('a server that DOES report visibility leaves `unchecked` empty even under --strict', async () => {
    const port = fakeServer({ serverVersion: '1.12.0', windows: [tab({ active: true, hidden: false })] })
    const { json, code } = await doctor(port, ['--strict'])
    expect(json.unchecked).toEqual([])
    expect(code).toBe(0)
  }, 30_000)
})

describe('`hj where` distinguishes absent / refused / readable (auth probe)', () => {
  /** Run the real `hj where --json` against `port`. */
  async function where(port: number, env: Record<string, string> = {}) {
    const proc = spawn({
      cmd: ['bun', HJ, 'where', '--json', '--port', String(port)],
      cwd: REPO_ROOT,
      env: {
        ...(process.env as Record<string, string>),
        HALTIJA_REGISTRY_DIR: REGISTRY_DIR,
        HALTIJA_NO_LAUNCH: '1',
        ...env,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
  }

  /** A server that demands a token, so we can drive all three outcomes. */
  function lockedServer(secret: string): number {
    const port = uniqueTestPort()
    const server = Bun.serve({
      port,
      fetch(req) {
        if (req.headers.get('x-haltija-token') !== secret) {
          return new Response('unauthorized', { status: 401 })
        }
        return new Response(JSON.stringify({ serverVersion: '1.12.0', windows: [] }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    servers.push(server)
    return port
  }

  it('no token: reports the server as RUNNING and names the missing token', async () => {
    // Before: `reachable: false`, error "no server is listening on this port" — a flat denial of a
    // live server, and advice ("start one") that could not have worked.
    const json = await where(lockedServer('s3cret'), { HALTIJA_TOKEN: '' })
    expect(json.reachable).toBe(true)
    expect(json.authRefused).toBe(true)
    expect(json.error).toMatch(/IS running/)
    expect(json.error).toMatch(/HALTIJA_TOKEN/) // names the remedy, not just the symptom
  }, 30_000)

  it('wrong token: says the token was rejected, not that nothing is there', async () => {
    const json = await where(lockedServer('s3cret'), { HALTIJA_TOKEN: 'wrong' })
    expect(json.authRefused).toBe(true)
    expect(json.error).toMatch(/rejected/)
  }, 30_000)

  it('right token: reads it normally and claims no auth problem', async () => {
    // The discriminating case — without it every assertion above would hold if the probe were
    // simply broken in a new way.
    const json = await where(lockedServer('s3cret'), { HALTIJA_TOKEN: 's3cret' })
    expect(json.authRefused).toBe(false)
    expect(json.server?.version).toBe('1.12.0')
  }, 30_000)

  it('genuinely nothing listening: still reported as unreachable', async () => {
    const json = await where(uniqueTestPort()) // never bound
    expect(json.reachable).toBe(false)
    expect(json.authRefused).toBe(false)
  }, 30_000)
})
