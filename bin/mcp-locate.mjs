/**
 * Where the MCP server is, and the command an MCP client should run to start it. ONE copy, used by
 * both setup paths (`haltija --setup-mcp` for Claude Desktop, `haltija-mcp-setup` for Claude Code).
 * They had a finder each, both looking for `apps/mcp/build/index.js`, which the npm package never
 * contained — so setup failed for every npm user (GitHub #47).
 *
 * The server is `dist/mcp.js`, a single bundle with its dependencies inlined: npm never installs a
 * nested package's dependencies, so an unbundled server could not have imported its SDK.
 */
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Absolute path of the bundled MCP server in this package, or null (a checkout that never built). */
export function mcpServerPath(root = PACKAGE_ROOT) {
  const p = join(root, 'dist', 'mcp.js')
  return existsSync(p) ? p : null
}

/**
 * The `{ command, args }` an MCP client config should hold. A package run through `npx` / `bunx`
 * lives in a cache that gets cleaned, so an absolute path there works today and breaks later with
 * nothing to say why; those get the version-pinned `npx` form instead.
 */
export function mcpServerCommand(serverPath, root = PACKAGE_ROOT) {
  if (/[\\/](_npx|bunx-[^\\/]*|\.bun[\\/]install[\\/]cache)[\\/]/.test(serverPath)) {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return { command: 'npx', args: ['-y', '-p', `haltija@${version}`, 'haltija-mcp'] }
  }
  return { command: 'node', args: [serverPath] }
}

/**
 * Why an existing `haltija` MCP entry can no longer start, or null when it looks runnable.
 *
 * Before 1.13.0 setup wrote `node …/apps/mcp/build/index.js`, a path the package no longer has, and
 * `--check` reported such an entry as configured while re-running setup said "already configured",
 * so nothing short of hand-editing the config could fix it. An entry that names a server file which
 * is not there is stale, whatever else it says; one that runs a command (`npx …`) is left alone.
 */
export function staleMcpEntry(entry) {
  const args = Array.isArray(entry?.args) ? entry.args : []
  const script = args.find((a) => typeof a === 'string' && /\.(m?js|ts)$/.test(a))
  if (!script) return null
  if (/[\\/]apps[\\/]mcp[\\/]build[\\/]/.test(script)) return `it runs ${script}, the pre-1.13 server location`
  if (!existsSync(script)) return `it runs ${script}, which does not exist`
  return null
}
