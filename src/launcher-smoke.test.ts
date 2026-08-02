/**
 * Does the published entry point actually start?
 *
 * `haltija --private` (without `--port-file`) — the form README, llms.txt, CLAUDE.md, the CHANGELOG
 * and the CI guide all advertise as the primary invocation — threw `ReferenceError: tmpdir is not
 * defined` at module-evaluation time and shipped dead in **five consecutive releases** (issue #17).
 *
 * Nothing caught it, and the reasons are worth keeping:
 *  - `src/private-isolation.test.ts` spawns `bin/server.ts` directly; its own comment says it stands
 *    in for the launcher. It tests what the launcher *would* do, never the launcher.
 *  - `unit-tests.yml` runs `node --check bin/*.mjs`, which is syntax-only — a missing import parses
 *    fine and fails at run time.
 *  - Every manual verification I ran passed `--port-file`, because that was in the first recipe I
 *    wrote and got copied forward. The advertised bare form was never once executed.
 *
 * So this file does the dumbest possible thing on purpose: **run the real binary the way the docs
 * tell people to, and require it to come up.** No mocks, no stand-ins, no flags the docs don't use.
 */

import { describe, it, expect, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { join } from 'path'
import { isolateTestMachineState } from './test-support'

const REGISTRY_DIR = isolateTestMachineState()
const REPO_ROOT = join(import.meta.dir, '..')
const LAUNCHER = join(REPO_ROOT, 'bin/tosijs-dev.mjs')

const spawned: Subprocess[] = []
afterAll(() => {
  for (const p of spawned) {
    try { p.kill() } catch {}
  }
})

/** Run the launcher and collect output until `match` appears or we give up. */
async function launch(args: string[], match: RegExp, timeoutMs = 45_000) {
  const proc = spawn({
    cmd: ['node', LAUNCHER, ...args],
    cwd: REPO_ROOT,
    env: {
      ...(process.env as Record<string, string>),
      HALTIJA_REGISTRY_DIR: REGISTRY_DIR,
      HALTIJA_NO_RETIRE: '1',
      HALTIJA_NO_INSTALL: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  spawned.push(proc)

  let out = ''
  const reader = (async () => {
    for await (const chunk of proc.stdout as any) {
      out += new TextDecoder().decode(chunk)
      if (match.test(out)) return
    }
  })()
  await Promise.race([reader, new Promise((r) => setTimeout(r, timeoutMs))])
  return { proc, out }
}

describe('the published launcher starts (issue #17)', () => {
  it('`--private --headless` works with NO --port-file, the form the docs advertise', async () => {
    // The exact invocation from llms.txt / CLAUDE.md / CI-INTEGRATION. A ReferenceError at module
    // load produced no output at all, so asserting on the READY line catches it directly.
    const { out } = await launch(
      ['--private', '--headless', '--headless-url', 'about:blank'],
      /HALTIJA_PRIVATE_READY/,
    )
    expect(out).toContain('HALTIJA_PRIVATE_READY')

    // And it must report a real ephemeral port, since with no port-file stdout is the ONLY channel.
    const m = /HALTIJA_PRIVATE_READY (\{.*\})/.exec(out)
    expect(m).not.toBeNull()
    const ready = JSON.parse(m![1])
    expect(typeof ready.port).toBe('number')
    expect(ready.port).toBeGreaterThan(0)
    expect(ready.port).not.toBe(8700) // private must never take the shared default
  }, 60_000)

  it('`--help` exits cleanly — the other zero-argument path through module load', async () => {
    const proc = spawn({
      cmd: ['node', LAUNCHER, '--help'],
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    spawned.push(proc)
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    expect(code).toBe(0)
    expect(out).toContain('--private')
  }, 30_000)
})
