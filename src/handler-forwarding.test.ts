/**
 * Every parameter an endpoint DECLARES must actually reach the widget.
 *
 * This is the defect class that dominated 1.12.0, and the reason it kept recurring is that each
 * instance looked like a one-off:
 *
 *   - `hj wait <selector>` sent `selector`; `/wait` reads `forElement`  → success in 50ms, no wait
 *   - `hj key s --ctrl` sent `ctrl`;        `/key` reads `ctrlKey`       → keystroke, no modifier
 *   - `/map` declared nothing for maxWidth/format, and the handler forwarded a hand-picked four
 *   - `/type` and `/key` declared `ref`, and **neither handler forwarded it** — so
 *     `hj type 10 "hello"`, the headline example in README, DOCS.md and SKILL.md, failed every
 *     time, and `/key {ref}` returned **success: true** against `document.activeElement`
 *
 * Every one is the same shape: a parameter is declared in one registry and dropped in another,
 * `validateInput` accepts undeclared keys silently, and the call returns 200. The caller is told
 * it worked.
 *
 * The first version of this file asserted the invariant for `/map` alone, which is how `/type` and
 * `/key` — a far more used pair — went out broken in the very release that fixed `/map`. A guard
 * written for one instance of a class does not guard the class. So: every handler, derived from
 * the schema, no hand-maintained list of endpoints.
 *
 * Deliberately STRUCTURAL (does the handler mention `body.<param>`?) rather than behavioural: the
 * behavioural version needs a browser per endpoint. `src/e2e.playwright.ts` carries the
 * behavioural cases for the parameters that have actually broken; this runs in milliseconds and
 * fails the moment someone adds a parameter without wiring it.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getInputSchema, endpoints } from './api-schema'

const SOURCE = readFileSync(join(import.meta.dir, 'api-handlers.ts'), 'utf-8')

/**
 * Parameters consumed by the SERVER rather than forwarded, with the reason.
 *
 * Keyed by parameter name and applied globally, because the reasons are global: `window` picks the
 * target tab, `diff`/`diffDelay` drive the server-side before/after snapshot, `file` decides
 * whether the server writes the image to disk, `fallback` chooses the server's degradation path.
 * Kept SMALL and justified — an exemption list is the obvious place to hide a real omission, so
 * the test below also asserts each of these is genuinely referenced in the handler source.
 */
const SERVER_SIDE = new Set(['window', 'diff', 'diffDelay', 'file', 'fallback', 'timeout'])

/** The body of one `registerHandler(api.X, …)` call, up to the next registration. */
function handlerSource(exportName: string): string | null {
  const marker = `registerHandler(api.${exportName},`
  const start = SOURCE.indexOf(marker)
  if (start === -1) return null
  const next = SOURCE.indexOf('registerHandler(api.', start + marker.length)
  return SOURCE.slice(start, next === -1 ? undefined : next)
}

function declaredParams(ep: unknown): string[] {
  const schema = getInputSchema(ep as never) as { properties?: Record<string, unknown> } | undefined
  const props = (schema?.properties ?? schema) as Record<string, unknown> | undefined
  return props ? Object.keys(props) : []
}

/** Endpoints that have a registered handler, paired with its source. */
function handlersWithSchemas(): Array<{ name: string; params: string[]; src: string }> {
  const out: Array<{ name: string; params: string[]; src: string }> = []
  for (const [name, ep] of Object.entries(endpoints as Record<string, unknown>)) {
    const src = handlerSource(name)
    if (!src) continue
    const params = declaredParams(ep)
    if (params.length) out.push({ name, params, src })
  }
  return out
}

describe('every declared parameter reaches the widget', () => {
  it('finds a decent number of handlers — the check must not be vacuous', () => {
    // If `endpoints` or `getInputSchema` changes shape, an empty list makes every assertion below
    // trivially true. Five vacuous tests were found by mutation in this cycle; none by reading.
    const found = handlersWithSchemas()
    expect(found.length).toBeGreaterThan(15)
    // And the specific pair this file exists because of.
    expect(found.map(h => h.name)).toContain('type')
    expect(found.map(h => h.name)).toContain('key')
  })

  it('no handler drops a parameter its own schema declares', () => {
    const dropped: string[] = []
    for (const { name, params, src } of handlersWithSchemas()) {
      for (const p of params) {
        if (SERVER_SIDE.has(p)) continue
        // Any mention of the parameter off the body counts — `p: body.p`, `body.p ?? x`, or the
        // cast form `(body as any).p` that `/wait`'s alias uses. The failure mode is a parameter
        // the handler never looks at AT ALL, and a looser check that still catches every real
        // instance beats a stricter one that produces false alarms and gets disabled.
        const mentioned = new RegExp(`\\bbody(?:\\s+as\\s+\\w+)?\\)?\\.${p}\\b`).test(src)
        // Some handlers forward the whole body rather than enumerating fields (`…, body, …`),
        // which by construction cannot drop anything.
        const forwardsWholeBody = /requestFromBrowser\([^)]*,\s*body\s*,/.test(src)
        if (!mentioned && !forwardsWholeBody) dropped.push(`${name}.${p}`)
      }
    }
    expect(dropped).toEqual([])
  })

  it('the server-side exemptions are genuinely used, not a hiding place', () => {
    // An exemption that names a parameter nobody consumes is indistinguishable from the bug.
    const unused = [...SERVER_SIDE].filter(p => !new RegExp(`\\bbody\\.${p}\\b`).test(SOURCE))
    expect(unused).toEqual([])
  })
})
