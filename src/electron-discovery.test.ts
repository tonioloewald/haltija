import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Electron discovery must not assume macOS (#43, from snowfox).
 *
 * `resolveElectronBinary()` searched the npx cache for `Electron.app` — a macOS bundle — behind a
 * `platform() !== 'win32'` guard. Linux took that branch and matched nothing, so a populated cache
 * was never detected: the launcher printed "Electron not cached" on every run and fell back to
 * `npx --yes electron`, putting an npm-registry round-trip on the browser-readiness path. A
 * registry degradation on 2026-09-04 turned that into a server that never bound its port across
 * three CI lanes.
 *
 * The defect was two expressions of "what an Electron dist looks like", only one platform-aware.
 * `binaryInDist()` is the one that knows; the search must find dist DIRECTORIES and let it decide.
 *
 * CI would not have caught this: the Linux lane still worked, just slower and dependent on the
 * registry being healthy. That is why the guard is here rather than left to a green build.
 */
const LAUNCHER = readFileSync(join(import.meta.dir, '../bin/tosijs-dev.mjs'), 'utf-8')

describe('Electron discovery is platform-neutral where it must be', () => {
  it('the npx-cache search does not look for a macOS bundle', () => {
    const findCmd = LAUNCHER.match(/`find \$\{homedir\(\)\}\/\.npm\/_npx[^`]*`/)
    expect(findCmd).not.toBeNull()
    // Naming Electron.app here is exactly the bug: it cannot match on Linux, where the binary is
    // `dist/electron`.
    expect(findCmd![0]).not.toContain('Electron.app')
    expect(findCmd![0]).not.toContain('.exe')
  })

  it('the search targets dist directories, so binaryInDist stays the only authority', () => {
    const findCmd = LAUNCHER.match(/`find \$\{homedir\(\)\}\/\.npm\/_npx[^`]*`/)![0]
    expect(findCmd).toContain('*/electron/dist')
  })

  it('binaryInDist still covers all three platforms', () => {
    // The single place allowed to know platform-specific binary names.
    const fn = LAUNCHER.slice(LAUNCHER.indexOf('const binaryInDist'))
    expect(fn).toContain("Electron.app/Contents/MacOS/Electron")
    expect(fn).toContain("electron.exe")
    expect(fn).toMatch(/join\(distDir, 'electron'\)/)
  })
})
