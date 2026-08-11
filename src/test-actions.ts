/**
 * The legal `action` values for a test-suite step — ONE list, published and enforced.
 *
 * There was no such list. `hj api` documents the HTTP endpoints, which reads as though the same
 * verbs work as steps, and `/drag` is documented there — so a suite using `{"action": "drag"}` was
 * a perfectly reasonable thing to write, validated clean, and then failed in CI with "Unsupported
 * step action: drag" (issue #30). The capability existed; only the runner's switch didn't know.
 *
 * Two things follow from having the list here rather than implicit in a switch statement:
 *
 *  - `/test/validate` can reject an unknown action *before* a lane runs, which is where a typo or a
 *    verb-that-isn't-a-step should be caught. That is the whole point of a validate command.
 *  - `src/test-actions.test.ts` asserts this list and the runner's `switch (step.action)` contain
 *    exactly the same members. A step type added to one and not the other is the defect this
 *    release cycle keeps repeating — `/type`'s `ref`, `/map`'s parameters, `:text()` vs `/find`,
 *    the CLI's `hj wait` vs the runner's `wait`. A list nobody checks becomes wrong; a list a test
 *    checks stays true.
 */
export const TEST_STEP_ACTIONS = [
  'navigate',
  'click',
  'type',
  'check',
  'key',
  'select',
  'cut',
  'copy',
  'paste',
  'drag',
  'wait',
  'assert',
  'eval',
  'verify',
  'tabs-open',
  'tabs-close',
  'tabs-focus',
] as const

export type TestStepAction = (typeof TEST_STEP_ACTIONS)[number]

const ACTION_SET: ReadonlySet<string> = new Set(TEST_STEP_ACTIONS)

export function isTestStepAction(action: unknown): action is TestStepAction {
  return typeof action === 'string' && ACTION_SET.has(action)
}

/**
 * Static problems with one step — things knowable without a browser.
 *
 * Deliberately NOT a full schema check. It covers the two failures that reach CI looking like a
 * pass: an action the runner cannot dispatch, and a `wait` with nothing to wait for (which used to
 * be reported as a PASSING step, so a guard that had never waited for anything looked green).
 */
export function staticStepIssue(step: Record<string, unknown>): string | null {
  const action = step.action
  if (!isTestStepAction(action)) {
    const near = typeof action === 'string' ? nearest(action) : null
    return (
      `unknown step action ${JSON.stringify(action)}` +
      (near ? ` — did you mean "${near}"?` : '') +
      `. Legal actions: ${TEST_STEP_ACTIONS.join(', ')}. ` +
      `Note that an HTTP endpoint existing (see \`hj api\`) does not by itself make it a step.`
    )
  }
  if (action === 'wait') {
    const hasTarget =
      step.duration != null ||
      (step as { ms?: unknown }).ms != null ||
      step.selector != null ||
      step.forElement != null ||
      step.forWindow != null ||
      step.url != null
    if (!hasTarget) {
      return (
        'wait step has nothing to wait for — give it `duration` (ms), `selector` (or ' +
        '`forElement`), `forWindow: true`, or `url`. A wait that waits for nothing reports success ' +
        'and lets every later step race the page.'
      )
    }
  }
  return null
}

/** Closest legal action by edit distance, for a "did you mean" — only when it is genuinely close. */
function nearest(input: string): string | null {
  let best: string | null = null
  let bestScore = Infinity
  for (const a of TEST_STEP_ACTIONS) {
    const d = editDistance(input.toLowerCase(), a)
    if (d < bestScore) {
      bestScore = d
      best = a
    }
  }
  return bestScore <= 3 ? best : null
}

function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[n]
}
