import { describe, it, expect } from 'bun:test'
import { clampPageWait, MAX_PAGE_WAIT_MS, returnedWindow, type PageTarget, type WindowLike } from './page-wait'

const win = (id: string, browserId: string, url: string, windowType = 'tab'): WindowLike => ({ id, browserId, url, windowType })
const map = (...ws: WindowLike[]) => new Map(ws.map((w) => [w.id, w]))
const target: PageTarget = { id: 'w1', browserId: 'b1', windowType: 'tab', focused: true, url: 'http://localhost:3000/a' }

describe('returnedWindow — which window is the navigated tab now', () => {
  it('not yet: same id, same browserId', () => {
    expect(returnedWindow(map(win('w1', 'b1', 'http://localhost:3000/a')), target, new Set(['w1']), 'http://localhost:3000')).toBeUndefined()
  })

  it('same origin / desktop: same id, NEW browserId', () => {
    const w = returnedWindow(map(win('w1', 'b2', 'http://localhost:3000/b')), target, new Set(['w1']), 'http://localhost:3000')
    expect(w?.id).toBe('w1')
  })

  it('cross-origin: sessionStorage is per-origin, so it comes back under a NEW id on the expected origin', () => {
    // The old window has not even disconnected yet; the origin match is enough.
    const ws = map(win('w1', 'b1', 'http://localhost:3000/a'), win('w9', 'b9', 'http://localhost:4000/x'))
    expect(returnedWindow(ws, target, new Set(['w1']), 'http://localhost:4000')?.id).toBe('w9')
  })

  it('a redirect to another origin: accepted once the navigated tab is gone', () => {
    const ws = map(win('w9', 'b9', 'https://accounts.example/login'))
    expect(returnedWindow(ws, target, new Set(['w1']), 'http://localhost:4000')?.id).toBe('w9')
  })

  it('NOT a window that already existed when the navigation began', () => {
    const ws = map(win('w1', 'b1', 'http://localhost:3000/a'), win('w2', 'b2', 'http://localhost:4000/x'))
    expect(returnedWindow(ws, target, new Set(['w1', 'w2']), 'http://localhost:4000')).toBeUndefined()
  })

  it('NOT a new window of another kind (an iframe appearing is not the tab coming back)', () => {
    const ws = map(win('w1', 'b1', 'http://localhost:3000/a'), win('f1', 'bf', 'http://localhost:4000/x', 'iframe'))
    expect(returnedWindow(ws, target, new Set(['w1']), 'http://localhost:4000')).toBeUndefined()
  })

  it('NOT a new same-kind window on another origin while the navigated tab is still alive', () => {
    const ws = map(win('w1', 'b1', 'http://localhost:3000/a'), win('w2', 'b2', 'http://other:5000/'))
    expect(returnedWindow(ws, target, new Set(['w1']), 'http://localhost:4000')).toBeUndefined()
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
