#!/usr/bin/env node
/**
 * Run the naming-intuition probes against fresh agents and print the distribution.
 *
 * NOT part of any test lane: it costs real model calls and is non-deterministic. Run it when you
 * are changing the vocabulary, read the answers, and decide. See src/naming-probe.ts for why the
 * wrong answers matter more than the score.
 *
 *   node tools/naming-probe.mjs            # 3 samples per probe
 *   node tools/naming-probe.mjs --n 5      # more samples = a clearer distribution
 *   node tools/naming-probe.mjs --dry-run  # print the prompts, call nothing
 *
 * Each sample is a SEPARATE `claude -p` invocation with no shared context, because the thing being
 * measured is a first impression. Reusing one session would let the first answer teach the rest.
 */
import { spawn } from 'child_process'
import { PROBES, CLI_PROBES, REACH_VOCABULARY, CLI_VOCABULARY, scoreAnswer, summarize } from '../src/naming-probe.ts'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const n = Number(args[args.indexOf('--n') + 1]) || 3
// Which surface: the test-step actions, or the `hj` command vocabulary.
const surface = args.includes('--cli') ? 'cli' : args.includes('--all') ? 'all' : 'steps'
const probeSet = surface === 'cli' ? CLI_PROBES : surface === 'all' ? [...PROBES, ...CLI_PROBES] : PROBES
const vocabFor = (probe) => (CLI_PROBES.includes(probe) ? CLI_VOCABULARY : REACH_VOCABULARY)

function buildPrompt(probe) {
  if (probe.kind === 'reach') {
    return (
      `Here is the complete command list of a browser-automation CLI:\n\n` +
      `${vocabFor(probe).join(', ')}\n\n${probe.prompt}\n\n` +
      `Answer with ONLY the action name, or the single word "none" if none fits. No explanation.`
    )
  }
  return `${probe.prompt}\n\nAnswer in one short sentence. No preamble.`
}

function ask(prompt) {
  return new Promise((resolve) => {
    // stdin must be closed, not merely ignored: `claude -p` waits 3s for piped input otherwise.
    const proc = spawn('claude', ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] })
    try { proc.stdin?.end() } catch {}
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('close', () => resolve(out.trim()))
    proc.on('error', () => resolve(''))
  })
}

const results = []
for (const probe of probeSet) {
  const prompt = buildPrompt(probe)
  if (dryRun) {
    console.log(`\n--- ${probe.kind} ---\n${prompt}`)
    continue
  }
  // Samples run concurrently; they are independent by construction.
  const answers = await Promise.all(Array.from({ length: n }, () => ask(prompt)))
  for (const a of answers) {
    if (!a) continue
    results.push(scoreAnswer(probe, a))
  }
  process.stderr.write('.')
}

if (!dryRun) {
  process.stderr.write('\n')
  console.log(summarize(results))
  console.log(
    `\nRead the DISTRIBUTION, not the score. A wrong answer that recurs is a naming problem: ` +
      `the word already means that to a competent reader, and ours is the odd meaning out.`,
  )
}
