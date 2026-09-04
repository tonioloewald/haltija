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
  it('has no fetch() to a refused prefix, however the URL is spelled', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(DESKTOP)) {
      const text = readFileSync(file, 'utf-8')
      text.split('\n').forEach((line, i) => {
        // Match the CALL and the PATH independently, instead of requiring a template literal
        // immediately after `fetch(`. The previous version only recognised
        // fetch(`...${x}/files/read`) — so fetch(getServerUrl() + '/files/read') and
        // fetch("/terminal/command") both passed green and 410'd at runtime, which is precisely
        // the silent breakage this test exists to prevent. Its comment claimed "however the base
        // is spelled"; that was true for one spelling of three.
        // Comments discuss these paths constantly now (the prose explaining WHY they moved names
        // both `fetch()` and `/terminal/command`), so a line-scoped scan must skip them or the
        // guard cries wolf and gets deleted — which is how a guard stops guarding.
        const code = line.trimStart()
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return
        const isPlainFetch = /(?<![.\w])fetch\s*\(/.test(line)
        if (!isPlainFetch) return
        const m = line.match(/['"`]?(\/(?:terminal|files)\/[a-z-]+)/)
        if (m && isRefusedMachineControlPath(m[1])) {
          offenders.push(`${file.replace(DESKTOP, 'apps/desktop')}:${i + 1} -> ${m[1]}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  // Known limit, stated rather than implied: the scan is line-scoped, so a URL assembled across
  // several lines is invisible to it. That is a narrower gap than the one it replaced, and naming
  // it is what stops the next person trusting it further than it goes.
  it('recognises non-template call shapes (the gap that shipped a broken Pick folder…)', () => {
    const samples = [
      "const r = await fetch(getServerUrl() + '/files/read?path=x')",
      'const r = await fetch("/terminal/command", { method: "POST" })',
      'fetch(`${BASE_URL}/files/tree`)',
    ]
    for (const line of samples) {
      const isPlainFetch = /(?<![.\w])fetch\s*\(/.test(line)
      const m = line.match(/['"`]?(\/(?:terminal|files)\/[a-z-]+)/)
      expect(isPlainFetch && !!m && isRefusedMachineControlPath(m![1])).toBe(true)
    }
  })

  // machineFetch/hjFetch are the sanctioned paths and must NOT be flagged, or the guard becomes
  // noise and gets deleted.
  it('does not flag the sanctioned helpers', () => {
    for (const line of ["await machineFetch(`/terminal/command`, {})", "await hjFetch(`/files/tree`)"]) {
      expect(/(?<![.\w])fetch\s*\(/.test(line)).toBe(false)
    }
  })

  it('the relocated agent list is reached at /agents, not the refused /terminal/agents', () => {
    const text = sourceFiles(DESKTOP).map((f) => readFileSync(f, 'utf-8')).join('\n')
    expect(text).not.toContain('/terminal/agents')
  })
})
