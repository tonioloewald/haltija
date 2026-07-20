import { describe, it, expect } from 'bun:test'
import { shouldEmitWarning } from './warning-dedupe'

describe('shouldEmitWarning', () => {
  const COOLDOWN = 15_000

  it('emits the first occurrence', () => {
    const cache = new Map<string, number>()
    expect(shouldEmitWarning('W', cache, 1000, COOLDOWN)).toBe(true)
  })

  it('suppresses an identical warning within the cooldown', () => {
    const cache = new Map<string, number>()
    shouldEmitWarning('W', cache, 1000, COOLDOWN)
    expect(shouldEmitWarning('W', cache, 5000, COOLDOWN)).toBe(false) // 4s later, < 15s
  })

  it('re-arms after the cooldown elapses (never suppresses forever)', () => {
    const cache = new Map<string, number>()
    shouldEmitWarning('W', cache, 1000, COOLDOWN)
    expect(shouldEmitWarning('W', cache, 1000 + COOLDOWN + 1, COOLDOWN)).toBe(true)
  })

  it('never suppresses a DIFFERENT warning (changed condition warns immediately)', () => {
    const cache = new Map<string, number>()
    shouldEmitWarning('tab A hidden', cache, 1000, COOLDOWN)
    // a different tab / origin set produces different text → must warn even within the cooldown
    expect(shouldEmitWarning('tab B hidden', cache, 1500, COOLDOWN)).toBe(true)
  })

  it('slides the window: a re-emitted warning resets its own cooldown', () => {
    const cache = new Map<string, number>()
    shouldEmitWarning('W', cache, 1000, COOLDOWN) // emit @1000
    expect(shouldEmitWarning('W', cache, 1000 + COOLDOWN + 1, COOLDOWN)).toBe(true) // re-emit, resets to that time
    expect(shouldEmitWarning('W', cache, 1000 + COOLDOWN + 100, COOLDOWN)).toBe(false) // now suppressed again
  })

  it('prunes elapsed entries once the cache grows past the bound', () => {
    const cache = new Map<string, number>()
    // 70 distinct old warnings at t=0
    for (let i = 0; i < 70; i++) shouldEmitWarning(`old-${i}`, cache, 0, COOLDOWN)
    // a new warning well past the cooldown triggers the prune of the elapsed entries
    shouldEmitWarning('new', cache, COOLDOWN + 1, COOLDOWN)
    expect(cache.has('old-0')).toBe(false)
    expect(cache.has('new')).toBe(true)
  })
})
