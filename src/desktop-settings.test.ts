/**
 * The REAL `apps/desktop/renderer/state.js`, driven directly.
 *
 * `desktop-isolation.test.ts` proves the *rule* is right. This proves the app is *wired to it* —
 * which is where the bug actually lived. `resolveServerUrl` could be perfect and the setting would
 * still revert if `state.js` passed it a value that had already been defaulted.
 *
 * That is not a hypothetical distinction. The original bug was exactly this shape: the guard in
 * state.js read correctly ("only override when main injected something"), and preload handed it a
 * value with `|| 'http://localhost:8700'` baked in, so "something" was always true. Neither file
 * was wrong on its own.
 *
 * state.js needs only `localStorage` and `window` at module scope — no DOM — so it loads under Bun
 * with two small stubs.
 */

import { describe, it, expect, beforeEach } from 'bun:test'

const store = new Map<string, string>()
const g = globalThis as any
g.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
}
g.window = { haltija: {} }

// Imported AFTER the stubs exist — state.js reads localStorage at module scope.
const state = await import('../apps/desktop/renderer/state.js')

/** Stand in for what the preload script exposed on this launch. */
function launchWith(haltija: Record<string, unknown>) {
  g.window.haltija = haltija
}
/** Stand in for what a previous launch persisted. */
function persisted(settings: Record<string, unknown>) {
  store.set('haltija-settings', JSON.stringify(settings))
}

beforeEach(() => store.clear())

describe('a Server URL the user typed survives a relaunch', () => {
  it('THE M1 reproduction: an injected address does not overwrite the user\'s choice', () => {
    // This is the case that fails against 1.11.3 — verified by reverting state.js to
    // `if (injected) settings.serverUrl = injected` and watching this test, and only this test, go
    // red. Because preload baked in `|| 'http://localhost:8700'`, `injected` was a non-empty string
    // on EVERY launch, so the override always fired and the user's saved address was discarded.
    launchWith({ serverUrl: 'http://localhost:8700', isPrivate: false })
    persisted({ serverUrl: 'http://my-box.local:9000', serverUrlIsUserSet: true })

    state.loadSettings()

    expect(state.getServerUrl()).toBe('http://my-box.local:9000')
  })

  it('and when main injected nothing at all', () => {
    // Deliberately NOT labelled as the regression: with preload fixed, `serverUrl` is null here, so
    // even the old `if (injected)` guard would have left the persisted value alone. It passes
    // against the buggy code and pins the other half of the contract — worth having, worth not
    // mistaking for proof.
    launchWith({ serverUrl: null, isPrivate: false })
    persisted({ serverUrl: 'http://my-box.local:9000', serverUrlIsUserSet: true })

    state.loadSettings()

    expect(state.getServerUrl()).toBe('http://my-box.local:9000')
  })
})

describe('isolation still overrides everything', () => {
  it('a private instance ignores a user-set URL pointing at the shared server', () => {
    // The property the original override existed to protect, and the one a naive "just stop
    // overriding" fix would have broken. Both must hold at once.
    launchWith({ serverUrl: 'http://localhost:49812', isPrivate: true })
    persisted({ serverUrl: 'http://localhost:8700', serverUrlIsUserSet: true })

    state.loadSettings()

    expect(state.getServerUrl()).toBe('http://localhost:49812')
  })

  it('a stale persisted 8700 loses to this instance\'s own ephemeral port', () => {
    // Non-private, but 8700 was taken so this app's server landed elsewhere. The user never chose
    // 8700 — it's a snapshot from a previous run — and following it would drive another project.
    launchWith({ serverUrl: 'http://localhost:51001', isPrivate: false })
    persisted({ serverUrl: 'http://localhost:8700' })

    state.loadSettings()

    expect(state.getServerUrl()).toBe('http://localhost:51001')
  })
})

describe('nothing persisted', () => {
  it('uses the address main injected', () => {
    launchWith({ serverUrl: 'http://localhost:51001', isPrivate: false })
    state.loadSettings()
    expect(state.getServerUrl()).toBe('http://localhost:51001')
  })

  it('a malformed settings blob does not take the app down', () => {
    launchWith({ serverUrl: 'http://localhost:51001', isPrivate: false })
    store.set('haltija-settings', '{not json')
    expect(() => state.loadSettings()).not.toThrow()
  })
})
