/**
 * Every well-known port haltija uses, in one place, with its role (#32a).
 *
 * ## Why this file exists
 *
 * `8701` had **two** defaults, written in two files that had no idea about each other:
 *
 *   src/server.ts:148        DEV_CHANNEL_HTTPS_PORT || '8701'   → the public HTTPS listener
 *   apps/desktop/main.js:97  HALTIJA_INTERNAL_PORT  || '8701'   → the desktop chrome-widget server
 *
 * Both are correct in isolation and they cannot both bind. This is the same defect shape as every
 * other structural twin in this repo (`cli-commands`, `window-state`, `desktop-server-env`): one
 * idea, two implementations, and the drift is invisible until something collides at runtime. The
 * remedy is the same one — one source, twins compiled from it, and a test that fails if the roles
 * ever overlap again.
 *
 * ## The harm it caused, before #32a made it unavoidable
 *
 * It was not merely latent. A user running `haltija --both` (documented, and what #32a wants as the
 * *default*) holds HTTP 8700 and HTTPS 8701 in ONE process. Then:
 *
 * - **`serverMode: 'builtin'`** → `killZombieServer()` POSTs `/shutdown` to 8700 *and* 8701. The
 *   8701 call lands on that user's `--both` server and takes down **both** its transports, because
 *   they share a process. The desktop app kills a healthy peer's whole channel, on a port it only
 *   wanted for its own private widget.
 * - **`serverMode: 'auto'` against an HTTPS-only channel** (`haltija --https`) → `checkServerRunning`
 *   probes `http://localhost:8700`, finds nothing, starts embedded, and the internal server tries to
 *   bind 8701 — where the user's HTTPS listener already is. That is issue #32's own scenario (an
 *   HTTPS-only project) with the desktop app layered on top.
 *
 * ## Which one moved, and why it was the internal port
 *
 * HTTPS 8701 has callers we do not control and cannot update:
 *
 * - the injected loader and bookmarklet hardcode `https://localhost:8701` (`src/ws-url.ts`, the
 *   embedded `inject.js`) — see #38 for what happened last time that string drifted;
 * - adopters' dev servers import `https://localhost:8701/dev.js` (tosijs-3d's doc site does);
 * - the user has clicked through a self-signed-certificate warning **for that origin**, and trust is
 *   per-origin: moving the port silently un-trusts the cert and presents as a dead channel.
 *
 * The internal chrome-widget port has exactly one client — the desktop app's own renderer, shipped
 * in the same binary and updated with it. Moving it costs three doc lines. Moving HTTPS would break
 * external code and invalidate cert trust. So the internal port moved.
 *
 * ## The block
 *
 *   8700   public HTTP        agents, `hj`, injected widgets
 *   8701   public HTTPS       the same channel for https:// pages
 *   8710   internal HTTP      desktop chrome widget (the app inspecting itself)
 *   8711   reserved           internal HTTPS, should it ever need one
 *
 * Public and internal are a decade apart deliberately: adjacent numbers invite exactly the
 * "8701 is free, I'll take it" reasoning that created the collision. Anything new claims 87x0/87x1
 * in its own group rather than the next integer.
 */

/** Public HTTP: the channel agents and `hj` drive. */
export const DEFAULT_HTTP_PORT = 8700

/**
 * Public HTTPS: the same channel for `https://` pages. Hardcoded in the injected loader and in
 * adopters' dev servers — treat as effectively immovable.
 *
 * Whether an https page could use HTTP instead depends on the engine: Chromium and Firefox allow
 * `http://localhost`, WebKit/Safari blocks it as mixed content (measured — `src/transports.ts`).
 * So for Safari this port is the ONLY way in, on top of being immovable because of who hardcodes it.
 */
export const DEFAULT_HTTPS_PORT = 8701

/**
 * The desktop app's internal server, hosting the outer chrome widget.
 *
 * **Moved from 8701 in 1.13.0** because that is the public HTTPS port. Only the desktop app's own
 * renderer connects here, so nothing outside this repo names it.
 */
export const DEFAULT_INTERNAL_PORT = 8710

/** Reserved for an internal HTTPS listener. Nothing binds this today; it exists to stay unclaimed. */
export const RESERVED_INTERNAL_HTTPS_PORT = 8711

/**
 * What the internal server used to default to.
 *
 * Kept named rather than inlined so the migration diagnostics can say *which* number changed. A
 * desktop app older than 1.13.0 still holds 8701, so a new `--both` server may fail to bind HTTPS
 * until that app restarts — and it must say so, not fail quietly.
 */
export const LEGACY_INTERNAL_PORT = 8701

/**
 * Ports that belong to the *public* channel and must never be claimed by anything internal.
 *
 * This is the list `assertNoPortRoleConflict` checks against, and the reason the regression cannot
 * silently return.
 */
export const PUBLIC_PORTS: readonly number[] = [DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT]

/** Ports reserved to the desktop app's own internals. */
export const INTERNAL_PORTS: readonly number[] = [
  DEFAULT_INTERNAL_PORT,
  RESERVED_INTERNAL_HTTPS_PORT,
]

/**
 * Explain a configured internal port that collides with the public channel, or `null` if fine.
 *
 * Returns a *message*, not a boolean, because the whole lesson of #32 is that a half-open channel
 * and a healthy one are indistinguishable from outside. Someone who sets
 * `HALTIJA_INTERNAL_PORT=8701` by hand gets told what will break; they do not get a bind error from
 * a process they did not know was involved.
 */
export function internalPortConflict(port: number): string | null {
  if (port === DEFAULT_HTTPS_PORT) {
    return (
      `HALTIJA_INTERNAL_PORT=${port} is the public HTTPS port. The desktop app's internal ` +
      `chrome-widget server would contend with the channel that serves https:// pages — and in ` +
      `'builtin' server mode it shuts down whatever it finds there, taking a --both server's HTTP ` +
      `listener with it. Default is ${DEFAULT_INTERNAL_PORT}. See ` +
      `https://github.com/tonioloewald/haltija/issues/32`
    )
  }
  if (port === DEFAULT_HTTP_PORT) {
    return (
      `HALTIJA_INTERNAL_PORT=${port} is the public HTTP port — the internal server would contend ` +
      `with the channel agents drive. Default is ${DEFAULT_INTERNAL_PORT}.`
    )
  }
  return null
}

/**
 * Fail loudly if the public and internal blocks ever overlap.
 *
 * Called from `src/ports.test.ts`. A constant is not a guard: the previous arrangement was two
 * constants that happened to be equal, and nothing anywhere would have noticed. This is the check
 * that had to exist for the fix to be more than a renumbering.
 */
export function assertNoPortRoleConflict(): void {
  const overlap = INTERNAL_PORTS.filter((p) => PUBLIC_PORTS.includes(p))
  if (overlap.length > 0) {
    throw new Error(
      `Port role conflict: ${overlap.join(', ')} assigned to both the public channel and the ` +
        `desktop app's internals. That is issue #32a — one number, two defaults, neither aware of ` +
        `the other. Pick a free number in the internal block rather than reusing a public one.`,
    )
  }
}
