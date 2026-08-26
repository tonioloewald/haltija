/**
 * The HTTP base for a WebSocket URL — ONE derivation, because two of the three hand-rolled ones
 * were wrong.
 *
 * `"wss://host/ws/browser".replace("ws:", "http:")` is a NO-OP: the substring is `wss:`, not `ws:`.
 * So the result stayed `wss://host`, which `fetch` cannot use, and server-side recording failed for
 * EVERY wss configuration — including the standard HTTPS localhost setup, where `inject.js` sets
 * `wss://localhost:8701/ws/browser` (issue #38). The bookmarklet's copy survived only by ordering
 * luck: its no-op `ws:` replace ran first and a later `wss:` replace rescued it.
 *
 * Anchored to the scheme, and `wss` before `ws`, or the second pattern would have to cope with the
 * first's output.
 *
 * In its own module rather than in `component.ts` so it can be unit-tested — importing the widget
 * pulls in `HTMLElement`, which does not exist in the test runtime.
 */
export function httpBaseFromWsUrl(
  wsUrl: string | undefined | null,
  fallback = 'http://localhost:8700',
): string {
  if (!wsUrl) return fallback
  return wsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace('/ws/browser', '')
}
