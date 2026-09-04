import { describe, expect, it } from 'bun:test'
import { HaltijaTestClient, sharedMutationRefusal } from './test'

/**
 * `haltija/test` must not drive a browser nobody chose (#42).
 *
 * The hazard is not hypothetical: on 2026-09-03 this project's own suite adopted a v1.11.2 server
 * belonging to another project and called `navigate`/`click` against its six live tabs. We fixed
 * our lane and left the published library adopting — and a hazard fixed in your own lane but left
 * in the library you ship is not fixed.
 *
 * **These tests make no network calls, deliberately.** The first version exercised the allow-path
 * by really calling `navigate()` against the shared default — i.e. a test for "do not drive someone
 * else's browser" that drove someone else's browser. That is why the decision is a pure function.
 */
describe('mutating the shared default is refused (#42)', () => {
  it('refuses when the target was never named', () => {
    const msg = sharedMutationRefusal('navigate', true, {})
    expect(msg).toContain('refusing to navigate')
    expect(msg).toContain('shared default')
  })

  // A refusal that does not say what to do instead just gets worked around.
  it('names the remedy, not just the refusal', () => {
    const msg = sharedMutationRefusal('click', true, {})!
    expect(msg).toContain('--private --headless')
    expect(msg).toContain('HALTIJA_PORT')
    expect(msg).toContain('HALTIJA_TEST_ALLOW_SHARED=1')
  })

  // An explicitly named target IS the caller saying which browser they mean.
  it('allows mutation once a target is named', () => {
    expect(sharedMutationRefusal('navigate', false, {})).toBeNull()
  })

  it('allows mutation when the caller deliberately opts in', () => {
    expect(sharedMutationRefusal('navigate', true, { HALTIJA_TEST_ALLOW_SHARED: '1' })).toBeNull()
  })

  // Only an exact '1' opts in — a truthy-looking value must not silently disable a safety boundary.
  it('does not accept a merely truthy opt-in', () => {
    for (const v of ['true', 'yes', '0', '']) {
      expect(sharedMutationRefusal('navigate', true, { HALTIJA_TEST_ALLOW_SHARED: v })).not.toBeNull()
    }
  })
})

/**
 * The runner path specifically — because it was OUTSIDE the boundary while five hand-written
 * methods were inside, and `hj.suite('./tests')` is this module's headline example. Guarding by
 * enumerating methods is what let the documented path be the unguarded one; this test exists so
 * the guard set cannot fall behind the API surface again.
 *
 * `fetch` is stubbed: the assertion is that NOTHING leaves the process, which a network call would
 * defeat even if it then failed.
 */
describe('the test runner is inside the #42 boundary', () => {
  it('runFile and suite refuse the shared default, without touching the network', async () => {
    for (const k of ['HALTIJA_URL', 'HALTIJA_PORT', 'DEV_CHANNEL_PORT', 'HALTIJA_TEST_ALLOW_SHARED']) {
      delete process.env[k]
    }
    const original = globalThis.fetch
    let networkCalls = 0
    globalThis.fetch = (async () => {
      networkCalls++
      return { ok: true, json: async () => ({}) }
    }) as unknown as typeof fetch
    try {
      const hj = new HaltijaTestClient()
      for (const call of [() => hj.runFile('./x.json'), () => hj.suite('./tests')]) {
        let threw = false
        try {
          await call()
        } catch (err: any) {
          threw = /refusing to/.test(err.message)
        }
        expect(threw).toBe(true)
      }
      expect(networkCalls).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })
})
