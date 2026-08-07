import { describe, it, expect } from 'bun:test'
import { resolveTestServerUrl } from './test'

/**
 * The SHIPPED `haltija/test` helper hardcoded `http://localhost:8700` with no env override, so
 * every adopter's integration suite pointed at the shared interactive server. Its only gate is
 * "does /status answer 200?" — true of somebody else's server too — and `navigate()` posts with no
 * `window`, so it drives whatever tab is focused. Reproduced during review: running the suite
 * navigated a live tosijs-3d tab away from what its developer was doing.
 */
describe('the test helper resolves its server like hj does', () => {
  it('HALTIJA_URL wins outright', () => {
    expect(resolveTestServerUrl({ HALTIJA_URL: 'http://localhost:9999', HALTIJA_PORT: '1' })).toEqual({
      url: 'http://localhost:9999',
      source: 'HALTIJA_URL',
    })
  })

  it('HALTIJA_PORT is honoured — the variable an isolated run actually sets', () => {
    expect(resolveTestServerUrl({ HALTIJA_PORT: '54321' })).toEqual({
      url: 'http://localhost:54321',
      source: 'HALTIJA_PORT',
    })
  })

  it('DEV_CHANNEL_PORT still works, since it is the documented legacy alias', () => {
    expect(resolveTestServerUrl({ DEV_CHANNEL_PORT: '4242' }).url).toBe('http://localhost:4242')
  })

  it('falls back to 8700 and SAYS it is the default', () => {
    // The `source` is what lets the constructor warn. Collapsing it into just a URL would make
    // "you chose this" and "we guessed" indistinguishable — the same shape as a doctor check that
    // reports green for a server it never reached.
    expect(resolveTestServerUrl({})).toEqual({ url: 'http://localhost:8700', source: 'default' })
  })

  it('an empty string is not a choice', () => {
    expect(resolveTestServerUrl({ HALTIJA_PORT: '', HALTIJA_URL: '' }).source).toBe('default')
  })
})
