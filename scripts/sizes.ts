/**
 * Shipped bundle sizes, and the change since the recorded baseline (virta #1076, #3383).
 *
 *   bun scripts/sizes.ts                    print gzip sizes and the delta against dist-sizes.json
 *   bun scripts/sizes.ts --record           write dist-sizes.json from ./dist (do this at the tag)
 *   bun scripts/sizes.ts --record --dist D  record from another build's dist (D), e.g. a worktree
 *
 * The baseline names the version it was recorded at and the delta line prints it, so a stale
 * baseline shows up as a cumulative delta with an old version beside it (practices: releasing.md,
 * "Track bundle size on every release"). The build runs the print form after every build.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { gzipSync } from 'zlib'

/** What adopters load: the widget (both forms), the server, the CLI and the MCP bundle. */
export const SIZED_FILES = ['component.js', 'component.esm.js', 'index.js', 'server.js', 'hj.js', 'mcp.js']

const ROOT = join(import.meta.dir, '..')
const BASELINE = join(ROOT, 'dist-sizes.json')

function measure(dist: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of SIZED_FILES) {
    const p = join(dist, f)
    if (existsSync(p)) out[f] = gzipSync(readFileSync(p), { level: 9 }).length
  }
  return out
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`

const args = process.argv.slice(2)
const distArg = args.indexOf('--dist')
const dist = distArg >= 0 ? args[distArg + 1] : join(ROOT, 'dist')
const sizes = measure(dist)

if (args.includes('--record')) {
  const version = JSON.parse(readFileSync(join(dist, '..', 'package.json'), 'utf8')).version
  writeFileSync(BASELINE, JSON.stringify({ version, gzip: sizes }, null, 2) + '\n')
  console.log(`recorded dist-sizes.json at ${version}`)
} else {
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null
  console.log(`  gzip sizes${base ? ` (change since ${base.version})` : ' (no dist-sizes.json baseline)'}:`)
  for (const [f, n] of Object.entries(sizes)) {
    const was = base?.gzip?.[f]
    const delta = typeof was === 'number' ? `  ${n >= was ? '+' : '-'}${kb(Math.abs(n - was))}` : ''
    console.log(`    ${f.padEnd(18)} ${kb(n).padStart(9)}${delta}`)
  }
}
