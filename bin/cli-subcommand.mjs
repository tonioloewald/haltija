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
import { existsSync } from 'fs'
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

// Compound paths (subcommand contains slash)
export const COMPOUND_PATHS = {
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
}

// GET compound endpoints
export const GET_COMPOUND = new Set([
  'mutations-status', 'events-stats', 'select-status', 'select-result'
])

// How to map positional args to body fields for each endpoint
export const ARG_MAPS = {
  click: (args) => parseTargetArgs(args),
  type: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), text: args.slice(1).join(' ') }),
  key: (args) => ({ key: args[0], ...parseModifiers(args.slice(1)) }),
  drag: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), deltaX: num(args[1]), deltaY: num(args[2]) }),
  scroll: (args) => parseScrollArgs(args),
  navigate: (args) => ({ url: args[0] }),
  eval: (args) => ({ code: args.join(' ') }),
  query: (args) => ({ selector: args[0] }),
  inspect: (args) => parseTargetArgs(args),
  'inspectAll': (args) => ({ selector: args[0] }),
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
}

/** Parse a target argument — number ref or selector */
export function parseTargetArgs(args) {
  if (!args.length || !args[0]) return {}
  const target = args[0]
  // Number → ref
  if (/^\d+$/.test(target)) return { ref: target }
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
  const serverPath = join(__dirname, '../dist/server.js')
  if (!existsSync(serverPath)) {
    console.error('Error: Server not built. Run `bun run build` first.')
    process.exit(1)
  }

  // Try bun first, fall back to node
  let command = 'bun'
  let cmdArgs = ['run', serverPath]
  try {
    const { execSync } = await import('child_process')
    execSync('bun --version', { stdio: 'ignore' })
  } catch {
    command = 'node'
    cmdArgs = [serverPath]
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

/** Check if a string looks like a subcommand (not a flag, not a port number) */
export function isSubcommand(arg) {
  if (!arg || arg.startsWith('-')) return false
  if (/^\d+$/.test(arg)) return false  // Legacy port number
  return true
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
`
}

function bold(s) { return `\x1b[1m${s}\x1b[0m` }
