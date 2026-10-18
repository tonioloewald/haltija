/**
 * The launcher's own flags, and `--flag=value` support for the ones that take a value.
 *
 * The launcher read flags with `args.indexOf('--token')`, so `--token=secret` and a typo like
 * `--tokn secret` both started a server with NO token, silently (1.13.0 review). With the #815 gate
 * that mostly fails closed for other machines, but a tunnel on this machine connects from loopback,
 * and the README sends tunnel users to `--token`. So: accept the `=` form, and say when a flag is not
 * one the launcher knows.
 */
export const VALUE_FLAGS = [
  '--port', '--https-port', '--token', '--name', '--port-file',
  '--headless-url', '--snapshots-dir', '--docs-dir',
]
export const BOOLEAN_FLAGS = [
  '--app', '--server', '--headless', '--ci', '--http', '--https', '--both', '--force', '-f',
  '--wait-ready', '--private', '--setup-mcp', '--setup-mcp-check', '--setup-mcp-remove',
  '--help', '-h',
]

/** `--token=x` becomes `--token x`, for the value flags only. Returns the unknown flags it saw. */
export function normalizeLauncherArgs(args) {
  const out = []
  const unknown = []
  for (const a of args) {
    const eq = a.indexOf('=')
    const flag = a.startsWith('-') && eq > 0 ? a.slice(0, eq) : a
    if (flag !== a && VALUE_FLAGS.includes(flag)) {
      out.push(flag, a.slice(eq + 1))
      continue
    }
    if (a.startsWith('-') && !VALUE_FLAGS.includes(a) && !BOOLEAN_FLAGS.includes(a)) unknown.push(a)
    out.push(a)
  }
  return { args: out, unknown }
}
