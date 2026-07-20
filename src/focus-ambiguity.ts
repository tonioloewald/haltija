/**
 * Did *focus* choose this tab, when the caller's *directory* should have?
 *
 * From issue #2. cwd routing (see `sessions.resolveByCwd`) gets an untargeted `hj` command to the
 * right shared **server** — and then stops. Which **tab** on that server answers falls back to
 * whatever is focused. So two agents, each correctly staying in its own project directory, can
 * still drive each other's pages the moment both projects have a tab on the same shared 8700
 * server; a human clicking into a second project's tab causes it solo.
 *
 * The obvious fix — rank tabs by "origin matches the cwd project" — has a trap: there is no
 * reliable map from a tab's origin (a URL like `localhost:8787`) to a project **directory**. The
 * dev-server port that injected the widget isn't always the project (proxies, multiple ports,
 * static previews, `about:blank` mid-navigation). A ranking that's *usually* right would pick
 * confidently and wrongly — reintroducing exactly the silent-misroute class we spent 1.4.0
 * eliminating. A registry entry's `cwd` is per-**server**, not per-tab, so it can't sharpen this
 * either.
 *
 * So we don't claim a mapping we don't have. We warn only about what is honestly knowable: the
 * command was **not** pinned to a window, and this server spans **more than one origin**, so
 * *focus* — not the caller's directory — chose which page answered. That's the honest half of the
 * issue's "warn when the focused tab's origin doesn't match the cwd server's directory", and it
 * composes with the hidden-tab warning (issue #3): one says the tab was asleep, this says the
 * wrong tab may have been picked. Preference/ranking waits for a mapping that can justify itself.
 */

/** The bits of a tracked window this decision needs. */
export interface FocusWindowInfo {
  id: string
  url?: string
  title?: string
}

/** A tab's origin for grouping — `about:blank`, opaque, and unparseable URLs fall back to the raw
 * string so they still form an honest distinct bucket rather than silently collapsing together. */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const origin = new URL(url).origin
    // Opaque origins (about:blank, data:, blob: with no host) serialize to the string "null";
    // the raw URL is a more legible, still-honest bucket than the word "null".
    return origin === 'null' ? url : origin
  } catch {
    return url
  }
}

/**
 * A warning to attach when an *untargeted* command was answered by the focused tab while the
 * server hosts tabs from more than one origin — i.e. focus, not the caller's directory, chose the
 * page. Returns null when the caller pinned a window, when we don't know what answered, or when
 * every tab shares one origin (no ambiguity to flag).
 */
export function ambiguousFocusWarning(opts: {
  windows: FocusWindowInfo[]
  sentToId: string | null | undefined
  /** True when the caller explicitly targeted a window (`--window` / `?window=`). */
  wasTargeted: boolean
}): string | null {
  const { windows, sentToId, wasTargeted } = opts
  // The caller pinned a window — they own the choice; nothing to warn about.
  if (wasTargeted) return null
  // We don't know which tab answered, so we can't honestly describe the ambiguity.
  if (!sentToId) return null

  const withOrigin = windows
    .map((w) => ({ ...w, origin: originOf(w.url) }))
    .filter((w): w is FocusWindowInfo & { origin: string } => w.origin !== null)

  const distinctOrigins = new Set(withOrigin.map((w) => w.origin))
  // One origin (or none we can read) → focus isn't choosing between projects. Stay quiet.
  if (distinctOrigins.size < 2) return null

  const chosen = withOrigin.find((w) => w.id === sentToId)
  const chosenWhere = chosen
    ? `${chosen.origin}${chosen.title ? ` — "${chosen.title}"` : ''}`
    : sentToId

  // List the tabs on OTHER origins as ready-to-paste pins, capped so the message stays legible.
  const others = withOrigin.filter((w) => !chosen || w.origin !== chosen.origin)
  const MAX = 4
  const pins = others
    .slice(0, MAX)
    .map((w) => `  --window ${w.id}  → ${w.origin}${w.title ? ` ("${w.title}")` : ''}`)
    .join('\n')
  const more = others.length > MAX ? `\n  …and ${others.length - MAX} more` : ''

  return (
    `This command was NOT pinned to a window and this server has tabs from ` +
    `${distinctOrigins.size} different origins, so *focus* — not your working directory — chose ` +
    `which tab answered (${chosenWhere}). A tab you didn't mean (another project's page on this ` +
    `shared server, or one a human just clicked into) can silently receive the command. If you ` +
    `meant a different page, pin it:\n${pins}${more}`
  )
}
