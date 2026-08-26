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
import { ROUTED_COMMANDS, LOCAL_COMMANDS, cliNameForEndpoint } from './cli-commands'

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
  // Read the AUTHORITATIVE list rather than regex-parsing a file. (This was scraping a literal
  // array out of bin/cli-subcommand.mjs; when that became a derived Set the regex matched nothing —
  // caught only because the guard below asserts the parse found something. Importing removes the
  // failure mode entirely.)
  const KNOWN = [...ROUTED_COMMANDS]
  const LOCAL = [...LOCAL_COMMANDS]

  it('the command list is non-trivial (guards against an empty import silently passing everything)', () => {
    expect(KNOWN.length).toBeGreaterThan(20)
  })

  it('every endpoint-derived CLI name either exists or resolves to null', () => {
    // The root cause behind the broken hints: five endpoints derived `hj <name>` for commands the
    // CLI has never had, and printed them as remedies. cliNameForEndpoint now returns null for
    // those; this asserts nothing silently regains a fake name.
    const lying = ALL_ENDPOINTS
      .filter((ep) => (ep as any).visibility !== 'internal')
      .map((ep) => ({ path: ep.path, cli: cliNameForEndpoint(ep.path) }))
      .filter((x) => x.cli !== null && !KNOWN.includes(x.cli!) && !LOCAL.includes(x.cli as any))
    expect(lying).toEqual([])
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
    const missing = [...KNOWN, ...LOCAL]
      .filter((c) => !exempt.has(c))
      .filter((c) => !new RegExp(`\\bhj ${c}\\b`).test(SKILL) && !SKILL.includes(`\`${c}\``))
    expect(missing).toEqual([])
  })

  it('every command is discoverable in the CLI\'s own help', async () => {
    // `hj map` shipped absent from `hj --help` entirely, so the printed recovery ("Run `hj help`")
    // dead-ended. The gate checked SKILL.md and the generated docs but never the CLI itself.
    // Run the REAL CLI: `hj --help` is listSubcommands() plus a Lifecycle block, and testing only
    // the fragment would miss half the surface (and wrongly flag the half it can't see).
    const { execSync } = await import('child_process')
    const help = execSync(`node ${join(ROOT, 'bin/hj.mjs')} --help`, { encoding: 'utf-8' })
      .replace(/\x1b\[[0-9;]*m/g, '')
    // Aliases and plumbing an agent reaches via a parent command.
    const viaParent = new Set([
      'events-watch', 'events-unwatch', 'events-stats',
      'mutations-watch', 'mutations-unwatch', 'mutations-status',
      'network-watch', 'network-unwatch', 'network-stats',
      'video-start', 'video-stop', 'video-status',
      'recording-start', 'recording-stop', 'recording-generate',
      'select-start', 'select-cancel', 'select-clear', 'select-result',
      'send-message', 'send-selection', 'send-recording',
      'tabs-open', 'tabs-close', 'tabs-focus',
      'test-run', 'test-validate', 'test-suite',
      // Reached as `hj session attach|read|detach`, same shape as tabs-*/test-*.
      'session-attach', 'session-read', 'session-detach',
      'inspectAll', 'ls', 'quit', 'version', 'api', 'docs', 'stats', 'recordings',
    ])
    const missing = [...KNOWN, ...LOCAL]
      .filter((c) => !viaParent.has(c))
      .filter((c) => !new RegExp(`(^|\\s)${c}(\\s|$|\\[|<)`, 'm').test(help))
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
    ['declared origins', ['.haltija.json', 'HALTIJA_ORIGINS'], 'opt-in per-tab routing by declaration'],
  ]

  for (const [name, needles, why] of CONCEPTS) {
    it(`${name} is explained in the agent docs (${why})`, () => {
      const inSkill = needles.some((n) => SKILL.includes(n))
      const inLlms = needles.some((n) => LLMS.includes(n))
      expect(inSkill || inLlms).toBe(true)
    })
  }
})

describe('the MCP server ships the endpoints it claims', () => {
  /**
   * `apps/mcp/build/endpoints.json` is what the committed MCP server imports at runtime, and it had
   * drifted SEVEN MONTHS behind the generated `src/` copy — 43 entries against 63 — so anyone using
   * the MCP path got a haltija with no `/map`, `/find`, `/wait`, `/key` or `/call`.
   *
   * `docs-drift.yml` could not catch it: that gate asserts the build leaves the tree clean, and
   * nothing in the build wrote this file at all. A drift gate only covers what the build produces —
   * which is exactly the blind spot the pre-release review named.
   */
  const mcpSrc = join(ROOT, 'apps/mcp/src/endpoints.json')
  const mcpBuild = join(ROOT, 'apps/mcp/build/endpoints.json')

  it('the runtime copy matches the generated one', () => {
    const count = (p: string) => {
      const j = JSON.parse(readFileSync(p, 'utf-8'))
      return Array.isArray(j) ? j.length : Object.keys(j).length
    }
    expect(count(mcpBuild)).toBe(count(mcpSrc))
    expect(readFileSync(mcpBuild, 'utf-8')).toBe(readFileSync(mcpSrc, 'utf-8'))
  })

  it('carries the endpoints that were missing — not a vacuous count check', () => {
    const body = readFileSync(mcpBuild, 'utf-8')
    for (const p of ['/map', '/find', '/wait', '/key', '/call']) {
      expect(body).toContain(`"${p}"`)
    }
  })
})
