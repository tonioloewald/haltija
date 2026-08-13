/**
 * The agent-facing prompt has a SIZE BUDGET, and it may only ever ratchet DOWN.
 *
 * `SKILL.md` is loaded on every invocation of the skill. Every byte in it competes with the user's
 * actual task for context and for attention, and prompts do not decay on their own: each addition
 * is individually reasonable, nobody is ever assigned "delete something", and five years later it
 * is a manual. A ceiling converts that slow ratchet into an explicit decision — to add, you must
 * either earn it or remove something.
 *
 * This is the enforcement half of the `core` flag in `src/test-actions.ts`. Marking an item
 * non-core is what MOVES it out of here and into the generated reference, which is read on demand.
 * Without a gate, that flag is a suggestion.
 *
 * **The budget may be lowered, never raised.** If this fails, the fix is to cut — move an
 * enumeration into a generated reference block, delete an example that repeats another, or mark
 * something non-core. Raising the number is how the thing you were preventing happens.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')
const SKILL_PATH = join(ROOT, 'plugins/haltija-skill/skills/haltija/SKILL.md')

/**
 * Ceiling in bytes for the main prompt.
 *
 * History — keep appending, and only in one direction:
 *   2026-08-13  31_600  set at first measurement (31,304) with minimal headroom, when the step
 *                       action list became generated and core-gated.
 *   2026-08-13  28_600  after moving displaySurface / smallTarget / legendPath prose into the
 *                       schema (so it generates into API.md) and cutting the three largest caveat
 *                       blocks to rule-plus-pointer. The rule survives in the prompt; the incident
 *                       lives in CHANGELOG.md and code comments, where it already did.
 */
const SKILL_BUDGET_BYTES = 28_600

/** Rough tokens; 4 bytes/token is close enough for English prose to reason about. */
const approxTokens = (bytes: number) => Math.round(bytes / 4)

describe('the main prompt stays within budget', () => {
  it('SKILL.md is under the ceiling', () => {
    const bytes = readFileSync(SKILL_PATH, 'utf-8').length
    const headroom = SKILL_BUDGET_BYTES - bytes
    if (bytes > SKILL_BUDGET_BYTES) {
      throw new Error(
        `SKILL.md is ${bytes} bytes (~${approxTokens(bytes)} tokens), over the ${SKILL_BUDGET_BYTES} ` +
          `budget by ${-headroom}.\n\n` +
          `Do NOT raise the budget. Cut instead:\n` +
          `  - mark something non-core in src/test-actions.ts so it moves to the reference\n` +
          `  - move an enumeration into a <!-- GENERATED:… --> block in a reference doc\n` +
          `  - delete an example that repeats one already above it\n` +
          `The budget exists because every byte here is loaded on every invocation and competes ` +
          `with the user's actual task.`,
      )
    }
    expect(bytes).toBeLessThanOrEqual(SKILL_BUDGET_BYTES)
  })

  it('the budget is not vacuously generous — headroom stays tight', () => {
    // A ceiling far above actual usage enforces nothing. If this fails because the prompt SHRANK,
    // that is the good case: lower SKILL_BUDGET_BYTES to lock the win in.
    const bytes = readFileSync(SKILL_PATH, 'utf-8').length
    const headroom = SKILL_BUDGET_BYTES - bytes
    expect(headroom).toBeLessThan(2_000)
  })

  it('the generated block is present, so the list cannot silently go back to hand-maintained', () => {
    const body = readFileSync(SKILL_PATH, 'utf-8')
    expect(body).toContain('<!-- GENERATED:step-actions -->')
    expect(body).toContain('<!-- END:step-actions -->')
    // And it must actually have content between the markers — an empty block would pass a naive
    // presence check while documenting nothing.
    const between = body.slice(
      body.indexOf('<!-- GENERATED:step-actions -->'),
      body.indexOf('<!-- END:step-actions -->'),
    )
    expect(between.length).toBeGreaterThan(200)
    expect(between).toContain('`navigate`')
  })
})

describe('reference docs carry what the main prompt does not', () => {
  it('every non-core action is documented in the full reference', () => {
    // The core flag is only honest if the non-core half lands somewhere. Otherwise "not core"
    // silently means "undocumented", which is worse than a long prompt.
    const ci = join(ROOT, 'docs/CI-INTEGRATION.md')
    expect(existsSync(ci)).toBe(true)
    const body = readFileSync(ci, 'utf-8')
    for (const action of ['drag', 'verify', 'tabs-open', 'tabs-close', 'tabs-focus', 'check']) {
      expect(body).toContain(`\`${action}\``)
    }
  })
})
