# Upstream items

Cross-repo work surfaced by haltija reviews. **We file, we don't fix** — never edit another repo
directly. Each entry links the issue once filed.

## tosijs-ui#66 — doc/build system should afford drift control (PROPOSAL)

https://github.com/tonioloewald/tosijs-ui/issues/66

We hand-rolled three drift-control mechanisms because nothing shared existed: generated
marker-blocks written into hand-written docs, a mandatory `core` tier that splits the always-read
surface from the reference, and a byte ceiling on the agent prompt. They work
(`scripts/build.ts` → `writeGeneratedBlocks`, `src/test-actions.ts` → `core`,
`src/prompt-budget.test.ts`).

**We would rather delete all three and adopt tosijs-ui's** once it affords them. Every project
solving this separately is the duplication problem one level up — which is the thing the practice
is about. Volunteered as first adopter; the hand-rolled version is there to diff against.

Practice write-up (proposal, open for comment):
`tosijs-coding-practices/practices/documentation-surface.md`.

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

**Status:** CLOSED (2026-08-02) — https://github.com/tonioloewald/tosijs-ui/issues/42

Told tosijs-ui about two false-positive sources in haltija's contrast audit that I found and fixed
in 1.11.1 (text-less containers flagged; text over a background-image judged against the colour
beneath it, which could give a false PASS as well as a false fail), so they re-run before working
their findings list. Also flagged the `<button>` UA-background result that looks wrong but is a true
positive, and offered to tune anything still noisy.

Not a defect in tosijs-ui — informational, and an invitation to report noise back. Origin: their
audit surfacing a systemic backlog after haltija's console/contrast/map signals improved.


## tosijs — the `tosiAgent` surface has no version or capability marker

**Status:** filed — https://github.com/tonioloewald/tosijs/issues/23

haltija's `hj map` uses the app's own wiring records when a page exposes `globalThis.tosiAgent`, which
is strictly better than reconstructing affordances from the DOM. But it **detects** that tier by
duck-typing one method (`typeof agent.describe === 'function'`, `src/component.ts:1772`) and then
**consumes** a specific shape — `renderMapSchematic` reads `map.wiring` and per entry `tag`/`id`/
`label`/`on`. An upstream rename leaves `describe()` present, the response still stamped
`source: 'tosi-agent'`, and the schematic an empty ~320x24 PNG whose footer still reads
`wiring · <title>`: degradation that is silent *and* confidently mislabelled.

This is **haltija's coupling, not a tosijs defect** — no stable shape was ever promised or asked for.
The ask is only that the surface become interrogable (`tosiAgent.version` and/or `.capabilities`), so
a consumer can degrade deliberately instead of rendering a confident blank. A documented "this shape
is unstable" would also settle it.

Fixed on haltija's side in 1.12.0 rather than waiting: the tier now checks the shape it depends on
and returns a `warning` naming what it expected, surfaces `agentSurfaceVersion` when the app provides
one, and is marked EXPERIMENTAL in the agent-facing docs. Two regression tests, including the
discriminating case. Pre-existing since v1.8.0; not a regression in this diff. Cross-ref haltija#16.

## Screen-capture — `preferCurrentTab` only *defaults* the picker, so a grant can be for another tab

**Status:** NOT filed — deliberately. Recorded here so the decision is visible.

`getDisplayMedia({ preferCurrentTab: true })` (`src/component.ts`, cast through
`MediaStreamConstraints & {...}` because lib.dom has no such member) pre-selects this tab in the
picker; the user can still choose a different one, after which tab A's `/screenshot` returns tab B's
pixels for the life of the grant. On Firefox/Safari the option does nothing at all.

Not filed upstream because the spec behaviour is intentional — the picker is a user-consent surface
and a page that could *constrain* what it captures would be a privacy regression. The actionable
half is entirely ours: verify the grant with `track.getSettings().displaySurface` and, on Chromium,
`setCaptureHandleConfig()` / `getCaptureHandle()`, then warn or re-prompt when the captured surface
isn't this tab. Filed in TODO.md rather than upstream.

## tosijs-floorplan — converge the renderer (haltija should stop maintaining one)

- **https://github.com/tonioloewald/tosijs-floorplan/issues/1** — filed 2026-08-07;
  **all four gaps adopted in tosijs-floorplan 0.3.0 (renamed from tosijs-floorplan)** (2026-08-09), re-validated against a real
  map. `href` and `value` landed in **0.3.0**, along with a `SchematicResult {svg, legend}` and a
  `targetSize` option — i.e. the legend + give-up-threshold pattern was adopted into the renderer
  too, which shrinks haltija's side of the split further.
- **https://github.com/tonioloewald/tosijs-floorplan/issues/2** — filed 2026-08-09. Two gaps stop
  `undersized` firing for a DOM producer: `interactive` is inferred tosijs-style (needs `on`
  handlers / `contentEditable` / a two-way binding), and `textSizedLink` exempts EVERY link with
  text rather than only inline ones — so a 16x16 icon link in a nav row is exempt whenever it has
  an aria-label. Isolated with one variable per case. Not blocking us: haltija computes
  `smallTarget` itself (it has `getComputedStyle` and the parent chain, so it can implement the
  spec's real exception) and `producerTargetFlag` already defers to it.

  Adoption sequenced for haltija 1.13 — not mid-RC.

`tosijs-floorplan` is a pure, dependency-free (12KB, 23 tests) renderer for exactly what
haltija's schematic draws: "one shape per element at its true geometry". We built the same thing
independently, in the same week, without either knowing.

Verified concretely: haltija's affordance map converts to `SchematicRecord[]` with a near-1:1
field mapping and renders first try — 145 records, 133 with bounds.

**Their design is better in three ways** and we should adopt rather than duplicate: `structural`
drawn as a recessive dashed outline (we made it binary — draw or omit), the index pinned to a
dedicated top-right corner (our inline ref chips collide in small boxes), and the renderer being a
pure function over plain data rather than entangled with the widget.

**Four things we have that their contract doesn't carry**, offered upstream: a stable actionable
`ref` (their `index` is an array position — a vision consumer can look it up but cannot
`hj click` it), a slot for computed verdicts (our WCAG contrast finding, generalisable to
`flags[]`), embedded media (a DOM-side producer can serialise an inline `<svg>` and read a
`<canvas>` — a pure renderer cannot), and caption wrapping.

**Proposed end state:** haltija becomes a *producer* — DOM extraction is its real competence
(visibility, geometry, contrast, media, stable refs) — and delegates drawing. Improvements then
flow both ways instead of diverging. **1.13, not 1.12**: it is an architectural change, and 1.12.0
is in RC.

## Bun — `Bun.serve({unix})` accepts connections but never responds (1.4.0)

**Filed:** https://github.com/oven-sh/bun/issues/41381 · **Status:** open · **Covers:** haltija at `99858e1`

Bun 1.4.0 (macOS arm64) cannot serve over a Unix domain socket. `Bun.serve({unix})`, `node:http`
listening on a socket path, and raw `Bun.listen({unix})` all accept the connection and never
answer (curl exit 28, request fully sent). A Node-server/Node-client control over the same socket
path on the same machine works, which is what makes it attributable to Bun's listener rather than
the platform.

**Why it mattered here:** #40 needed machine-scope endpoints on a channel a browser cannot address,
and a UDS is the natural answer — no origin, no port, no URL `fetch()` can name. We wrote it,
measured the failure three ways, and **backed it out** rather than ship a socket that is created,
chmod'd, announced in the log, and answers nothing.

**We are not blocked.** The replacement — JSON-lines RPC over the server child's stdio
(`src/machine-channel.ts`) — is good on its own merits and should stay even if Bun fixes this: a
pipe has no address either, and Electron main already owns the child. So an upstream fix is about
the ecosystem, not about reverting our design.

## tosijs-schema — `s.any` emits invalid JSON Schema

- **https://github.com/tonioloewald/tosijs-schema/issues/3** — filed 2026-08-08.

`s.any` serializes to `{"type": [null, "null"]}`; the first entry is a literal `null` rather than
a type-name string, so it is not valid JSON Schema. It appears in 7 haltija endpoint definitions,
which means `API.md`, `llms.txt`, the MCP manifest and our 400 response bodies all carry invalid
fragments.

**Measured cost, not theoretical:** an agent testing 1.12.0-rc.2 hit an unrelated CLI bug (a POST
sent with no body), saw this fragment in the schema our 400 helpfully attaches, and reasonably
filed it as "invalid schema" — quoting it as the cause. It wasn't; `validateInput(endpoint, {})`
passes. Both of us spent time on the wrong thing.

**Not worked around locally, deliberately.** Replacing all 7 `s.any` uses with concrete types
immediately before a release means changing validation on `test`/`tests` (the JSON test runner's
payload) without knowing how lenient the current validator is being — exactly the kind of
late change that bites. Tracked in `TODO.md` for after 1.12.0.

