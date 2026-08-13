/**
 * The published list of step actions and the runner's `switch (step.action)` must contain exactly
 * the same members.
 *
 * `hj drag` and `POST /drag` shipped; the runner had no `case 'drag'`, and `TestStep` didn't allow
 * it either — so a suite step failed with "Unsupported step action: drag" while `hj api` documented
 * `/drag` and `hj test validate` passed the file clean (#30).
 *
 * That is the fifth instance this release cycle of one idea with two registries and only one of
 * them updated: `/type`'s `ref`, `/map`'s parameters, `:text()` vs `/find`, the CLI's `hj wait` vs
 * the runner's `wait`, and now the runner's action list. Every one looked like a one-off. So this
 * checks the CLASS: derive the runner's cases from its source and compare to the exported list.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { TEST_STEP_ACTIONS, staticStepIssue, isTestStepAction, resolveStepAction, deprecationNotice, DEPRECATED_ACTION_ALIASES } from './test-actions'

const SERVER_SRC = readFileSync(join(import.meta.dir, 'server.ts'), 'utf-8')

/**
 * The `case '…':` labels inside the runner's step dispatcher, and only those.
 *
 * Bounded by brace-matching from `switch (step.action)`. Scraping every `case` in server.ts would
 * sweep up unrelated switches AND the nested `case 'eval'` that lives inside the assert handler —
 * a check whose findings name the wrong thing is worse than none.
 */
function runnerActions(): string[] {
  const marker = 'switch (step.action)'
  const start = SERVER_SRC.indexOf(marker)
  if (start === -1) throw new Error('runner switch not found — this guard has gone stale')
  const open = SERVER_SRC.indexOf('{', start)
  let depth = 0
  let end = SERVER_SRC.length
  for (let i = open; i < SERVER_SRC.length; i++) {
    const c = SERVER_SRC[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = SERVER_SRC.slice(open, end)
  // Top-level cases only: nested switches sit deeper, so track depth as we scan.
  const out: string[] = []
  let d = 0
  for (const line of body.split('\n')) {
    const m = /^\s*case '([^']+)':/.exec(line)
    if (m && d === 1) out.push(m[1])
    for (const ch of line) {
      if (ch === '{') d++
      else if (ch === '}') d--
    }
  }
  return [...new Set(out)]
}

describe('the runner and the published action list agree', () => {
  it('finds the runner switch and a plausible number of cases — not a vacuous check', () => {
    // If the brace-matching or the regex breaks, an empty list makes every assertion below
    // trivially true. That trap has been sprung repeatedly in this repo.
    const found = runnerActions()
    expect(found.length).toBeGreaterThan(10)
    expect(found).toContain('click')
  })

  it('every action the runner dispatches is published', () => {
    const undocumented = runnerActions().filter((a) => !TEST_STEP_ACTIONS.includes(a as never))
    expect(undocumented).toEqual([])
  })

  it('every published action is actually dispatchable — including drag', () => {
    // The direction that broke: `drag` was documented as an endpoint, usable from the CLI, and
    // simply absent from the runner.
    const cases = runnerActions()
    const missing = TEST_STEP_ACTIONS.filter((a) => !cases.includes(a))
    expect(missing).toEqual([])
    expect(cases).toContain('drag')
  })
})

describe('static step validation catches what used to reach CI as a pass', () => {
  it('rejects an unknown action, and suggests a near miss', () => {
    const issue = staticStepIssue({ action: 'drg', selector: '.x' })
    expect(issue).toContain('unknown step action')
    expect(issue).toContain('did you mean "drag"')
  })

  it('names the legal actions, since there was nowhere else to look them up', () => {
    expect(staticStepIssue({ action: 'nope' })).toContain('tabs-focus')
  })

  it('a wait with nothing to wait for is an ERROR, not a silently passing guard', () => {
    // {"action":"wait","forElement":"tbody tr","timeout":10000} used to report PASS having waited
    // for nothing, so every assertion after it raced the page.
    expect(staticStepIssue({ action: 'wait', timeout: 10000 })).toContain('nothing to wait for')
  })

  it('accepts every form of wait the runner actually honours', () => {
    for (const step of [
      { action: 'wait', duration: 100 },
      { action: 'wait', ms: 100 },
      { action: 'wait', selector: '.x' },
      { action: 'wait', forElement: '.x' },
      { action: 'wait', forWindow: true },
      { action: 'wait', url: '/done' },
    ]) {
      expect(staticStepIssue(step)).toBeNull()
    }
  })

  it('passes a legal step', () => {
    expect(staticStepIssue({ action: 'drag', selector: '.thumb', deltaX: 50 })).toBeNull()
    expect(isTestStepAction('drag')).toBe(true)
    expect(isTestStepAction('dragon')).toBe(false)
  })
})

describe('deprecated action aliases', () => {
  it('an alias resolves to its canonical action', () => {
    expect(resolveStepAction('select')).toEqual({ action: 'select-text', deprecatedFrom: 'select' })
  })

  it('a canonical action passes through untouched', () => {
    expect(resolveStepAction('click')).toEqual({ action: 'click' })
    expect(resolveStepAction('select-text')).toEqual({ action: 'select-text' })
  })

  it('an alias still validates — old suites must not start failing', () => {
    expect(staticStepIssue({ action: 'select', selector: '#note' })).toBeNull()
  })

  it('checks that apply to the canonical action apply THROUGH the alias', () => {
    // Resolution happens before validation, so a rename cannot create a hole where a rule stops
    // being enforced for anyone still using the old spelling.
    expect(staticStepIssue({ action: 'wait' })).toContain('nothing to wait for')
  })

  it('the notice names the replacement, and says the old name is being reused', () => {
    const msg = deprecationNotice('select', 'select-text')
    expect(msg).toContain('`select-text`')
    expect(msg).toContain('freed for a different meaning')
  })

  /**
   * THE INVARIANT THAT MAKES THE PLAN SAFE.
   *
   * `select` is being freed so it can later mean "pick an option from a <select>". If it were ever
   * registered as a live action while still aliased, the same word would mean two things depending
   * on vintage — a silent wrong action, which is the exact failure the rename exists to remove.
   * Reusing the name requires DELETING the alias first, and this test is what forces that order.
   */
  it('no alias may shadow a live action', () => {
    const live = new Set(TEST_STEP_ACTIONS as readonly string[])
    const shadowed = Object.keys(DEPRECATED_ACTION_ALIASES).filter((a) => live.has(a))
    expect(shadowed).toEqual([])
  })

  it('every alias points at an action that exists', () => {
    const live = new Set(TEST_STEP_ACTIONS as readonly string[])
    const dangling = Object.entries(DEPRECATED_ACTION_ALIASES)
      .filter(([, to]) => !live.has(to))
      .map(([from, to]) => `${from} -> ${to}`)
    expect(dangling).toEqual([])
  })
})

describe('the recorder cannot emit an illegal or deprecated action', () => {
  /**
   * The fourth vocabulary, and the one no guard was watching.
   *
   * `eventsToTest()` in component.ts is a PRODUCER of steps, and it emitted `set` — which is not a
   * step action at all, so recorded suites died with "Unsupported step action: set" — and `select`
   * for dropdowns, which resolves to `select-text` and dispatches a text-selection event at the
   * <select>: the step PASSES having chosen nothing. Both predate this release; what this release
   * nearly shipped was a CHANGELOG line and a code comment claiming they were fixed when only one
   * of the two emitters had been touched.
   *
   * `no alias may shadow a live action` could not see this: it compares the alias table to the
   * action list and never looks at a producer. Checking one direction of a triangle is not checking
   * the triangle.
   */
  const COMPONENT_SRC = readFileSync(join(import.meta.dir, 'component.ts'), 'utf-8')

  /** Action literals assigned or pushed inside the recorder's event→step conversion. */
  function recorderActions(): string[] {
    const start = COMPONENT_SRC.indexOf('private eventsToTest(')
    expect(start).toBeGreaterThan(-1)
    // The conversion runs to the end of the function; bound generously and rely on the literal
    // shapes below rather than trying to brace-match a large function.
    const body = COMPONENT_SRC.slice(start, start + 40_000)
    const out = new Set<string>()
    for (const m of body.matchAll(/\baction:\s*'([a-z-]+)'/g)) out.add(m[1])
    for (const m of body.matchAll(/\binputAction\s*=\s*'([a-z-]+)'/g)) out.add(m[1])
    return [...out]
  }

  it('finds the recorder emitters — not a vacuous check', () => {
    const found = recorderActions()
    expect(found.length).toBeGreaterThan(3)
    expect(found).toContain('click')
  })

  it('every action the recorder emits is a legal action', () => {
    const illegal = recorderActions().filter((a) => !isTestStepAction(a))
    expect(illegal).toEqual([])
  })

  it('the recorder never emits a DEPRECATED spelling — a new recording must not be born stale', () => {
    const deprecated = recorderActions().filter((a) => a in DEPRECATED_ACTION_ALIASES)
    expect(deprecated).toEqual([])
  })
})
