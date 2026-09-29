/**
 * What a navigation actually loads, and how a tab keeps its identity across it (#54).
 *
 * Pure (no DOM), so it is unit-tested; the widget calls it with `location.href`.
 */

/**
 * The absolute URL a `navigate` to `raw` loads, from the page at `base`. ONE answer, used for the
 * navigation itself, for `sameDocument`, and reported to the server, which derives what to wait for
 * from it. The beta.2 re-review found them disagreeing: `sameDocument` was judged on `start#x` while
 * the page went to `https://start/#x`, and `/docs` went to `https:///docs`.
 *
 *  - a scheme (`https://…`, `about:`, `data:`, `file:`, …): as given;
 *  - `/…`, `#…`, `?…`, `./…`, `../…`: relative to the current page;
 *  - anything else (`example.com/x`, `localhost:4000/x`): a host, so `https://` is prefixed, as before.
 */
export function resolveNavigationUrl(raw: string, base: string): string {
  const url = String(raw ?? '').trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(about|data|blob|javascript|mailto):/i.test(url)) return url
  if (/^(\/|#|\?|\.\.?\/)/.test(url)) return new URL(url, base).href
  return 'https://' + url
}

/** A fragment-only change of the current page: no new document loads, so nothing reconnects. */
export function isSameDocument(resolved: string, current: string): boolean {
  // `includes('#')`, not a non-empty hash: `/page#` has an empty hash and still does not reload.
  return resolved.includes('#') && resolved.split('#')[0] === current.split('#')[0]
}

/**
 * Handing a tab's windowId across a navigation, through `window.name`.
 *
 * Outside the desktop app the id lives in sessionStorage, which is per-ORIGIN, so a tab that moved to
 * another origin (even another localhost port) used to come back as a stranger with a fresh id. The
 * server then had to GUESS which new window was the tab, and a guess is how an unrelated tab opening
 * during the load got reported as "your page came back" and handed focus (beta.2 re-review). This
 * makes the identity DECLARED instead: `window.name` belongs to the browsing context and survives
 * same-site navigations, so the old page writes its id there and the new page adopts it.
 *
 * Browsers clear `window.name` on a cross-SITE top-level navigation (e.g. an OAuth redirect), and
 * then no id arrives; the tab comes back with a fresh one, and the server reports it as unconfirmed
 * rather than claiming it. The page's own `window.name` is kept behind the marker and restored.
 */
const HANDOFF = 'haltija-handoff:'

export function withHandoff(currentName: string, windowId: string): string {
  const { original } = readHandoff(currentName)
  return `${HANDOFF}${windowId}|${original}`
}

export function readHandoff(name: string): { windowId: string | null; original: string } {
  if (!name.startsWith(HANDOFF)) return { windowId: null, original: name }
  const rest = name.slice(HANDOFF.length)
  const bar = rest.indexOf('|')
  const id = bar === -1 ? rest : rest.slice(0, bar)
  const original = bar === -1 ? '' : rest.slice(bar + 1)
  // Only something shaped like our ids: window.name is page-writable.
  return { windowId: /^[a-z0-9]{6,40}$/i.test(id) ? id : null, original }
}
