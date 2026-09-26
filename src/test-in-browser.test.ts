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
