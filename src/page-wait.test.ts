import { describe, it, expect } from 'bun:test'
import { clampPageWait, MAX_PAGE_WAIT_MS, returnedWindow, type PageTarget, type WindowLike } from './page-wait'

const win = (id: string, browserId: string, url: string, windowType = 'tab'): WindowLike => ({ id, browserId, url, windowType })
const map = (...ws: WindowLike[]) => new Map(ws.map((w) => [w.id, w]))
const target: PageTarget = { id: 'w1', browserId: 'b1', windowType: 'tab', focused: true, url: 'http://localhost:3000/a' }

describe('returnedWindow — the navigated tab is back only by IDENTITY', () => {
  it('not yet: same id, same browserId', () => {
    expect(returnedWindow(map(win('w1', 'b1', 'http://localhost:3000/a')), target, new Set(['w1']), 'http://localhost:4000')).toBeUndefined()
  })

  it('back: same id, NEW browserId — same origin, desktop, and cross-origin via the window.name handoff', () => {
    const r = returnedWindow(map(win('w1', 'b2', 'http://localhost:4000/b')), target, new Set(['w1']), 'http://localhost:4000')
    expect(r).toEqual({ window: expect.objectContaining({ id: 'w1' }), confirmed: true })
  })

  it('NOT a new window while the tab is still connected, even on the expected origin', () => {
    // The earlier rule accepted this: an unrelated tab opening during a slow load was "your page".
    const ws = map(win('w1', 'b1', 'http://localhost:3000/a'), win('w9', 'b9', 'http://localhost:4000/x'))
    expect(returnedWindow(ws, target, new Set(['w1']), 'http://localhost:4000')).toBeUndefined()
  })

  it('once the tab is gone, a new same-kind window on the expected origin is only a CANDIDATE', () => {
    const r = returnedWindow(map(win('w9', 'b9', 'http://localhost:4000/x')), target, new Set(['w1']), 'http://localhost:4000')
    expect(r).toEqual({ window: expect.objectContaining({ id: 'w9' }), confirmed: false })
  })

  it('never a window from another origin, one that already existed, or one of another kind', () => {
    expect(returnedWindow(map(win('w9', 'b9', 'http://other:5000/')), target, new Set(['w1']), 'http://localhost:4000')).toBeUndefined()
    expect(returnedWindow(map(win('w2', 'b2', 'http://localhost:4000/x')), target, new Set(['w1', 'w2']), 'http://localhost:4000')).toBeUndefined()
    expect(returnedWindow(map(win('f1', 'bf', 'http://localhost:4000/x', 'iframe')), target, new Set(['w1']), 'http://localhost:4000')).toBeUndefined()
  })

  it('nothing to wait for without a target', () => {
    expect(returnedWindow(map(win('w9', 'b9', 'http://localhost:4000/x')), null, new Set(), 'http://localhost:4000')).toBeUndefined()
  })
})

describe('clampPageWait — caller-supplied, reachable by any page (#44)', () => {
  it('defaults, and caps huge or hostile values', () => {
    expect(clampPageWait(undefined)).toBe(10_000)
    expect(clampPageWait(1e12)).toBe(MAX_PAGE_WAIT_MS)
    expect(clampPageWait(-5)).toBe(0)
    expect(clampPageWait('nonsense')).toBe(10_000)
  })
})
