/**
 * Deciding what to do about `~/.local/bin/hj`.
 *
 * This is the code that can **delete a file on someone's disk**, so the policy lives here
 * as pure functions with a tested decision table — not as a closure inside a startup IIFE.
 * The two sibling policies in this release (`legacy-servers.ts`, `port-pid.ts`) were
 * extracted and tested; this one wasn't, and it shipped two bugs in opposite directions:
 *
 *   - It **false-positived** on a user's own `hj` — a 46-byte shim like
 *     `HALTIJA_PORT=9123 exec /opt/hj "$@"` matched a substring sniff for `haltija`, so we
 *     executed the stranger's script and then deleted it. And the people most likely to
 *     write such a wrapper are *our own users*, because our docs tell them to set
 *     `HALTIJA_PORT`.
 *   - It **false-negatived** on Haltija's own compiled `hj` (63 MB; the first `haltija`
 *     byte is at ~62.7 M, far past the 200 KB window it looked at), so for anyone who had
 *     ever run the DMG we refused to touch our own binary, printed a false accusation on
 *     every boot, and could never perform the repair this release exists to perform.
 *
 * The rule everywhere in this release is **never destroy what you have not identified**.
 * Identification therefore has to actually work, in both directions, on all three shapes of
 * artifact we ship (modern JS bundle, legacy JS bundle, compiled binary).
 */

/**
 * Stamped into `dist/hj.js` by the build, and therefore also embedded in the compiled
 * `hj-<arch>` binary (which bundles that JS). Deliberately distinctive: a user's wrapper
 * script may well mention `haltija` or `HALTIJA_PORT`, but it will not contain this.
 */
export const HJ_MARKER = 'haltija-cli:do-not-edit'

/**
 * Smallest plausible haltija `hj`. Our JS bundle is ~68 KB; a hand-written shim is a few
 * hundred bytes. This is the size gate the old comment promised and the old code never
 * applied — it is what separates "our bundle" from "someone's two-line wrapper".
 */
export const MIN_BUNDLE_BYTES = 10_000

/** Above this we're looking at a compiled binary rather than a script. */
export const MIN_COMPILED_BYTES = 1_000_000

export type HjIdentity =
  /** Ours, and modern enough to carry the marker (1.4.0+). */
  | 'ours'
  /** Ours, but predates the marker — a pre-1.4.0 bundle or compiled binary. */
  | 'ours-legacy'
  /** Not ours. Do not execute it, do not overwrite it, do not delete it. */
  | 'foreign'

/**
 * Identify the file at `~/.local/bin/hj` from its **bytes**, without running it.
 *
 * Running it is not an option: `installedVersion()` used to `execSync` this file to ask its
 * version *before* establishing whose it was, which means executing a stranger's script.
 * Identity has to come from the bytes first; only then is it safe to ask the binary anything.
 */
export function identifyHj(buf: Buffer): HjIdentity {
  // 1. Modern artifact: the build stamped a marker. Scan the WHOLE buffer — in the compiled
  //    binary the JS payload (and therefore the marker) sits near the end, ~62 MB in.
  //    Buffer.includes is a byte scan, not a UTF-16 decode of 63 MB.
  if (buf.includes(HJ_MARKER)) return 'ours'

  // 2. Legacy artifacts have no marker, and we still need to recognize them — they are
  //    precisely the stale copies this release repairs.
  const looksLikeHaltija = (window: Buffer) => /haltija|tosijs-dev/i.test(window.toString('latin1'))

  // 2a. A legacy compiled binary: big, and mentions haltija somewhere inside.
  if (buf.length >= MIN_COMPILED_BYTES && looksLikeHaltija(buf)) return 'ours-legacy'

  // 2b. A legacy JS bundle: script-shaped, tens of KB, mentioning haltija near the top.
  //     The size gate is what stops a user's `HALTIJA_PORT=… exec /opt/hj "$@"` shim from
  //     being mistaken for ours and destroyed.
  if (buf.length >= MIN_BUNDLE_BYTES && looksLikeHaltija(buf.subarray(0, 200_000))) {
    return 'ours-legacy'
  }

  return 'foreign'
}

/**
 * How much of a large file's tail we scan for the marker.
 *
 * `bun build --compile` produces a standalone executable by statically linking the whole Bun
 * runtime and **appending** the JS payload — so our 60 MB `hj-<arch>` is ~99.9% runtime and
 * the marker sits in the last ~1%. Reading all 60 MB to find it would cost a 121 MB read and
 * RSS spike on every desktop launch (two servers), which is real on a laptop juggling twenty
 * projects. 8 MB of tail is a wide margin over a ~1 MB payload.
 */
export const TAIL_SCAN_BYTES = 8 * 1024 * 1024

/** Head window for recognizing script-shaped artifacts. */
export const HEAD_SCAN_BYTES = 256 * 1024

/**
 * Identify `hj` on disk with **bounded** reads — never loading a 60 MB binary into memory.
 *
 * `read(offset, length)` is injected so this stays testable without a filesystem.
 */
export function identifyHjBounded(
  size: number,
  read: (offset: number, length: number) => Buffer,
): HjIdentity {
  // Small enough to just look at whole.
  if (size <= HEAD_SCAN_BYTES) return identifyHj(read(0, size))

  const head = read(0, HEAD_SCAN_BYTES)
  if (head.includes(HJ_MARKER)) return 'ours'

  if (size >= MIN_COMPILED_BYTES) {
    // Compiled binary: the payload — and therefore the marker — is at the END.
    const tailLen = Math.min(TAIL_SCAN_BYTES, size)
    const tail = read(size - tailLen, tailLen)
    if (tail.includes(HJ_MARKER)) return 'ours'
    // No marker: a pre-1.4.0 compiled hj. Its haltija strings live in the payload too.
    if (/haltija|tosijs-dev/i.test(tail.toString('latin1'))) return 'ours-legacy'
    return 'foreign'
  }

  // Script-shaped and big enough to be a bundle: the legacy JS-bundle case.
  if (size >= MIN_BUNDLE_BYTES && /haltija|tosijs-dev/i.test(head.toString('latin1'))) {
    return 'ours-legacy'
  }

  return 'foreign'
}

export type HjPlan =
  /** Nothing there — write it. */
  | { action: 'bootstrap'; reason: string }
  /** Ours and out of date — replace it. */
  | { action: 'repair'; reason: string }
  /** Ours and current (or newer). Do nothing at all. */
  | { action: 'leave'; reason: string }
  /** Not ours, or a deliberate install. Say so; never touch it. */
  | { action: 'decline'; reason: string }

export interface HjState {
  exists: boolean
  /** True for a symlink, dangling or not. */
  isSymlink: boolean
  /** Whether the symlink resolves. Only meaningful when isSymlink. */
  symlinkResolves?: boolean
  /** Identity from the bytes. Undefined when the file doesn't exist. */
  identity?: HjIdentity
  /**
   * What `hj --version` reported. Only ever consulted once identity says the file is ours —
   * we do not execute strangers. Null when it could not answer, which for one of our own
   * artifacts means "pre-1.4.0", i.e. exactly the stale copy we want to replace.
   */
  reportedVersion?: string | null
}

/**
 * The whole decision, in one place, so it can be tested rather than inferred from a
 * 60-line IIFE.
 *
 * `isOlder(a, b)` is injected so this stays pure (see `src/semver.ts`).
 */
export function planHjInstall(
  state: HjState,
  ourVersion: string,
  isOlder: (a: string, b: string) => boolean,
): HjPlan {
  if (!state.exists && !state.isSymlink) {
    return { action: 'bootstrap', reason: 'no hj on the PATH' }
  }

  // A symlink is a deliberate install — someone pointed hj at their own build. Leave it,
  // even if it now dangles: replacing a broken deliberate install silently undoes their
  // setup the moment they fix the target, and a dangling hj announces itself immediately
  // (`command not found`). Say something; don't fix it for them.
  if (state.isSymlink) {
    return state.symlinkResolves
      ? { action: 'leave', reason: 'hj is a symlink — a deliberate install' }
      : {
          action: 'decline',
          reason: 'hj is a symlink whose target is missing — repoint or remove it; haltija will not overwrite a deliberate install',
        }
  }

  if (state.identity === 'foreign') {
    return {
      action: 'decline',
      reason: 'a file named hj is on the PATH but is not a haltija CLI — refusing to touch it',
    }
  }

  // Ours from here down, so it is safe to have asked it for a version.
  const reported = state.reportedVersion ?? null

  if (reported === null) {
    // One of our artifacts that cannot answer `--version` — i.e. pre-1.4.0. The stale copy.
    return { action: 'repair', reason: `replacing a pre-${ourVersion} hj that cannot report its version` }
  }

  if (isOlder(reported, ourVersion)) {
    return { action: 'repair', reason: `replacing hj ${reported} with ${ourVersion}` }
  }

  return { action: 'leave', reason: `hj ${reported} is already current (this server is ${ourVersion})` }
}
