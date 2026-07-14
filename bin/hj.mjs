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
import { HJ_VERSION } from './version.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)

/** Where instance entries live. Mirrors DEFAULT_REGISTRY_DIR in src/sessions.ts. */
const REGISTRY_DIR = process.env.HALTIJA_REGISTRY_DIR || join(homedir(), '.haltija', 'servers')

if (args[0] === '--version' || args[0] === '-v') {
  console.log(HJ_VERSION)
  process.exit(0)
}

/**
 * Print what server this shell is currently targeting and what's alive
 * there. Reports the resolved port, the source of the resolution (flag,
 * env var, or registry lookup), and — if reachable — the server's
 * version, the named-instance label, tab count, and the focused tab.
 * Used as `hj where` (or `hj where --json` for structured output).
 */
async function runWhere(port, portSource, jsonOutput) {
  let serverInfo = null
  let serverError = null
  try {
    const resp = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(2000),
    })
    if (resp.ok) {
      serverInfo = await resp.json()
    } else {
      serverError = `HTTP ${resp.status}`
    }
  } catch (err) {
    serverError = err.code === 'ConnectionRefused' || err.cause?.code === 'ECONNREFUSED'
      ? 'no server is listening on this port'
      : err.message
  }
  // Look up the instance name (if any) by scanning ~/.haltija/servers/ for
  // an entry pointing at this port.
  let instanceName = null
  try {
    const dir = REGISTRY_DIR
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue
        try {
          const entry = JSON.parse(readFileSync(join(dir, file), 'utf-8'))
          if (entry.port === Number(port)) {
            try { process.kill(entry.pid, 0); instanceName = entry.name } catch {}
          }
        } catch {}
      }
    }
  } catch {}

  const focused = serverInfo?.windows?.find(w => w.focused) || serverInfo?.windows?.[0]
  const tabs = serverInfo?.windows?.length ?? 0

  if (jsonOutput) {
    console.log(JSON.stringify({
      port: Number(port),
      portSource,
      reachable: !!serverInfo,
      error: serverError,
      client: HJ_VERSION,
      versionSkew: serverInfo ? serverInfo.serverVersion !== HJ_VERSION : null,
      server: serverInfo ? {
        version: serverInfo.serverVersion,
        instanceName,
        desktopApp: !!serverInfo.desktopApp,
        tabs,
        agents: serverInfo.agents,
        focused: focused ? { id: focused.id, url: focused.url, title: focused.title } : null,
      } : null,
    }, null, 2))
    return
  }

  const bold = (s) => `\x1b[1m${s}\x1b[0m`
  const dim = (s) => `\x1b[2m${s}\x1b[0m`
  console.log(`${bold('port:')}   ${port} ${dim(`(${portSource})`)}`)
  if (!serverInfo) {
    console.log(`${bold('server:')} ${dim(`unreachable — ${serverError}`)}`)
    return
  }
  const desc = [
    `haltija ${serverInfo.serverVersion}`,
    instanceName ? `name=${instanceName}` : null,
    serverInfo.desktopApp ? 'desktop app' : null,
    `${tabs} tab${tabs === 1 ? '' : 's'}`,
    serverInfo.agents > 0 ? `${serverInfo.agents} agent${serverInfo.agents === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ')
  console.log(`${bold('server:')} ${desc}`)
  console.log(`${bold('client:')} hj ${HJ_VERSION}`)
  if (focused) {
    console.log(`${bold('focused:')} ${focused.title || dim('(no title)')} ${dim(`— ${focused.url}`)}`)
  } else if (tabs === 0) {
    console.log(`${bold('focused:')} ${dim('no tabs connected')}`)
  }
  if (serverInfo.serverVersion && serverInfo.serverVersion !== HJ_VERSION) {
    console.log(`\n${bold('warning:')} hj ${HJ_VERSION} is talking to server ${serverInfo.serverVersion}.`)
    console.log(dim(`  Commands may route or format wrongly. Update with: bun install -g haltija@latest`))
  }
}

/**
 * Resolve a named haltija instance to its port by reading
 * ~/.haltija/servers/<name>.json. Returns null if the file is missing,
 * malformed, or the recorded pid is no longer alive.
 */
function lookupNamedInstance(name) {
  const path = join(REGISTRY_DIR, `${name}.json`)
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

/**
 * Every live entry in ~/.haltija/servers/. Mirrors `list()` in src/sessions.ts —
 * duplicated rather than imported because this file is plain .mjs bundled
 * standalone into dist/hj.js, with no access to the compiled TS.
 */
function listLiveInstances() {
  const dir = REGISTRY_DIR
  if (!existsSync(dir)) return []
  const out = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const entry = lookupNamedInstance(file.slice(0, -'.json'.length))
    if (entry) out.push(entry)
  }
  return out
}

/** True if `dir` is `p` or one of its ancestors (segment-wise, not raw prefix). */
function isAncestorOf(dir, p) {
  if (!dir || !p) return false
  if (dir === p) return true
  return p.startsWith(dir.endsWith('/') ? dir : dir + '/')
}

/**
 * Find the live server that owns `cwd` — the one whose recorded directory is
 * the nearest ancestor of it. This is what makes plain `hj` inside a project
 * reach *that project's* server instead of the global default port.
 *
 * `/` and the home directory are ancestors of everything, so servers started
 * there can't win a match; otherwise they'd capture every project on the box.
 */
function resolveByCwd(cwd, instances) {
  const candidates = instances.filter(
    (e) => e.cwd && e.cwd !== '/' && e.cwd !== homedir() && isAncestorOf(e.cwd, cwd),
  )
  if (!candidates.length) return null
  candidates.sort((a, b) => b.cwd.length - a.cwd.length || (b.startedAt || 0) - (a.startedAt || 0))
  return candidates[0]
}

if (!args.length || args.includes('--help') || args.includes('-h')) {
  const bold = (s) => `\x1b[1m${s}\x1b[0m`
  const dim = (s) => `\x1b[2m${s}\x1b[0m`
  console.log(`
${bold('hj')} - Haltija command-line interface

Usage: hj <command> [args...]

${dim('Which server does hj talk to?')}
  ${dim('By default, the one that owns the directory you are in: a haltija server')}
  ${dim('records where it was started, and hj picks the one whose directory is the')}
  ${dim('nearest ancestor of your cwd. So inside a project with its own server,')}
  ${dim('plain `hj tree` just works. Otherwise it falls back to port 8700.')}
  ${dim('Run `hj where` to see the port, WHY it was chosen, and what is alive there.')}

${dim('Overriding that (per-shell):')}
  ${dim('haltija --name api --server')}   # in another shell: register as "api"
  ${dim('export HALTIJA_NAME=api')}       # all hj calls in this shell talk to "api"
  ${dim('hj --name api tree')}            # one-off name override
  ${dim('export HALTIJA_PORT=9123')}      # bypass the registry; talk to a port directly
  ${dim('hj --port 9123 tree')}           # one-off port override
  ${dim('export HALTIJA_TOKEN=secret')}   # required when server was started with HALTIJA_TOKEN
  ${dim('hj --token secret tree')}        # one-off token override
  ${dim('hj --version')}                  # which hj is this?
${listSubcommands()}
Run ${dim('hj --help')} for this help.
Run ${dim('haltija --help')} for server/app options.
`)
  process.exit(0)
}

// Parse --name option (or HALTIJA_NAME env): resolve to a port via
// ~/.haltija/servers/<name>.json, written by `haltija --name <foo>`.
let resolvedName = process.env.HALTIJA_NAME || ''
let nameSource = resolvedName ? 'HALTIJA_NAME env' : ''
const nameIdx = args.indexOf('--name')
if (nameIdx !== -1 && args[nameIdx + 1]) {
  resolvedName = args[nameIdx + 1]
  nameSource = '--name flag'
  args.splice(nameIdx, 2)
}

// Parse --port up front. It must be consumed BEFORE resolution runs: the
// fallback branch below warns about landing on the default port, and if --port
// were still unparsed at that moment, `hj --port 9999` would warn "you're on
// 8700, use --port" and then correctly use 9999 — a single run contradicting
// itself, telling the user to reach for the flag they just used.
let portFlag = ''
const portIdx = args.indexOf('--port')
if (portIdx !== -1 && args[portIdx + 1]) {
  portFlag = args[portIdx + 1]
  args.splice(portIdx, 2)
}

// Port resolution priority:
//   --port flag > --name/HALTIJA_NAME registry lookup > HALTIJA_PORT env
//   > DEV_CHANNEL_PORT env > cwd match against the registry > 8700 default
//
// The cwd step is what keeps projects from stepping on each other: a server
// started inside a project records its directory, so plain `hj` run anywhere
// under that directory routes to it. Without it, every `hj` in every project
// lands on 8700 and drives whatever browser is focused there — silently.
//
// Resolved highest-precedence-first and short-circuited, so each source is
// consulted only when nothing above it decided. Only the final, losing branch
// warns.
let port, portSource
if (portFlag) {
  port = portFlag
  portSource = '--port flag'
} else if (resolvedName) {
  const entry = lookupNamedInstance(resolvedName)
  if (!entry) {
    console.error(`hj: no live haltija instance named "${resolvedName}".`)
    console.error(`Start one with:  haltija --name ${resolvedName} --server`)
    process.exit(1)
  }
  port = String(entry.port)
  portSource = `name "${resolvedName}" via ${nameSource}`
} else if (process.env.HALTIJA_PORT) {
  port = process.env.HALTIJA_PORT
  portSource = 'HALTIJA_PORT env'
} else if (process.env.DEV_CHANNEL_PORT) {
  port = process.env.DEV_CHANNEL_PORT
  portSource = 'DEV_CHANNEL_PORT env (legacy)'
} else {
  const live = listLiveInstances()
  const cwdMatch = resolveByCwd(process.cwd(), live)
  if (cwdMatch) {
    port = String(cwdMatch.port)
    portSource = `cwd match: ${cwdMatch.name}`
  } else {
    port = '8700'
    portSource = '8700 (default)'
    // Falling back to the shared default while project servers are running is
    // the classic misroute — you think you're driving this project's browser
    // and you're driving someone else's. Say so rather than doing it quietly.
    // Reached only when nothing else selected a port, so it can't contradict an
    // explicit choice.
    if (live.length) {
      const names = live.map((e) => `${e.name} (${e.cwd})`).join(', ')
      console.error(`hj: warning — targeting the default port 8700, but these haltija servers are running: ${names}`)
      console.error(`hj: if you meant one of them, cd into its directory, or use --name/--port. See \`hj where\`.`)
    }
  }
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

// Did the shell explicitly target a private instance (--port / --name /
// HALTIJA_PORT / HALTIJA_NAME / DEV_CHANNEL_PORT)? If so, this is a
// project-owned server with a bring-your-own browser — auto-launching the
// standalone Haltija.app is never right (it runs its own server on 8700 and
// can't connect to this port), so we suppress the Electron launch and print
// an actionable hint instead. Only the bare, unconfigured 8700 default keeps
// the zero-config desktop auto-launch.
const explicitTarget = portSource !== '8700 (default)'

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

// `hj where` — show which haltija server this shell is targeting and what
// (if anything) is alive there. Pure client-side resolution plus a single
// /status probe; no side effects, no auto-launch, safe to run anywhere.
if (subcommand === 'where') {
  await runWhere(port, portSource, subArgs.includes('--json'))
  process.exit(0)
}

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
    runSubcommand(suggestion, subArgs, port, { noLaunch, explicitTarget })
  } else {
    console.error(`Unknown command: '${subcommand}'`)
    console.error(`\nExamples: hj tree, hj navigate <url>, hj click @42`)
    console.error(`Run 'hj' for docs.`)
    process.exit(1)
  }
} else {
  runSubcommand(subcommand, subArgs, port, { noLaunch, explicitTarget })
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
