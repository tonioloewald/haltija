/**
 * The desktop app's "which server am I talking to?" rules, in one testable place.
 *
 * These were three inline expressions across `preload.js`, `state.js` and `renderer.js` — the
 * guards that keep a `--private` instance from connecting to the shared 8700/8701. They were added
 * to fix a real isolation bug and shipped with **no test at any tier**, because everything that
 * could exercise them needed a running Electron. Guards nobody can run are indistinguishable from
 * guards that don't work, and one of them didn't:
 *
 *   preload.js:  serverUrl: process.env.HALTIJA_PUBLIC_URL || 'http://localhost:8700'
 *   state.js:    const injected = window.haltija?.serverUrl
 *                if (injected) settings.serverUrl = injected
 *
 * The fallback made `injected` **always truthy**, so `if (injected)` fired unconditionally and the
 * user's saved "Server URL" setting was silently reverted on every launch. The setting appeared to
 * save (it went to localStorage and the field showed it), then quietly stopped applying — which is
 * worse than not having the setting, because the UI keeps claiming otherwise.
 *
 * Compiled to BOTH a CommonJS twin (`apps/desktop/isolation.js`, for the preload script) and an ESM
 * twin (`apps/desktop/renderer/isolation.js`, for the renderer modules). Two twins from one source,
 * because the two consumers genuinely differ in module system — not two implementations.
 */

/** The shared, well-known public server. A private instance must never resolve to this. */
export const SHARED_PUBLIC_URL = 'http://localhost:8700'
/** The shared, well-known internal (chrome-widget) server. */
export const SHARED_INTERNAL_PORT = 8701

export interface IsolationEnv {
  HALTIJA_INTERNAL_PORT?: string
  HALTIJA_PUBLIC_URL?: string
  HALTIJA_PRIVATE?: string
}

/**
 * The internal chrome-widget port for THIS instance.
 *
 * `0` means "this instance has no internal server" and must survive as `0`. Writing this as
 * `parseInt(env.X, 10) || SHARED_INTERNAL_PORT` — the obvious form — resurrects the *shared* 8701
 * for a private instance that deliberately has none, which is precisely the cross-project
 * connection the private mode exists to prevent.
 */
export function resolveInternalPort(env: IsolationEnv): number {
  const raw = env.HALTIJA_INTERNAL_PORT
  if (raw === undefined || raw === '') return SHARED_INTERNAL_PORT
  const parsed = parseInt(raw, 10)
  // A non-numeric value is a bug upstream; falling back to the shared port would hide it and cross
  // the isolation boundary. Report "none" instead — an app with no internal widget is visibly
  // degraded, whereas an app silently attached to another project's server is not.
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

/**
 * The public server address main resolved for this instance, or `null` if main didn't set one.
 *
 * **`null`, not a default.** The caller needs to distinguish "main told me where my server is" from
 * "nobody told me anything" — collapsing those into `'http://localhost:8700'` is exactly what broke
 * the Server URL setting.
 */
export function resolvePublicUrl(env: IsolationEnv): string | null {
  return env.HALTIJA_PUBLIC_URL || null
}

/** Is this a `--private` instance, whose isolation overrides user preference? */
export function isPrivateInstance(env: IsolationEnv): boolean {
  return env.HALTIJA_PRIVATE === '1'
}

export interface ServerUrlInputs {
  /** What main injected for this instance (`window.haltija.serverUrl`), or null. */
  injected: string | null
  /** Whether this instance is isolated. */
  isPrivate: boolean
  /** What localStorage had, if anything. */
  persisted?: string | null
  /**
   * Whether the persisted value came from the user editing the setting, as opposed to being a
   * snapshot of whatever a previous run happened to be using. Absent on settings saved before this
   * field existed, which correctly reads as `false`.
   */
  persistedIsUserSet?: boolean
}

/**
 * Which server URL this window should actually use.
 *
 * Three rules, in strict priority:
 *
 *  1. **A private instance always uses its injected address.** Isolation is not a preference. A
 *     persisted URL is per-origin and shared across runs, so a value saved by an earlier or shared
 *     session would point a private app straight back at the shared server.
 *  2. **Otherwise a URL the user deliberately typed wins.** That is what the setting is for, and
 *     overriding it was the bug.
 *  3. **Otherwise this instance's own address wins over a stale snapshot.** A non-private app whose
 *     server landed on an ephemeral port (8700 was busy) must not inherit a persisted `8700` and
 *     start driving another project's browser.
 */
export function resolveServerUrl(inputs: ServerUrlInputs): string {
  const { injected, isPrivate, persisted, persistedIsUserSet } = inputs
  if (isPrivate && injected) return injected
  if (persistedIsUserSet && persisted) return persisted
  return injected || persisted || SHARED_PUBLIC_URL
}
