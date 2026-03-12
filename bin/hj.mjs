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

const args = process.argv.slice(2)

if (!args.length || args.includes('--help') || args.includes('-h')) {
  const bold = (s) => `\x1b[1m${s}\x1b[0m`
  const dim = (s) => `\x1b[2m${s}\x1b[0m`
  console.log(`
${bold('hj')} - Haltija command-line interface

Usage: hj <command> [args...]
${listSubcommands()}
Run ${dim('hj --help')} for this help.
Run ${dim('haltija --help')} for server/app options.
`)
  process.exit(0)
}

// Parse --port option
let port = process.env.DEV_CHANNEL_PORT || '8700'
const portIdx = args.indexOf('--port')
if (portIdx !== -1 && args[portIdx + 1]) {
  port = args[portIdx + 1]
  args.splice(portIdx, 2)
}

// Parse --session option (set session token)
const sessionIdx = args.indexOf('--session')
if (sessionIdx !== -1 && args[sessionIdx + 1]) {
  process.env.HALTIJA_SESSION = args[sessionIdx + 1]
  args.splice(sessionIdx, 2)
}

// Parse --no-launch option (skip auto-launching Electron app)
let noLaunch = false
const noLaunchIdx = args.indexOf('--no-launch')
if (noLaunchIdx !== -1) {
  noLaunch = true
  args.splice(noLaunchIdx, 1)
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
  
  let msg = `Unknown command: '${subcommand}'`
  if (suggestion) {
    msg += ` — did you mean '${suggestion}'?`
  }
  console.error(msg)
  console.error(`\nExamples: hj tree, hj navigate <url>, hj click @42`)
  console.error(`Run 'hj' for docs.`)
  process.exit(1)
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
