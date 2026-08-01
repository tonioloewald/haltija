/**
 * Docs-coverage gate: a capability nobody documented does not exist.
 *
 * `docs-drift.yml` already catches *generated* files being stale relative to the schema. It cannot
 * catch the failure that actually keeps happening: a new command or endpoint ships, the generated
 * artifacts regenerate cleanly (because the generator's hand-written prose never mentioned it), and
 * the feature is invisible to every agent. That's how `hj map`, `--canvas` and `hj shutdown` all
 * shipped undiscoverable — and issue #10 was filed precisely because a discoverable feature
 * (`:text()` selectors) was documented in the wrong place.
 *
 * So this asserts the *prose* keeps up with the surface, and fails loudly naming what to add.
 * Adding a command means adding a line about it — which is the rule CLAUDE.md already states and
 * that nothing enforced.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ALL_ENDPOINTS } from './api-schema'

const ROOT = join(import.meta.dir, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const SKILL = read('plugins/haltija-skill/skills/haltija/SKILL.md')
const DOCS = read('DOCS.md')
const LLMS = read('llms.txt')
const API = read('API.md')

/**
 * Endpoints that are deliberately not surfaced in the agent-facing prose: plumbing an agent never
 * calls directly. Anything NOT listed here must be findable. Keep this list short and justified —
 * it is the escape hatch, and a long escape hatch defeats the gate.
 */
const PROSE_EXEMPT = new Set([
  '/send', '/send/message', '/send/selection', '/send/recording', // widget→agent plumbing
  '/build', '/clear', '/messages', '/restart', '/shutdown', // server control, not page driving
  '/api', '/docs', '/endpoints', '/llms.txt', // discovery surfaces documenting themselves
])

describe('docs coverage: every endpoint is discoverable', () => {
  const publicEndpoints = ALL_ENDPOINTS.filter((ep) => (ep as any).visibility !== 'internal')

  it('every public endpoint appears in the generated API reference', () => {
    const missing = publicEndpoints
      .filter((ep) => !API.includes(`${ep.method} ${ep.path}`))
      .map((ep) => `${ep.method} ${ep.path}`)
    expect(missing).toEqual([])
  })

  it('every public endpoint is reachable from the agent-facing docs (llms.txt)', () => {
    // llms.txt lists endpoints by category, so the path should appear verbatim.
    const missing = publicEndpoints
      .filter((ep) => !PROSE_EXEMPT.has(ep.path))
      .filter((ep) => !LLMS.includes(ep.path))
      .map((ep) => ep.path)
    expect(missing).toEqual([])
  })
})

describe('docs coverage: every hj command is documented', () => {
  // The CLI's own list of what it accepts — the authority on the surface area.
  const KNOWN = (() => {
    const src = read('bin/cli-subcommand.mjs')
    const m = /export const KNOWN_COMMANDS = new Set\(\[([\s\S]*?)\]\)/.exec(src)
    if (!m) throw new Error('could not read KNOWN_COMMANDS from bin/cli-subcommand.mjs')
    return Array.from(m[1].matchAll(/'([^']+)'/g)).map((x) => x[1])
  })()

  // Commands handled directly in hj.mjs rather than routed (they never reach KNOWN_COMMANDS).
  const LOCAL_COMMANDS = ['where', 'servers', 'doctor', 'shutdown']

  it('KNOWN_COMMANDS was parsed (guards the regex above from silently matching nothing)', () => {
    expect(KNOWN.length).toBeGreaterThan(20)
  })

  it('every command an agent would drive is named in SKILL.md', () => {
    // Plumbing/aliases an agent is not expected to reach for directly.
    const exempt = new Set([
      'send', 'send-message', 'send-selection', 'send-recording',
      'version', 'api', 'docs', 'stats',
      'select-start', 'select-cancel', 'select-clear', 'select-result',
      'events-unwatch', 'mutations-unwatch', 'network-unwatch', 'network-stats',
      'events-stats', 'mutations-status', 'video-status', 'inspectAll',
      'test-validate', 'recordings', 'snapshot', 'unhighlight', 'location',
      'refresh', 'drag', 'scroll', 'call', 'fetch', 'styles',
      'video-start', 'video-stop', 'recording-generate',
    ])
    const missing = [...KNOWN, ...LOCAL_COMMANDS]
      .filter((c) => !exempt.has(c))
      .filter((c) => !new RegExp(`\\bhj ${c}\\b`).test(SKILL) && !SKILL.includes(`\`${c}\``))
    expect(missing).toEqual([])
  })

  it('the lifecycle commands are in the served quick-start (DOCS.md)', () => {
    // These are the ones a script author needs and cannot guess.
    for (const c of ['hj doctor', 'hj map', 'hj servers']) {
      expect(DOCS).toContain(c)
    }
  })
})

describe('docs coverage: headline capabilities are described, not just listed', () => {
  // A path in a list is not documentation. These are the capabilities whose *semantics* an agent
  // cannot guess from the name, so the prose has to actually explain them somewhere.
  const CONCEPTS: Array<[string, string[], string]> = [
    ['canvas capture', ['canvas'], 'reading canvas pixels needs no screen-share grant'],
    ['schematic fallback', ['schematic'], 'screenshot degrades to a labelled schematic'],
    ['agent surface', ['tosiAgent'], 'the native wiring tier of hj map'],
    ['strict mode', ['--strict', 'HALTIJA_STRICT'], 'warnings become non-zero exits'],
    ['readiness', ['ready'], '"server up" is not "server drivable"'],
  ]

  for (const [name, needles, why] of CONCEPTS) {
    it(`${name} is explained in the agent docs (${why})`, () => {
      const inSkill = needles.some((n) => SKILL.includes(n))
      const inLlms = needles.some((n) => LLMS.includes(n))
      expect(inSkill || inLlms).toBe(true)
    })
  }
})
