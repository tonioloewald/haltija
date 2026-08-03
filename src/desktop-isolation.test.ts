/**
 * The desktop app's isolation guards, tested without launching Electron.
 *
 * These guards shipped with **no coverage at any tier** — not unit, not integration, not e2e —
 * because every way of exercising them required a running Electron app with a private server.
 * "Untestable without a GUI" is not a property of the rule; it was a property of where the rule was
 * written. Moved into src/, they are four pure functions.
 *
 * That mattered: one of them was wrong. `serverUrl: process.env.HALTIJA_PUBLIC_URL ||
 * 'http://localhost:8700'` made the renderer's "did main tell me my address?" check *always* true,
 * so `if (injected) settings.serverUrl = injected` fired unconditionally and silently reverted the
 * user's saved Server URL on every launch — a setting that appeared to save and then quietly
 * stopped applying.
 */

import { describe, it, expect } from 'bun:test'
import {
  resolveInternalPort,
  resolvePublicUrl,
  isPrivateInstance,
  resolveServerUrl,
  SHARED_PUBLIC_URL,
  SHARED_INTERNAL_PORT,
} from './desktop-isolation'

describe('resolveInternalPort: 0 means "none" and must survive as 0', () => {
  it('an unset port is the shared default — the normal, non-private case', () => {
    expect(resolveInternalPort({})).toBe(SHARED_INTERNAL_PORT)
  })

  it('an ephemeral port from a private instance is used verbatim', () => {
    expect(resolveInternalPort({ HALTIJA_INTERNAL_PORT: '54321' })).toBe(54321)
  })

  it('"0" stays 0 and does NOT become 8701', () => {
    // The whole reason this is a function. `parseInt(x, 10) || 8701` — the form anyone would
    // write — resurrects the SHARED internal port for a private instance that deliberately has no
    // internal server, attaching its chrome widget to another project's channel under the same
    // windowId ('hj-chrome') so the two collide.
    expect(resolveInternalPort({ HALTIJA_INTERNAL_PORT: '0' })).toBe(0)
  })

  it('garbage reports "none" rather than falling back across the isolation boundary', () => {
    // An app with no chrome widget is visibly degraded and gets a console warning. An app silently
    // attached to another project's server is not visible at all. Prefer the loud failure.
    expect(resolveInternalPort({ HALTIJA_INTERNAL_PORT: 'wat' })).toBe(0)
    expect(resolveInternalPort({ HALTIJA_INTERNAL_PORT: '-1' })).toBe(0)
  })

  it('an empty string is "unset", not "garbage"', () => {
    expect(resolveInternalPort({ HALTIJA_INTERNAL_PORT: '' })).toBe(SHARED_INTERNAL_PORT)
  })
})

describe('resolvePublicUrl: null when nobody said, so the caller can tell', () => {
  it('returns null when main set nothing — THE regression', () => {
    // Was `|| 'http://localhost:8700'`. Returning a default here destroys the only signal the
    // renderer has for "main told me where my server is", and that signal is what decides whether
    // to overwrite the user's setting.
    expect(resolvePublicUrl({})).toBeNull()
    expect(resolvePublicUrl({ HALTIJA_PUBLIC_URL: '' })).toBeNull()
  })

  it('returns the address main resolved for this instance', () => {
    expect(resolvePublicUrl({ HALTIJA_PUBLIC_URL: 'http://localhost:49812' })).toBe(
      'http://localhost:49812',
    )
  })
})

describe('isPrivateInstance', () => {
  it('only the literal "1" counts', () => {
    expect(isPrivateInstance({ HALTIJA_PRIVATE: '1' })).toBe(true)
    expect(isPrivateInstance({})).toBe(false)
    // Not "any truthy string": HALTIJA_PRIVATE=0 must not read as private, and neither must a
    // stray "false" — a mis-read in EITHER direction is a bug (isolation lost, or a normal app
    // refusing to honour its own settings).
    expect(isPrivateInstance({ HALTIJA_PRIVATE: '0' })).toBe(false)
    expect(isPrivateInstance({ HALTIJA_PRIVATE: 'false' })).toBe(false)
  })
})

describe('resolveServerUrl: isolation > deliberate choice > own address > stale snapshot', () => {
  it('a private instance uses its injected address even against a user-set URL', () => {
    // Isolation is not a preference. A persisted URL is per-origin and survives across runs, so a
    // value saved by an earlier or shared session would point a private app back at the shared
    // server — the exact cross-project connection --private exists to prevent.
    expect(
      resolveServerUrl({
        injected: 'http://localhost:49812',
        isPrivate: true,
        persisted: SHARED_PUBLIC_URL,
        persistedIsUserSet: true,
      }),
    ).toBe('http://localhost:49812')
  })

  it('a URL the user typed survives a relaunch — THE bug', () => {
    // Before: `injected` was always truthy (because of the `|| 8700` default), so this returned
    // 'http://localhost:8700' and the setting silently reverted on every launch.
    expect(
      resolveServerUrl({
        injected: SHARED_PUBLIC_URL,
        isPrivate: false,
        persisted: 'http://my-box.local:9000',
        persistedIsUserSet: true,
      }),
    ).toBe('http://my-box.local:9000')
  })

  it('a stale snapshot does NOT beat this instance\'s own address', () => {
    // Non-private, but 8700 was busy so this app's server landed on an ephemeral port. A persisted
    // 8700 that the user never chose would point it at another project's browser.
    expect(
      resolveServerUrl({
        injected: 'http://localhost:51001',
        isPrivate: false,
        persisted: SHARED_PUBLIC_URL,
        persistedIsUserSet: false,
      }),
    ).toBe('http://localhost:51001')
  })

  it('settings saved before serverUrlIsUserSet existed keep working', () => {
    // `persistedIsUserSet` is simply absent in those, which must read as "not deliberate" — the
    // same behaviour those users already have, rather than a surprise change on upgrade.
    expect(
      resolveServerUrl({
        injected: 'http://localhost:51001',
        isPrivate: false,
        persisted: SHARED_PUBLIC_URL,
      }),
    ).toBe('http://localhost:51001')
  })

  it('falls back to the persisted value when main injected nothing', () => {
    expect(
      resolveServerUrl({ injected: null, isPrivate: false, persisted: 'http://elsewhere:9000' }),
    ).toBe('http://elsewhere:9000')
  })

  it('with nothing at all, the shared default — the plain first-run case', () => {
    expect(resolveServerUrl({ injected: null, isPrivate: false })).toBe(SHARED_PUBLIC_URL)
  })

  it('a private instance with no injected address does not invent one', () => {
    // Degenerate, but it must not silently produce the shared URL under a `private` flag; the
    // persisted/default path is at least honest about where it came from.
    expect(
      resolveServerUrl({ injected: null, isPrivate: true, persisted: 'http://saved:1234' }),
    ).toBe('http://saved:1234')
  })
})

describe('both compiled twins load and agree with the source', () => {
  it('apps/desktop/isolation.js (CJS) is what preload.js destructures', () => {
    // preload.js requires this at top level; a twin that fails to load takes the whole window with
    // it. And testing src/ alone cannot catch a bundling failure.
    const { createRequire } = require('module')
    const req = createRequire(import.meta.url)
    const twin = req('../apps/desktop/isolation.js')
    for (const name of ['resolveInternalPort', 'resolvePublicUrl', 'isPrivateInstance']) {
      expect(typeof twin[name]).toBe('function')
    }
    // The behaviour, not just the presence — a twin built from a stale source would pass the above.
    expect(twin.resolveInternalPort({ HALTIJA_INTERNAL_PORT: '0' })).toBe(0)
    expect(twin.resolvePublicUrl({})).toBeNull()
  })

  it('apps/desktop/renderer/isolation.js (ESM) is what state.js and settings.js import', async () => {
    const twin = await import('../apps/desktop/renderer/isolation.js')
    expect(typeof twin.resolveServerUrl).toBe('function')
    expect(twin.SHARED_PUBLIC_URL).toBe(SHARED_PUBLIC_URL)
    expect(
      twin.resolveServerUrl({
        injected: SHARED_PUBLIC_URL,
        isPrivate: false,
        persisted: 'http://my-box.local:9000',
        persistedIsUserSet: true,
      }),
    ).toBe('http://my-box.local:9000')
  })
})
