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
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { formatTree } from './format-tree.mjs'
import { formatEvents } from './format-events.mjs'
import { formatTestResult, formatSuiteResult } from './format-test.mjs'
import { formatNetwork, formatNetworkStats } from './format-network.mjs'
import { substituteGeneratedVars } from './test-data.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Command hints - generated from api-schema.ts during build
// Use readFileSync instead of JSON import to avoid Node.js ExperimentalWarning
const hintsPath = join(__dirname, 'hints.json')
export const COMMAND_HINTS = existsSync(hintsPath) ? JSON.parse(readFileSync(hintsPath, 'utf-8')) : {}

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
export const ARG_MAPS = {
  click: (args) => parseClickArgs(args),
  type: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), text: args.slice(1).join(' ') }),
  key: (args) => ({ key: args[0], ...parseModifiers(args.slice(1)) }),
  drag: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), deltaX: num(args[1]), deltaY: num(args[2]) }),
  scroll: (args) => parseScrollArgs(args),
  navigate: (args) => ({ url: args[0] }),
  eval: (args) => ({ code: args.join(' ') }),
  query: (args) => ({ selector: args[0] }),
  inspect: (args) => parseInspectArgs(args),
  'inspectAll': (args) => parseInspectArgs(args),
  styles: (args) => ({ ...parseTargetArgs(args), matchedRules: true }),
  tree: (args) => parseTreeArgs(args),
  highlight: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), label: args[1] }),
  unhighlight: () => ({}),
  find: (args) => ({ text: args.join(' ') }),
  wait: (args) => parseWaitArgs(args),
  call: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), method: args[1], args: args.slice(2).map(tryParseJSON) }),
  fetch: (args) => ({ url: args[0], prompt: args.slice(1).join(' ') || undefined }),
  screenshot: (args) => {
    const body = { file: true }
    const positional = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === '--data-url') { body.file = false; continue }
      if (a === '--scale') { body.scale = num(args[++i]); continue }
      if (a === '--maxWidth' || a === '--max-width') { body.maxWidth = num(args[++i]); continue }
      if (a === '--maxHeight' || a === '--max-height') { body.maxHeight = num(args[++i]); continue }
      if (a === '--delay') { body.delay = num(args[++i]); continue }
      if (a === '--no-chyron') { body.chyron = false; continue }
      if (!a.startsWith('-')) { positional.push(a) }
    }
    return { ...body, ...parseTargetArgs(positional) }
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
  'events-watch': (args) => ({ preset: args[0] || 'interactive' }),
  'mutations-watch': (args) => ({ preset: args[0] || 'smart' }),
  'network-watch': (args) => ({ preset: args[0] || 'standard' }),
  form: (args) => parseTargetArgs(args),
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
  const first = args[0]
  if (!isNaN(first)) return { ms: num(first) }
  return { ...parseTargetArgs([first]), timeout: args[1] ? num(args[1]) : undefined }
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
  const mods = {}
  for (const a of args) {
    if (a === '--ctrl' || a === '-c') mods.ctrl = true
    if (a === '--shift' || a === '-s') mods.shift = true
    if (a === '--alt' || a === '-a') mods.alt = true
    if (a === '--meta' || a === '-m') mods.meta = true
  }
  return Object.keys(mods).length ? mods : {}
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
      const dim = (s) => `\x1b[2m${s}\x1b[0m`
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
// Session ID for multi-agent isolation
// ============================================

export function getSessionId() {
  if (process.env.HALTIJA_SESSION) return process.env.HALTIJA_SESSION
  // Auto-generate a session ID for this shell — persisted in env for subsequent calls
  const id = `hj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  process.env.HALTIJA_SESSION = id
  return id
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
 * Resolve the server path - checks for bundled binary first, then dev server.
 * Exported for testing.
 */
export function resolveServerPath() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const execDir = dirname(process.execPath)
  const bundledServerPath = join(execDir, `haltija-server-${arch}`)
  const devServerPath = join(__dirname, '../dist/server.js')
  
  if (existsSync(bundledServerPath)) {
    return { type: 'bundled', path: bundledServerPath }
  } else if (existsSync(devServerPath)) {
    return { type: 'dev', path: devServerPath }
  }
  return null
}

async function startServerInBackground(port) {
  const resolved = resolveServerPath()
  
  if (!resolved) {
    console.error('Error: Server not found. Run `bun run build` first.')
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

async function ensureBrowserConnected(port) {
  try {
    const resp = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(2000)
    })
    const status = await resp.json()
    // Use status.ok (global, not session-filtered) to check if any browser is connected
    if (status.ok) return true
  } catch { return false }
  
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

// ============================================
// Main subcommand execution
// ============================================

export async function runSubcommand(subcommand, subArgs, port = '8700', options = {}) {
  const baseUrl = `http://localhost:${port}`
  const jsonOutput = subArgs.includes('--json')
  const noLaunch = options.noLaunch || false
  // Remove --json and extract --window/--session before processing
  let filteredArgs = subArgs.filter(a => a !== '--json')
  let targetWindowId = undefined
  const windowIdx = filteredArgs.indexOf('--window')
  if (windowIdx !== -1) {
    targetWindowId = filteredArgs[windowIdx + 1]
    filteredArgs = [...filteredArgs.slice(0, windowIdx), ...filteredArgs.slice(windowIdx + 2)]
  }
  const sessionIdx = filteredArgs.indexOf('--session')
  if (sessionIdx !== -1) {
    process.env.HALTIJA_SESSION = filteredArgs[sessionIdx + 1]
    filteredArgs = [...filteredArgs.slice(0, sessionIdx), ...filteredArgs.slice(sessionIdx + 2)]
  }

  // Check if server is running, auto-start if not
  if (!(await isServerRunning(port))) {
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
    await ensureBrowserConnected(port)
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
    const sessionId = getSessionId()
    const opts = { method, headers: { 'X-Haltija-Session': sessionId } }
    if (body) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }

    const resp = await fetch(url, opts)
    const contentType = resp.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const json = await resp.json()

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
        const bold = (s) => `\x1b[1m${s}\x1b[0m`
        const dim = (s) => `\x1b[2m${s}\x1b[0m`
        console.log(bold(json.data.path))
        const meta = [json.data.width && json.data.height ? `${json.data.width}×${json.data.height}` : null, json.data.format, json.data.source].filter(Boolean).join(', ')
        if (meta) console.log(dim(meta))
      } else if (!jsonOutput && (subcommand === 'network' || subcommand === 'network-watch') && (json.entries || json.data?.entries || json.summary || json.data?.summary)) {
        console.log(formatNetwork(json))
      } else if (!jsonOutput && subcommand === 'network-stats') {
        console.log(formatNetworkStats(json))
      } else if (!jsonOutput && subcommand === 'video-stop' && json.data?.path) {
        const bold = (s) => `\x1b[1m${s}\x1b[0m`
        const dim = (s) => `\x1b[2m${s}\x1b[0m`
        console.log(bold(json.data.path))
        const meta = [json.data.duration ? `${json.data.duration.toFixed(1)}s` : null, json.data.size ? `${(json.data.size / 1024).toFixed(0)}KB` : null, json.data.format].filter(Boolean).join(', ')
        if (meta) console.log(dim(meta))
      } else {
        console.log(JSON.stringify(json, null, 2))
      }
    } else {
      const text = await resp.text()
      console.log(text)
    }

    // Show hint for this command (if available and successful)
    if (resp.ok && !jsonOutput) {
      const hint = COMMAND_HINTS[subcommand]
      if (hint) {
        const dim = (s) => `\x1b[2m${s}\x1b[0m`
        console.log(dim(`\nhj ${subcommand} : ${hint}`))
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
export const KNOWN_COMMANDS = new Set([
  'tree', 'query', 'inspect', 'inspectAll', 'styles', 'find',
  'click', 'type', 'key', 'drag', 'scroll', 'call',
  'navigate', 'refresh', 'location',
  'events', 'events-watch', 'events-unwatch', 'console',
  'mutations-watch', 'mutations-unwatch', 'mutations-status',
  'eval', 'fetch',
  'screenshot', 'snapshot', 'highlight', 'unhighlight',
  'select-start', 'select-result', 'select-cancel', 'select-clear',
  'windows', 'tabs-open', 'tabs-close', 'tabs-focus',
  'video-start', 'video-stop', 'video-status',
  'network', 'network-watch', 'network-unwatch', 'network-stats',
  'recording', 'recording-start', 'recording-stop', 'recording-generate', 'recordings',
  'test-run', 'test-validate', 'test-suite',
  'send', 'send-message', 'send-selection', 'send-recording',
  'status', 'version', 'docs', 'api', 'stats'
])

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
  'ls': 'tree',
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
    tree [selector] [-d N] [-i] [-v]  DOM tree (-i=interactive, -v=visible)
    screenshot [@ref|selector]        Screenshot (saves to /tmp)
    inspect <@ref|selector>           Detailed element info
    console                           Console output

  ${bold('Interact')}
    click <@ref|selector|"text">      Click element
    type <@ref|selector> <text>       Type text
    key <key> [--ctrl --shift]        Press key
    drag <@ref|selector> <dx> <dy>    Drag element
    scroll [selector|dy]              Scroll page or element

  ${bold('Watch')}
    events ${dim('watch|unwatch|stats')}       Semantic events (default: show recent)
    mutations ${dim('watch|unwatch|status')}   DOM changes
    network ${dim('watch|unwatch|stats')}      HTTP requests (CDP, desktop only)
    console                           Console output

  ${bold('Control')}
    navigate <url>                    Go to URL
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

function bold(s) { return `\x1b[1m${s}\x1b[0m` }
function dim(s) { return `\x1b[2m${s}\x1b[0m` }
