#!/usr/bin/env node
/**
 * Haltija CLI subcommand handler
 * 
 * Translates CLI subcommands to REST API calls:
 *   haltija tree              → GET /tree
 *   haltija click 42          → POST /click {"ref":"42"}
 *   haltija click "#btn"      → POST /click {"selector":"#btn"}
 *   haltija type 10 "hello"   → POST /type {"ref":"10","text":"hello"}
 *   haltija eval "1+1"        → POST /eval {"code":"1+1"}
 *   haltija navigate "url"    → POST /navigate {"url":"..."}
 *   haltija key Enter         → POST /key {"key":"Enter"}
 *   haltija status            → GET /status
 *   haltija docs              → GET /docs
 * 
 * Also available as: hj tree, hj click 42, etc.
 */

import { spawn } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { formatTree } from './format-tree.mjs'
import { formatEvents } from './format-events.mjs'
import { formatTestResult, formatSuiteResult } from './format-test.mjs'
import { formatNetwork, formatNetworkStats } from './format-network.mjs'
import { substituteGeneratedVars } from './test-data.mjs'
import { HJ_VERSION } from './version.mjs'
import { differsBeyondPatch } from './semver.mjs'
import { ROUTED_COMMANDS, LOCAL_COMMANDS } from './cli-commands.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Command hints — generated from api-schema.ts during build and IMPORTED, not read from disk.
// Reading a sibling hints.json works for the npm package but not for dist/hj.js installed as a lone
// file in ~/.local/bin, so the standalone CLI silently had no hints while claiming the same version
// (issue #14). An import is inlined by the bundler, so both distributions behave identically.
export { COMMAND_HINTS, COMMAND_SUMMARIES } from './hints.mjs'
import { COMMAND_HINTS as COMMAND_HINTS_LOCAL } from './hints.mjs'

let warnedAboutSkew = false

/**
 * Warn when this hj is meaningfully out of step with the server it just talked to.
 *
 * `hj` is ONE global binary driving MANY per-project servers, so some version skew is
 * the normal steady state, not a fault: a project pinned to haltija 1.4.0 while the
 * CLI is 1.4.2 is fine, and no action the user takes can make those numbers match.
 *
 * So warn only when the versions differ by more than a patch — that's when hj can
 * actually lack a resolution rule or response shape the server assumes. Warning on
 * exact mismatch would fire forever, on every command, with a remedy
 * (`bun install -g haltija@latest`) that cannot fix it. And a warning that always
 * fires is one that gets ignored — including the times it's real. SKILL.md tells
 * agents to *trust* this warning, so it has to be worth trusting.
 *
 * Once per process, on stderr (so `--json` stdout stays machine-readable).
 * `HALTIJA_NO_SKEW_WARN=1` silences it.
 */
function warnOnVersionSkew(resp) {
  if (warnedAboutSkew) return
  if (process.env.HALTIJA_NO_SKEW_WARN === '1') return
  const serverVersion = resp.headers?.get?.('X-Haltija-Version')
  if (!serverVersion) return
  if (!differsBeyondPatch(serverVersion, HJ_VERSION)) return
  warnedAboutSkew = true
  console.error(`hj: warning — hj ${HJ_VERSION} is driving haltija server ${serverVersion}.`)
  console.error(`hj: that gap is wide enough to route or format wrongly. This hj is ${process.argv[1]}`)
  console.error(`hj: silence with HALTIJA_NO_SKEW_WARN=1`)
}

// Endpoints that use GET (everything else is POST)
export const GET_ENDPOINTS = new Set([
  'location', 'events', 'console', 'windows', 'recordings',
  'status', 'version', 'docs', 'api', 'stats', 'network'
])

// Compound paths (subcommand contains slash) or aliases to different endpoint
export const COMPOUND_PATHS = {
  'styles': '/inspect',  // Shortcut: hj styles <selector> → /inspect with matchedRules
  'mutations-watch': '/mutations/watch',
  'mutations-unwatch': '/mutations/unwatch',
  'mutations-status': '/mutations/status',
  'events-watch': '/events/watch',
  'events-unwatch': '/events/unwatch',
  'events-stats': '/events/stats',
  'select-start': '/select/start',
  'select-cancel': '/select/cancel',
  'select-status': '/select/status',
  'select-result': '/select/result',
  'select-clear': '/select/clear',
  'tabs-open': '/tabs/open',
  'tabs-close': '/tabs/close',
  'tabs-focus': '/tabs/focus',
  'video-start': '/video/start',
  'video-stop': '/video/stop',
  'video-status': '/video/status',
  'recording-start': '/recording/start',
  'recording-stop': '/recording/stop',
  'recording-generate': '/recording/generate',
  'test-run': '/test/run',
  'test-suite': '/test/suite',
  'test-validate': '/test/validate',
  'send-message': '/send/message',
  'send-selection': '/send/selection',
  'send-recording': '/send/recording',
  'network-watch': '/network/watch',
  'network-unwatch': '/network/unwatch',
  'network-stats': '/network/stats',
}

// GET compound endpoints
export const GET_COMPOUND = new Set([
  'mutations-status', 'events-stats', 'select-status', 'select-result', 'video-status',
  'network-stats'
])

// How to map positional args to body fields for each endpoint
/**
 * `--preset x` or a bare `x`, with a fallback.
 *
 * Taking `args[0]` blindly turned `--preset interactive` into `{preset:'--preset'}` — which the
 * server accepted, failed to look up, and reported success for. A wrong answer delivered as a
 * success is worse than an error, so anything that isn't a flag is treated as the value and a
 * dangling `--preset` with nothing after it falls back rather than sending `undefined`.
 */
export function presetArg(args, fallback) {
  const i = args.indexOf('--preset')
  const value = i !== -1 ? args[i + 1] : args.find((a) => !a.startsWith('-'))
  return value && !value.startsWith('-') ? value : fallback
}

/**
 * Split `args` into the flags a command declares and everything else.
 *
 * Eight commands advertised flags in `hj <cmd> --help` that no parser ever read — `--all`,
 * `--clear`, `--humanlike`, `--repeat`, `--duration`, `--label`, `--color`, `--args`. The endpoints
 * accept every one of them; only the CLI dropped them. `hj type 10 "hello" --clear` was the worst:
 * text is `args.slice(1).join(' ')`, so the flag became part of the typed string and the user got
 * the literal characters "hello --clear".
 *
 * `spec` maps a flag to how to read it: 'bool' (presence), 'num', 'str', or 'json'. Returns the
 * parsed flags plus the untouched positional arguments.
 */
export function takeFlags(args, spec) {
  const flags = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    // `--` ends flag parsing; everything after it is literal. The escape hatch for commands whose
    // payload is free text — `hj type 10 -- --clear` types the characters "--clear" rather than
    // setting the clear flag and typing nothing, which is what it did once these commands gained
    // KNOWN_FLAGS entries. Without an escape there is no way to express the literal at all.
    if (a === '--') { positional.push(...args.slice(i + 1)); break }
    const kind = spec[a]
    if (!kind) { positional.push(a); continue }
    if (kind === 'bool') {
      // `--humanlike false` is the documented form, so accept an explicit boolean after it.
      const next = args[i + 1]
      if (next === 'true' || next === 'false') { flags[spec[a + ':name'] || a.slice(2)] = next === 'true'; i++ }
      else flags[spec[a + ':name'] || a.slice(2)] = true
      continue
    }
    const value = args[++i]
    if (value === undefined) continue
    const name = spec[a + ':name'] || a.slice(2)
    flags[name] = kind === 'num' ? num(value) : kind === 'json' ? tryParseJSON(value) : value
  }
  return { flags, positional }
}

export const ARG_MAPS = {
  click: (args) => parseClickArgs(args),
  type: (args) => {
    // Flags first, so an advertised `--clear` stops being typed as literal text.
    const { flags, positional } = takeFlags(args, { '--clear': 'bool', '--humanlike': 'bool' })
    return { ...parseTargetArgs(positional.slice(0, 1)), text: positional.slice(1).join(' '), ...flags }
  },
  key: (args) => {
    const { flags, positional } = takeFlags(args, { '--repeat': 'num' })
    return { key: positional[0], ...parseModifiers(positional.slice(1)), ...flags }
  },
  drag: (args) => {
    const { flags, positional } = takeFlags(args, { '--duration': 'num' })
    return { ...parseTargetArgs(positional.slice(0, 1)), deltaX: num(positional[1]), deltaY: num(positional[2]), ...flags }
  },
  scroll: (args) => {
    const { flags, positional } = takeFlags(args, { '--duration': 'num' })
    return { ...parseScrollArgs(positional), ...flags }
  },
  navigate: (args) => ({ url: args[0] }),
  eval: (args) => ({ code: args.join(' ') }),
  query: (args) => {
    const { flags, positional } = takeFlags(args, { '--all': 'bool' })
    return { selector: positional[0], ...flags }
  },
  inspect: (args) => parseInspectArgs(args),
  'inspectAll': (args) => parseInspectArgs(args),
  styles: (args) => ({ ...parseTargetArgs(args), matchedRules: true }),
  tree: (args) => parseTreeArgs(args),
  highlight: (args) => {
    const { flags, positional } = takeFlags(args, { '--label': 'str', '--color': 'str', '--duration': 'num' })
    // The positional second arg is still the label — the documented `hj highlight 5 "Problem here"`.
    return { ...parseTargetArgs(positional.slice(0, 1)), ...(positional[1] ? { label: positional[1] } : {}), ...flags }
  },
  unhighlight: () => ({}),
  find: (args) => ({ text: args.join(' ') }),
  form: (args) => parseFormArgs(args),
  wait: (args) => parseWaitArgs(args),
  call: (args) => {
    const { flags, positional } = takeFlags(args, { '--args': 'json' })
    const rest = positional.slice(2).map(tryParseJSON)
    return {
      ...parseTargetArgs(positional.slice(0, 1)),
      method: positional[1],
      // `--args '[1,2]'` wins over trailing positionals; both forms are documented.
      args: flags.args !== undefined ? (Array.isArray(flags.args) ? flags.args : [flags.args]) : rest,
    }
  },
  fetch: (args) => ({ url: args[0], prompt: args.slice(1).join(' ') || undefined }),
  screenshot: (args) => {
    const body = { file: true }
    const positional = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === '--data-url') { body.file = false; continue }
      if (a === '--format') { body.format = args[++i]; continue }
      if (a === '--quality') {
        // Accept both 0–1 (canvas-native) and 0–100 (documented) — normalize
        // anything > 1 down to the 0–1 the widget's toDataURL expects.
        const q = num(args[++i])
        if (q != null && !Number.isNaN(q)) body.quality = q > 1 ? q / 100 : q
        continue
      }
      if (a === '--scale') { body.scale = num(args[++i]); continue }
      if (a === '--maxWidth' || a === '--max-width') { body.maxWidth = num(args[++i]); continue }
      if (a === '--maxHeight' || a === '--max-height') { body.maxHeight = num(args[++i]); continue }
      if (a === '--delay') { body.delay = num(args[++i]); continue }
      if (a === '--no-chyron') { body.chyron = false; continue }
      // Read a <canvas>'s own pixels (WebGL/2D) instead of capturing the screen: exact pixels, no
      // screen-share grant, works off-screen. The route for 3D scenes / render-to-texture UI.
      if (a === '--canvas') {
        // Bare `--canvas` (no selector) captures the largest canvas on the page — which is
        // unambiguous when there's one interesting canvas, the common case.
        const next = args[i + 1]
        body.canvas = next && !next.startsWith('-') ? args[++i] : ''
        continue
      }
      // Hard-fail instead of returning a labelled schematic when pixels aren't capturable.
      if (a === '--no-fallback') { body.fallback = false; continue }
      // Prefer the schematic outright: cheaper, deterministic, and it carries the contrast audit.
      if (a === '--schematic') { body.schematic = true; continue }
      if (!a.startsWith('-')) { positional.push(a) }
    }
    return { ...body, ...parseTargetArgs(positional) }
  },
  map: (args) => {
    const body = {}
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--global') { body.global = args[++i]; continue }
      if (args[i] === '--max-nodes') { body.maxNodes = num(args[++i]); continue }
      // Rasterized schematic. Must be a BITMAP to earn the vision-encoder discount — SVG markup
      // sent to a model is just text tokens, and worse than the JSON it replaces.
      if (args[i] === '--image' || args[i] === '--png') { body.image = true; continue }
      if (args[i] === '--data-url') { body.file = false; continue }
      if (args[i] === '--scale') { body.scale = num(args[++i]); continue }
      // The schematic's sizing/encoding options. `/map` accepts these — after they spent several
      // releases declared nowhere and silently dropped by the handler — so the CLI must be able to
      // pass them, or the same parameter is once again reachable at one layer and not the next.
      // Both spellings, matching `hj screenshot`, which already accepts --maxWidth and --max-width.
      if (args[i] === '--maxWidth' || args[i] === '--max-width') { body.maxWidth = num(args[++i]); continue }
      if (args[i] === '--maxHeight' || args[i] === '--max-height') { body.maxHeight = num(args[++i]); continue }
      if (args[i] === '--format') { body.format = args[++i]; continue }
      if (args[i] === '--quality') { body.quality = num(args[++i]); continue }
    }
    return body
  },
  snapshot: (args) => ({ context: args.join(' ') || undefined }),
  select: (args) => ({ action: args[0] }),
  'select-start': () => ({}),
  'select-cancel': () => ({}),
  'select-clear': () => ({}),
  refresh: (args) => (args.includes('--soft') ? { soft: true } : {}),
  'tabs-open': (args) => ({ url: args[0] }),
  'tabs-close': (args) => ({ window: args[0] }),
  'tabs-focus': (args) => ({ window: args[0] }),
  'video-start': (args) => {
    const body = {}
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--maxDuration' || args[i] === '--max-duration') body.maxDuration = num(args[++i])
    }
    return body
  },
  'video-stop': () => ({}),
  'events-watch': (args) => ({ preset: presetArg(args, 'interactive') }),
  // These two had the ORIGINAL args[0] bug still in them, one line below the comment describing the
  // fix — `hj mutations-watch --preset smart` sent preset:'--preset', `FILTER_PRESETS[preset]` came
  // back undefined, and the user got a success response with silently wrong filtering. Fixing one
  // instance of a footgun and leaving its neighbours is how a bug survives its own postmortem, so
  // the parse is now one function all three share.
  'mutations-watch': (args) => ({ preset: presetArg(args, 'smart') }),
  'network-watch': (args) => ({ preset: presetArg(args, 'standard') }),
  // send <agent> <message> or send selection/recording
  // --no-submit flag prevents auto-submit (paste only)
  'test-run': (args) => {
    if (!args.length) { console.error('Usage: hj test-run <file.json> [--vars JSON] [--seed N] [--timeoutMs N] [--allow-failures N]'); process.exit(1) }
    const { files, options, vars } = parseTestArgs(args)
    if (!files.length) { console.error('Usage: hj test-run <file.json>'); process.exit(1) }
    const { seed, ...restOptions } = options
    return { ...readTestFile(files[0], vars, seed), ...restOptions }
  },
  'test-validate': (args) => {
    if (!args.length) { console.error('Usage: hj test-validate <file.json> [--vars JSON]'); process.exit(1) }
    const { files, vars, options } = parseTestArgs(args)
    if (!files.length) { console.error('Usage: hj test-validate <file.json>'); process.exit(1) }
    return readTestFile(files[0], vars, options.seed)
  },
  'test-suite': (args) => {
    if (!args.length) { console.error('Usage: hj test-suite <dir|file...> [--vars JSON] [--seed N] [--timeoutMs N] [--allow-failures N]'); process.exit(1) }
    const { files: rawFiles, options, vars } = parseTestArgs(args)
    const files = expandTestFiles(rawFiles)
    if (!files.length) { console.error('Error: No test files found'); process.exit(1) }
    const { seed, ...restOptions } = options
    const tests = files.map(f => readTestFile(f, vars, seed).test)
    return { tests, ...restOptions }
  },
  'send-message': (args) => {
    const noSubmit = args.includes('--no-submit')
    const filtered = args.filter(a => a !== '--no-submit')
    return { agent: filtered[0], message: filtered.slice(1).join(' '), submit: !noSubmit }
  },
  'send-selection': (args) => {
    const noSubmit = args.includes('--no-submit')
    const filtered = args.filter(a => a !== '--no-submit')
    return { agent: filtered[0], submit: !noSubmit }
  },
  'send-recording': (args) => {
    const noSubmit = args.includes('--no-submit')
    const filtered = args.filter(a => a !== '--no-submit')
    return { agent: filtered[0], description: filtered.slice(1).join(' ') || undefined, submit: !noSubmit }
  },
  // hj recording <action> [name|id]
  // hj recording start [name]
  // hj recording stop
  // hj recording list
  // hj recording replay <id|index>
  // hj recording generate [name]
  'recording': (args) => {
    const action = args[0] || 'status'
    if (action === 'replay') {
      return { action, id: args[1] }
    }
    if (action === 'generate' || action === 'start') {
      return { action, name: args.slice(1).join(' ') || undefined }
    }
    return { action }
  },
}

/** Parse a target argument — @ref number or selector */
export function parseTargetArgs(args) {
  if (!args.length || !args[0]) return {}
  const target = args[0]
  // @42 or plain 42 → ref
  if (/^@?\d+$/.test(target)) return { ref: target.replace('@', '') }
  // Everything else is a selector
  return { selector: target }
}

/** Parse tree-specific args */
export function parseTreeArgs(args) {
  const body = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--depth' || a === '-d') { body.depth = num(args[++i]); continue }
    if (a === '--selector' || a === '-s') { body.selector = args[++i]; continue }
    if (a === '--compact' || a === '-c') { body.compact = true; continue }
    if (a === '--interactive' || a === '-i') { body.interactiveOnly = true; continue }
    if (a === '--visible' || a === '-v') { body.visibleOnly = true; continue }
    if (a === '--text') { body.includeText = true; continue }
    if (a === '--no-text') { body.includeText = false; continue }
    if (a === '--shadow') { body.pierceShadow = true; continue }
    if (a === '--frames') { body.pierceFrames = true; continue }
    if (a === '--no-frames') { body.pierceFrames = false; continue }
    // First positional arg is selector if present
    if (!a.startsWith('-')) { body.selector = a; continue }
  }
  return Object.keys(body).length ? body : undefined
}

/** Parse scroll args */
export function parseScrollArgs(args) {
  if (!args.length) return {}
  const first = args[0]
  if (first.startsWith('.') || first.startsWith('#') || first.startsWith('[')) {
    return { selector: first }
  }
  // deltaX deltaY
  if (args.length >= 2 && !isNaN(args[0]) && !isNaN(args[1])) {
    return { deltaX: num(args[0]), deltaY: num(args[1]) }
  }
  // Just deltaY
  if (!isNaN(first)) return { deltaY: num(first) }
  return parseTargetArgs(args)
}

/** Parse wait args: selector or ms */
export function parseWaitArgs(args) {
  if (!args.length) return { ms: 1000 }
  // Flags parsed as flags. `timeout` used to be read positionally as args[1], so
  // `hj wait ".modal" --timeout 5000` sent timeout: NaN (Number('--timeout')), and
  // `hj wait --selector "#foo"` took the flag NAME as the selector.
  const flags = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--timeout' && args[i + 1] !== undefined) { flags.timeout = num(args[++i]); continue }
    if (a === '--poll-interval' && args[i + 1] !== undefined) { flags.pollInterval = num(args[++i]); continue }
    if (a === '--hidden') { flags.hidden = true; continue }
    if (a === '--selector' && args[i + 1] !== undefined) { positional.push(args[++i]); continue }
    if (a.startsWith('-')) continue // unknown flag — warnUnknownFlags reports it
    positional.push(a)
  }
  const first = positional[0]
  if (first === undefined) return { ms: 1000, ...flags }
  if (!isNaN(first)) return { ms: num(first), ...flags }
  // A numeric SECOND positional is still a timeout: `hj wait .loading 10000` is the form
  // docs/agent-prompt.md documents, and dropping it silently would be the same class of bug this
  // whole fix is about — an argument accepted and ignored. An explicit --timeout wins.
  const positionalTimeout =
    positional[1] !== undefined && !isNaN(positional[1]) ? num(positional[1]) : undefined
  // `selector` is what the endpoint accepts as an alias for forElement; send the canonical name so
  // the request is self-describing on the wire.
  const target = parseTargetArgs([first])
  const body = target.selector !== undefined ? { forElement: target.selector } : { ...target }
  if (positionalTimeout !== undefined) body.timeout = positionalTimeout
  return { ...body, ...flags }
}

/** Parse click args: selector/ref + --diff flag + --delay */
export function parseClickArgs(args) {
  const body = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--diff') { body.diff = true; continue }
    if (a === '--delay' && args[i + 1]) { body.diffDelay = num(args[++i]); continue }
    if (!a.startsWith('-')) { positional.push(a); continue }
  }
  // First positional is target (ref or selector)
  if (positional.length) {
    const target = positional[0]
    if (/^@?\d+$/.test(target)) {
      body.ref = target.replace('@', '')
    } else {
      body.selector = target
    }
  }
  return Object.keys(body).length ? body : {}
}

/** Parse form args: optional form selector + --include-disabled/--include-hidden */
export function parseFormArgs(args) {
  const body = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--include-disabled') { body.includeDisabled = true; continue }
    if (a === '--include-hidden') { body.includeHidden = true; continue }
    if (!a.startsWith('-')) { positional.push(a); continue }
  }
  if (positional.length) body.selector = positional[0]
  return Object.keys(body).length ? body : undefined
}

/** Parse inspect args: selector/ref + CSS flags */
export function parseInspectArgs(args) {
  const body = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--full-styles' || a === '--styles') { body.fullStyles = true; continue }
    if (a === '--matched-rules' || a === '--rules') { body.matchedRules = true; continue }
    if (a === '--ancestors') { body.ancestors = true; continue }
    if (!a.startsWith('-')) { positional.push(a); continue }
  }
  // First positional is target (ref or selector)
  if (positional.length) {
    const target = positional[0]
    if (/^@?\d+$/.test(target)) {
      body.ref = target.replace('@', '')
    } else {
      body.selector = target
    }
  }
  return Object.keys(body).length ? body : undefined
}

/** Parse key modifiers */
export function parseModifiers(args) {
  // `ctrlKey`, not `ctrl` — these are the field names `/key` actually reads (`api-handlers.ts`
  // forwards `body.ctrlKey`). Emitting the short names meant `hj key s --ctrl` sent `{ctrl: true}`,
  // the extra key validated fine, the handler forwarded `ctrlKey: undefined`, and the keystroke
  // arrived WITHOUT the modifier — reported as success. Identical in shape to the `hj wait`
  // blocker: a CLI/endpoint field-name disagreement that no schema check can see, because an
  // unrecognised key is legal. Verified against a real keydown event in the e2e lane.
  const mods = {}
  for (const a of args) {
    if (a === '--ctrl' || a === '-c') mods.ctrlKey = true
    if (a === '--shift' || a === '-s') mods.shiftKey = true
    if (a === '--alt' || a === '-a') mods.altKey = true
    if (a === '--meta' || a === '-m') mods.metaKey = true
  }
  return mods
}

/**
 * Substitute template variables in a string.
 * Replaces ${VAR_NAME} with values from vars object, falling back to env vars.
 * Also handles ${GEN.TYPE} patterns for generated test data.
 * Unresolved variables are left as-is for debugging.
 */
export function substituteVars(text, vars = {}, seed) {
  // First pass: replace ${GEN.*} patterns with generated test data
  let genInfo = null
  if (/\$\{GEN\./i.test(text)) {
    genInfo = substituteGeneratedVars(text, seed)
    text = genInfo.result
  }

  // Second pass: replace ${VAR_NAME} with explicit vars / env vars
  const result = text.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const trimmed = varName.trim()
    if (trimmed in vars) return vars[trimmed]
    if (trimmed in process.env) return process.env[trimmed]
    return match  // Leave unresolved for debugging
  })

  return { text: result, genInfo }
}

/** Read a test JSON file, returning { test: <parsed> }. Applies template variable substitution. */
function readTestFile(filePath, vars = {}, seed) {
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`)
    process.exit(1)
  }
  try {
    const content = readFileSync(filePath, 'utf-8')
    const { text: processed, genInfo } = substituteVars(content, vars, seed)

    // Report generated values if any
    if (genInfo && Object.keys(genInfo.generated).length > 0) {
      console.error(dim(`[test-data] seed: ${genInfo.seed}`))
      for (const [key, value] of Object.entries(genInfo.generated)) {
        const display = value.length > 60 ? value.slice(0, 57) + '...' : value
        console.error(dim(`  ${key} = ${JSON.stringify(display)}`))
      }
    }

    const parsed = JSON.parse(processed)
    return { test: parsed }
  } catch (err) {
    console.error(`Error: Failed to parse ${filePath}: ${err.message}`)
    process.exit(1)
  }
}

/** Parse test command args, extracting options, files, and vars */
export function parseTestArgs(args) {
  const files = []
  const options = {}
  let vars = {}
  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--timeoutMs' && args[i + 1]) {
      options.timeout = parseInt(args[i + 1], 10)
      i += 2
    } else if (arg === '--allow-failures' && args[i + 1]) {
      options.patience = parseInt(args[i + 1], 10)
      i += 2
    } else if (arg === '--allow-failures-streak' && args[i + 1]) {
      options.patienceStreak = parseInt(args[i + 1], 10)
      i += 2
    } else if (arg === '--step-delay' && args[i + 1]) {
      options.stepDelay = parseInt(args[i + 1], 10)
      i += 2
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[i + 1], 10)
      i += 2
    } else if (arg === '--vars' && args[i + 1]) {
      // Parse JSON object of variables: --vars '{"APP_URL": "http://localhost:5050"}'
      try {
        vars = { ...vars, ...JSON.parse(args[i + 1]) }
      } catch (err) {
        console.error(`Error: Invalid JSON for --vars: ${args[i + 1]}`)
        process.exit(1)
      }
      i += 2
    } else if (arg.startsWith('--')) {
      // Skip unknown flags
      i++
    } else {
      files.push(arg)
      i++
    }
  }
  return { files, options, vars }
}

/** Expand test file arguments - directories become sorted list of .json files */
function expandTestFiles(args) {
  const files = []
  for (const arg of args) {
    if (!existsSync(arg)) {
      console.error(`Error: Not found: ${arg}`)
      process.exit(1)
    }
    const stat = statSync(arg)
    if (stat.isDirectory()) {
      // Find all .json files in directory, sorted alphabetically
      const jsonFiles = readdirSync(arg)
        .filter(f => f.endsWith('.json'))
        .sort()
        .map(f => join(arg, f))
      files.push(...jsonFiles)
    } else {
      files.push(arg)
    }
  }
  return files
}

function num(s) { return s != null ? Number(s) : undefined }

function tryParseJSON(s) {
  try { return JSON.parse(s) } catch { return s }
}

/** Remove undefined values from an object */
export function clean(obj) {
  if (!obj) return undefined
  const result = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v
  }
  return Object.keys(result).length ? result : undefined
}

// ============================================
// Server auto-start
// ============================================

async function isServerRunning(port) {
  try {
    const resp = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(1000)
    })
    return resp.ok
  } catch {
    return false
  }
}

/**
 * Resolve the server path. Search order:
 *   1. Next to the hj binary (compiled distribution).
 *   2. `../dist/server.js` (running from a source checkout).
 *   3. Inside an installed `/Applications/Haltija.app` (the bundled
 *      server binary lives in Contents/Resources/haltija-server-<arch>).
 *   4. Same under `~/Applications/`.
 * Exported for testing.
 */
export function resolveServerPath() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const execDir = dirname(process.execPath)
  const candidates = [
    { type: 'bundled', path: join(execDir, `haltija-server-${arch}`) },
    { type: 'dev', path: join(__dirname, '../dist/server.js') },
    { type: 'app', path: `/Applications/Haltija.app/Contents/Resources/haltija-server-${arch}` },
    { type: 'app', path: join(homedir(), `Applications/Haltija.app/Contents/Resources/haltija-server-${arch}`) },
  ]
  for (const c of candidates) {
    if (existsSync(c.path)) return c
  }
  return null
}

async function startServerInBackground(port) {
  const resolved = resolveServerPath()

  if (!resolved) {
    console.error('Error: no haltija server found.')
    console.error('')
    console.error('Install one of these:')
    console.error('  • Haltija desktop app: https://github.com/tonioloewald/haltija/releases')
    console.error('  • Or run a server in another shell: bunx haltija --server')
    console.error('  • Or, if you are developing haltija from source: bun run build')
    process.exit(1)
  }
  
  let command, cmdArgs
  
  if (resolved.type === 'bundled') {
    // Running from app bundle - use compiled binary directly
    command = resolved.path
    cmdArgs = []
  } else {
    // Development mode - use bun/node to run server.js
    command = 'bun'
    cmdArgs = ['run', resolved.path]
    try {
      const { execSync } = await import('child_process')
      execSync('bun --version', { stdio: 'ignore' })
    } catch {
      command = 'node'
      cmdArgs = [resolved.path]
    }
  }

  const child = spawn(command, cmdArgs, {
    env: { ...process.env, DEV_CHANNEL_PORT: String(port) },
    stdio: 'ignore',
    detached: true
  })
  child.unref()

  // Wait for server to be ready
  const maxWait = 5000
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    if (await isServerRunning(port)) return true
    await new Promise(r => setTimeout(r, 200))
  }
  return false
}

// ============================================
// Auto-launch Electron app when no browser windows connected
// ============================================

async function launchElectronApp() {
  const { execSync, spawn: spawnChild } = await import('child_process')
  
  if (process.platform === 'darwin') {
    // Check common locations for Haltija.app
    const appPaths = [
      '/Applications/Haltija.app',
      `${process.env.HOME}/Applications/Haltija.app`,
    ]
    for (const p of appPaths) {
      if (existsSync(p)) {
        spawnChild('open', ['-a', p], { stdio: 'ignore', detached: true }).unref()
        return true
      }
    }
    // Try spotlight search as fallback
    try {
      const result = execSync('mdfind "kMDItemCFBundleIdentifier == com.electron.haltija" | head -1', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
      if (result) {
        spawnChild('open', ['-a', result], { stdio: 'ignore', detached: true }).unref()
        return true
      }
    } catch {}
    return false
  }
  
  // Linux/Windows: not yet supported
  return false
}

async function ensureBrowserConnected(port, { explicitTarget = false } = {}) {
  let status
  try {
    const resp = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(2000)
    })
    status = await resp.json()
    if (status.ok) return true
  } catch { return false }

  // Server is up but no tabs yet. If this server is hosted by the Haltija
  // desktop app, it will open a tab itself when the agent's command hits
  // (via __NEED_WINDOW__). Launching /Applications/Haltija.app on top would
  // produce two app instances side by side — skip the launch.
  if (status?.desktopApp) return true

  // Private / project-owned server (explicitly targeted via --port / --name /
  // HALTIJA_PORT). Launching the standalone Haltija.app here is wrong — it runs
  // its own server on 8700 and would never connect to this port — so guide the
  // user to attach a browser to *this* server instead of spawning Electron.
  if (explicitTarget) {
    process.stderr.write(
      `\x1b[2mNo browser connected to the haltija server on port ${port}. ` +
      `Open your app/page with the widget injected (script tag or bookmarklet), ` +
      `or run \`hj --no-launch\` to skip this check.\x1b[0m\n`
    )
    return false
  }

  // Respect "user explicitly quit" — don't auto-relaunch on every agent
  // call. Cleared when the user starts Haltija manually.
  try {
    const quitMarker = join(homedir(), '.haltija', 'last-quit')
    if (existsSync(quitMarker)) {
      process.stderr.write('\x1b[2m(Haltija was quit by user; not auto-launching. Open Haltija manually to resume.)\x1b[0m\n')
      return false
    }
  } catch {}

  // No windows connected — try to launch Electron app (macOS only)
  if (process.platform !== 'darwin') return false
  
  process.stderr.write('\x1b[2mLaunching Haltija browser...\x1b[0m')
  const launched = await launchElectronApp()
  if (!launched) {
    process.stderr.write('\x1b[2m not found\x1b[0m\n')
    return false
  }
  
  // Wait for a window to connect (up to 10s)
  const maxWait = 10000
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      const resp = await fetch(`http://localhost:${port}/status`, {
        signal: AbortSignal.timeout(1000)
      })
      const status = await resp.json()
      if (status.ok) {
        process.stderr.write('\x1b[2m ready\x1b[0m\n')
        return true
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  process.stderr.write('\x1b[2m timeout\x1b[0m\n')
  return false
}

// Commands that don't need a browser window to be connected
const INFO_COMMANDS = new Set(['status', 'windows', 'version', 'help'])

// Commands whose payload lives in DevResponse.data and should be printed
// unwrapped: strings verbatim, objects/arrays as pretty JSON, no envelope.
// Trailing command hint is suppressed for these so agents can pipe stdout
// directly. Pass --json to get the full DevResponse envelope instead.
const UNWRAP_DATA_SUBCOMMANDS = new Set([
  'map',         // affordance map (the whole point is the map, not the envelope)
  'eval',        // JS expression result (any type)
  'call',        // method-call result on an element
  'fetch',       // fetched URL response (body + headers + status)
  'location',    // current URL + title
  'query',       // matched element info (single or array)
  'inspect',     // single-element details
  'inspectAll',  // array of element details
  'find',        // elements located by text
  'console',     // console buffer entries
  'form',        // form field values
])

// ============================================
// Main subcommand execution
// ============================================

// Flags each flag-oriented subcommand recognizes. Used to (a) accept
// `--flag=value` as well as `--flag value`, and (b) warn — not fail — when an
// agent passes a flag the command will otherwise silently ignore. Commands that
// take free-form text (type, eval, find, snapshot, send…) are intentionally
// ABSENT: a leading-dash token there is content, not a flag, so we leave them
// untouched.
export const GLOBAL_FLAGS = ['--json', '--window', '--port', '--name', '--token', '--no-launch', '--help']
export const KNOWN_FLAGS = {
  tree: ['--depth', '-d', '--selector', '-s', '--compact', '-c', '--interactive', '-i', '--visible', '-v', '--text', '--no-text', '--shadow', '--frames', '--no-frames'],
  click: ['--diff', '--delay'],
  form: ['--include-disabled', '--include-hidden'],
  inspect: ['--full-styles', '--styles', '--matched-rules', '--rules', '--ancestors'],
  inspectAll: ['--full-styles', '--styles', '--matched-rules', '--rules', '--ancestors'],
  key: ['--ctrl', '-c', '--shift', '-s', '--alt', '-a', '--meta', '-m', '--repeat'],
  screenshot: ['--data-url', '--format', '--quality', '--scale', '--maxWidth', '--max-width', '--maxHeight', '--max-height', '--delay', '--no-chyron', '--canvas', '--no-fallback', '--schematic'],
  'video-start': ['--maxDuration', '--max-duration'],
  refresh: ['--soft'],
  'test-run': ['--vars', '--seed', '--timeoutMs', '--allow-failures', '--allow-failures-streak', '--step-delay'],
  'test-validate': ['--vars', '--seed', '--timeoutMs', '--allow-failures', '--allow-failures-streak', '--step-delay'],
  'test-suite': ['--vars', '--seed', '--timeoutMs', '--allow-failures', '--allow-failures-streak', '--step-delay'],
  // Added after an invariant test derived them from the parsers themselves. Missing entries are
  // not cosmetic: BOTH `normalizeEqualsFlags` and `warnUnknownFlags` are gated on an entry
  // existing, so `hj map --scale=3` parsed to `{}` and warned about nothing.
  map: ['--global', '--max-nodes', '--image', '--png', '--data-url', '--scale', '--maxWidth', '--max-width', '--maxHeight', '--max-height', '--format', '--quality'],
  'events-watch': ['--preset'],
  'mutations-watch': ['--preset'],
  'network-watch': ['--preset'],
  'send-message': ['--no-submit'],
  'send-selection': ['--no-submit'],
  'send-recording': ['--no-submit'],
  wait: ['--timeout', '--poll-interval', '--hidden', '--selector'],
  // These eight were advertised in `hj <cmd> --help` and read by nothing. The endpoints accepted
  // every one of them; only the CLI dropped them silently.
  query: ['--all'],
  type: ['--clear', '--humanlike'],
  drag: ['--duration'],
  highlight: ['--label', '--color', '--duration'],
  scroll: ['--duration'],
  call: ['--args'],
}

/** Split `--flag=value` into `--flag`, `value` (first `=` only). Long flags only. */
export function normalizeEqualsFlags(args, known) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    // Past `--`, nothing is a flag.
    if (a === '--') { out.push(...args.slice(i)); break }
    const eq = a.indexOf('=')
    // Split ONLY flags this command actually knows. Splitting any `--x=y` mangled free text:
    // `hj type 10 "--foo=bar"` became `{text: "--foo bar"}` — the `=` replaced by a space, in a
    // string the user asked to be typed verbatim. A normaliser has no business rewriting a token
    // it cannot identify.
    if (a.startsWith('--') && eq !== -1 && (!known || known.includes(a.slice(0, eq)))) {
      out.push(a.slice(0, eq), a.slice(eq + 1))
    } else {
      out.push(a)
    }
  }
  return out
}

/**
 * Commands whose payload is free text, where a leading `-` is CONTENT, not a flag.
 *
 * They still accept their own real flags (`hj type 10 "hi" --clear` works), but an unrecognised
 * dash-token must pass through silently — warning about it is worse than useless, because the
 * warning says "ignored" while the token is in fact typed. `hj type 10 "--- divider"` warned about
 * a flag `---` it had not ignored at all.
 */
export const FREE_TEXT_COMMANDS = new Set([
  'type', 'highlight', 'call', 'eval', 'find', 'snapshot',
  'send', 'send-message', 'send-selection', 'send-recording',
])

/** Levenshtein distance, for "did you mean" suggestions. */
function editDistance(a, b) {
  const m = a.length, n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  return d[m][n]
}

/** Closest known flag within a small edit distance, or null. */
function closestFlag(input, candidates) {
  let best = null, bestD = Infinity
  for (const c of candidates) {
    const dist = editDistance(input, c)
    if (dist < bestD) { bestD = dist; best = c }
  }
  return bestD <= 3 ? best : null
}

/**
 * Warn (to stderr, non-fatal) about dashed tokens a flag-oriented command
 * doesn't recognize, so a typo like `--frmat` or an unsupported flag stops
 * silently doing nothing. No-op for free-text commands (not in KNOWN_FLAGS).
 */
export function warnUnknownFlags(subcommand, args) {
  const known = KNOWN_FLAGS[subcommand]
  if (!known) return
  // For a free-text command a dash-token is content. The warning claimed it was "ignored" while
  // the CLI went on to type it — a diagnostic asserting the opposite of what happened.
  if (FREE_TEXT_COMMANDS.has(subcommand)) return
  const allowed = new Set([...known, ...GLOBAL_FLAGS])
  for (const a of args) {
    if (a === '--') break                 // end of flags; the rest is literal
    if (!a.startsWith('-')) continue      // positional or a flag's value
    if (/^-\d/.test(a)) continue          // negative number, not a flag
    if (allowed.has(a)) continue
    const suggestion = closestFlag(a, known)
    const hint = suggestion ? ` (did you mean ${suggestion}?)` : ''
    process.stderr.write(dim(`[hj] warning: unknown flag "${a}" ignored${hint}`) + '\n')
  }
}

export async function runSubcommand(subcommand, subArgs, port = '8700', options = {}) {
  const baseUrl = `http://localhost:${port}`
  const jsonOutput = subArgs.includes('--json')
  const noLaunch = options.noLaunch || false
  const explicitTarget = options.explicitTarget || false
  // Remove --json and extract --window before processing
  let filteredArgs = subArgs.filter(a => a !== '--json')
  let targetWindowId = undefined
  const windowIdx = filteredArgs.indexOf('--window')
  if (windowIdx !== -1) {
    targetWindowId = filteredArgs[windowIdx + 1]
    filteredArgs = [...filteredArgs.slice(0, windowIdx), ...filteredArgs.slice(windowIdx + 2)]
  }

  // For flag-oriented commands, accept `--flag=value` and surface unknown flags
  // instead of silently dropping them. Free-text commands are left untouched.
  if (KNOWN_FLAGS[subcommand]) {
    filteredArgs = normalizeEqualsFlags(filteredArgs, [...KNOWN_FLAGS[subcommand], ...GLOBAL_FLAGS])
    warnUnknownFlags(subcommand, filteredArgs)
  }

  // Check if a server is answering; auto-start one only if it's safe to.
  if (!(await isServerRunning(port))) {
    // NEVER auto-spawn a server against a port the shell EXPLICITLY targeted (--port /
    // --name / HALTIJA_PORT / …), and never under --no-launch.
    //
    // Spawning a server is a machine-topology mutation, and doing it from a read-only-ish
    // command (`hj eval`, `hj tree`) against a targeted port is the sharpest edge in the CLI:
    // the target is a server the USER manages — very often their dev server, embedded on a
    // port they chose. If it's momentarily not answering (mid-restart, or HTTPS-only so the
    // HTTP /status probe fails), spawning a generic server that BINDS that port collides with
    // their setup and knocks it offline. That's a bug report, and it was: `hj --no-launch
    // --port 8700 eval` bound its own listener on 8700 and took the dev channel down.
    //
    // So auto-spawn is only for the bare, unconfigured 8700 default — the zero-config "I just
    // want it to work" path. This mirrors the Electron auto-launch rule (hj.mjs), which the
    // server spawn had drifted out of sync with. An explicit target that isn't answering is an
    // actionable error, not license to spawn.
    if (noLaunch || explicitTarget) {
      console.error(`Error: nothing is answering on the haltija server you targeted (port ${port}).`)
      console.error(explicitTarget
        ? 'That port is yours to manage — haltija will not spawn a server against a target you named.'
        : 'Start it yourself: `haltija --server`  (or drop --no-launch to let hj start one on the default port).')
      console.error('`hj where` shows what a shell is targeting and why.')
      process.exit(1)
    }

    // Respect "user manually quit Haltija" before we try to spawn anything.
    // The marker is dropped by the desktop app on will-quit and cleared on
    // its next launch — agent calls in between should not bring it back.
    try {
      const quitMarker = join(homedir(), '.haltija', 'last-quit')
      if (existsSync(quitMarker)) {
        console.error('Haltija was quit by user; not auto-launching.')
        console.error('Open Haltija manually to resume — or run `hj --no-launch` to bypass this check.')
        process.exit(1)
      }
    } catch {}

    process.stderr.write('\x1b[2mStarting Haltija server...\x1b[0m')
    const started = await startServerInBackground(port)
    if (started) {
      process.stderr.write('\x1b[2m done\x1b[0m\n')
    } else {
      process.stderr.write('\n')
      console.error('Error: Could not start server. Run `haltija --server` in another terminal.')
      process.exit(1)
    }
  }

  // Auto-launch browser if no windows connected (skip for info commands and --no-launch)
  if (!noLaunch && !INFO_COMMANDS.has(subcommand)) {
    await ensureBrowserConnected(port, { explicitTarget })
  }

  // Special handling for 'send' command - route to appropriate endpoint
  // hj send selection [agent]      → /send/selection
  // hj send recording [agent]      → /send/recording  
  // hj send <agent> <message...>   → /send/message
  if (subcommand === 'send') {
    const firstArg = filteredArgs[0]?.toLocaleLowerCase()
    if (firstArg === 'selection') {
      subcommand = 'send-selection'
      filteredArgs.shift() // Remove 'selection'
    } else if (firstArg === 'recording') {
      subcommand = 'send-recording'
      filteredArgs.shift() // Remove 'recording'
    } else {
      subcommand = 'send-message'
      // Args stay as: <agent> <message...>
    }
  }

  // Resolve compound path
  const path = COMPOUND_PATHS[subcommand] || `/${subcommand}`
  const isGet = GET_ENDPOINTS.has(subcommand) || GET_COMPOUND.has(subcommand)

  // Build request body for POST
  let body = undefined
  if (!isGet) {
    const mapper = ARG_MAPS[subcommand]
    if (mapper) {
      body = clean(mapper(filteredArgs))
    } else if (filteredArgs.length) {
      // Generic: try to parse as JSON or pass as first positional
      const joined = filteredArgs.join(' ')
      try {
        body = JSON.parse(joined)
      } catch {
        body = parseTargetArgs(filteredArgs)
      }
    }
  }

  // Handle window targeting via --window flag (extracted earlier)
  if (targetWindowId) {
    if (isGet) {
      const url = new URL(path, baseUrl)
      url.searchParams.set('window', targetWindowId)
      return doRequest(url.toString(), 'GET', undefined, { subcommand, jsonOutput })
    } else {
      if (!body) body = {}
      body.window = targetWindowId
    }
  }

  const url = `${baseUrl}${path}`
  return doRequest(url, isGet ? 'GET' : 'POST', body, { subcommand, jsonOutput })
}

async function doRequest(url, method, body, context = {}) {
  const { subcommand, jsonOutput } = context
  try {
    const headers = {}
    if (process.env.HALTIJA_TOKEN) headers['X-Haltija-Token'] = process.env.HALTIJA_TOKEN
    const opts = { method, headers }
    if (body) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }

    const resp = await fetch(url, opts)
    warnOnVersionSkew(resp)
    const contentType = resp.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const json = await resp.json()

      // A result can be REAL but MISLEADING — e.g. it came from a hidden tab where rAF-driven
      // content never mounted, so an empty selector means "not mounted", not "broken" (issue #3).
      // Print it on stderr so it can't be mistaken for output, and so --json stdout stays clean.
      // A `hint` accompanies an error to say what to do next — printing the error without it
      // throws away the teachable half.
      if (json && json.success === false && typeof json.hint === 'string' && json.hint) {
        console.error(`hj: ${json.hint}`)
      }

      if (json && typeof json.warning === 'string' && json.warning) {
        if (process.env.HALTIJA_STRICT === '1') {
          // Strict mode (issue #8): if the result may be wrong, a script must not consume it. Fail
          // fast with the real reason instead of emitting a plausible-but-wrong value that makes the
          // lane fail later, pointing at the caller's own code. stdout stays empty on purpose.
          // NB: fails on `warningRepeated` too — the condition still holds, and suppressing repeats
          // here would let every command after the first silently pass.
          console.error(`hj: ERROR (strict) — ${json.warning}`)
          console.error(`hj: refusing to return a result that may be wrong. Fix the condition above, or drop --strict/HALTIJA_STRICT to proceed anyway.`)
          process.exit(1)
        }
        // Non-strict: stay quiet on a repeat within the cooldown, so a burst of commands doesn't
        // re-print the same block and train the reader to ignore it.
        if (!json.warningRepeated) console.error(`hj: warning — ${json.warning}`)
      }

      // Text format for supported subcommands (unless --json)
      if (!jsonOutput && subcommand === 'tree' && json.success && json.data) {
        console.log(formatTree(json.data, 0, { depth: body?.depth }))
      } else if (!jsonOutput && subcommand === 'events' && (json.events || Array.isArray(json))) {
        console.log(formatEvents(json))
      } else if (!jsonOutput && subcommand === 'test-run' && json.test) {
        console.log(formatTestResult(json))
      } else if (!jsonOutput && subcommand === 'test-suite' && json.results) {
        console.log(formatSuiteResult(json))
      } else if (!jsonOutput && subcommand === 'screenshot' && json.data?.path) {
        console.log(bold(json.data.path))
        const meta = [json.data.width && json.data.height ? `${json.data.width}×${json.data.height}` : null, json.data.format, json.data.source].filter(Boolean).join(', ')
        if (meta) console.error(dim(meta))
      } else if (!jsonOutput && subcommand === 'map' && json.data?.path) {
        // `hj map --image` used to print the ENTIRE map JSON and then append the image metadata,
        // the cost block and the path — so it was strictly MORE expensive than `hj map`, always.
        // Measured on a small page: 5,910 chars vs 5,447. The flag whose whole purpose is to be
        // cheaper could never once pay off, and README described it as returning a path, which it
        // did only in the sense that a path was in there somewhere.
        //
        // Now it behaves like `hj screenshot`: the path on stdout, everything else on stderr.
        // `--json` still gives the full envelope for anyone who wants map AND image together.
        console.log(bold(json.data.path))
        const d = json.data
        const meta = [d.width && d.height ? `${d.width}×${d.height}` : null, d.format].filter(Boolean).join(', ')
        // The honest comparison, measured rather than asserted. `cost.jsonChars` is the length of
        // the COMPACT JSON, but what an agent actually pays for `hj map` is the pretty-printed
        // output — about 1.8x larger on the pages measured. Advising "use whichever is smaller"
        // from a number 1.8x too small pushed the answer toward JSON every time.
        const { image, width, height, format, cost, path, ...mapOnly } = d
        const plainChars = JSON.stringify(mapOnly, null, 2).length
        const jsonTokens = Math.round(plainChars / 4)
        // The image side is COMPUTED from the schematic actually produced, not a constant. This
        // line used to end "a schematic costs a vision encoder ~1-1.6k" — the ceiling stated as a
        // floor. For this 491x480 schematic the real figure is ~314; with --max-width 200 it is
        // ~52. Telling an agent the cheap option costs 25x what it does inverts the very decision
        // this line exists to inform.
        const imgTokens = d.cost?.approxImageTokens ?? (d.width && d.height ? Math.round((d.width * d.height) / 750) : null)
        const k = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))
        const bits = [
          meta,
          imgTokens != null
            ? `this map as JSON: ~${k(plainChars)} chars (~${k(jsonTokens)} tokens); as this image: ~${k(imgTokens)} tokens`
            : `hj map on this page prints ~${k(plainChars)} chars (~${k(jsonTokens)} tokens)`,
        ]
        console.error(dim(bits.filter(Boolean).join(' · ')))
      } else if (!jsonOutput && (subcommand === 'network' || subcommand === 'network-watch') && (json.entries || json.data?.entries || json.summary || json.data?.summary)) {
        console.log(formatNetwork(json))
      } else if (!jsonOutput && subcommand === 'network-stats') {
        console.log(formatNetworkStats(json))
      } else if (!jsonOutput && subcommand === 'video-stop' && json.data?.path) {
        console.log(bold(json.data.path))
        const meta = [json.data.duration ? `${json.data.duration.toFixed(1)}s` : null, json.data.size ? `${(json.data.size / 1024).toFixed(0)}KB` : null, json.data.format].filter(Boolean).join(', ')
        if (meta) console.error(dim(meta))
      } else if (!jsonOutput && UNWRAP_DATA_SUBCOMMANDS.has(subcommand)) {
        // Print the inner DevResponse.data unwrapped so agents (and humans) can
        // read it directly. Strings go to stdout as-is — no JSON escaping of
        // newlines, quotes, etc. Objects/arrays still pretty-print as JSON.
        // Failures go to stderr with a non-zero exit. Pass --json to get the
        // full DevResponse envelope instead.
        if (json.success === false) {
          console.error(`${subcommand} failed: ${json.error || 'unknown error'}`)
          process.exit(1)
        }
        const result = json.data
        if (result === null || result === undefined) {
          // nothing to print
        } else if (typeof result === 'string') {
          process.stdout.write(result)
          if (!result.endsWith('\n')) process.stdout.write('\n')
        } else {
          console.log(JSON.stringify(result, null, 2))
        }
      } else {
        // The fall-through for BOTH `--json` and plain action commands with no special
        // formatter (hj click / navigate / key / type / scroll …): print the envelope,
        // then EXIT NON-ZERO IF IT SAYS FAILURE.
        //
        // This used to print `{"success": false, "error": "No browser connected…"}` (or an
        // element-not-found) and exit 0. An agent that checks the exit code — which is how a
        // harness decides whether a step worked — saw success while the payload said failure.
        // That is the instrument lying, and for a debugging tool a lying instrument is worse
        // than none: you can't tell "the page is broken" from "my probe is broken". A click
        // that didn't click, or a probe with no browser, is a failure and now exits 1.
        console.log(JSON.stringify(json, null, 2))
        if (json && json.success === false) process.exit(1)
      }
    } else {
      const text = await resp.text()
      console.log(text)
    }

    // Show hint for this command (if available and successful).
    // Skip for commands whose stdout is meant to be piped/consumed verbatim
    // — agents shouldn't have to strip a trailing hint line.
    if (resp.ok && !jsonOutput && !UNWRAP_DATA_SUBCOMMANDS.has(subcommand)) {
      const hint = COMMAND_HINTS_LOCAL[subcommand]
      if (hint) {
        // stderr, NOT stdout. A hint appended to stdout turns parseable JSON into garbage —
        // an adopter's `JSON.parse(await $`hj windows`)` threw, their catch fell open, and the
        // readiness probe silently did nothing (issue #14). Advisory text belongs on stderr.
        console.error(dim(`hj ${subcommand} : ${hint}`))
      }
    }

    if (!resp.ok) {
      process.exit(1)
    }
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error('Error: Cannot connect to Haltija server.')
      console.error('Start the server with: haltija --server')
    } else {
      console.error(`Error: ${err.message}`)
    }
    process.exit(1)
  }
}

/** Known valid subcommands */
// Derived from src/cli-commands.ts — the single authoritative list. A local copy here is exactly
// how `wait` ended up with an endpoint, an arg map, and no way to invoke it.
export const KNOWN_COMMANDS = new Set([...ROUTED_COMMANDS, ...LOCAL_COMMANDS])

/** Common typos/aliases mapped to correct commands */
const COMMAND_ALIASES = {
  'open': 'navigate',
  'goto': 'navigate',
  'go': 'navigate',
  'url': 'navigate',
  'load': 'navigate',
  'get': 'tree',
  'dom': 'tree',
  'page': 'tree',
  'input': 'type',
  'write': 'type',
  'enter': 'key',
  'press': 'key',
  'run': 'eval',
  'js': 'eval',
  'exec': 'eval',
  'evaluate': 'eval',
  'execute': 'eval',
  'shot': 'screenshot',
  'capture': 'screenshot',
  // NB: `ls` is NOT an alias for `tree` — it's intercepted in hj.mjs as `hj servers` (list servers).
  'list': 'tree',
  'show': 'tree',
  'help': '--help',
  'nav': 'navigate',
  'reload': 'refresh',
  'snap': 'snapshot',
  'log': 'console',
  'logs': 'console',
}

/** Check if a string is a valid subcommand */
export function isSubcommand(arg) {
  if (!arg || arg.startsWith('-')) return false
  if (/^\d+$/.test(arg)) return false  // Legacy port number
  return KNOWN_COMMANDS.has(arg)
}

/** Get suggestion for unknown command */
export function getSuggestion(cmd) {
  // Check aliases first
  if (COMMAND_ALIASES[cmd]) {
    return COMMAND_ALIASES[cmd]
  }
  const lower = cmd.toLowerCase()
  // Check aliases case-insensitively
  for (const [alias, target] of Object.entries(COMMAND_ALIASES)) {
    if (alias.toLowerCase() === lower) return target
  }
  // Exact prefix match (e.g., "screensho" → "screenshot")
  const prefixMatches = [...KNOWN_COMMANDS].filter(k => k.startsWith(lower))
  if (prefixMatches.length === 1) return prefixMatches[0]
  // Levenshtein distance for close typos (max distance 2)
  let bestMatch = null
  let bestDist = 3
  for (const known of KNOWN_COMMANDS) {
    const d = levenshtein(lower, known)
    if (d < bestDist) {
      bestDist = d
      bestMatch = known
    }
  }
  if (bestMatch) return bestMatch
  // Prefix of 3+ chars
  if (lower.length >= 3) {
    for (const known of KNOWN_COMMANDS) {
      if (known.startsWith(lower.slice(0, 3))) return known
    }
  }
  return null
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

/** List available subcommands for --help */
export function listSubcommands() {
  return `
  ${bold('See the page')}
    map [--image]                     Affordance map: what's here and what it's wired to
    tree [selector] [-d N] [-i] [-v]  DOM tree (-i=interactive, -v=visible)
    screenshot [@ref|selector]        Screenshot (writes a file, prints its path)
    inspect <@ref|selector>           Detailed element info
    query <selector> [--all]          Match elements (info, not the whole tree)
    styles <@ref|selector>            Computed styles + matched CSS rules
    form [selector]                   Read a form's values as structured data
    console                           Console output

  ${bold('Interact')}
    click <@ref|selector|"text">      Click element
    type <@ref|selector> <text>       Type text
    key <key> [--ctrl --shift]        Press key
    drag <@ref|selector> <dx> <dy>    Drag element
    scroll [selector|dy]              Scroll page or element
    wait <selector> [--timeout N]     Wait for an element to appear
    call <@ref|selector> <method>     Call a method on an element
    highlight <@ref> [label]          Point something out
    unhighlight                       Clear highlights

  ${bold('Watch')}
    events ${dim('watch|unwatch|stats')}       Semantic events (default: show recent)
    mutations ${dim('watch|unwatch|status')}   DOM changes
    network ${dim('watch|unwatch|stats')}      HTTP requests (CDP, desktop only)
    console                           Console output

  ${bold('Control')}
    navigate <url>                    Go to URL
    location                          Current URL + title
    windows                           Connected tabs  (tabs-open/close/focus)
    refresh [--soft]                  Reload page
    tabs ${dim('open|close|focus')}            Tab management (default: list)
    eval <code>                       Run JS in browser

  ${bold('Test')}
    test ${dim('run|suite|validate')} <file>   Run tests (default: run)
    recording ${dim('start|stop|generate')}    Record user actions
    select ${dim('start|cancel|status|result|clear')}

  ${bold('More')}
    find <text>                       Find elements by text
    highlight <@ref> [label]          Highlight element
    snapshot [context]                Full page state
    video ${dim('start|stop|status')}          Video capture
    fetch <url> [prompt]              Fetch and process URL
    send <agent> <message>            Message an agent

  ${bold('Info')}
    status | version | docs | api

  ${bold('Options')}
    --window <id>    Target specific window
    --port <n>       Server port (default: 8700)

  Space-separated sub-commands work: ${dim('hj test run = hj test-run')}
  Fuzzy matching: ${dim('hj evaluate = hj eval, hj screensho = hj screenshot')}
`
}

// ONE definition each. Seven inner `const dim = …` shadows used to sit inside individual
// functions, so any future NO_COLOR / !isTTY handling would have had to be applied in eight places
// and would have been applied in one — the same divergence the ANSI de-dup comment in hj.mjs
// describes. Function declarations, so they hoist above every call site here.
//
// …and that future arrived. `hj map --image` documents its stdout as "a bare path you can hand
// straight to a file read", and `console.log(bold(path))` made it 8 bytes of escape codes around
// one — so `p=$(hj map --image); cat "$p"` failed with "No such file or directory". The CHANGELOG's
// "103 characters" was a 94-char path plus the escapes. Same defect on `hj screenshot` and
// `hj video-stop`; one definition each means one fix covers all three.
//
// Gated per STREAM, because they go to different ones: `bold` is stdout (payload), `dim` is stderr
// (commentary). Colour when a human is watching that stream, plain text when anything else is.
const colorOut = () => !process.env.NO_COLOR && process.stdout.isTTY
const colorErr = () => !process.env.NO_COLOR && process.stderr.isTTY
function bold(s) { return colorOut() ? `\x1b[1m${s}\x1b[0m` : String(s) }
function dim(s) { return colorErr() ? `\x1b[2m${s}\x1b[0m` : String(s) }
