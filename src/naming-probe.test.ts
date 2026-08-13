/**
 * The scoring must be right before any answer it produces is worth reading.
 *
 * An instrument that mis-scores is worse than none: it would launder a naming problem into a clean
 * percentage, which is precisely the failure this repo keeps finding in itself.
 */
import { describe, it, expect } from 'bun:test'
import { PROBES, CLI_PROBES, scoreAnswer, normalizeAnswer, summarize } from './naming-probe'

const reach = PROBES.find((p) => p.kind === 'reach' && p.expected === 'assert')!
const coldCheck = PROBES.find((p) => p.kind === 'cold-read' && p.prompt.includes('`check`'))!

describe('normalizeAnswer', () => {
  it('strips the decoration an agent adds around a bare token', () => {
    expect(normalizeAnswer('`assert`')).toBe('assert')
    expect(normalizeAnswer('  ASSERT. ')).toBe('assert')
    expect(normalizeAnswer('the assert action')).toBe('assert')
  })
})

describe('scoreAnswer', () => {
  it('accepts the right answer', () => {
    expect(scoreAnswer(reach, 'assert').correct).toBe(true)
    expect(scoreAnswer(reach, '`assert`').correct).toBe(true)
  })

  it('names the confusion when an answer falls into a trap', () => {
    const r = scoreAnswer(reach, 'check')
    expect(r.correct).toBe(false)
    expect(r.trap).toContain('toggles a checkbox')
  })

  it('a wrong answer with no known trap is still wrong, just unexplained', () => {
    const r = scoreAnswer(reach, 'navigate')
    expect(r.correct).toBe(false)
    expect(r.trap).toBeUndefined()
  })

  it('cold-read matches on containment, since the answer is prose', () => {
    expect(scoreAnswer(coldCheck, 'It toggles a checkbox or radio button.').correct).toBe(true)
    const wrong = scoreAnswer(coldCheck, 'It asserts that something is true.')
    expect(wrong.correct).toBe(false)
    expect(wrong.trap).toContain('silent wrong action')
  })
})

describe('summarize', () => {
  it('reports the DISTRIBUTION, which is the actual finding', () => {
    const results = [
      scoreAnswer(reach, 'check'),
      scoreAnswer(reach, 'check'),
      scoreAnswer(reach, 'assert'),
    ]
    const out = summarize(results)
    expect(out).toContain('1/3')
    expect(out).toContain('2x check')
    // The trap explanation must survive into the report, or a reader sees a number and no cause.
    expect(out).toContain('toggles a checkbox')
  })
})

describe('cold-read scoring uses keywords, not sentence matching', () => {
  const snap = CLI_PROBES.find((p) => p.prompt.includes('`snapshot` command'))!

  it('accepts a correct answer phrased differently', () => {
    // These are VERBATIM answers from the first run, all scored 0 by the old containment matcher.
    for (const a of [
      'snapshot captures the DOM/page state as structured text an agent can read, while screenshot captures a pixel image',
      'snapshot captures the page\'s DOM/state as structured data (text you can query), while screenshot captures a pixel image of what it looks like',
    ]) {
      expect(scoreAnswer(snap, a).correct).toBe(true)
    }
  })

  it('still rejects an answer missing the distinguishing idea', () => {
    expect(scoreAnswer(snap, 'they both capture the page, more or less the same thing').correct).toBe(false)
  })
})
