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


/** From a marker to the matching close of the handler's argument list, by brace/paren depth. */
function handlerBody(src: string, start: number): string {
  let depth = 0
  let seen = false
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '{') { depth++; seen = true }
    else if (c === ')' || c === '}') {
      depth--
      if (seen && depth <= 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start)
}

describe('every parameter a handler READS is declared by its schema', () => {
  /**
   * The mirror of the check above, and the one that was missing.
   *
   * `/recording/generate` read NINE fields from the body and declared ONE. tosijs-schema 1.1.3 did
   * not enforce `additionalProperties: false`, so the other eight worked anyway and the e2e case
   * that passes `events` stayed green for months. Only a dependency bump to 1.5.1 — which does
   * enforce it — turned "undeclared but working" into a 400 on a documented endpoint.
   *
   * Undeclared-but-read is worse than the forward direction, because it fails LATER and somewhere
   * else: the parameter works until validation tightens, or until a consumer generates a client
   * from the published schema and omits a field the endpoint actually needs.
   *
   * Scanned from `src/server.ts` as well as `api-handlers.ts` — several endpoints are handled
   * there via `schemaEndpoint`, and that is exactly where this one hid.
   */
  const SOURCES = ['api-handlers.ts', 'server.ts'].map(f =>
    readFileSync(join(import.meta.dir, f), 'utf-8'),
  )

  /** Fields the router injects or consumes before the handler sees them. */
  const ROUTER_PROVIDED = new Set(['window'])

  it('finds handler bodies to scan — not a vacuous check', () => {
    const total = SOURCES.join('\n').match(/body\.[a-zA-Z_$][\w$]*/g) || []
    expect(total.length).toBeGreaterThan(50)
  })

  it('no handler reads a field its endpoint does not declare', () => {
    const undeclared: string[] = []
    for (const [name, ep] of Object.entries(endpoints as Record<string, any>)) {
      const marker = `registerHandler(api.${name},`
      const marker2 = `schemaEndpoint(api.${name},`
      for (const src of SOURCES) {
        const start = src.indexOf(marker) !== -1 ? src.indexOf(marker) : src.indexOf(marker2)
        if (start === -1) continue
        // Brace-match to the end of THIS handler. Slicing to "the next marker" overran: server.ts
        // dispatches with `if (path === …)` blocks, so the next `schemaEndpoint(` can be far past
        // the end of the current one — and the overrun attributed a neighbour's `body.agentId` to
        // /snapshot. A check whose findings name the wrong endpoint is worse than none: it sends
        // you to fix code that is already correct.
        const body = handlerBody(src, start)
        const declared = new Set(
          Object.keys(((getInputSchema(ep) as any)?.properties ?? {}) as Record<string, unknown>),
        )
        for (const m of body.matchAll(/\bbody\.([a-zA-Z_$][\w$]*)/g)) {
          const field = m[1]
          if (ROUTER_PROVIDED.has(field) || declared.has(field)) continue
          undeclared.push(`${name} reads body.${field}, /${name} does not declare it`)
        }
      }
    }
    expect([...new Set(undeclared)]).toEqual([])
  })
})
