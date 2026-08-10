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
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
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

/**
 * A stand-in haltija that serves the `/status` body we hand it, plus `/eval`.
 *
 * `/eval` is here because doctor probes requestAnimationFrame through it: a tab can report
 * visibilityState "visible" and still not be compositing, which silently breaks every
 * render-dependent conclusion (#28). A fake that 404s that probe is a server doctor genuinely
 * CANNOT check, so it lands in `unchecked` — correct behaviour, but it makes every assertion here
 * about a clean verdict fail for a reason that has nothing to do with what each test is about.
 *
 * `raf` chooses what the probe reports, so the starved case can be tested deliberately rather than
 * arrived at by accident.
 */
function fakeServer(body: Record<string, unknown>, opts: { raf?: 'fired' | 'starved' | 'absent' } = {}): number {
  const port = uniqueTestPort()
  const raf = opts.raf ?? 'fired'
  const server = Bun.serve({
    port,
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path === '/status') {
        return new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (path === '/eval' && raf !== 'absent') {
        return new Response(
          JSON.stringify({ success: true, data: { fired: raf === 'fired', ms: raf === 'fired' ? 8 : 2000 } }),
          { headers: { 'content-type': 'application/json' } },
        )
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

describe('declared origins are visible in the diagnostics that exist to explain routing', () => {
  /** Run a local command from `cwd`, so `.haltija.json` discovery is exercised for real. */
  async function inDir(cwd: string, cmd: string[], port: number) {
    const proc = spawn({
      cmd: ['bun', HJ, ...cmd, '--port', String(port)],
      cwd,
      env: {
        ...(process.env as Record<string, string>),
        HALTIJA_REGISTRY_DIR: REGISTRY_DIR,
        HALTIJA_NO_LAUNCH: '1',
        HALTIJA_ORIGINS: '', // never let the ambient env mask the file under test
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return { out, code }
  }

  const live = () => fakeServer({
    serverVersion: '1.12.0',
    windows: [tab({ active: true, hidden: false, url: 'http://localhost:3000/' })],
  })

  it('a .haltija.json declaring NOTHING usable fails doctor instead of being silently ignored', async () => {
    // The warning for this existed, but lived in a block `where` and `doctor` return before
    // reaching — so the one configuration that silently disables per-tab routing was reported
    // nowhere a user would look, least of all in the CI preflight.
    const dir = mkdtempSync(join(tmpdir(), 'haltija-origins-'))
    writeFileSync(join(dir, '.haltija.json'), JSON.stringify({ origins: [] }))
    const { out, code } = await inDir(dir, ['doctor'], live())
    expect(code).toBe(1)
    expect(out).toMatch(/no usable origins/)
    expect(out).toMatch(/routing is OFF/)
  }, 30_000)

  it('a VALID declaration passes doctor and names the tab it will drive', async () => {
    // The discriminating case: without it the assertion above would hold if doctor simply failed
    // whenever any .haltija.json existed.
    const dir = mkdtempSync(join(tmpdir(), 'haltija-origins-'))
    writeFileSync(join(dir, '.haltija.json'), JSON.stringify({ origins: ['http://localhost:3000'] }))
    const { out, code } = await inDir(dir, ['doctor'], live())
    expect(code).toBe(0)
    expect(out).toMatch(/http:\/\/localhost:3000/)
  }, 30_000)

  it('`hj where` reports origins in both human and --json output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'haltija-origins-'))
    writeFileSync(join(dir, '.haltija.json'), JSON.stringify({ origins: ['http://localhost:3000'] }))
    const human = await inDir(dir, ['where'], live())
    expect(human.out).toMatch(/origins:/)

    const json = await inDir(dir, ['where', '--json'], live())
    const parsed = JSON.parse(json.out.slice(json.out.indexOf('{'), json.out.lastIndexOf('}') + 1))
    expect(parsed.origins.declared).toEqual(['http://localhost:3000'])
  }, 30_000)

  it('no declaration at all says so, and points at the fix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'haltija-origins-'))
    const { out, code } = await inDir(dir, ['where'], live())
    expect(code).toBe(0)
    expect(out).toMatch(/none declared/)
    expect(out).toMatch(/\.haltija\.json/) // names the remedy at the moment of the question
  }, 30_000)
})

describe('a tab that reports "visible" but never paints', () => {
  /**
   * `visibilityState` answers "is this tab selected", not "is this tab being composited". They
   * diverge for occluded windows, offscreen windows and a sleeping display, and a starved tab
   * renders nothing while every geometry probe keeps returning real numbers.
   *
   * That combination doesn't just hide information, it manufactures a plausible wrong answer: an
   * agent found four routes "not mounting", had a coherent mechanism (the router gates its first
   * mount on rAF), reproduced it four times, and nearly filed it as an application bug. Opening a
   * second tab fixed all four (#28).
   */
  it('is a PROBLEM, not a pass — the tab looks visible in /status', async () => {
    const port = fakeServer(
      { serverVersion: '1.12.0', windows: [tab({ hidden: false, active: true })] },
      { raf: 'starved' },
    )
    const { json, code } = await doctor(port)
    expect(json.ok).toBe(false)
    expect(code).toBe(1)
    expect(json.problems.join(' ')).toContain('requestAnimationFrame DID NOT FIRE')
  }, 30_000)

  it('a compositing tab passes — so the check above can actually pass', async () => {
    // The vacuous-assertion guard: without this, a doctor that failed unconditionally would look
    // just as green.
    const port = fakeServer(
      { serverVersion: '1.12.0', windows: [tab({ hidden: false, active: true })] },
      { raf: 'fired' },
    )
    const { json, code } = await doctor(port)
    expect(json.ok).toBe(true)
    expect(code).toBe(0)
    expect(json.problems.join(' ')).not.toContain('requestAnimationFrame')
  }, 30_000)

  it('a probe that cannot run is UNCHECKED, never a pass', async () => {
    // "I could not check" and "I checked and it is fine" are different claims. Folding the first
    // into the second is the exact failure this command exists to remove.
    const port = fakeServer(
      { serverVersion: '1.12.0', windows: [tab({ hidden: false, active: true })] },
      { raf: 'absent' },
    )
    const { json } = await doctor(port)
    expect(json.unchecked.join(' ')).toContain('requestAnimationFrame')
    expect(json.problems.join(' ')).not.toContain('requestAnimationFrame DID NOT FIRE')
  }, 30_000)
})
