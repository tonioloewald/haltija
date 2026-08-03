/**
 * Every field the CLI *sends* must be a field the endpoint *declares*.
 *
 * This is the last link in the chain, and the one that was missing. Three invariants were added
 * this release and all three are CLI-internal:
 *
 *   hint  -> KNOWN_FLAGS          (a flag can't be advertised and unparsed)
 *   parser -> KNOWN_FLAGS         (a parser can't handle a flag nobody registered)
 *   handler -> schema             (a declared parameter can't be dropped server-side)
 *
 * None of them compares a **parsed field name** against the **endpoint schema**, which is exactly
 * where the worst bugs of this cycle lived:
 *
 *   hj wait ".modal"     sent `selector`; /wait read `forElement`  -> success in 50ms, no wait
 *   hj key s --ctrl      sent `ctrl`;     /key read `ctrlKey`      -> keystroke with no modifier
 *   hj inspect 5 --ancestors                                        -> parsed, registered,
 *                        advertised in `hj inspect --help`, and undeclared by /inspect
 *
 * `validateInput` accepts undeclared keys silently, so every one of these returns 200 with a
 * payload identical to the one you'd get without the argument. The command reports success having
 * quietly discarded what you asked for — which is the single defect class this release exists to
 * eliminate, and it kept coming back because each instance looked like a one-off.
 *
 * Structural, and deliberately cheap: it runs each `ARG_MAPS` entry over a synthetic argv and
 * checks the resulting body's keys against `getInputSchema`. It cannot catch a field that is
 * declared AND forwarded AND ignored by the widget — `src/e2e.playwright.ts` covers those — but it
 * catches every mismatch of the shape above in milliseconds.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ARG_MAPS, KNOWN_FLAGS, GLOBAL_FLAGS } from '../bin/cli-subcommand.mjs'
import { getInputSchema, endpoints } from './api-schema'
import { cliNameForEndpoint } from './cli-commands'

/** Endpoint schema keyed by the CLI subcommand name that reaches it. */
function schemaByCommand(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const ep of Object.values(endpoints as Record<string, any>)) {
    const name = cliNameForEndpoint(ep.path)
    if (!name) continue
    const schema = getInputSchema(ep) as { properties?: Record<string, unknown> }
    out.set(name, new Set(Object.keys(schema?.properties ?? {})))
  }
  return out
}

/**
 * Fields the CLI adds that no endpoint declares, legitimately.
 *
 * `window` is stripped by `runSubcommand` before the body is built, so a parser emitting it is
 * fine. Kept tiny and justified — this is the obvious place to bury a real mismatch.
 */
const CLI_ONLY = new Set(['window'])

/**
 * Commands whose parser does real I/O and so can't be driven with a synthetic argv.
 *
 * `test-run`/`test-validate`/`test-suite` take a path to a JSON test file and read it — handing
 * them a fake ref makes them try to open a file named "1". Excluded because the harness can't
 * exercise them, NOT because they're exempt from the rule; noted here so the gap is visible rather
 * than implied by silence.
 */
const NEEDS_REAL_INPUT = new Set(['test-run', 'test-validate', 'test-suite'])

/**
 * Every flag literal that appears anywhere in the CLI source.
 *
 * NOT `KNOWN_FLAGS`. The first version of this probe built its argv from the registry, which made
 * it blind to exactly the bug it was written for: a parser that handles a flag nobody registered.
 * Verified by mutation — reintroducing `hj inspect --ancestors` (parser handling, no registry
 * entry) left all 783 tests green, because the probe never passed `--ancestors` to the parser.
 *
 * Scraping source instead means a parser cannot hide a field behind an unregistered flag. The
 * quoting is deliberately both kinds: Bun's transpiler re-emits single-quoted strings as
 * double-quoted, so a single-quote-only pattern finds nothing under `bun test` while working
 * perfectly under `node` — which happened once already this cycle.
 */
function allFlagLiterals(): string[] {
  const src = readFileSync(join(import.meta.dir, '..', 'bin', 'cli-subcommand.mjs'), 'utf-8')
  const found = new Set<string>()
  for (const m of src.matchAll(/['"](--[a-z][\w-]*)['"]/gi)) found.add(m[1])
  return [...found].filter(f => !GLOBAL_FLAGS.includes(f))
}

/**
 * Keys a parser can emit, probing each flag INDIVIDUALLY.
 *
 * One at a time rather than all at once, so a field that only appears under some nonsense
 * combination of flags can't create a false alarm — and so a parser that consumes the next token
 * as a value doesn't swallow the flag being tested.
 */
function emittedKeys(cmd: string, parse: (a: string[]) => any, flags: string[]): Set<string> {
  const keys = new Set<string>()
  const collect = (args: string[]) => {
    try {
      for (const k of Object.keys(parse(args) ?? {})) keys.add(k)
    } catch {
      // A parser that rejects this shape tells us nothing; not this test's business.
    }
  }
  collect(['1', 'sample'])
  for (const f of flags) collect(['1', 'sample', f, '2'])
  return keys
}

describe('the CLI cannot send a field the endpoint does not declare', () => {
  const schemas = schemaByCommand()

  it('resolves schemas for a real number of commands — not a vacuous check', () => {
    expect(schemas.size).toBeGreaterThan(20)
    // The three that actually broke, so a change to cliNameForEndpoint can't quietly empty this.
    for (const c of ['wait', 'key', 'inspect']) {
      expect([c, [...schemas.keys()]]).toEqual([c, expect.arrayContaining([c])])
    }
  })

  it('every field every parser emits is declared by its endpoint', () => {
    const flags = allFlagLiterals()
    // Guard against the scrape going quiet — a regex that finds nothing makes every
    // assertion below trivially true, which is how the flag-literal extractor failed silently
    // under Bun earlier in this cycle.
    expect(flags.length).toBeGreaterThan(30)

    const mismatches: string[] = []
    for (const [cmd, parse] of Object.entries(ARG_MAPS as Record<string, (a: string[]) => any>)) {
      if (NEEDS_REAL_INPUT.has(cmd)) continue
      const declared = schemas.get(cmd)
      if (!declared || declared.size === 0) continue // no schema to compare against
      for (const key of emittedKeys(cmd, parse, flags)) {
        if (CLI_ONLY.has(key)) continue
        if (!declared.has(key)) mismatches.push(`hj ${cmd} sends "${key}", /${cmd} does not declare it`)
      }
    }
    expect(mismatches).toEqual([])
  })
})
