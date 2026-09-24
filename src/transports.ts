/**
 * Which transports a shared channel opens, and where its certificate lives (#32a, #32d).
 *
 * ## The bug, restated more precisely than the issue did
 *
 * #32 reported that `foresight/node_modules/haltija/certs` did not exist, so that instance came up
 * HTTP-only — and concluded the fix was to ship or generate certs. Reading the code, the causation
 * runs the other way: `src/server.ts` only generates certs when HTTPS is *wanted*, and the mode
 * defaulted to `http`. The certs were absent **because** the transport was absent, not the reverse.
 *
 * That matters, because it means shipping certs in the npm package would have fixed nothing. The
 * default is the bug.
 *
 * ## Why the default is a cross-project decision
 *
 * The channel is deliberately shared: whichever project starts a server on 8700 serves every other
 * project on the machine. So an HTTP-only default is not a choice a project makes *for itself* — it
 * decides, on behalf of every neighbour, whether `https://` pages can connect at all. In #32 that
 * cost tosijs-3d its entire channel while everything reported healthy: `hj where` said
 * "haltija 1.12.2, 1 tab", the dev server logged "dev-channel ready", and every command routed into
 * an unrelated project's page. A shared server's capabilities must not depend on which directory it
 * happened to start in.
 *
 * ## Why the certificate moved out of node_modules, as a consequence of that
 *
 * Certs used to be generated into `<install>/certs` — one per install. With HTTP-only defaults that
 * was nearly invisible, because almost nobody had certs at all. Making `both` the default turns it
 * into a recurring papercut, and a new one we would be introducing:
 *
 * - the self-signed cert is accepted **per origin**, and `https://localhost:8701` is one origin — but
 *   the *certificate* behind it changes every time a different install wins the race to bind, so the
 *   browser's "you accepted this before" memory is invalidated by a peer starting first;
 * - `npm install` wipes `node_modules`, regenerating a fresh cert and re-prompting;
 * - so the user would be asked to trust localhost repeatedly, with no way to make it stop — and a
 *   warning users must click through routinely is a warning they stop reading.
 *
 * One machine-level directory (`~/.haltija/certs`) makes the certificate stable across installs,
 * reinstalls and projects: accepted once, then quiet. It is the same argument as the port block —
 * shared state belongs in one place, not one copy per install.
 *
 * `mkcert` sidesteps the prompt entirely (it signs with a locally-trusted CA), but it is not
 * installed on most machines and we fall back to `openssl`. The design has to be right for the
 * fallback, which is the common case.
 *
 * ## Can an https page reach `http://localhost`? It depends on the ENGINE
 *
 * This note has been wrong in both directions, so read it whole.
 *
 * For a long time this repo said "no, mixed content", in six places. Commit `8470c82` then called
 * that **false** on the strength of a Chromium measurement and removed it everywhere. That
 * over-corrected: it generalised from one engine, while this very note said "Chromium only —
 * Firefox and Safari must not be assumed". Measured across all three on 2026-09-24 (Playwright,
 * real https server, `isSecureContext === true`; `loader-snippet.playwright.ts` reproduces it):
 *
 *                                 fetch       ws://      <script src>
 *   Chromium → http://localhost   OK          OK         OK
 *   Firefox  → http://localhost   OK          OK         OK
 *   WebKit   → http://localhost   BLOCKED     BLOCKED    BLOCKED   "[blocked] The page at
 *   WebKit   → http://127.0.0.1   BLOCKED     BLOCKED    BLOCKED    https://localhost:… requested
 *                                                                   insecure content from http://…"
 *   any      → http://<LAN IP>    ws:// refused — the control
 *
 * Chromium and Firefox treat loopback as a *potentially trustworthy origin* (W3C Secure Contexts)
 * and exempt it from mixed-content blocking. WebKit (Playwright's build, WebKit 26.0 — real Safari
 * not driven, but it is the engine) does not. So **#33's "mixed content" diagnosis was correct for
 * Safari** and "false" was never true, only "false in Chromium".
 *
 * The LAN-IP row is the control. An earlier attempt inside the Electron app showed "localhost
 * works" while the control ALSO passed, i.e. a permissive environment that proved nothing. A result
 * without a control that fails is not a result — and, the lesson of the second mistake, a result
 * from one engine is not a result about "the browser".
 *
 * What follows for the design:
 * - **HTTPS on the channel is REQUIRED for https pages in Safari.** That is the strongest argument
 *   for #32a's `both` default: no loader cleverness can substitute for it on WebKit.
 * - The loader (`src/loader-snippet.ts`, #32c) tries the matching transport, then the other —
 *   https → http on loopback only. That rescues Chromium and Firefox pages when a channel is
 *   HTTP-only; on WebKit the fallback attempt is blocked and it ends at the "no channel reachable"
 *   warning, which names the HTTPS address to fix it.
 *
 * One trap for whoever re-measures this: a page served by Playwright's `page.route` has no IP
 * address space, so Chromium's Local Network Access check refuses its loopback subresources
 * ("Permission was denied for this request to access the `unknown` address space"). That looks
 * exactly like the old false claim coming true. It isn't — a real `https://localhost` page is
 * loopback → loopback. Measure with a real server.
 */

import { join } from 'path'

export type TransportMode = 'http' | 'https' | 'both'

/** Where the machine-level certificate lives, unless overridden. */
export const CERT_DIR_ENV = 'HALTIJA_CERTS_DIR'

export interface TransportModeResult {
  mode: TransportMode
  /** Where the value came from, so startup can explain itself rather than assert. */
  source: 'default' | 'env'
  /**
   * The user explicitly asked for a single transport on a SHARED server.
   *
   * Tracked separately from `mode === 'http'` because #32d is specifically about the *explicit*
   * opt-out: the channel is shared, so turning a transport off degrades it for neighbours who never
   * made that choice. A default needs no warning; a decision does.
   */
  degradesSharedChannel: boolean
}

/**
 * Resolve the transport mode.
 *
 * `both` is the default (#32a). An unrecognised value falls back to `both` rather than being
 * silently coerced to `http` — the whole point of this change is that a half-open channel must not
 * be something you can end up with by accident.
 */
export function resolveTransportMode(
  env: Record<string, string | undefined>,
  opts: { isPrivate?: boolean } = {},
): TransportModeResult {
  const raw = env.DEV_CHANNEL_MODE
  const valid = raw === 'http' || raw === 'https' || raw === 'both'
  const mode: TransportMode = valid ? raw : 'both'
  const source = valid ? 'env' : 'default'
  return {
    mode,
    source,
    // Neither a private instance nor the desktop app's internal server has any neighbour to
    // degrade. The cross-project consequence in #32 is a SHARED-channel property; warning about it
    // on a server nobody else can reach would be crying wolf, and the internal server is HTTP-only
    // by deliberate configuration (see `isDesktopInternal`) — warning about our own decision on
    // every desktop launch is exactly how a warning becomes noise.
    degradesSharedChannel:
      source === 'env' && mode !== 'both' && !opts.isPrivate && !isDesktopInternal(env),
  }
}

/**
 * Is this the desktop app's internal chrome-widget server?
 *
 * Keyed on the signal `buildServerEnv` already sets for the registry decision
 * (`HALTIJA_DESKTOP_PUBLIC=0`) rather than a new variable, so there is one answer to "which role is
 * this child" instead of two that can disagree.
 */
export function isDesktopInternal(env: Record<string, string | undefined>): boolean {
  return env.HALTIJA_DESKTOP === '1' && env.HALTIJA_DESKTOP_PUBLIC === '0'
}

/** What to tell someone who turned a transport off on a shared server (#32d). */
export function sharedChannelDegradedWarning(mode: TransportMode): string {
  const missing = mode === 'http' ? 'HTTPS' : 'HTTP'
  const pages = mode === 'http' ? 'https://' : 'http://'
  return (
    `DEV_CHANNEL_MODE=${mode} turns ${missing} off for every project on this machine, not just ` +
    `this one. The channel is shared: pages served over ${pages} will not be able to connect to ` +
    `it, and they will present as "my tabs aren't registering" with nothing in the logs. Prefer ` +
    `'both' unless you have a specific reason. See https://github.com/tonioloewald/haltija/issues/32`
  )
}

/**
 * The machine-level certificate directory.
 *
 * `HALTIJA_CERTS_DIR` exists so tests can point this at a temp dir — writing a real cert into the
 * developer's home during a unit run is exactly the machine-scope footprint `unit-tests.yml` asserts
 * against.
 */
export function resolveCertDir(
  env: Record<string, string | undefined>,
  home: string,
): string {
  return env[CERT_DIR_ENV] || join(home, '.haltija', 'certs')
}

export interface CertPaths {
  dir: string
  cert: string
  key: string
}

export function certPaths(dir: string): CertPaths {
  return { dir, cert: join(dir, 'localhost.pem'), key: join(dir, 'localhost-key.pem') }
}

export type CertPlan =
  | { action: 'use'; paths: CertPaths }
  | { action: 'adopt'; paths: CertPaths; from: CertPaths }
  | { action: 'generate'; paths: CertPaths }

/**
 * Decide how to obtain a certificate, without touching the filesystem.
 *
 * The `adopt` case is the one worth explaining: an existing install already has a cert under
 * `node_modules/haltija/certs` that the user has **already clicked through a browser warning for**.
 * Generating a fresh one at the new location would silently revoke that decision and re-prompt —
 * punishing existing users for an internal reorganisation they cannot see. Copying it forward keeps
 * their trust intact, and costs two file reads once.
 *
 * Pure, with `exists` injected, because the alternative is a function that can only be tested by
 * writing certificates into somebody's home directory.
 */
export function planCertSetup(opts: {
  certDir: string
  legacyCertDir: string
  exists: (path: string) => boolean
}): CertPlan {
  const paths = certPaths(opts.certDir)
  if (opts.exists(paths.cert) && opts.exists(paths.key)) return { action: 'use', paths }

  const legacy = certPaths(opts.legacyCertDir)
  if (opts.exists(legacy.cert) && opts.exists(legacy.key)) {
    return { action: 'adopt', paths, from: legacy }
  }
  return { action: 'generate', paths }
}
