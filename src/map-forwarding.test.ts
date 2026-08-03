/**
 * Every parameter `/map` DECLARES must actually cross the wire to the widget.
 *
 * `maxWidth`, `maxHeight`, `format` and `quality` are read by `buildSchematicResponse` in
 * component.ts and have been honoured there since 1.11.x. The handler forwarded a hand-written
 * allowlist of four *other* fields, so they never left the server: `/map {maxWidth: 300,
 * maxHeight: 300, format: 'jpeg'}` returned a byte-identical full-size PNG, with a 200 and no
 * warning. Confirmed by probe against a live server — `scale` (on the list) changed the output;
 * the other four did nothing whatsoever.
 *
 * Three registries had to agree — the input schema, this forwarding list, and the widget's reader —
 * and the 1.11.x fix updated one. That is the same shape as a CLI flag present in `--help` and in
 * no parser, and it wants the same remedy: stop trusting a hand-maintained list, and assert the
 * relationship instead.
 *
 * The check is deliberately structural (does the handler mention the field?) rather than
 * behavioural, because the behavioural version needs a browser. src/e2e.playwright.ts has that
 * case; this one runs in milliseconds and fails the moment someone adds a parameter to the schema
 * without wiring it through.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getInputSchema, endpoints } from './api-schema'

/** Server-side only: consumed by the handler for routing, never forwarded to the widget. */
const NOT_FORWARDED = new Set(['window', 'file'])

function declaredMapParams(): string[] {
  const schema = getInputSchema(endpoints.map as any) as any
  const props = schema?.properties ?? schema
  return Object.keys(props || {})
}

/** The literal body of the `registerHandler(api.map, …)` call. */
function mapHandlerSource(): string {
  const src = readFileSync(join(import.meta.dir, 'api-handlers.ts'), 'utf-8')
  const start = src.indexOf('registerHandler(api.map,')
  expect(start).toBeGreaterThan(-1)
  // Up to the next handler registration, or the end of file.
  const next = src.indexOf('registerHandler(', start + 20)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('the /map forwarding list cannot silently omit a declared parameter', () => {
  it('finds the schema parameters at all — the check must not be vacuous', () => {
    // If `getInputSchema` ever changes shape, an empty list would make every assertion below
    // trivially true. Pin the four that were dropped, plus the control that always worked.
    const declared = declaredMapParams()
    expect(declared.length).toBeGreaterThan(5)
    for (const p of ['scale', 'maxWidth', 'maxHeight', 'format', 'quality']) {
      expect([p, declared]).toEqual([p, expect.arrayContaining([p])])
    }
  })

  it('every declared parameter is forwarded to the browser', () => {
    const source = mapHandlerSource()
    const missing = declaredMapParams()
      .filter(p => !NOT_FORWARDED.has(p))
      .filter(p => !new RegExp(`\\b${p}:\\s*body\\.${p}\\b`).test(source))
    expect(missing).toEqual([])
  })

  it('the fields it does NOT forward are deliberate, not forgotten', () => {
    // `window` picks the target tab and `file` decides whether the server writes the image to disk;
    // both are consumed here. Asserting they're used locally keeps NOT_FORWARDED from becoming a
    // place to hide a real omission.
    const source = mapHandlerSource()
    expect(source).toContain('body.window')
    expect(source).toContain('body.file')
  })
})
