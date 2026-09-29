/**
 * What a navigation actually loads, and how a tab keeps its identity across it (#54).
 *
 * Pure (no DOM), so it is unit-tested; the widget calls it with `location.href`.
 */

/**
 * What a `navigate` to `raw` loads, from the page at `base`. ONE answer for the navigation, for
 * `sameDocument`, and for what the server waits for; the beta.2 review found them disagreeing
 * (`sameDocument` was judged on `start#x` while the page went to `https://start/#x`, and `/docs` went
 * to `https:///docs`).
 *
 *  - a scheme (`https://…`, `about:`, `data:`, …): parsed, so the comparison below sees a normalised
 *    URL (`http://LOCALHOST:3000` → `http://localhost:3000/`);
 *  - `/…`, `#…`, `?…`, `./…`, `../…`: relative to the current page;
 *  - anything else (`example.com/x`, `localhost:3000`): a BARE host. `href` is the `https://` guess the
 *    plain-browser path loads, but `bare` is set so the desktop app is handed the raw input: it adds
 *    the scheme itself and, only then, falls back to http when https fails — handing it a prefixed URL
 *    silently disabled that fallback for every plain-http dev server (beta.2 re-review).
 */
export function resolveNavigationUrl(raw: string, base: string): { href: string; bare: boolean } {
  const url = String(raw ?? '').trim()
  if (!url) throw new Error('url is required')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(about|data|blob|javascript|mailto):/i.test(url)) {
    return { href: new URL(url).href, bare: false }
  }
  if (/^(\/|#|\?|\.\.?\/)/.test(url)) return { href: new URL(url, base).href, bare: false }
  return { href: new URL('https://' + url).href, bare: true }
}

/** A fragment-only change of the current page: no new document loads, so nothing reconnects. */
export function isSameDocument(resolved: string, current: string): boolean {
  // Both sides normalised, so `http://h:1#x` from `http://h:1/` and an uppercase host still match.
  // `includes('#')`, not a non-empty hash: `/page#` has an empty hash and still does not reload.
  let a: string, b: string
  try {
    a = new URL(resolved).href
    b = new URL(current).href
  } catch {
    return false
  }
  return a.includes('#') && a.split('#')[0] === b.split('#')[0]
}

/**
 * Whether a navigation needs the window.name handoff: a top-level move to ANOTHER http(s) origin.
 * Same-origin keeps sessionStorage, and a scheme that does not load a page (mailto:, javascript:,
 * data:) must not leave a marker in a page that stays.
 */
export function needsHandoff(resolved: string, current: string): boolean {
  try {
    const next = new URL(resolved)
    return /^https?:$/.test(next.protocol) && next.origin !== new URL(current).origin
  } catch {
    return false
  }
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
 * Firefox and WebKit clear `window.name` on a cross-SITE top-level navigation, and Chromium does on a
 * browsing-context-group swap (COOP, as some OAuth providers send); then no id arrives, the tab comes
 * back with a fresh one, and the server reports it as unconfirmed rather than claiming it. The page's
 * own `window.name` is kept behind the marker and restored by the next page's widget; a page with no
 * widget keeps the marker (documented in the CHANGELOG).
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
