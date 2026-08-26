/**
 * The widget must send the shared secret on its own HTTP calls.
 *
 * It had eight fetch sites and sent the token on NONE, so on a `--token` server every page-side
 * feature — recording, sending a selection, listing agents — got a 401. That barely showed while
 * the channel was localhost-only. Over a tunnel it is the whole security story: "require a token"
 * and "the page can talk to the server" were mutually exclusive, and nothing said so.
 *
 * Source-level rather than behavioural, because exercising these paths needs a browser AND a
 * tokened server; the failure mode being guarded is a call site that simply forgets.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(join(import.meta.dir, 'component.ts'), 'utf-8')

/** Every `await fetch(...)` in the widget, with the ~6 lines that configure it. */
function fetchCallSites(): string[] {
  const out: string[] = []
  const lines = SRC.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/await fetch\(/.test(lines[i])) out.push(lines.slice(i, i + 7).join('\n'))
  }
  return out
}

describe('widget → server requests carry the token', () => {
  it('finds the call sites — not a vacuous check', () => {
    expect(fetchCallSites().length).toBeGreaterThan(3)
  })

  it('every fetch at the haltija server sends X-Haltija-Token via serverHeaders()', () => {
    const missing = fetchCallSites()
      // Only calls aimed at our own server need the secret; a fetch of an arbitrary page URL
      // must NOT leak it, which is why this is scoped rather than blanket.
      .filter((site) => /\$\{serverUrl\}|\$\{this\.serverUrl\}/.test(site))
      .filter((site) => !site.includes('serverHeaders('))
    expect(missing).toEqual([])
  })

  it('serverHeaders omits the header entirely when no token is configured', () => {
    // An empty X-Haltija-Token would be sent as a wrong token rather than as none.
    const fn = SRC.slice(SRC.indexOf('function serverHeaders('), SRC.indexOf('function isOwnWidget('))
    expect(fn).toContain('token ?')
    expect(fn).toMatch(/:\s*\{\s*\.\.\.extra\s*\}/)
  })

  it('reads the token from the same place the socket does', () => {
    const fn = SRC.slice(SRC.indexOf('function serverHeaders('), SRC.indexOf('function isOwnWidget('))
    expect(fn).toContain('__haltija_config__')
  })
})
