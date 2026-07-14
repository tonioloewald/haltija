/**
 * Tests for src/hj-install.ts — the code that can delete a file on someone's disk.
 *
 * These use REAL artifacts, not synthetic ones, because both shipped bugs were about real
 * artifacts the synthetic cases would have missed: our compiled `hj` is 63 MB with the only
 * `haltija` bytes ~62.7 M in, and the user shim that got destroyed was one that *mentions*
 * haltija because our own docs tell people to set `HALTIJA_PORT`.
 */

import { describe, expect, it } from 'bun:test'
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'fs'
import { join } from 'path'
import { HEAD_SCAN_BYTES, HJ_MARKER, TAIL_SCAN_BYTES, identifyHj, identifyHjBounded, planHjInstall, type HjState } from './hj-install'
import { isOlderThan } from './semver'

const REPO = join(import.meta.dir, '..')
const BUNDLE = join(REPO, 'dist', 'hj.js')
const COMPILED = join(REPO, 'apps', 'desktop', 'resources', 'hj-arm64')

const OURS = '1.4.0'
const plan = (s: HjState) => planHjInstall(s, OURS, isOlderThan)

describe('identifyHj — real artifacts', () => {
  it('recognizes our own JS bundle', () => {
    if (!existsSync(BUNDLE)) throw new Error('run `bun run build` first — dist/hj.js is the artifact under test')
    expect(identifyHj(readFileSync(BUNDLE))).toBe('ours')
  })

  it('recognizes our own COMPILED hj — the 63MB binary the old guard called foreign', () => {
    if (!existsSync(COMPILED)) {
      // Not built on every machine; the synthetic deep-marker case below covers the scan.
      return
    }
    const buf = readFileSync(COMPILED)

    // Guard the premise of the bug: any `haltija` bytes are far past a head window.
    expect(buf.length).toBeGreaterThan(1_000_000)
    expect(buf.subarray(0, 200_000).toString('latin1')).not.toMatch(/haltija/i)

    // The old guard returned false here — so for anyone who had run the DMG we refused to
    // touch our OWN binary, printed a false accusation every boot, and never repaired.
    // What matters is that we do not call it foreign. (This checked-in binary predates the
    // marker, so it lands in `ours-legacy` — which still repairs, correctly.)
    expect(identifyHj(buf)).not.toBe('foreign')
  })

  it('finds the marker far past the old 200KB window (the false-negative fix)', () => {
    // A compiled binary embeds the JS payload near the END. The old code decoded only the
    // first 200KB and therefore never saw it.
    const deep = Buffer.concat([Buffer.alloc(5_000_000, 0x00), Buffer.from(HJ_MARKER)])
    expect(deep.subarray(0, 200_000).includes(HJ_MARKER)).toBe(false)
    expect(identifyHj(deep)).toBe('ours')
  })
})

describe('identifyHj — foreign files must never be claimed', () => {
  it("does NOT claim a user's wrapper that mentions HALTIJA_PORT", () => {
    // THE regression. This exact shape passed the old substring sniff, so we executed the
    // user's script and then deleted it — and it's the most likely wrapper OUR OWN users
    // write, because the docs tell them to set HALTIJA_PORT.
    const shim = Buffer.from('#!/bin/sh\nHALTIJA_PORT=9123 exec /opt/hj "$@"\n')
    expect(identifyHj(shim)).toBe('foreign')
  })

  it("does NOT claim a user's unrelated hj script", () => {
    expect(identifyHj(Buffer.from('#!/bin/sh\necho "my own hj"\n'))).toBe('foreign')
  })

  it('does not claim a small file merely because it says "haltija"', () => {
    // The size gate is the discriminator: our bundle is tens of KB, a shim is not.
    expect(identifyHj(Buffer.from('#!/bin/sh\n# talks to haltija\nexec curl localhost:8700/tree\n'))).toBe('foreign')
  })

  it('does not claim a large unrelated binary', () => {
    expect(identifyHj(Buffer.alloc(2_000_000, 0x41))).toBe('foreign')
  })
})

describe('identifyHj — legacy artifacts (the ones we exist to repair)', () => {
  it('recognizes a pre-1.4.0 JS bundle, which carries no marker', () => {
    const legacy = Buffer.from('#!/usr/bin/env bun\n' + '// haltija cli bundle\n'.repeat(1000))
    expect(legacy.length).toBeGreaterThan(10_000)
    expect(legacy.includes(HJ_MARKER)).toBe(false)
    expect(identifyHj(legacy)).toBe('ours-legacy')
  })
})

describe('planHjInstall', () => {
  it('bootstraps when nothing is there', () => {
    expect(plan({ exists: false, isSymlink: false }).action).toBe('bootstrap')
  })

  it('leaves a working symlink completely alone', () => {
    expect(plan({ exists: true, isSymlink: true, symlinkResolves: true }).action).toBe('leave')
  })

  it('declines a dangling symlink rather than silently replacing a deliberate install', () => {
    expect(plan({ exists: false, isSymlink: true, symlinkResolves: false }).action).toBe('decline')
  })

  it('DECLINES a foreign file — never overwrite what is not ours', () => {
    expect(plan({ exists: true, isSymlink: false, identity: 'foreign' }).action).toBe('decline')
  })

  it('repairs one of our artifacts that cannot report a version (pre-1.4.0)', () => {
    expect(plan({ exists: true, isSymlink: false, identity: 'ours-legacy', reportedVersion: null }).action).toBe('repair')
  })

  it('repairs a strictly older hj', () => {
    expect(plan({ exists: true, isSymlink: false, identity: 'ours', reportedVersion: '1.3.4' }).action).toBe('repair')
  })

  it('leaves a current hj alone', () => {
    expect(plan({ exists: true, isSymlink: false, identity: 'ours', reportedVersion: '1.4.0' }).action).toBe('leave')
  })

  it('never downgrades a newer hj', () => {
    expect(plan({ exists: true, isSymlink: false, identity: 'ours', reportedVersion: '1.5.0' }).action).toBe('leave')
  })

  it('does not rewrite on a byte difference alone — same version means leave', () => {
    // The churn bug: two servers of the SAME version built from different local builds used
    // to rewrite hj past each other on every boot.
    expect(plan({ exists: true, isSymlink: false, identity: 'ours', reportedVersion: OURS }).action).toBe('leave')
  })
})

describe('identifyHjBounded — bounded reads, real 60MB binary', () => {
  /** A reader that records how many bytes it actually pulled off disk. */
  function fileReader(path: string) {
    let bytesRead = 0
    const fd = openSync(path, 'r')
    const read = (offset: number, length: number) => {
      const buf = Buffer.alloc(length)
      const n = readSync(fd, buf, 0, length, offset)
      bytesRead += n
      return buf.subarray(0, n)
    }
    return { read, bytes: () => bytesRead, close: () => closeSync(fd) }
  }

  it('identifies our 60MB compiled hj WITHOUT reading all 60MB', () => {
    if (!existsSync(COMPILED)) return
    const size = statSync(COMPILED).size
    const r = fileReader(COMPILED)
    try {
      const id = identifyHjBounded(size, r.read)
      expect(id).not.toBe('foreign')
      // The whole point: we must not slurp the entire binary on every server boot.
      expect(r.bytes()).toBeLessThan(size)
      expect(r.bytes()).toBeLessThanOrEqual(HEAD_SCAN_BYTES + TAIL_SCAN_BYTES)
    } finally {
      r.close()
    }
  })

  it('finds a marker that lives only in the tail', () => {
    // Exactly the compiled-binary shape: 20MB of runtime, marker appended at the end.
    const big = Buffer.concat([Buffer.alloc(20_000_000, 0x41), Buffer.from(HJ_MARKER)])
    const read = (o: number, l: number) => big.subarray(o, o + l)
    expect(identifyHjBounded(big.length, read)).toBe('ours')
  })

  it('still declines a large file that is not ours', () => {
    const big = Buffer.alloc(20_000_000, 0x41)
    const read = (o: number, l: number) => big.subarray(o, o + l)
    expect(identifyHjBounded(big.length, read)).toBe('foreign')
  })

  it('still declines a small user shim', () => {
    const shim = Buffer.from('#!/bin/sh\nHALTIJA_PORT=9123 exec /opt/hj "$@"\n')
    const read = (o: number, l: number) => shim.subarray(o, o + l)
    expect(identifyHjBounded(shim.length, read)).toBe('foreign')
  })
})
