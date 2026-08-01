# Upstream items

Cross-repo work surfaced by haltija reviews. **We file, we don't fix** — never edit another repo
directly. Each entry links the issue once filed.

## tosijs-ui — dev-server test lane should drive a `--private` haltija, not adopt the shared browser

**Status:** filed — https://github.com/tonioloewald/tosijs-ui/issues/21

`tosijs-ui`'s `dev-server.js` test mode runs an unscoped `hj windows` adopt check, so it consults
and can navigate whatever browser is live on the shared 8700 server — yanking a developer's live
browser to different pages, then failing on a timeout. This is the exact hazard that motivated
haltija issue #1.

haltija 1.5.0 ships the fix on our side: `haltija --private` (and `--private --app`) gives an
isolated server + browser on an ephemeral port that is never adopted by interactive `hj`. The
consumer needs to migrate: request a `--private` instance and drive **that** by the port it
reports (`--port-file` / `HALTIJA_PRIVATE_READY`), instead of the unscoped `hj windows` check.

Closing haltija #1 removes the field bug; it does **not** change the consumer until tosijs-ui
migrates. Issue URL: https://github.com/tonioloewald/tosijs-ui/issues/21

**Update (1.5.5+):** the Electron side is now complete — `--private --app` is isolated *and* tears
down with the run (issue #7: no single-instance lock, self-terminates on spawner death, `hj
shutdown`). So the migration is fully unblocked on haltija's end: the lane can drive a `--private`
instance (headless or app) by its reported port and either let its spawner exit or call `hj --port
<p> shutdown`. Still open pending the tosijs-ui change.

## Electron — deliberate workarounds, no upstream issue warranted

Two things haltija works around in Electron rather than filing upstream, recorded here as conscious
choices (`apps/desktop/main.js`):

- **No "die with my spawner" hook.** Electron reparents to launchd shortly after startup, so a
  child can't watch `process.ppid`. We pass the launcher's pid as `HALTIJA_SPAWNER_PID` and poll it,
  calling `app.quit()` when it's gone. A generic upstream API is unlikely to land.
- **No instance-scoped single-instance lock.** `requestSingleInstanceLock()` is per-app, not
  per-instance, so a private run can't take an isolated lock — we skip the lock entirely for private
  runs instead. Filing electron/electron for a scoped lock is low-value/unlikely; skipping is the
  right local call.

(The `--private --headless` server-orphan-on-SIGKILL leak — a sibling of #7 — is tracked in
`TODO.md`, not here: it's a haltija fix, not an upstream one.)

## tosijs-ui — stable agent-facing hooks for live examples

**Status:** filed — https://github.com/tonioloewald/tosijs-ui/issues/41

Agent-driven use of tosijs-ui live examples requires targeting internal class names
(`button.source-menu` → `.xin-menu-item`), which breaks on restyle and is undiscoverable. Asked for
`data-testid`-style hooks on the source-toggle / refresh / editor, plus documenting that Refresh
re-runs the already-loaded ES module (so `src/` edits need a full reload).

Deliberately NOT fixed in haltija: first-class `hj` verbs for one project's example UI would
hard-code an app into a generic browser-control tool — wrong layer. haltija's side of it (the
`:text()` selectors that make the class names unnecessary) shipped in 1.6.1; they were undocumented
in the skill's Live-control section, which is why the reporter reached for classes.
Origin: haltija#10.

## tosijs-ui — contrast-audit noise heads-up (informational)

**Status:** filed — https://github.com/tonioloewald/tosijs-ui/issues/42

Told tosijs-ui about two false-positive sources in haltija's contrast audit that I found and fixed
in 1.11.1 (text-less containers flagged; text over a background-image judged against the colour
beneath it, which could give a false PASS as well as a false fail), so they re-run before working
their findings list. Also flagged the `<button>` UA-background result that looks wrong but is a true
positive, and offered to tune anything still noisy.

Not a defect in tosijs-ui — informational, and an invitation to report noise back. Origin: their
audit surfacing a systemic backlog after haltija's console/contrast/map signals improved.
