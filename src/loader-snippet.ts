/**
 * The widget loader snippet users paste into their page — ONE source, used by the generated docs
 * and by `loader-snippet.playwright.ts`, so the snippet the docs recommend is the snippet the test
 * runs. A docs-only snippet is a claim nothing checks.
 *
 * ## Why it falls back (#32c)
 *
 * It tries the transport matching the page first (that works on every engine and needs nothing
 * clever), and if that fails, tries the other one. The fallback exists because an https page is
 * NOT blocked from reaching `http://localhost` — it is a potentially trustworthy origin (full
 * measurement in `src/transports.ts`) — so an http-only channel can still serve an https page. The
 * old snippet matched the transport and gave up, which turned a limitation of OUR code into what
 * looked like a platform rule ("impossible because mixed content").
 *
 * ## Why https → http is loopback-only
 *
 * The exemption covers `localhost` / `127.0.0.1` / `[::1]`, not the LAN. From an https page,
 * `http://<LAN IP>` IS mixed content, so trying it would only add a console warning (and, for the
 * WebSocket, a SecurityError) on the way to the same failure. An http page may try https anywhere:
 * that is never mixed content, it just needs the self-signed cert accepted.
 *
 * ## Why `s.remove()` on error
 *
 * `autoInject()` in `component.ts` reads its config from the FIRST `script[src*="component.js"]`
 * in the document. Leave the failed tag in place and the fallback's widget would connect to the
 * transport that just failed.
 *
 * Node-safe (no Bun APIs): the Playwright suite imports it.
 */

export interface LoaderSnippetOptions {
  httpPort?: number
  httpsPort?: number
}

/** The body of the `<script>` (no tags), as lines. */
export function loaderSnippetLines({ httpPort = 8700, httpsPort = 8701 }: LoaderSnippetOptions = {}): string[] {
  return [
    `;(() => {`,
    `  const host = location.hostname   // NOT localhost — works over LAN/Bonjour too`,
    `  const http = [\`http://\${host}:${httpPort}\`, \`ws://\${host}:${httpPort}\`]`,
    `  const https = [\`https://\${host}:${httpsPort}\`, \`wss://\${host}:${httpsPort}\`]`,
    `  // Matching transport first, then the other. https → http only for loopback (not mixed content).`,
    `  const loopback = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(host)`,
    `  const order = location.protocol !== 'https:' ? [http, https] : loopback ? [https, http] : [https]`,
    `  const load = (i) => {`,
    `    if (i === order.length) return console.warn(`,
    `      'haltija: no channel reachable. Start one with \`bunx haltija --server\`; ' +`,
    `      'for https, accept the cert once at ' + https[0])`,
    `    const [origin, ws] = order[i]`,
    `    const s = document.createElement('script')`,
    `    s.src = \`\${origin}/component.js?autoInject=true&serverUrl=\${ws}/ws/browser\``,
    `    s.onerror = () => { s.remove(); load(i + 1) }`,
    `    document.head.appendChild(s)`,
    `  }`,
    `  load(0)`,
    `})()`,
  ]
}

/** The full `<script>…</script>` block, indented as it appears in the docs. */
export function loaderSnippetHtml(opts: LoaderSnippetOptions = {}): string {
  return ['<script>', ...loaderSnippetLines(opts).map((l) => `  ${l}`), '</script>'].join('\n')
}
