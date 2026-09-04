import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { isRefusedMachineControlPath } from './machine-control'

/**
 * The desktop app must not reach machine control over HTTP (#40).
 *
 * This test exists because converting call sites BY ENUMERATION failed twice in one sitting.
 * First pass: "remove the four dangerous routes" left `/files/tree` and `/files/image` serving.
 * Second pass: `terminal.html` was converted thoroughly while `tabs.js` and `agent-status.js` were
 * forgotten entirely — so six renderer calls silently began returning 410, which is how the
 * "Pick folder…" button stopped working (it sends a `cd` through /terminal/command). Both times
 * the mistake was a human list; the fix is a rule a machine checks.
 *
 * A refused path reached with `fetch()` is a bug by construction: those prefixes are 410 on every
 * network transport, so it cannot work. Machine control goes through `machineFetch` (renderer, has
 * the preload bridge) or `hjFetch` (the terminal iframe, which does not).
 */
const DESKTOP = join(import.meta.dir, '../apps/desktop')

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // `dist/` holds built app bundles, and node_modules is not ours.
    if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === 'resources') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, acc)
    else if (/\.(js|html)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe('the desktop app never fetches machine control over HTTP', () => {
  it('has no fetch() to a refused prefix', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(DESKTOP)) {
      const text = readFileSync(file, 'utf-8')
      text.split('\n').forEach((line, i) => {
        // Any fetch whose URL template reaches /terminal/ or /files/, however the base is spelled.
        const m = line.match(/fetch\(`[^`]*?(\/(?:terminal|files)\/[a-z-]*)/)
        if (m && isRefusedMachineControlPath(m[1].replace(/\/$/, '') || m[1])) {
          offenders.push(`${file.replace(DESKTOP, 'apps/desktop')}:${i + 1} -> ${m[1]}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('the relocated agent list is reached at /agents, not the refused /terminal/agents', () => {
    const text = sourceFiles(DESKTOP).map((f) => readFileSync(f, 'utf-8')).join('\n')
    expect(text).not.toContain('/terminal/agents')
  })
})
