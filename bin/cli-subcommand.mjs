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
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { formatTree } from './format-tree.mjs'
import { formatEvents } from './format-events.mjs'
import { formatTestResult, formatSuiteResult } from './format-test.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Endpoints that use GET (everything else is POST)
export const GET_ENDPOINTS = new Set([
  'location', 'events', 'console', 'windows', 'recordings',
  'status', 'version', 'docs', 'api', 'stats'
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
  'recording-start': '/recording/start',
  'recording-stop': '/recording/stop',
  'recording-generate': '/recording/generate',
  'test-run': '/test/run',
  'test-suite': '/test/suite',
  'test-validate': '/test/validate',
  'send-message': '/send/message',
  'send-selection': '/send/selection',
  'send-recording': '/send/recording',
}

// GET compound endpoints
export const GET_COMPOUND = new Set([
  'mutations-status', 'events-stats', 'select-status', 'select-result'
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
  screenshot: (args) => parseTargetArgs(args),
  snapshot: (args) => ({ context: args.join(' ') || undefined }),
  select: (args) => ({ action: args[0] }),
  'select-start': () => ({}),
  'select-cancel': () => ({}),
  'select-clear': () => ({}),
  refresh: (args) => (args.includes('--hard') ? { hard: true } : {}),
  'tabs-open': (args) => ({ url: args[0] }),
  'tabs-close': (args) => ({ window: args[0] }),
  'tabs-focus': (args) => ({ window: args[0] }),
  'events-watch': (args) => ({ preset: args[0] || 'interactive' }),
  'mutations-watch': (args) => ({ preset: args[0] || 'smart' }),
  form: (args) => parseTargetArgs(args),
  // send <agent> <message> or send selection/recording
  // --no-submit flag prevents auto-submit (paste only)
  'test-run': (args) => {
    if (!args.length) { console.error('Usage: hj test-run <file.json>'); process.exit(1) }
    return readTestFile(args[0])
  },
  'test-validate': (args) => {
    if (!args.length) { console.error('Usage: hj test-validate <file.json>'); process.exit(1) }
    return readTestFile(args[0])
  },
  'test-suite': (args) => {
    if (!args.length) { console.error('Usage: hj test-suite <file1.json> [file2.json ...]'); process.exit(1) }
    const tests = args.map(f => readTestFile(f).test)
    return { tests }
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
    if (a === '--visible') { body.visibleOnly = true; continue }
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

/** Read a test JSON file, returning { test: <parsed> } */
function readTestFile(filePath) {
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`)
    process.exit(1)
  }
  try {
    const content = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    return { test: parsed }
  } catch (err) {
    console.error(`Error: Failed to parse ${filePath}: ${err.message}`)
    process.exit(1)
  }
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

async function startServerInBackground(port) {
  // Check for compiled server binary (app bundle) first
  // In compiled binaries, __dirname doesn't work - use dirname of the executable
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const execDir = dirname(process.execPath)
  const bundledServerPath = join(execDir, `haltija-server-${arch}`)
  const devServerPath = join(__dirname, '../dist/server.js')
  
  let command, cmdArgs
  
  if (existsSync(bundledServerPath)) {
    // Running from app bundle - use compiled binary directly
    command = bundledServerPath
    cmdArgs = []
  } else if (existsSync(devServerPath)) {
    // Development mode - use bun/node to run server.js
    command = 'bun'
    cmdArgs = ['run', devServerPath]
    try {
      const { execSync } = await import('child_process')
      execSync('bun --version', { stdio: 'ignore' })
    } catch {
      command = 'node'
      cmdArgs = [devServerPath]
    }
  } else {
    console.error('Error: Server not found. Run `bun run build` first.')
    process.exit(1)
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
// Main subcommand execution
// ============================================

export async function runSubcommand(subcommand, subArgs, port = '8700') {
  const baseUrl = `http://localhost:${port}`
  const jsonOutput = subArgs.includes('--json')
  // Remove --json from subArgs before processing
  const filteredArgs = subArgs.filter(a => a !== '--json')

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

  // Handle window targeting via --window flag
  const windowIdx = filteredArgs.indexOf('--window')
  if (windowIdx !== -1 && filteredArgs[windowIdx + 1]) {
    const windowId = filteredArgs[windowIdx + 1]
    if (isGet) {
      // Append as query param for GET
      const url = new URL(path, baseUrl)
      url.searchParams.set('window', windowId)
      return doRequest(url.toString(), 'GET', undefined, { subcommand, jsonOutput })
    } else {
      if (!body) body = {}
      body.window = windowId
    }
  }

  const url = `${baseUrl}${path}`
  return doRequest(url, isGet ? 'GET' : 'POST', body, { subcommand, jsonOutput })
}

async function doRequest(url, method, body, context = {}) {
  const { subcommand, jsonOutput } = context
  try {
    const opts = { method }
    if (body) {
      opts.headers = { 'Content-Type': 'application/json' }
      opts.body = JSON.stringify(body)
    }

    const resp = await fetch(url, opts)
    const contentType = resp.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const json = await resp.json()

      // Text format for supported subcommands (unless --json)
      if (!jsonOutput && subcommand === 'tree' && json.success && json.data) {
        console.log(formatTree(json.data))
      } else if (!jsonOutput && subcommand === 'events' && (json.events || Array.isArray(json))) {
        console.log(formatEvents(json))
      } else if (!jsonOutput && subcommand === 'test-run' && json.test) {
        console.log(formatTestResult(json))
      } else if (!jsonOutput && subcommand === 'test-suite' && json.results) {
        console.log(formatSuiteResult(json))
      } else {
        console.log(JSON.stringify(json, null, 2))
      }
    } else {
      const text = await resp.text()
      console.log(text)
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
  'recording-start', 'recording-stop', 'recording-generate', 'recordings',
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
  'shot': 'screenshot',
  'capture': 'screenshot',
  'ls': 'tree',
  'list': 'tree',
  'show': 'tree',
  'help': '--help',
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
  // Simple prefix match
  for (const known of KNOWN_COMMANDS) {
    if (known.startsWith(cmd) || cmd.startsWith(known.slice(0, 3))) {
      return known
    }
  }
  return null
}

/** List available subcommands for --help */
export function listSubcommands() {
  return `
Subcommands (replace curl with simple commands):
  ${bold('Inspect')}
    tree [selector] [-d depth]     DOM tree with ref IDs
    query <selector>               Find elements matching selector
    inspect <@ref|selector>        Detailed element info
    inspectAll <selector>          Deep inspect all matches
    find <text>                    Find elements by text content

  ${bold('Interact')}
    click <@ref|selector|"text">   Click an element
    type <@ref|selector> <text>    Type text into element
    key <key> [--ctrl --shift]     Press a key
    drag <@ref|selector> <dx> <dy> Drag element
    scroll [selector|dy]           Scroll page or element
    call <@ref|selector> <method>  Call element method/get property

  ${bold('Navigate')}
    navigate <url>                 Go to URL
    refresh [--hard]               Reload page
    location                       Current URL and title

  ${bold('Observe')}
    events                         Get semantic events
    events-watch [preset]          Start watching events
    events-unwatch                 Stop watching events
    console                        Get console output
    mutations-watch [preset]       Start watching DOM changes
    mutations-unwatch              Stop watching
    mutations-status               Check mutation watcher

  ${bold('Evaluate')}
    eval <code>                    Run JavaScript in browser
    fetch <url> [prompt]           Fetch and process URL

  ${bold('Capture')}
    screenshot [@ref|selector]     Take screenshot
    snapshot [context]             Full page state capture
    highlight <@ref|selector>      Highlight element
    unhighlight                    Remove highlights

  ${bold('Selection')}
    select-start                   Begin region selection
    select-result                  Get selection result
    select-cancel                  Cancel selection
    select-clear                   Clear selection

  ${bold('Windows')}
    windows                        List browser windows
    tabs-open <url>                Open new tab
    tabs-close <windowId>          Close tab
    tabs-focus <windowId>          Focus tab

  ${bold('Recording')}
    recording-start                Start recording
    recording-stop                 Stop recording
    recording-generate             Generate test from recording
    recordings                     List recordings

  ${bold('Send to Agent')}
    send <agent> <message>         Send message to agent (auto-submits)
    send selection [agent]         Send browser selection to agent
    send recording [agent]         Send last recording to agent
    --no-submit                    Paste only, don't auto-submit

  ${bold('Testing')}
    test-run <json>                Run a test
    test-validate <json>           Validate test format

  ${bold('Info')}
    status                         Server status
    version                        Server version
    docs                           API documentation
    api                            Full API reference
    stats                          Usage statistics

  ${bold('Options')}
    --window <id>                  Target specific window
    --port <n>                     Server port (default: 8700)

  ${bold('Examples')}
    hj tree                        # See the page
    hj tree -d 5                   # Deeper tree
    hj click 42                    # Click by ref
    hj click "#submit"             # Click by selector
    hj type 10 Hello world         # Type text
    hj key Enter                   # Press Enter
    hj key a --ctrl                # Ctrl+A
    hj eval document.title         # Get page title
    hj navigate https://example.com
    hj events                      # See what happened
    hj send claude "check this"    # Message an agent
    hj send selection              # Send selection to agent
`
}

function bold(s) { return `\x1b[1m${s}\x1b[0m` }
