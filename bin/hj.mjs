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

import { runSubcommand, isSubcommand, getSuggestion, listSubcommands } from './cli-subcommand.mjs'

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

const subcommand = args[0]
const subArgs = args.slice(1).filter(a => a !== '--window' || true) // keep all args

if (!isSubcommand(subcommand)) {
  const suggestion = getSuggestion(subcommand)
  if (suggestion === '--help') {
    console.log(listSubcommands())
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
  runSubcommand(subcommand, subArgs, port)
}
