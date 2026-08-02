import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, utimesSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseDataUrl, saveDataUrl, pruneArtifacts, artifactDir } from './artifacts'

const scratch: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'haltija-artifacts-test-'))
  scratch.push(d)
  return d
}
afterAll(() => {
  for (const d of scratch) {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
})

// A 1x1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('one extension mapping, not two', () => {
  it('jpeg becomes jpg — the exact line the two call sites disagreed about', () => {
    // `/screenshot` mapped jpeg→jpg and `/map` did not, so the same format came back as `.jpg` from
    // one endpoint and `.jpeg` from the other, 26 lines apart, from one commit.
    expect(parseDataUrl('data:image/jpeg;base64,AAAA')?.ext).toBe('jpg')
    expect(parseDataUrl('data:image/png;base64,AAAA')?.ext).toBe('png')
    expect(parseDataUrl('data:image/webp;base64,AAAA')?.ext).toBe('webp')
  })

  it('a non-data-URL is rejected rather than written as garbage', () => {
    expect(parseDataUrl('https://example.com/x.png')).toBeNull()
    expect(parseDataUrl('')).toBeNull()
  })
})

describe('saveDataUrl reports failure instead of throwing or hiding it', () => {
  it('writes real bytes and returns the path', async () => {
    const res = await saveDataUrl(PNG, { kind: 'screenshots', prefix: 'test' })
    expect('path' in res).toBe(true)
    if ('path' in res) {
      expect(existsSync(res.path)).toBe(true)
      expect(res.path.endsWith('.png')).toBe(true)
      const bytes = await Bun.file(res.path).arrayBuffer()
      // Magic bytes: "it wrote something" is not "it wrote a PNG".
      expect([...new Uint8Array(bytes).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
      rmSync(res.path, { force: true })
    }
  })

  it('returns { error } for a malformed data URL — the caller decides what to say', async () => {
    // Deliberately NOT a throw and NOT a silent swallow. `/map` used to swallow it and hand back
    // ~700KB of base64 with no explanation; `/screenshot` used to 500. Neither caller could tell
    // the user what actually happened.
    const res = await saveDataUrl('nonsense', { kind: 'screenshots' })
    expect('error' in res).toBe(true)
  })

  it('uses tmpdir(), not a hardcoded /tmp', () => {
    // Identical on Linux, different on macOS (/var/folders/…), and possibly read-only in a sandbox
    // — which is the failure the old silent catch hid.
    expect(artifactDir('schematics').startsWith(tmpdir())).toBe(true)
    expect(artifactDir('schematics')).toContain('haltija-schematics')
  })
})

describe('artifacts are pruned, so a long-lived app cannot fill the disk', () => {
  it('deletes files older than maxAge and keeps recent ones', async () => {
    const dir = tmp()
    const old = join(dir, 'old.png')
    const fresh = join(dir, 'fresh.png')
    writeFileSync(old, 'x')
    writeFileSync(fresh, 'y')
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)
    utimesSync(old, longAgo, longAgo)

    const removed = await pruneArtifacts(dir, { maxAgeMs: 24 * 60 * 60 * 1000 })
    expect(removed).toBe(1)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true) // the discriminating half: it does not delete everything
  })

  it('caps the count, newest kept', async () => {
    const dir = tmp()
    for (let i = 0; i < 10; i++) {
      const p = join(dir, `f${i}.png`)
      writeFileSync(p, 'x')
      const t = new Date(Date.now() - (10 - i) * 1000) // f9 newest
      utimesSync(p, t, t)
    }
    await pruneArtifacts(dir, { keep: 3 })
    const left = readdirSync(dir).sort()
    expect(left.length).toBe(3)
    expect(left).toEqual(['f7.png', 'f8.png', 'f9.png'])
  })

  it('a missing directory is not an error — tidying must never fail the capture', async () => {
    expect(await pruneArtifacts(join(tmpdir(), 'haltija-does-not-exist-' + Math.random()))).toBe(0)
  })
})
