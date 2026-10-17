import { describe, expect, it } from 'bun:test'
import { dialogPolicyError } from './dialog-policy'

describe('dialog policy values (#3274)', () => {
  it('accepts every value the widget acts on, including the opt-in "show"', () => {
    for (const p of [{ alert: 'show' }, { alert: 'dismiss' }, { confirm: 'show' }, { confirm: 'accept' },
      { prompt: 'show' }, { prompt: 'dismiss' }, { prompt: { response: 'x' } }, { beforeunload: 'block' }, {}]) {
      expect(dialogPolicyError(p)).toBeNull()
    }
  })
  // Assigned unchecked, a typo answered success and changed nothing.
  it('refuses a value it would not act on, and names the valid ones', () => {
    expect(dialogPolicyError({ alert: 'shwo' })).toContain('"dismiss", "show"')
    expect(dialogPolicyError({ confirm: true })).toContain('confirm must be')
    expect(dialogPolicyError({ prompt: 'my answer' })).toContain('{ "response": "text" }')
    expect(dialogPolicyError({ prompt: { response: 3 } })).toContain('prompt must be')
  })
})
