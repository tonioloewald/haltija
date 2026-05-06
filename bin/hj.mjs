#!/usr/bin/env node
/**
 * hj - Short alias for haltija CLI subcommands
 * 
 * Usage:
 *   hj tree              # DOM tree
 *   hj click @42         # Click by ref
 *   hj type @10 hello    # Type text
 *   hj eval 1+1          # Eval JS
 *   hj status            # Server status
 */

import { runSubcommand, isSubcommand, getSuggestion, listSubcommands, COMMAND_HINTS } from './cli-subcommand.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)

/**
 * Resolve a named haltija instance to its port by reading
 * ~/.haltija/servers/<name>.json. Returns null if the file is missing,
 * malformed, or the recorded pid is no longer alive.
 */
function lookupNamedInstance(name) {
  const path = join(homedir(), '.haltija', 'servers', `${name}.json`)
  if (!existsSync(path)) return null
  let entry
  try {
    entry = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
  if (entry?.pid) {
    try { process.kill(entry.pid, 0) } catch { return null }
  }
  return entry
}

if (!args.length || args.includes('--help') || args.includes('-h')) {
  const bold = (s) => `\x1b[1m${s}\x1b[0m`
  const dim = (s) => `\x1b[2m${s}\x1b[0m`
  console.log(`
${bold('hj')} - Haltija command-line interface

Usage: hj <command> [args...]

${dim('Targeting a specific haltija server (per-shell):')}
  ${dim('haltija --name api --server')}   # in another shell: register as "api"
  ${dim('export HALTIJA_NAME=api')}       # all hj calls in this shell talk to "api"
  ${dim('hj --name api tree')}            # one-off name override
  ${dim('export HALTIJA_PORT=9123')}      # bypass the registry; talk to a port directly
  ${dim('hj --port 9123 tree')}           # one-off port override
  ${dim('export HALTIJA_TOKEN=secret')}   # required when server was started with HALTIJA_TOKEN
  ${dim('hj --token secret tree')}        # one-off token override
${listSubcommands()}
Run ${dim('hj --help')} for this help.
Run ${dim('haltija --help')} for server/app options.
`)
  process.exit(0)
}

// Parse --name option (or HALTIJA_NAME env): resolve to a port via
// ~/.haltija/servers/<name>.json, written by `haltija --name <foo>`.
let resolvedName = process.env.HALTIJA_NAME || ''
const nameIdx = args.indexOf('--name')
if (nameIdx !== -1 && args[nameIdx + 1]) {
  resolvedName = args[nameIdx + 1]
  args.splice(nameIdx, 2)
}

// Port resolution priority:
//   --port flag > --name/HALTIJA_NAME registry lookup > HALTIJA_PORT env
//   > DEV_CHANNEL_PORT env > 8700 default
let port = process.env.HALTIJA_PORT || process.env.DEV_CHANNEL_PORT || '8700'
if (resolvedName) {
  const entry = lookupNamedInstance(resolvedName)
  if (entry) {
    port = String(entry.port)
  } else {
    console.error(`hj: no live haltija instance named "${resolvedName}".`)
    console.error(`Start one with:  haltija --name ${resolvedName} --server`)
    process.exit(1)
  }
}
const portIdx = args.indexOf('--port')
if (portIdx !== -1 && args[portIdx + 1]) {
  port = args[portIdx + 1]
  args.splice(portIdx, 2)
}

// Parse --token option (sets HALTIJA_TOKEN env so cli-subcommand.mjs picks it up).
const tokenIdx = args.indexOf('--token')
if (tokenIdx !== -1 && args[tokenIdx + 1]) {
  process.env.HALTIJA_TOKEN = args[tokenIdx + 1]
  args.splice(tokenIdx, 2)
}

// Parse --no-launch option (skip auto-launching Electron app)
let noLaunch = false
const noLaunchIdx = args.indexOf('--no-launch')
if (noLaunchIdx !== -1) {
  noLaunch = true
  args.splice(noLaunchIdx, 1)
}

// --- Space-to-hyphen sub-command resolution ---
// "hj test run foo.json" → "hj test-run foo.json"
// "hj events watch" → "hj events-watch"
// "hj recording start" → "hj recording-start"
// Works even when args[0] is a known command (e.g., "events" is valid, but "events watch" → "events-watch")
if (args.length >= 2 && isSubcommand(`${args[0]}-${args[1]}`)) {
  args.splice(0, 2, `${args[0]}-${args[1]}`)
}

// --- Bare noun defaults ---
// "hj test" → "hj test-run", "hj mutations" → "hj mutations-status", etc.
const NOUN_DEFAULTS = {
  'test': 'test-run',
  'events': 'events',       // already a command (GET /events)
  'mutations': 'mutations-status',
  'network': 'network',     // already a command (GET /network)
  'select': 'select-status',
  'tabs': 'windows',        // show tab list
  'video': 'video-status',
  'send': 'send',           // already a command
}
if (args.length === 1 && !isSubcommand(args[0]) && NOUN_DEFAULTS[args[0]]) {
  args[0] = NOUN_DEFAULTS[args[0]]
}

const subcommand = args[0]
const subArgs = args.slice(1).filter(a => a !== '--window' || true) // keep all args

if (!isSubcommand(subcommand)) {
  const suggestion = getSuggestion(subcommand)
  if (suggestion === '--help') {
    // hj help <topic> — filter help output by topic
    const topic = args[1]
    if (topic) {
      filterHelp(topic)
    } else {
      console.log(listSubcommands())
    }
    process.exit(0)
  }

  // Auto-execute if there's exactly one fuzzy match
  if (suggestion) {
    runSubcommand(suggestion, subArgs, port, { noLaunch })
  } else {
    console.error(`Unknown command: '${subcommand}'`)
    console.error(`\nExamples: hj tree, hj navigate <url>, hj click @42`)
    console.error(`Run 'hj' for docs.`)
    process.exit(1)
  }
} else {
  runSubcommand(subcommand, subArgs, port, { noLaunch })
}

function filterHelp(topic) {
  const bold = (s) => `\x1b[1m${s}\x1b[0m`
  const dim = (s) => `\x1b[2m${s}\x1b[0m`
  const needle = topic.toLowerCase()
  const helpText = listSubcommands()
  const lines = helpText.split('\n')

  const matches = []
  let currentCategory = ''

  for (const line of lines) {
    // Detect category headers (bold ANSI text with no leading spaces beyond the initial 2)
    if (line.match(/^\s{2}\x1b\[1m/)) {
      currentCategory = line
      continue
    }

    // Match content lines against topic
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase()
    if (stripped.trim() && stripped.includes(needle)) {
      matches.push({ category: currentCategory, line })
    }
  }

  if (matches.length === 0) {
    console.log(`No commands matching '${topic}'.`)
    console.log(`Run ${dim('hj help')} to see all commands.`)
    return
  }

  console.log(`\nCommands matching '${bold(topic)}':\n`)
  let lastCategory = ''
  for (const m of matches) {
    if (m.category && m.category !== lastCategory) {
      console.log(m.category)
      lastCategory = m.category
    }
    console.log(m.line)
  }

  // Also show matching hints
  const hintMatches = Object.entries(COMMAND_HINTS).filter(([cmd, hint]) =>
    cmd.toLowerCase().includes(needle) || hint.toLowerCase().includes(needle)
  )
  if (hintMatches.length > 0) {
    console.log(`\n  ${bold('Hints')}`)
    for (const [cmd, hint] of hintMatches) {
      console.log(`    ${bold(cmd.padEnd(28))} ${dim(hint)}`)
    }
  }
  console.log('')
}
