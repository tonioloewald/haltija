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
import { TEST_STEP_ACTIONS, staticStepIssue, isTestStepAction } from './test-actions'

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
