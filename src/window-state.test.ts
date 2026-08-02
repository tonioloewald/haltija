import { describe, it, expect } from 'bun:test'
import { isTopLevelTab, isVisible, isVisibleTab, isDrivable, summarizeWindow } from './window-state'

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
