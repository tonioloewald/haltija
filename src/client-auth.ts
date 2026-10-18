/**
 * `fetch`, plus `X-Haltija-Token` when `HALTIJA_TOKEN` is set: what `DevChannelClient` and
 * `haltija/test` send every request with.
 *
 * `hj` and the MCP bridge have always sent the token; these two never did, so a test suite could
 * not reach a server started with `--token` at all. Since 1.13.0 a caller on another machine (or in
 * a container reaching the host through a forwarded port) needs that token (#815), so the gap went
 * from rare to the documented setup (1.13.0 review). Imported as `fetch` so no call site changes,
 * and a header the caller set explicitly wins.
 */
export function authedFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const token = typeof process !== 'undefined' ? process.env.HALTIJA_TOKEN : undefined
  if (!token) return fetch(input, init)
  const headers = new Headers(init.headers)
  if (!headers.has('X-Haltija-Token')) headers.set('X-Haltija-Token', token)
  return fetch(input, { ...init, headers })
}
