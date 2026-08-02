import { describe, it, expect } from 'bun:test'
import { isTopLevelTab, isVisible, isVisibleTab, isDrivable, summarizeWindow, visibilityKnown } from './window-state'

const tab = (over: Partial<{ active: boolean; windowType: string }> = {}) => ({ id: 'w', ...over })

describe('polarity: undefined must not mean hidden', () => {
  it('a window that never reported visibility counts as visible', () => {
    // The trap: `active === true` would drop every older widget; only an explicit false is hidden.
    expect(isVisible(tab())).toBe(true)
    expect(isVisible(tab({ active: true }))).toBe(true)
    expect(isVisible(tab({ active: false }))).toBe(false)
  })

  it('a window that never reported a type counts as a tab', () => {
    expect(isTopLevelTab(tab())).toBe(true)
    expect(isTopLevelTab(tab({ windowType: 'iframe' }))).toBe(false)
    expect(isTopLevelTab(tab({ windowType: 'popup' }))).toBe(false)
  })
})

describe('isVisibleTab', () => {
  it('requires BOTH top-level and on-screen', () => {
    expect(isVisibleTab(tab())).toBe(true)
    expect(isVisibleTab(tab({ active: false }))).toBe(false)
    expect(isVisibleTab(tab({ windowType: 'iframe' }))).toBe(false)
  })
})

describe('isDrivable', () => {
  it('a HIDDEN tab still counts — reachable, just possibly stale', () => {
    // Reporting ready:false here would tell a CI lane to abandon a server it could use; staleness
    // is what the hidden-tab warning is for, not a reason to declare the server undrivable.
    expect(isDrivable([tab({ active: false })])).toBe(true)
  })

  it('iframes and popups alone do NOT make a server drivable', () => {
    expect(isDrivable([tab({ windowType: 'iframe' }), tab({ windowType: 'popup' })])).toBe(false)
  })

  it('no windows means not drivable — the #11 case', () => {
    expect(isDrivable([])).toBe(false)
  })
})

describe('summarizeWindow', () => {
  it('emits active AND hidden, so neither endpoint can invert a consumer’s meaning', () => {
    // /status used to emit only `hidden`, /windows only `active`; code moving between them flipped.
    expect(summarizeWindow(tab({ active: false }))).toMatchObject({ active: false, hidden: true })
    expect(summarizeWindow(tab({ active: true }))).toMatchObject({ active: true, hidden: false })
  })

  it('normalizes an unreported type to "tab" rather than leaving it undefined', () => {
    expect(summarizeWindow(tab()).windowType).toBe('tab')
  })

  it('the two fields are always exact inverses', () => {
    for (const w of [tab(), tab({ active: true }), tab({ active: false })]) {
      const s = summarizeWindow(w)
      expect(s.active).toBe(!s.hidden)
    }
  })
})

describe('isVisible reads BOTH field names (M3 — the false-green bug)', () => {
  it('honours `hidden: true`, the shape /status sent before 1.11.4', () => {
    // This is the whole bug. `w.active !== false` is TRUE for {hidden:true}, so `hj doctor`
    // printed "✓ ready to drive" at a server whose every tab was asleep — and CI consumed it.
    expect(isVisible({ id: 'w', hidden: true })).toBe(false)
    expect(isVisible({ id: 'w', hidden: false })).toBe(true)
  })

  it('honours `active: false`, the shape /windows sends', () => {
    expect(isVisible({ id: 'w', active: false })).toBe(false)
  })

  it('either field alone is enough to call a tab hidden', () => {
    // Servers in the wild send one, the other, or both. Agreeing with whichever says "hidden"
    // fails closed; requiring both would let a half-speaking server look awake.
    expect(isVisible({ id: 'w', hidden: true, active: true })).toBe(false)
    expect(isVisible({ id: 'w', hidden: false, active: false })).toBe(false)
  })
})

describe('visibilityKnown separates a check from an assumption', () => {
  it('a tab that reported neither field is UNKNOWN, not confirmed-visible', () => {
    // isVisible must still answer something, and `true` is the right guess — but a diagnostic
    // that prints that guess as a passed check is the failure this release exists to end.
    const w = { id: 'w' }
    expect(isVisible(w)).toBe(true)
    expect(visibilityKnown(w)).toBe(false)
  })

  it('either field being present makes it known', () => {
    expect(visibilityKnown({ id: 'w', active: true })).toBe(true)
    expect(visibilityKnown({ id: 'w', hidden: false })).toBe(true)
  })
})
