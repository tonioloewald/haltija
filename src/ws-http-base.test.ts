/**
 * `wss://` must become `https://`, and it did not.
 *
 * `"wss://host/ws/browser".replace("ws:", "http:")` is a NO-OP — the substring is `wss:`, not `ws:`
 * — so the derived value stayed `wss://host`, which `fetch` cannot use. Server-side recording was
 * broken for EVERY wss configuration, including the standard HTTPS localhost setup where
 * `inject.js` sets `wss://localhost:8701/ws/browser` (issue #38).
 *
 * Two of the three hand-rolled copies were wrong; the third survived by ordering luck. There is one
 * now, and these are the cases that distinguish it from the broken version.
 */
import { describe, it, expect } from 'bun:test'
import { httpBaseFromWsUrl } from './ws-url'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('httpBaseFromWsUrl', () => {
  it('wss becomes https — the case that was broken', () => {
    expect(httpBaseFromWsUrl('wss://localhost:8701/ws/browser')).toBe('https://localhost:8701')
    expect(httpBaseFromWsUrl('wss://tunnel.example.com/ws/browser')).toBe('https://tunnel.example.com')
  })

  it('ws still becomes http', () => {
    expect(httpBaseFromWsUrl('ws://localhost:8700/ws/browser')).toBe('http://localhost:8700')
  })

  it('never leaves a ws scheme behind — the actual failure was a URL fetch could not use', () => {
    for (const u of ['ws://h:1/ws/browser', 'wss://h:2/ws/browser']) {
      expect(httpBaseFromWsUrl(u)).not.toMatch(/^wss?:/)
    }
  })

  it('anchors to the scheme, so a host containing "ws" is untouched', () => {
    expect(httpBaseFromWsUrl('wss://ws.example.com/ws/browser')).toBe('https://ws.example.com')
  })

  it('falls back only when there is no url', () => {
    expect(httpBaseFromWsUrl(undefined)).toBe('http://localhost:8700')
    expect(httpBaseFromWsUrl(null)).toBe('http://localhost:8700')
    expect(httpBaseFromWsUrl('')).toBe('http://localhost:8700')
  })

  it('a same-origin tunnel URL survives intact — the case #38 was found while building', () => {
    expect(httpBaseFromWsUrl('wss://headset.local:8443/ws/browser')).toBe('https://headset.local:8443')
  })
})

describe('served scripts point at the host the client used, not localhost', () => {
  /**
   * `localhost` inside a script the SERVER hands a browser means the BROWSER's machine. A page
   * opened from another device on the LAN — a fixed IP, a Bonjour `.local` name — was told to
   * connect to its own localhost, where nothing is listening. Silent failure: no widget, `hj where`
   * reports 0 tabs, and the natural conclusion is that your own setup is wrong.
   *
   * Source-level, because exercising it needs a second machine.
   */
  const SERVER = readFileSync(join(import.meta.dir, 'server.ts'), 'utf-8')

  it('/inject.js and /dev.js derive the host from the request', () => {
    const hits = [...SERVER.matchAll(/const reachedHost = new URL\(req\.url\)\.hostname/g)]
    expect(hits.length).toBe(2)
  })

  it('neither hands the page a hardcoded localhost websocket', () => {
    const bad = [...SERVER.matchAll(/const wsUrl = `\$\{wsProtocol\}:\/\/localhost:/g)]
    expect(bad).toEqual([])
  })

  it('the generated embed snippet uses location.hostname', () => {
    const llms = readFileSync(join(import.meta.dir, '..', 'llms.txt'), 'utf-8')
    expect(llms).toContain('const host = location.hostname')
    expect(llms).not.toContain("'http://localhost:8700'")
  })
})
