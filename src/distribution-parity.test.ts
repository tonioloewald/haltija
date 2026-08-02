/**
 * Distribution parity — the two `hj`s must be one CLI.
 *
 * haltija ships the same CLI twice: as `bin/hj.mjs` inside the npm package, and as `dist/hj.js`, a
 * single bundled file installed to `~/.local/bin/hj`. They report the same version, so nothing
 * signals when they diverge — and they did:
 *
 *  - the bundle read its command hints from a sibling `hints.json` that doesn't exist next to a lone
 *    installed file, so it silently emitted none;
 *  - which meant the npm CLI appended a hint to **stdout** and the bundle didn't, so
 *    `JSON.parse($`hj windows`)` worked on a maintainer's machine and threw on every npm install.
 *
 * An adopter verified their readiness probe behaviourally, against a real repro, and still shipped a
 * no-op — because the binary they verified against is not the one their users get (issue #14).
 *
 * So: run BOTH artifacts and diff what a consumer can observe. This is the same lesson as the
 * adopter-context lane — test the artifact people receive, not the one that's convenient — applied
 * to packaging rather than to machine state.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { existsSync } from 'fs'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

const REGISTRY_DIR = isolateTestMachineState()
const REPO_ROOT = join(import.meta.dir, '..')
const NPM_CLI = join(REPO_ROOT, 'bin/hj.mjs')
const BUNDLE_CLI = join(REPO_ROOT, 'dist/hj.js')

const PORT = uniqueTestPort()
let server: Subprocess | null = null

async function run(cli: string, args: string[]) {
  const proc = spawn({
    cmd: ['node', cli, ...args],
    cwd: REPO_ROOT,
    env: { ...(process.env as Record<string, string>), HALTIJA_REGISTRY_DIR: REGISTRY_DIR },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

/** Both artifacts, same arguments — the only comparison that matters. */
const both = async (args: string[]) => ({
  npm: await run(NPM_CLI, args),
  bundle: await run(BUNDLE_CLI, args),
})

beforeAll(async () => {
  server = spawn({
    cmd: ['bun', 'run', join(REPO_ROOT, 'bin/server.ts')],
    cwd: REPO_ROOT,
    env: { ...(process.env as Record<string, string>), DEV_CHANNEL_PORT: String(PORT), HALTIJA_PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/status`)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('parity-test server did not start')
})

afterAll(() => {
  try { server?.kill() } catch {}
})

describe('distribution parity: the bundle exists and is current', () => {
  it('dist/hj.js is built (the lane is meaningless without it)', () => {
    expect(existsSync(BUNDLE_CLI)).toBe(true)
  })

  it('both report the SAME version — the premise that makes divergence dangerous', async () => {
    const { npm, bundle } = await both(['--version'])
    expect(bundle.stdout.trim()).toBe(npm.stdout.trim())
  })
})

describe('distribution parity: identical command surface', () => {
  it('exposes the same commands — a version number promises the commands of that version', async () => {
    // An adopter scripting `hj doctor` on our own CI advice must not get generic help and exit 0.
    const list = (out: string) =>
      [...new Set((out.match(/^\s{2}hj [a-z-]+/gm) || []).map((s) => s.trim()))].sort()
    const { npm, bundle } = await both(['--help'])
    expect(list(bundle.stdout)).toEqual(list(npm.stdout))
  })

  it('resolves the commands that shipped after the bundle mechanism existed', async () => {
    // doctor (1.6.1) and map (1.8.0) were both reported missing from the bundle.
    for (const cmd of ['doctor', 'map', 'servers']) {
      const { npm, bundle } = await both([cmd, '--help'])
      expect(bundle.stdout.toLowerCase()).toContain(cmd)
      expect(npm.stdout.toLowerCase()).toContain(cmd)
    }
  })
})

describe('distribution parity: identical observable output', () => {
  it('stdout is byte-identical for a data command', async () => {
    const { npm, bundle } = await both(['--port', String(PORT), 'windows'])
    expect(bundle.stdout).toBe(npm.stdout)
    expect(bundle.exitCode).toBe(npm.exitCode)
  })

  it('stdout is parseable JSON from BOTH — the exact bug that made an adopter probe inert', async () => {
    const { npm, bundle } = await both(['--port', String(PORT), 'windows'])
    expect(() => JSON.parse(npm.stdout)).not.toThrow()
    expect(() => JSON.parse(bundle.stdout)).not.toThrow()
  })

  it('the bundle carries its hints — it used to read a sibling file that is not installed', async () => {
    // The hint must reach the user from both artifacts (on stderr, where it can't corrupt stdout).
    const { npm, bundle } = await both(['--port', String(PORT), 'windows'])
    expect(npm.stderr.length).toBeGreaterThan(0)
    expect(bundle.stderr.length).toBeGreaterThan(0)
  })

  it('an error and its teachable hint are identical in both', async () => {
    const { npm, bundle } = await both(['--port', String(PORT), 'navigate'])
    expect(bundle.exitCode).toBe(npm.exitCode)
    // The hint is what tells the caller what to do; it must not be a maintainer-only luxury.
    expect(bundle.stderr).toBe(npm.stderr)
  })
})
