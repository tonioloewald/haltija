/**
 * Pure arg helpers for the `hj` CLI, extracted so they can be unit-tested (see
 * src/hj-args.test.ts) — the leading-`--window` form was fully broken and shipped without a test.
 */

/**
 * Pull a `--window <id>` flag out of `args` from ANY position, returning the id and the remaining
 * args (input is not mutated). Mirrors how `--port`/`--name`/`--token` are pre-parsed, so both
 * `hj --window <id> <cmd>` (leading) and `hj <cmd> --window <id>` (trailing) resolve the same tab.
 * A `--window` with no following value is left in place (treated as not-a-target) so it surfaces as
 * a normal unknown-flag rather than silently swallowing the next real arg.
 */
export function extractWindowTarget(args) {
  const i = args.indexOf('--window')
  if (i === -1 || args[i + 1] === undefined) {
    return { windowTarget: null, args: [...args] }
  }
  const rest = [...args]
  rest.splice(i, 2)
  return { windowTarget: args[i + 1], args: rest }
}
