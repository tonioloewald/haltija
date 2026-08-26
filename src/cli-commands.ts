/**
 * The authoritative list of what `hj` accepts — one place, so nothing can drift from it.
 *
 * This surface used to be hand-maintained in three files that disagreed:
 *  - `KNOWN_COMMANDS` in `bin/cli-subcommand.mjs` (what actually dispatches),
 *  - the `listSubcommands()` blurb (what `--help` prints — ~26 of ~66),
 *  - `KNOWN_FLAGS` (which flags a command accepts).
 *
 * Everything that went wrong followed from that split: `hj wait` had an endpoint and an arg map but
 * was never in `KNOWN_COMMANDS`, so the remedy haltija itself printed died with "Unknown command";
 * per-command `--help` grepped the blurb and told users 40 real commands didn't exist; and five
 * endpoints emit hints naming `hj <cmd>` for commands the CLI has never had.
 *
 * The server-side hint writers import `cliNameForEndpoint` from here so they can only ever print a
 * command that exists.
 */

/** Commands routed to a REST endpoint. */
export const ROUTED_COMMANDS = [
  'tree', 'map', 'query', 'inspect', 'inspectAll', 'styles', 'find', 'form', 'wait',
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
  // Session mirror (#37) — read-only by design; there is deliberately no session-write.
  'session-attach', 'session-read', 'session-detach',
  'send', 'send-message', 'send-selection', 'send-recording',
  'status', 'version', 'docs', 'api', 'stats', 'where',
] as const

/** Commands `hj` handles itself — never routed, so they don't appear in the endpoint schema. */
export const LOCAL_COMMANDS = ['where', 'servers', 'ls', 'doctor', 'shutdown', 'quit'] as const

/**
 * What each local command is FOR, and what it prints.
 *
 * Routed commands get their `--help` body from two generated sources — the schema-derived hint
 * (flags + see-also) and the one-line blurb in `listSubcommands()`. Local commands have neither, so
 * `hj doctor --help` and `hj where --help` printed a bold header, the line "Runs client-side (no
 * page interaction)", and nothing else.
 *
 * Those are exactly the commands this release is about. Telling an agent to run `hj doctor` when it
 * doubts an answer, and then having `hj doctor --help` say nothing about what a verdict means, is
 * the documentation equivalent of the empty diagnostics we spent this cycle fixing.
 *
 * Kept HERE, beside the command list, so a new local command that lands without a description is
 * visible in the same diff — and `src/adopter-context.test.ts` fails if one is missing.
 */
export const LOCAL_COMMAND_HELP: Record<string, { summary: string; detail: string }> = {
  where: {
    summary: 'Which server this shell targets, and why',
    detail:
      'Prints the resolved port, WHICH rule chose it (--port > --name/HALTIJA_NAME > HALTIJA_PORT >\n' +
      '  cwd match > the 8700 default), and what is actually alive there — version, tab count,\n' +
      '  declared origins. Start here when a command drove the wrong browser: a misroute is silent\n' +
      '  and looks like a flaky test rather than an error.\n\n' +
      '  Flags: --json',
  },
  servers: {
    summary: 'Every live haltija, with the one you would drive marked',
    detail:
      'Enumerates registry entries, the well-known defaults 8700/8701 (probed, to catch anything\n' +
      '  unregistered), and this shell\'s resolved target — port, name, version, tab count, and\n' +
      '  whether it is the desktop app. The one `hj` would talk to is marked with ▸.\n' +
      '  Target another with `hj --port <n>` or `hj --name <name>`.\n\n' +
      '  Alias: hj ls    Flags: --json',
  },
  ls: { summary: 'Alias for `hj servers`', detail: 'See `hj servers --help`.' },
  doctor: {
    summary: 'Preflight: is this thing drivable? (exits non-zero if not)',
    detail:
      'Checks the server is reachable, a browser is connected, a tab is drivable, and the client\n' +
      '  and server versions agree. Reports THREE verdicts, not two:\n\n' +
      '    ✓  checked, and fine\n' +
      '    ✗  checked, and broken   → exits 1\n' +
      '    ?  could NOT be checked  → not a pass; use --strict to make it exit 1 too\n\n' +
      '  The third state exists because "I verified this" and "I could not verify this" are\n' +
      '  different facts, and collapsing them into ✓ is how a preflight reports green on a server\n' +
      '  it never reached.\n\n' +
      '  Flags: --json, --strict (also HALTIJA_STRICT=1)',
  },
  shutdown: {
    summary: 'Ask the target server to stop, cleanly',
    detail:
      'POSTs /shutdown, so the server releases its port and removes its registry entry itself.\n' +
      '  This is a request, not a signal — haltija never maps a port to a pid and kills it, because\n' +
      '  `lsof -i :PORT` matches CONNECTED CLIENTS as well as listeners and would happily return a\n' +
      '  browser that has been open since login.\n\n' +
      '  On a private desktop instance this tears down the whole app (server + Electron).\n\n' +
      '  Alias: hj quit',
  },
  quit: { summary: 'Alias for `hj shutdown`', detail: 'See `hj shutdown --help`.' },
}

const ALL = new Set<string>([...ROUTED_COMMANDS, ...LOCAL_COMMANDS])

/** Does `hj <name>` actually work? */
export function isKnownCommand(name: string): boolean {
  return ALL.has(name)
}

/**
 * The `hj` subcommand for a REST path, or **null** when that endpoint has no CLI form.
 *
 * Returning null is the whole point: an error hint that says "try `hj dialog-configure --help`"
 * for a command that has never existed is worse than no hint, and this repo's own rule is that a
 * printed remedy is a testable claim. Callers fall back to `hj api` / the REST path.
 */
export function cliNameForEndpoint(path: string): string | null {
  const name = path.replace(/^\//, '').replace(/\//g, '-')
  return isKnownCommand(name) ? name : null
}
