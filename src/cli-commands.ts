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
  'send', 'send-message', 'send-selection', 'send-recording',
  'status', 'version', 'docs', 'api', 'stats', 'where',
] as const

/** Commands `hj` handles itself — never routed, so they don't appear in the endpoint schema. */
export const LOCAL_COMMANDS = ['where', 'servers', 'ls', 'doctor', 'shutdown', 'quit'] as const

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
