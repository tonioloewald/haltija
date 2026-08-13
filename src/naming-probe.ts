/**
 * Does the NAME carry the intention? Measured on agents, not argued about.
 *
 * Documentation length is a symptom. If an action needs a paragraph before anyone can use it
 * correctly, the paragraph is compensating for a name that failed — and the durable fix is to
 * rename, not to write more prose. That claim is testable: show an agent the vocabulary with no
 * descriptions, give it a task, and see which word it reaches for.
 *
 * **The wrong answers are the finding, not the score.** A probe where every agent picks `select`
 * for "choose an option from a dropdown" is not a failure to be averaged away — it is a mandate,
 * because it says the word already means that to a competent reader and our meaning is the odd one
 * out. Read the distribution, not the percentage.
 *
 * Deliberately NOT a CI gate. It costs real model calls, it is non-deterministic, and a flaky
 * naming test would be disabled within a week. It is the thing you RUN, and read, when changing the
 * vocabulary — the same standing as the schematic head-to-head corpus.
 *
 * Two probe kinds, and the second is the one that catches collisions:
 *   - `cold-read`  — given only a name, what do you think it does?
 *   - `reach`      — given a task and the bare list of names, which would you use?
 */

export type ProbeKind = 'cold-read' | 'reach'

export interface Probe {
  kind: ProbeKind
  /** What the agent is asked. */
  prompt: string
  /** The answer that matches what the code actually does. */
  expected: string
  /**
   * For `cold-read`: the ideas the answer must contain, as lowercase substrings. ALL must appear.
   *
   * A cold-read answer is a free-form sentence, and comparing it to one canonical sentence is
   * hopeless — the first run scored three CORRECT answers as failures because they said the right
   * thing in different words. That is the mirror of the failure this file warns about: an
   * instrument that mis-scores launders the truth either way, and under-reporting is just as
   * useless as over-reporting. Keywords describe the IDEA, not the phrasing.
   */
  expectedKeywords?: string[]
  /**
   * Answers that reveal a specific confusion, mapped to what that confusion tells us.
   *
   * This is the payload of the whole exercise: a wrong answer that recurs is a named design
   * problem, not noise.
   */
  traps?: Record<string, string>
  /** Why this probe exists — shown in the report so a reader can judge the finding. */
  rationale: string
}

/**
 * The vocabulary shown to `reach` probes: names only, no descriptions.
 *
 * Deliberately the bare list. Showing summaries would measure whether our prose is clear, which we
 * already know how to fix. The question here is whether the WORD is clear.
 */
export const REACH_VOCABULARY = [
  'navigate', 'click', 'type', 'check', 'key', 'select', 'cut', 'copy', 'paste',
  'drag', 'wait', 'assert', 'eval', 'verify', 'tabs-open', 'tabs-close', 'tabs-focus',
]

export const PROBES: Probe[] = [
  {
    kind: 'reach',
    prompt: 'You need a step that confirms the page total reads "42". Which action do you use?',
    expected: 'assert',
    traps: {
      check: '`check` reads as a checking verb but toggles a checkbox — the wrong guess CLICKS something and passes',
      verify: '`verify` and `assert` are both checking verbs with nothing in either name to separate them',
    },
    rationale:
      'The dangerous collision: three checking verbs (check/assert/verify), only two of which check.',
  },
  {
    kind: 'reach',
    prompt: 'You need a step that ticks a checkbox. Which action do you use?',
    expected: 'check',
    traps: { click: 'a reasonable answer — if agents reach for `click`, `check` may not be earning its place' },
    rationale: 'The other half of the check collision: does anyone actually reach for it?',
  },
  {
    kind: 'reach',
    prompt:
      'You need a step that chooses "France" from a country dropdown (an HTML <select>). Which action do you use?',
    expected: '(none — haltija has no such action today)',
    traps: {
      select: '`select` means "dispatch a text-selection event" here. If agents reach for it, the name is mis-assigned',
    },
    rationale:
      'A capability gap AND a name collision at once: `select` is the natural word for the thing we cannot do.',
  },
  {
    kind: 'reach',
    prompt:
      'You need a step that polls until an expression settles on a value, failing if it never does. Which action do you use?',
    expected: 'verify',
    traps: { wait: '`wait` also polls — the boundary between wait/verify is not in either name' },
    rationale: 'Tests whether the wait/verify split is discoverable from the words alone.',
  },
  {
    kind: 'reach',
    prompt:
      'You need a step that makes subsequent untargeted commands go to a different already-open tab. Which action do you use?',
    expected: 'tabs-focus',
    rationale:
      '`tabs-focus` sounds like a browser action; it is really a server-side routing change that never dispatches.',
  },
  {
    kind: 'cold-read',
    prompt:
      'In a browser-automation test format, there is a step action called `check`. With no other information, what do you think it does?',
    expected: 'toggles a checkbox or radio',
    expectedKeywords: ['checkbox'],
    traps: {
      assert: 'read as an assertion — the exact misreading that produces a silent wrong action',
      verify: 'read as a verification step',
    },
    rationale: 'Direct measurement of whether `check` reads as "assert" to a naive reader.',
  },
  {
    kind: 'cold-read',
    prompt:
      'In a browser-automation test format, there is a step action called `select`. With no other information, what do you think it does?',
    expected: 'selects text within an element',
    expectedKeywords: ['text'],
    traps: { option: 'read as choosing an option from a <select> element — the natural meaning we do not implement' },
    rationale: 'Direct measurement of the `select` overload.',
  },
]

export interface ProbeResult {
  probe: Probe
  /** What the agent answered, normalised to a bare token where possible. */
  answer: string
  correct: boolean
  /** The trap this answer fell into, if any. */
  trap?: string
}

/** Normalise a free-text agent answer to a comparable token. */
export function normalizeAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[`"'.*]/g, '')
    .replace(/^the\s+|\s+action$|^action\s+/g, '')
    .trim()
}

/** Score one answer against a probe, naming the confusion when it matches a known trap. */
export function scoreAnswer(probe: Probe, raw: string): ProbeResult {
  const answer = normalizeAnswer(raw)
  const expected = normalizeAnswer(probe.expected)
  // A cold-read answer is prose, so match on containment; a reach answer should be one token.
  const correct =
    probe.kind === 'reach'
      ? answer === expected || answer.startsWith(expected + ' ')
      : probe.expectedKeywords
        ? probe.expectedKeywords.every((k) => answer.includes(k.toLowerCase()))
        : answer.includes(expected) || expected.includes(answer)
  let trap: string | undefined
  for (const [needle, meaning] of Object.entries(probe.traps ?? {})) {
    if (!correct && answer.includes(normalizeAnswer(needle))) {
      trap = meaning
      break
    }
  }
  return { probe, answer, correct, trap }
}

/**
 * Turn a set of results into the report a human reads.
 *
 * Groups by probe and shows the DISTRIBUTION of answers, because "3 of 5 agents said `select`" is
 * the finding — a single pass/fail percentage would hide exactly the signal this exists to surface.
 */
export function summarize(results: ProbeResult[]): string {
  const byPrompt = new Map<string, ProbeResult[]>()
  for (const r of results) {
    const key = r.probe.prompt
    byPrompt.set(key, [...(byPrompt.get(key) ?? []), r])
  }
  const lines: string[] = []
  for (const [prompt, rs] of byPrompt) {
    const probe = rs[0].probe
    const hits = rs.filter((r) => r.correct).length
    lines.push(`\n${probe.kind.toUpperCase()}  ${hits}/${rs.length} matched "${probe.expected}"`)
    lines.push(`  Q: ${prompt}`)
    lines.push(`  why: ${probe.rationale}`)
    const counts = new Map<string, number>()
    for (const r of rs) counts.set(r.answer, (counts.get(r.answer) ?? 0) + 1)
    for (const [ans, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      const t = rs.find((r) => r.answer === ans && r.trap)?.trap
      lines.push(`   ${String(n).padStart(2)}x ${ans}${t ? `   <- ${t}` : ''}`)
    }
  }
  return lines.join('\n')
}

/**
 * The `hj` command vocabulary — 70 names, none of which has ever been examined this way.
 *
 * Much larger surface than the step actions, with several clusters of near-synonyms that were named
 * at different times: the look-at-the-page verbs (`map`/`tree`/`query`/`find`/`inspect`), the
 * capture verbs (`screenshot`/`snapshot`), and the which-server verbs (`status`/`where`/`doctor`/
 * `servers`). Any of those could be fine; the point is that nobody knows, and after the step-action
 * run overturned three of four confident predictions, an untested intuition here is worth little.
 */
export const CLI_VOCABULARY = [
  'api', 'call', 'click', 'console', 'docs', 'doctor', 'drag', 'eval', 'events', 'fetch', 'find',
  'form', 'highlight', 'inspect', 'key', 'location', 'ls', 'map', 'navigate', 'network', 'query',
  'quit', 'recording', 'refresh', 'screenshot', 'scroll', 'send', 'servers', 'shutdown', 'snapshot',
  'stats', 'status', 'styles', 'tabs-close', 'tabs-focus', 'tabs-open', 'test-run', 'test-suite',
  'test-validate', 'tree', 'type', 'version', 'wait', 'where', 'windows',
]

export const CLI_PROBES: Probe[] = [
  {
    kind: 'reach',
    prompt:
      'You want a list of everything on the page you can interact with, and what each control is wired to. Which command?',
    expected: 'map',
    traps: {
      tree: '`tree` gives DOM structure, not affordances — if agents reach here, `map` is not announcing itself',
      inspect: '`inspect` is single-element deep detail',
    },
    rationale: 'Five commands look at the page; `map` is the one an agent is told to start from.',
  },
  {
    kind: 'reach',
    prompt:
      'You are driving an unfamiliar web page and want to orient yourself: what is on it, and what can you act on? Which single command do you run first?',
    expected: 'map',
    traps: {
      tree: 'wins on neutral wording — `tree` reads as "show me the page" more than `map` does',
      form: 'wins when the question mentions "controls" — the word pulls toward form fields',
    },
    rationale:
      'The same question as above with NEUTRAL wording. The first version said "controls" and got 3/3 `form`; ' +
      'this one avoids the word entirely, and still does not get `map`. Two framings, neither reaching the ' +
      'command every doc says to start from.',
  },
  {
    kind: 'reach',
    prompt:
      'You want to locate the element whose visible text is "Sign in" so you can click it. Which command?',
    expected: 'find',
    traps: { query: '`query` takes a CSS selector; `find` takes text — the split is not in either name' },
    rationale: 'find vs query is a distinction by ARGUMENT TYPE, which a name cannot easily carry.',
  },
  {
    kind: 'reach',
    prompt: 'You want to know which haltija server this shell will talk to, and why. Which command?',
    expected: 'where',
    traps: {
      status: '`status` reports the server you already resolved — it cannot tell you WHICH you resolved',
      servers: '`servers` lists all of them without saying which is yours',
    },
    rationale: 'Three commands answer overlapping questions about servers.',
  },
  {
    kind: 'reach',
    prompt:
      'Before a CI run, you want one command that fails if anything about the setup would make results untrustworthy. Which command?',
    expected: 'doctor',
    rationale: 'The command a lane should gate on. If it is not obvious, lanes gate on the wrong thing.',
  },
  {
    kind: 'reach',
    prompt: 'You want to capture the page state so you can compare against it later. Which command?',
    expected: 'snapshot',
    traps: { screenshot: 'snapshot/screenshot differ by one syllable and both mean "capture" to most readers' },
    rationale: 'The closest pair in the vocabulary.',
  },
  {
    kind: 'cold-read',
    prompt:
      'A browser-automation CLI has both a `snapshot` command and a `screenshot` command. With no other information, what do you think the difference is?',
    expected: 'snapshot captures page state/DOM; screenshot captures an image',
    expectedKeywords: ['snapshot', 'screenshot', 'image'],
    rationale: 'Whether the pair is self-explaining, or just two words for "capture".',
  },
  {
    kind: 'cold-read',
    prompt:
      'A browser-automation CLI has a `call` command and an `eval` command. With no other information, what do you think the difference is?',
    expected: 'call invokes a method or reads a property on an element; eval runs arbitrary JavaScript',
    expectedKeywords: ['call', 'eval', 'arbitrary'],
    rationale: '`call` is the least self-evident of the code-running verbs.',
  },
]
