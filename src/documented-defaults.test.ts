/**
 * Every "(default X)" in the API schema is a **claim**, and a claim we never check goes stale
 * silently.
 *
 * `map.scale` was documented as "(default 2)" while the code did `payload?.scale || 1` — so an
 * agent asking for the documented behaviour got something else, and had no way to tell. Nothing
 * could have caught it: `docs-drift.yml` regenerates API.md / DOCS.md / llms.txt from this very
 * schema, so a wrong default is copied faithfully into every artifact and the diff stays clean.
 * The generated docs prove the docs match the *schema*, never that the schema matches the *code*.
 *
 * That is the same shape as `--private` shipping dead for five releases: a documented claim nobody
 * ever executed. The rule this file enforces is the generalisation — **a documented default is a
 * testable claim, so test it.**
 *
 * How: pull every `(default X)` out of the schema descriptions, then find where that parameter is
 * actually defaulted in the implementation (`payload?.x || N`, `body.x ?? N`, destructured `= N`)
 * and compare. Where a parameter is defaulted in several places with different values, any match is
 * accepted — the goal is to catch a documented value that appears *nowhere*, without inventing an
 * endpoint→code mapping we can't justify.
 *
 * It is deliberately honest about its own reach: params it cannot locate are reported as
 * UNVERIFIABLE rather than counted as passing, and the count is asserted so the blind spot can't
 * quietly grow.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir)
const read = (f: string) => readFileSync(join(SRC, f), 'utf-8')

const SCHEMA = read('api-schema.ts')
/** Where defaults are actually applied. */
const IMPL = [read('component.ts'), read('api-handlers.ts'), read('server.ts')].join('\n')

interface Claim {
  param: string
  documented: string
  line: number
}

/**
 * Extract `param: s.<type>.describe('… (default X) …')` claims.
 *
 * Only leading-word defaults are taken: "(default false = first only)" claims `false`, and prose
 * like "(default from CLI)" or "(default body)" is skipped as not being a literal value.
 */
function extractClaims(): Claim[] {
  const out: Claim[] = []
  // Matched against the WHOLE file, not line by line. A line-based version missed every
  // `describe(` wrapped across lines — the param name and its `(default …)` land on different
  // lines — which silently hid 2 of the 5 `timeout` claims. A checker with an invisible blind
  // spot is the thing this file exists to stop, so it does not get to have one.
  const re = /(\w+):\s*s\.[\w.]*?\bdescribe\(\s*(['"`])([\s\S]*?)\2/g
  for (const m of SCHEMA.matchAll(re)) {
    const [, param, , description] = m
    const doc = /\(default\s+([^)]*)\)/.exec(description)?.[1]
    if (!doc) continue
    const first = doc.trim().split(/[\s,;=]/)[0].replace(/[.'"]+$/, '')
    // Only literal values are checkable; "from CLI" / "body" describe a source, not a value.
    if (!/^(true|false|-?\d+(\.\d+)?|'[^']*'|#[0-9a-fA-F]{3,8})$/.test(first)) continue
    out.push({
      param,
      documented: first,
      line: SCHEMA.slice(0, m.index).split('\n').length,
    })
  }
  return out
}

/** Every literal this parameter is defaulted to anywhere in the implementation. */
function codeDefaults(param: string): string[] {
  const p = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    // payload?.scale || 1     body.foo ?? 100     opts.x || 'y'
    new RegExp(`[\\w?.]*\\.${p}\\s*(?:\\|\\||\\?\\?)\\s*(true|false|-?\\d+(?:\\.\\d+)?|'[^']*'|"[^"]*")`, 'g'),
    // const { scale = 1 } = payload      function f(scale = 1)
    // The lookbehind matters: without it `successMsg.style.color = '#f59e0b'` reads as a default
    // for a `color` parameter, and the linter reported the (correct) highlight colour as a doc lie.
    // A checker that cries wolf is the failure this release is about; it does not get an exemption
    // for being on our side.
    new RegExp(`(?<![.\\w])${p}\\s*=\\s*(true|false|-?\\d+(?:\\.\\d+)?|'[^']*'|"[^"]*")\\s*[,)}\\n]`, 'g'),
  ]
  const found = new Set<string>()
  for (const re of patterns) {
    for (const m of IMPL.matchAll(re)) found.add(m[1].replace(/"/g, "'"))
  }
  return [...found]
}

/**
 * Is this claim one we can honestly adjudicate?
 *
 * Two cases we deliberately decline rather than guess at:
 *
 * 1. **`(default false)` on a boolean.** An option nobody passes is already falsy, so the claim is
 *    satisfied by the absence of code — there is nothing to find, and "found nothing" would read as
 *    a contradiction. `pierceShadow` is documented `true` for `/tree` and `false` for mutation
 *    watching; both are right, and a name-keyed search can only see one of them.
 * 2. **Defaults that live somewhere this can't read** — CSS custom properties, library behaviour.
 *    `highlight.color`'s real default is `--tosijs-highlight: #6366f1` in a stylesheet.
 *
 * Declining these costs some coverage. It buys a checker whose every complaint is real, which is
 * worth more: the one that shipped a moment ago flagged three problems, of which two were its own.
 */
function checkable(c: Claim): boolean {
  if (c.documented === 'false') return false
  return codeDefaults(c.param).length > 0
}

const claims = extractClaims()

describe('documented defaults match the code', () => {
  it('finds a meaningful number of claims to check (the extractor itself works)', () => {
    // Guards the vacuous case: a broken regex would make every assertion below pass on an empty
    // set, which is how a "linter" ends up certifying whatever it was supposed to catch.
    expect(claims.length).toBeGreaterThan(30)
  })

  it('no documented default contradicts every default in the code', () => {
    const mismatches: string[] = []
    for (const c of claims) {
      if (!checkable(c)) continue // declined on purpose — see `checkable`
      const actual = codeDefaults(c.param)
      const doc = c.documented.replace(/"/g, "'")
      if (!actual.includes(doc)) {
        mismatches.push(
          `api-schema.ts:${c.line}  ${c.param}: documented "(default ${c.documented})" but the ` +
            `code only ever defaults it to ${actual.join(' / ')}`,
        )
      }
    }
    // Printed in full: a doc lie is cheap to fix and expensive to leave, so make it obvious.
    expect(mismatches).toEqual([])
  })
})

describe('the checker is honest about what it cannot check', () => {
  it('actually checks a real share of the claims — not "0 problems" from checking nothing', () => {
    // The failure mode of a lenient checker is looking identical to a strict one that found
    // nothing. Pin the coverage so `checkable` can't be quietly widened until it excuses
    // everything, which is how a green suite comes to mean nothing at all.
    const checked = claims.filter(checkable)
    expect(checked.length).toBeGreaterThan(12)
  })

  it('reports its blind spot rather than counting it as a pass', () => {
    const declined = claims.filter((c) => !checkable(c))
    // Not a failure — a `(default false)` needs no code, and some defaults live in CSS — but the
    // ratio is pinned so the unchecked set cannot quietly grow. If this trips after you added a
    // parameter, either make the default findable or raise the bound knowingly.
    expect(declined.length / claims.length).toBeLessThan(0.75)
  })
})
