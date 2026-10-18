/**
 * Callers from another machine need `--token` (virta #815, GitHub #44).
 *
 * The server binds every interface, and the REST surface answers any origin by design: the widget is
 * injected into arbitrary pages and must reach us, so `Access-Control-Allow-Origin: *` and
 * `Allow-Private-Network` stay. That made anything on the LAN a full driver of your browser, with
 * `/eval` included, unless you had thought to pass `--token`, and nothing put that choice in front
 * of you.
 *
 * So the rule is: a request whose PEER ADDRESS is not loopback is refused unless the server has a
 * token, and then it is gated by the token as before. Same-machine use is unchanged. LAN, VR headset
 * and other-device use (the case 1.12.6 enabled) keeps working, but authenticated.
 *
 * This keys on the socket's peer address, never on a header: `Host`, `Origin` and
 * `X-Forwarded-For` are written by the caller this distinguishes against.
 *
 * What it does NOT cover, said plainly so nobody reads more into it: a tunnel or reverse proxy
 * running on this machine (ngrok, cloudflared, `ssh -R`) connects from loopback, so it passes. If you
 * expose haltija through one, pass `--token`. A page you visit in a browser on this machine also
 * connects from loopback; that is the widget's whole job, and it is the residual #815 documents.
 */

/** True for 127.0.0.0/8, ::1, and IPv4-mapped loopback (::ffff:127.x.x.x). */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const v4 = a.startsWith('::ffff:') ? a.slice('::ffff:'.length) : a
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)
}

/**
 * Whether a request from `address` must be refused. An unknown address (Bun returns null once the
 * socket is gone) is refused: failing open would make the gate depend on a race.
 */
export function refusesRemoteCaller(address: string | null | undefined, token: string): boolean {
  return !token && !isLoopbackAddress(address)
}

export const REMOTE_REFUSAL =
  'Forbidden: this haltija accepts connections from other machines only with a token. ' +
  'Restart it with --token <secret> (or HALTIJA_TOKEN), and send the same value as X-Haltija-Token ' +
  'or ?token=. Same-machine use needs no token.'
