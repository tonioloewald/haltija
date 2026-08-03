/**
 * Docs must not hand out `/wait` payloads with fields the endpoint doesn't have.
 *
 * `/wait` gained `selector` as an alias for `forElement` in 1.12.0. Before that, an unrecognised
 * key was dropped and the call returned `{success:true, waited:0}` — wrong but INERT. Once
 * `selector` was honoured, two recipes in `docs/recipes.md` started executing:
 *
 *   {"selector":".loading","appear":false}   labelled "wait for element to disappear"
 *
 * `/wait` has `hidden`, not `appear` — so this now waits for the spinner to **appear**, the exact
 * inverse of its own comment, and passes silently while the spinner is still on screen. The
 * sibling recipe passed `text`, which `/wait` has never had, so it waits for the element and
 * ignores the text entirely.
 *
 * `docs/` ships in the npm `files` list, and `llms.txt` links `agent-prompt.md` as drop-in agent
 * instructions — so these are executable claims, not prose. `docs/CI-INTEGRATION.md` was corrected
 * for this exact class in this release and the sweep stopped there; this is the sweep, automated.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { getInputSchema, endpoints } from './api-schema'

const DOCS = join(import.meta.dir, '..', 'docs')

function waitFields(): Set<string> {
  const schema = getInputSchema(endpoints.wait as never) as { properties?: Record<string, unknown> }
  return new Set(Object.keys(schema?.properties ?? {}))
}

function markdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...markdownFiles(join(dir, e.name)))
    else if (e.name.endsWith('.md')) out.push(join(dir, e.name))
  }
  return out
}

describe('docs cannot advertise /wait fields the endpoint does not accept', () => {
  it('the schema really declares the fields we expect — not a vacuous check', () => {
    const f = waitFields()
    expect(f.has('forElement')).toBe(true)
    expect(f.has('selector')).toBe(true)
    expect(f.has('hidden')).toBe(true)
    // The two that burned us — assert they are genuinely absent, so this test's premise is real.
    expect(f.has('appear')).toBe(false)
    expect(f.has('text')).toBe(false)
  
  // A third assertion — "any `hj wait` for a spinner must pass --hidden" — was written and then
  // DELETED. It flagged a legitimate `hj wait .loading 10000` timeout-syntax example and the prose
  // sentence explaining the fix, i.e. it could not tell a command from a description of one. A
  // check that cries wolf gets disabled, and then the precise checks above go with it. The
  // misleading example was fixed by hand instead.
})

  it('no /wait payload in docs/ uses an undeclared key', () => {
    const allowed = waitFields()
    const files = markdownFiles(DOCS)
    expect(files.length).toBeGreaterThan(3) // the sweep must actually be sweeping

    const bad: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf-8')
      // Any JSON object on a line that also mentions /wait.
      for (const line of text.split('\n')) {
        if (!line.includes('/wait')) continue
        const m = line.match(/\{[^{}]*\}/)
        if (!m) continue
        for (const key of [...m[0].matchAll(/"(\w+)"\s*:/g)].map(x => x[1])) {
          if (!allowed.has(key)) bad.push(`${file.replace(DOCS, 'docs')}: "${key}"`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})

// A third assertion — "any `hj wait` for a spinner must pass --hidden" — was written and then
// DELETED. It flagged a legitimate `hj wait .loading 10000` timeout-syntax example and the prose
// sentence explaining the fix: it could not tell a command from a description of one. A check that
// cries wolf gets disabled, and the precise assertions above would go with it. The misleading
// example was corrected by hand instead.
