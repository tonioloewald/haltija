/**
 * `createBrowserPage` against a fake bridge: the envelope check on selector actions.
 *
 * `BrowserBridge` is structural ("any haltija client satisfies it"). A raw-REST bridge reports a
 * missing selector as `{ success: false, error }` rather than throwing; `click`/`type`/`press`
 * used to discard that, so `page.click('#missing')` passed (1.13.0-beta.1 correctness review).
 */

import { describe, it, expect } from 'bun:test'
import { BrowserProbeError, createBrowserPage, type BrowserBridge } from './test-in-browser'

const refusing: BrowserBridge = {
  eval: async () => ({ success: true, data: null }),
  click: async () => ({ success: false, error: 'no element matches #missing' }),
  type: async () => ({ success: false, error: 'no element matches #missing' }),
  press: async () => ({ success: false, error: 'nothing focused' }),
}

const accepting: BrowserBridge = {
  eval: async () => ({ success: true, data: null }),
  click: async () => ({ success: true }),
  type: async () => ({ success: true }),
  press: async () => ({ success: true }),
}

describe('selector actions honour the { success: false } envelope', () => {
  const page = createBrowserPage(refusing)

  it('click fails', async () => {
    await expect(page.click('#missing')).rejects.toBeInstanceOf(BrowserProbeError)
  })

  it('type fails', async () => {
    await expect(page.type('#missing', 'x')).rejects.toThrow('no element matches #missing')
  })

  it('press fails', async () => {
    await expect(page.press('Enter')).rejects.toThrow('nothing focused')
  })

  it('a successful reply still passes', async () => {
    const ok = createBrowserPage(accepting)
    await ok.click('#there')
    await ok.type('#there', 'x')
    await ok.press('Enter')
  })
})

describe("bridge.eval's return contract (#2415)", () => {
  const bridgeReturning = (reply: (code: string) => unknown): BrowserBridge => ({ ...accepting, eval: async (code) => reply(code) })
  // What a correct bridge hands back for the probe wrapper `read()` sends.
  const envelope = { ok: true, value: 42 }

  it('accepts the raw value', async () => {
    expect(await createBrowserPage(bridgeReturning(() => envelope)).read(() => 42)).toBe(42)
  })

  it('accepts { data: value }, the shape of haltija\'s own /eval', async () => {
    expect(await createBrowserPage(bridgeReturning(() => ({ success: true, data: envelope }))).read(() => 42)).toBe(42)
  })

  it('names the bridge, not the probe, when the reply is wrapped some other way', async () => {
    const wrapped = createBrowserPage(bridgeReturning(() => ({ success: true, value: envelope, result: envelope })))
    const err = await wrapped.read(() => 42).catch((e) => e)
    expect(err).toBeInstanceOf(BrowserProbeError)
    expect(err.message).toContain('bridge.eval returned an object without')
    expect(err.message).toContain('keys: success, value, result')
    expect(err.message).not.toContain('probe threw')
  })

  it('still reports a probe that really threw, with its message', async () => {
    const threw = createBrowserPage(bridgeReturning(() => ({ ok: false, error: 'boom' })))
    await expect(threw.read(() => 42)).rejects.toThrow('boom')
  })

  it('still reports a reply that is not an object as no result', async () => {
    await expect(createBrowserPage(bridgeReturning(() => undefined)).read(() => 42)).rejects.toThrow('no result')
  })
})
