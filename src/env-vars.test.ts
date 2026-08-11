/**
 * Every `HALTIJA_*` / `DEV_CHANNEL_*` variable the code reads must appear in CLAUDE.md's table,
 * and vice versa.
 *
 * Keeping prose in step with code has been this project's most persistent source of drift, and the
 * env table is a pure enumeration — exactly the kind of thing a human maintains badly and a test
 * maintains perfectly. Written after a hand diff found `HALTIJA_ARTIFACT_DIR` and
 * `HALTIJA_TEST_QUIET` read in the code and documented nowhere.
 *
 * TWO ACCESS PATTERNS, both required. The first draft of this check matched only
 * `process.env.NAME` and reported `HALTIJA_ORIGINS` as documented-but-dead — a false alarm, because
 * `project-origins.ts` takes an injected `env` object (`env.HALTIJA_ORIGINS`) so it can be tested
 * without touching the real environment. That is *better* practice, not worse, and a guard that
 * punishes it would push the codebase the wrong way. A checker that cries wolf gets deleted.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')
const CLAUDE_MD = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf-8')

/** Source files that ship — tests and generated twins are excluded deliberately. */
function shippedSources(): string[] {
  const out: string[] = []
  for (const [dir, exts] of [
    ['src', ['.ts']],
    ['bin', ['.mjs']],
    ['apps/desktop', ['.js']],
  ] as const) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!exts.some((e) => f.endsWith(e))) continue
      if (f.includes('.test.')) continue
      const body = readFileSync(join(ROOT, dir, f), 'utf-8')
      // Generated twins duplicate their src/ original; counting them changes nothing but noise.
      if (body.startsWith('/** ⚠️  AUTO-GENERATED')) continue
      out.push(body)
    }
  }
  return out
}

/** Names read from EITHER `process.env.X` or an injected `env.X`. */
function namesReadInCode(): Set<string> {
  const names = new Set<string>()
  const pattern = /(?:process\.)?env(?:\.|\[')((?:HALTIJA|DEV_CHANNEL)_[A-Z0-9_]+)/g
  for (const body of shippedSources()) {
    for (const m of body.matchAll(pattern)) names.add(m[1])
  }
  return names
}

function namesInTable(): Set<string> {
  const names = new Set<string>()
  for (const m of CLAUDE_MD.matchAll(/^\| `((?:HALTIJA|DEV_CHANNEL)_[A-Z0-9_]+)`/gm)) names.add(m[1])
  return names
}

describe('the env-var table matches the code', () => {
  it('finds a plausible number of both — not a vacuous check', () => {
    expect(namesReadInCode().size).toBeGreaterThan(15)
    expect(namesInTable().size).toBeGreaterThan(15)
  })

  it('nothing is read in code but missing from CLAUDE.md', () => {
    const missing = [...namesReadInCode()].filter((n) => !namesInTable().has(n)).sort()
    expect(missing).toEqual([])
  })

  it('nothing is documented that the code never reads', () => {
    // The other direction matters just as much: a variable that no longer does anything, still
    // documented, is an instruction that silently fails.
    const dead = [...namesInTable()].filter((n) => !namesReadInCode().has(n)).sort()
    expect(dead).toEqual([])
  })
})
