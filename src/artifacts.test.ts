import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, utimesSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseDataUrl, saveDataUrl, pruneArtifacts, artifactDir } from './artifacts'

// Point EVERY artifact write in this file at a throwaway root before anything runs. Without it,
// `saveDataUrl` writes to the real <tmpdir>/haltija-screenshots and its prune deletes the
// developer's captures older than 24h — running the unit suite destroyed user data.
const ARTIFACT_ROOT = mkdtempSync(join(tmpdir(), 'haltija-artifact-root-'))
process.env.HALTIJA_ARTIFACT_DIR = ARTIFACT_ROOT

const scratch: string[] = [ARTIFACT_ROOT]
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

  it('honours HALTIJA_ARTIFACT_DIR, so tests cannot touch the real one', () => {
    expect(artifactDir('schematics')).toBe(join(ARTIFACT_ROOT, 'haltija-schematics'))
  })

  it('falls back to tmpdir(), not a hardcoded /tmp, when no override is set', () => {
    // Identical on Linux, different on macOS (/var/folders/…), and possibly read-only in a sandbox
    // — which is the failure the old silent catch hid.
    const saved = process.env.HALTIJA_ARTIFACT_DIR
    delete process.env.HALTIJA_ARTIFACT_DIR
    try {
      expect(artifactDir('schematics')).toBe(join(tmpdir(), 'haltija-schematics'))
    } finally {
      process.env.HALTIJA_ARTIFACT_DIR = saved
    }
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

describe('retention is declared once, per kind, and covers every kind', () => {
  it('every ArtifactKind has a policy — a new kind cannot silently get none', async () => {
    const { RETENTION } = await import('./artifacts')
    // The video path had NO policy: it hardcoded its own directory and never pruned, so screen
    // recordings — the largest files haltija writes — accumulated without bound under a comment
    // claiming it followed the convention. A table that must be exhaustive is how that stops
    // recurring; `Record<ArtifactKind, …>` makes the compiler enforce it, and this asserts the
    // values are real rather than zeroed.
    for (const kind of ['screenshots', 'schematics', 'videos'] as const) {
      expect(RETENTION[kind].maxAgeMs).toBeGreaterThan(0)
      expect(RETENTION[kind].keep).toBeGreaterThan(0)
    }
  })

  it('videos are capped far lower than screenshots — 200 recordings is tens of GB', async () => {
    const { RETENTION } = await import('./artifacts')
    expect(RETENTION.videos.keep).toBeLessThan(RETENTION.screenshots.keep)
  })

  it('pruneKind targets the directory for that kind and no other', async () => {
    const { pruneKind } = await import('./artifacts')
    // Discriminating: write into `videos` and `screenshots`, prune only `videos`, and check the
    // screenshot survives. A pruneKind that ignored its argument would fail this.
    const vids = artifactDir('videos')
    const shots = artifactDir('screenshots')
    const { mkdirSync } = await import('fs')
    mkdirSync(vids, { recursive: true })
    mkdirSync(shots, { recursive: true })
    const oldVid = join(vids, 'old.webm')
    const oldShot = join(shots, 'old.png')
    writeFileSync(oldVid, 'x')
    writeFileSync(oldShot, 'y')
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)
    utimesSync(oldVid, longAgo, longAgo)
    utimesSync(oldShot, longAgo, longAgo)

    await pruneKind('videos')
    expect(existsSync(oldVid)).toBe(false)
    expect(existsSync(oldShot)).toBe(true)
  })
})

describe('the retention policy the docs promise is the one the code applies', () => {
  it('every "older than Nh / most recent M" claim in the schema is a real RETENTION entry', async () => {
    const { RETENTION } = await import('./artifacts')
    const schema = readFileSync(join(import.meta.dir, 'api-schema.ts'), 'utf-8')
    const claims = [...schema.matchAll(/older than (\d+)h[\s\S]{0,40}?most recent (\d+)\)/g)].map(
      m => `${m[1]}h/${m[2]}`,
    )
    // Guard against the check itself going vacuous — three documented artifact kinds, three claims.
    // Without this, deleting the prose would make the "every claim is real" assertion trivially
    // true, which is the failure mode that produced five vacuous tests this cycle.
    expect(claims.length).toBe(3)

    const real = new Set(
      Object.values(RETENTION).map(p => `${p.maxAgeMs / (60 * 60 * 1000)}h/${p.keep}`),
    )
    // Both directions: no documented policy that the code doesn't implement...
    for (const c of claims) expect([c, [...real]]).toEqual([c, expect.arrayContaining([c])])
    // ...and no implemented policy the docs never mention. Changing RETENTION.videos.keep without
    // touching the prose fails here, which is the drift this exists to catch.
    for (const r of real) expect([r, claims]).toEqual([r, expect.arrayContaining([r])])
  })
})

describe('the Electron main process can actually load the compiled twin', () => {
  it('apps/desktop/artifacts.js requires under CommonJS and exports what main.js destructures', () => {
    // main.js `require`s this at TOP LEVEL, so a twin that fails to load doesn't degrade video
    // recording — it prevents the desktop app from starting at all. Testing the `src/` original
    // (which is what desktop-server-env.test.ts does) cannot catch that: the failure mode is the
    // CJS *bundle*, not the logic. Loading it here costs nothing and covers the whole class.
    const { createRequire } = require('module')
    const req = createRequire(import.meta.url)
    const twin = req('../apps/desktop/artifacts.js')
    // The exact two names main.js destructures. A rename in src/ that missed main.js fails here.
    expect(typeof twin.artifactDir).toBe('function')
    expect(typeof twin.pruneKind).toBe('function')
    // And it must honour the same seam — a twin that hardcoded tmpdir() would pass the two checks
    // above while leaving videos outside the test isolation, which is the bug being fixed.
    expect(twin.artifactDir('videos')).toBe(join(ARTIFACT_ROOT, 'haltija-videos'))
  })
})

describe('the suite cannot reach the real artifact directory', () => {
  it('isolateTestMachineState() redirects artifacts, not just the registry', async () => {
    // The seam only helps if the shared isolation helper sets it — otherwise every future test
    // module that writes an artifact re-acquires the ability to delete the developer's files.
    const { isolateTestMachineState } = await import('./test-support')
    const dir = isolateTestMachineState()
    expect(process.env.HALTIJA_ARTIFACT_DIR).toBe(dir)
    expect(artifactDir('screenshots').startsWith(dir)).toBe(true)
    // And it must NOT be the real one.
    expect(artifactDir('screenshots')).not.toBe(join(tmpdir(), 'haltija-screenshots'))
  })
})
