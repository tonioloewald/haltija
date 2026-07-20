import { describe, it, expect } from 'bun:test'
// The helper is runtime CLI code in bin/; the test lives here so `bun test src/` (CI) covers it.
import { extractWindowTarget } from '../bin/arg-utils.mjs'

describe('extractWindowTarget', () => {
  it('pulls a LEADING --window (the documented escape hatch that was broken)', () => {
    // hj --window w2 eval "document.title"
    const { windowTarget, args } = extractWindowTarget(['--window', 'w2', 'eval', 'document.title'])
    expect(windowTarget).toBe('w2')
    expect(args).toEqual(['eval', 'document.title'])
  })

  it('pulls a TRAILING --window', () => {
    // hj eval "document.title" --window w2
    const { windowTarget, args } = extractWindowTarget(['eval', 'document.title', '--window', 'w2'])
    expect(windowTarget).toBe('w2')
    expect(args).toEqual(['eval', 'document.title'])
  })

  it('pulls a --window from the middle', () => {
    const { windowTarget, args } = extractWindowTarget(['click', '--window', 'w2', '42'])
    expect(windowTarget).toBe('w2')
    expect(args).toEqual(['click', '42'])
  })

  it('returns null when there is no --window', () => {
    const { windowTarget, args } = extractWindowTarget(['tree', '-d', '5'])
    expect(windowTarget).toBeNull()
    expect(args).toEqual(['tree', '-d', '5'])
  })

  it('leaves a trailing --window with no value in place (surfaces as an unknown flag, not a swallow)', () => {
    const { windowTarget, args } = extractWindowTarget(['eval', 'x', '--window'])
    expect(windowTarget).toBeNull()
    expect(args).toEqual(['eval', 'x', '--window'])
  })

  it('does not mutate the input array', () => {
    const input = ['--window', 'w2', 'tree']
    extractWindowTarget(input)
    expect(input).toEqual(['--window', 'w2', 'tree'])
  })
})
