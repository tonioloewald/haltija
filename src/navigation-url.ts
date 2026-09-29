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
 * Whether a navigation carries the window.name handoff: any top-level http(s) navigation that loads a
 * new document, WHATEVER its origin. Gating on the requested URL being cross-origin missed a
 * same-origin link that redirects to another origin (a login flow): no handoff, a fresh id, a 10 s
 * wait and a false warning (beta.2 round-3 review). A same-origin next page just adopts and restores.
 * Schemes that do not load a page (mailto:, javascript:, data:) never carry it.
 */
export function needsHandoff(resolved: string): boolean {
  try {
    return /^https?:$/.test(new URL(resolved).protocol)
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
 * It is written BEFORE navigating: in Chromium a cross-site navigation commits the new document
 * before the old page's `pagehide` runs, so a marker written there arrives too late. If the page is
 * still alive when the caller's wait is over (a 204, a download, a cancelled navigation), the widget
 * restores the page's own name, so the marker's life in a live page is bounded by that wait.
 *
 * Measured survival across engines: Chromium keeps `window.name` across origins and sites unless the
 * browsing-context group changes (COOP, sent by some OAuth providers). Firefox and WebKit clear it
 * on ANY cross-origin navigation, including another port on localhost. Where it does not survive,
 * no id arrives, the tab comes back with a fresh one, and the server reports it as unconfirmed
 * rather than claiming it. A next page without the widget keeps the marker (in the CHANGELOG).
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
