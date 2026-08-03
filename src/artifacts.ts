/**
 * Where haltija puts the files it hands back, and how it writes them.
 *
 * `/screenshot` and `/map --image` each decoded a base64 data URL and wrote it to disk, 26 lines
 * apart — and had already diverged inside a single commit:
 *
 *  - screenshot mapped `jpeg` → `jpg`; `/map` did not, so a JPEG schematic landed as `.jpeg`;
 *  - `/map` caught write failures and screenshot let them 500;
 *  - both hardcoded `/tmp`, which on macOS is not `tmpdir()` and in a sandbox may be read-only.
 *
 * Two copies that disagree about the extension of the file they hand back is the small version of
 * the same problem as five copies of a command list: the caller can't predict what it gets, and the
 * docs can only be right about one of them.
 *
 * Also: nothing ever deleted these. macOS keeps `/tmp` until reboot, so a long-lived desktop app
 * accumulated every screenshot and schematic it had ever taken. A tool that quietly fills a disk is
 * not trustworthy either, so writing prunes as it goes.
 */

import { mkdir, writeFile, readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

/** Artifact kinds, so the directory names are declared in one place rather than spelled inline. */
export type ArtifactKind = 'screenshots' | 'schematics' | 'videos'

/**
 * `tmpdir()`, not `/tmp`.
 *
 * They are the same on Linux and NOT on macOS (`/var/folders/…`), and a sandboxed or
 * TMPDIR-respecting environment may make `/tmp` unwritable — which is the failure `/map`'s silent
 * `catch` used to hide.
 */
export function artifactDir(kind: ArtifactKind): string {
  // `HALTIJA_ARTIFACT_DIR` exists so the test suite has a seam. Without one, `bun test src/` ran
  // `pruneArtifacts` with PRODUCTION defaults against the developer's real
  // `<tmpdir>/haltija-screenshots` — i.e. running the unit tests deleted their captures older than
  // 24h. `isolateTestMachineState()` could not contain it because the path was computed inline, and
  // the CI footprint gate only watched `~/.local/bin/hj` and `~/.haltija/servers`. The reviewer who
  // found this declined to run the suite at all, which is the correct response to a test that
  // destroys data and precisely the wrong position to put a reviewer in.
  return join(process.env.HALTIJA_ARTIFACT_DIR || tmpdir(), `haltija-${kind}`)
}

/** Parsed pieces of a `data:` URL, or null if it isn't one. */
export function parseDataUrl(dataUrl: string): { ext: string; base64: string } | null {
  const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || '')
  if (!match) return null
  // ONE extension mapping. The two call sites disagreed about this exact line, so a JPEG came back
  // as `.jpg` from one endpoint and `.jpeg` from the other.
  return { ext: match[1] === 'jpeg' ? 'jpg' : match[1], base64: match[2] }
}

/**
 * How long each kind of artifact sticks around.
 *
 * Per-kind because the sizes differ by orders of magnitude: 200 screenshots is tens of MB, 200
 * screen recordings is potentially tens of GB. Declared HERE, in one table, rather than as a
 * different literal at each call site — which is how the video path ended up with no policy at all.
 */
export const RETENTION: Record<ArtifactKind, { maxAgeMs: number; keep: number }> = {
  screenshots: { maxAgeMs: 24 * 60 * 60 * 1000, keep: 200 },
  schematics: { maxAgeMs: 24 * 60 * 60 * 1000, keep: 200 },
  // Videos are the big ones. Same 24h, far smaller cap.
  videos: { maxAgeMs: 24 * 60 * 60 * 1000, keep: 20 },
}

/** Prune one artifact kind under its declared policy. The form every caller should use. */
export function pruneKind(kind: ArtifactKind): Promise<number> {
  return pruneArtifacts(artifactDir(kind), RETENTION[kind])
}

/**
 * Delete artifacts older than `maxAgeMs`, then any excess beyond `keep` (newest first).
 *
 * Best-effort and non-fatal by design: failing to tidy up must never fail the capture the user
 * actually asked for. Errors are swallowed *here*, where the only consequence is a file that lives
 * a bit longer — unlike the swallowed error in the write path, which changed what the caller got.
 */
export async function pruneArtifacts(
  dir: string,
  { maxAgeMs = 24 * 60 * 60 * 1000, keep = 200 }: { maxAgeMs?: number; keep?: number } = {},
): Promise<number> {
  let removed = 0
  try {
    const names = await readdir(dir)
    const entries: Array<{ path: string; mtime: number }> = []
    for (const name of names) {
      const path = join(dir, name)
      try {
        const st = await stat(path)
        if (st.isFile()) entries.push({ path, mtime: st.mtimeMs })
      } catch {
        // Raced with another prune or an external delete; nothing to do.
      }
    }
    const now = Date.now()
    const survivors: typeof entries = []
    for (const e of entries) {
      if (now - e.mtime > maxAgeMs) {
        try { await unlink(e.path); removed++ } catch {}
      } else {
        survivors.push(e)
      }
    }
    survivors.sort((a, b) => b.mtime - a.mtime)
    for (const e of survivors.slice(keep)) {
      try { await unlink(e.path); removed++ } catch {}
    }
  } catch {
    // Directory doesn't exist yet, or isn't readable. Either way there is nothing to prune.
  }
  return removed
}

/**
 * Write a base64 image data URL into the artifact directory and return its path.
 *
 * **Async on purpose.** `writeFileSync` plus a multi-megabyte `Buffer.from(base64)` blocks Bun's
 * event loop, which stalls every other REST request and every WebSocket frame — including the
 * heartbeat from the browser widget, so a big screenshot could look like a tab disconnect.
 *
 * Returns `{ error }` rather than throwing. Both callers want to fall back to the inline data URL
 * with a warning rather than lose the capture, and the caller is the only one that knows how to say
 * so — the previous silent `catch {}` in `/map` is exactly what this shape prevents.
 */
export async function saveDataUrl(
  dataUrl: string,
  opts: { kind: ArtifactKind; prefix?: string },
): Promise<{ path: string; ext: string } | { error: string }> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return { error: 'not a base64 image data URL' }
  const dir = artifactDir(opts.kind)
  try {
    await mkdir(dir, { recursive: true })
    const shortId = Math.random().toString(36).slice(2, 6)
    const path = join(dir, `${opts.prefix || 'hj'}-${Date.now()}-${shortId}.${parsed.ext}`)
    await writeFile(path, Buffer.from(parsed.base64, 'base64'))
    // Fire-and-forget: the caller is waiting on their capture, not on our housekeeping.
    void pruneKind(opts.kind)
    return { path, ext: parsed.ext }
  } catch (err) {
    return { error: (err as Error).message }
  }
}
