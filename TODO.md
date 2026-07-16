# TODO

## UI-debugging primitives — the actual product thesis

**Positioning note (Tonio's, and it's the one to build against).** Haltija is **a tool for
building and testing user interfaces** — interactively *and in CI* — that also happens to let
an agent use websites. Claude-in-Chrome is the mirror image: a tool for letting an agent *use*
websites, that also happens to have `eval`. Same two capabilities, inverted primacy.

So the comparison is legitimate — tosijs-ui overshot in calling them non-competitors — but the
axis is *primary purpose*, not feature overlap. And note tosijs-ui's proposed competitor set
("an agent writing throwaway Playwright scripts", "a human squinting at DevTools") is
**interactive-only**: it drops CI, which is the half we've deliberately invested in
(`--headless`/`--ci`, JSON fixtures) and the half that justifies deprioritizing the DMG. If
Haltija is a UI *testing* tool, its real peer is **Playwright proper**, and the honest question
is whether record→replay JSON tests beat writing specs by hand.

Keep every comparison strictly fair and honest even where it doesn't flatter Haltija — the
problem to fix is that we're comparing on the wrong axis, not that we're being too modest.

The evidence below is from a real session debugging tosijs-ui's scroll engine, not from theory.
Every item is something that had to be hand-rolled — badly, three times — inside an `eval`:

- [ ] **`hj scrub`** — sweep scroll position across N steps, sampling expressions at each.
      `hj scrub --steps 20 --sample 'map.getZoom()' --sample 'sm.dataset.localProgress'`
      → a table of scroll position vs. sampled values. For a scroll-narrative library this is
      the whole ballgame: one command instead of six, and it answers "is the flyover working"
      directly. Note the scroll container is often **not** `document.scrollingElement` (it was a
      doc-system `<div>`), so this must walk the ancestor chain to find the real one.
- [ ] **`hj spy <method>`** — `hj spy 'tosi-scroll-map.setScrollProgress'` → call count and
      arguments over time. "Is progress even reaching this component" is the first question in
      every scroll-engine bug, and today it needs a bespoke monkeypatched closure.
- [ ] **Contact sheet** — screenshot at N scroll positions, tiled into one image. A single
      screenshot at 80% settled a question instantly; five side by side would have settled it
      *before* an hour went down a "map never initialized" rabbit hole.
- [ ] **Cold-cache / throttled-load emulation** — *push hardest on this one.* The real bug found
      that day ([tosijs-ui#13](https://github.com/tonioloewald/tosijs-ui/issues/13) — 180
      `mapboxgl.Map` instances in one element) **only exists inside the CDN-load window**, and
      had to be faked by monkeypatching `MapBox.mapboxAvailable` with a delayed promise.
      Async-init races are where component libraries actually break, and nothing in the current
      toolchain makes them reproducible. "Load this page cold, on 3G, and scrub the scroll"
      would have surfaced it as a matter of routine.
- [ ] **Output that survives the trip.** The above got reformatted into compact rows by hand
      because the tool truncated the JSON twice. Sampling primitives must return
      agent-sized tabular output, not raw JSON that gets cut off.

- [ ] **Custom-element-aware inspection** *(tosijs-project)*. Shadow roots,
      `initAttributes`-backed properties, CSS custom properties like `--local-progress`.
      Generic DOM tools flatten all of that; a **tosijs-native** debugger shouldn't. We already
      pierce shadow DOM structurally (`hj tree --shadow`) — this is about the *state* side:
      reading the properties and custom props that actually drive a tosijs component.

### `hj vitals` — the orientation call *(do this one first)*

**The gap it fills.** A token-minimal, query-narrow API implicitly assumes **the agent already
has the right hypothesis.** Narrow questions get narrow answers — *including narrow wrong ones.*
A probe asked "is the map ready?" three seconds in, got `false`, and sent an agent hunting a
phantom initialization bug for ninety minutes. The answer was **true and useless**. Nothing in
the loop said *"the thing you should be looking at is that this page has 180 WebGL contexts and
a wall of console errors."*

**Why a human doesn't have this problem, and an agent does.** A developer sees console spam —
especially errors — *peripherally*, and treats a big red pile as a large signal without ever
asking for it. For an agent that signal **does not exist unless it explicitly queries for it.**
So the tool has to volunteer what's weird, or the agent will confidently reason from a page
that is visibly on fire to anyone with eyes on it.

So: a cheap orientation call that sits **between the two extremes we already have** — not a DOM
dump (expensive, low signal) and not a single expression (cheap, but needs a hypothesis).
A few hundred tokens, high signal, answering *"what's weird here?"* rather than *"what did you
ask about?"* Candidate contents:

- console errors + unhandled rejections **since last check** (the delta is the signal)
- pending / failed network requests
- custom elements that **failed to upgrade**
- live **WebGL context count** (see resource accounting below)
- elements with zero-size boxes that shouldn't have them
- long tasks

This is the call an agent should make *first* in any debugging loop. It would have handed over
the real bug in the first thirty seconds instead of the ninetieth minute.

## Hidden / off-screen tab: detect and respond better (needs repro first)

**Symptom** *(from tosijs-3d/Tonio):* a tab that isn't visible on screen — backgrounded,
minimized, or **maximized on another Space / occluded on macOS** — makes haltija "seem broken."
Documented as a gotcha in DOCS.md + llms.txt (bring it forward, or target explicitly with
`hj --window <id>`). The code-side improvement below is separate and **not yet done**.

**Mechanism — partially traced, NOT yet reproduced (do that first).** Two things happen when a
tab goes `hidden`:
1. The widget calls `deactivate()` on `visibilitychange → hidden` (`component.ts:2804`), which
   tells the server this window is inactive so untargeted commands prefer the visible tab.
2. Browsers stop `requestAnimationFrame` and throttle timers while hidden — so rAF-driven state
   (scroll progress, animation frames) is frozen even if the widget does answer.

   *Caveat, stated honestly:* the widget's command gate (`component.ts:7053`) reads as though
   **untargeted** commands are still handled when inactive (`isForUs` is true when there's no
   target window), so my static reading does **not** fully explain a hard "no response." The
   real failing path must be reproduced with an actual hidden tab before changing code — I
   could not simulate that from a shell, and this session's rule is: don't ship a fix on an
   unverified reading of a running system.

**The improvement, once reproduced:**
- **Make the sole connected window always addressable** by untargeted commands regardless of
  visibility — with one tab there's no ambiguity about which you mean, so focus-follows-visible
  shouldn't apply. (The multi-tab focus behavior only earns its keep when there ARE multiple
  tabs.) This fixes the common single-tab dev case with no downside.
- **When a command can only route to an inactive/hidden window, return an actionable error**
  the server already has the facts for (it knows the window is `active:false`): name the cause
  and the fix (`bring it forward, or hj --window <id>`), instead of a bare `Timeout`. This is
  the "instrument must not lie" / negative-blast-radius fix — one place, every consumer.

## Multi-tenancy: a working set, not isolation-vs-sharing

**The design target, named properly:** twenty projects *addressable*, three or four *resident*.
That's **virtual memory applied to tabs** — and the goal is explicitly to avoid a bazillion
containers eating the battery and RAM.

- [ ] **One `BrowserContext` per project.** Chromium's cheap isolation primitive, sitting exactly
      between "one shared tab" (which bites us) and "twenty containers" (which we're avoiding):
      incognito-grade separation of cookies, localStorage, IndexedDB and **service workers**,
      while sharing the browser process, GPU process and binary. The state it isolates is
      precisely the state that makes concurrent dev sites collide — SWs and localStorage keyed by
      `localhost:PORT`, where a stale service worker from project A cheerfully serves project B.
      Miserable to debug; free to prevent.
- [ ] **Lease the tab, freeze the rest.** Live tabs are the expensive thing (a renderer is tens to
      hundreds of MB; a rAF loop with a WebGL context burns battery just sitting there). Keep a
      bounded working set, evict by LRU — but evict to **frozen/discarded, not closed**
      (`Page.setWebLifecycleState` / tab discard), which drops the renderer while preserving the
      tab's identity and URL. **The lease outlives residency.** An agent returning after twenty
      minutes issues a command, haltija transparently rehydrates, and the agent never knows it was
      paged out. *Identity is cheap and permanent; residency is expensive and transient.*
- [ ] **Fencing tokens + stamped responses.** Every response carries tab id, URL and **lease
      epoch**. This turns the whole class of cross-tenant bleed into a **hard error at the
      boundary** instead of a silent wrong answer, and it's the same idea as the
      instrument-must-not-lie item above: *a tab's eviction must be a fact you can observe, not an
      absence you have to infer.* (Real incident: an agent concluded a component wasn't in the DOM
      because it was reading **someone else's page** and didn't know it. It caught that by
      accident. An unattended agent wouldn't have.)
- [ ] **Account for WebGL contexts as a first-class resource, not just RSS.** Chrome caps live
      contexts around **16 browser-wide** and force-discards the oldest past that. Twenty projects
      with a map or a 3D scene in several blow through that *while behaving* — and one `<tosi-map>`
      bug spawned **180 in a single element**. The failure mode isn't slowness, it's *"another
      tenant's map silently went black."*
- [ ] *(Later, deliberately not now.)* The browser may not even be the biggest hog: twenty projects
      means twenty long-lived dev servers with bundlers in them, and a pre-1.6.22 tosijs-ui dev
      server leaked to **136 GB RSS** over two days. Idle-stopping dev servers is the *same
      working-set abstraction* applied to the thing actually eating the machine. Resist building it
      until tab leases are nailed — but know that's where this is heading **before** hardening the
      interfaces around tabs alone.

## Prove it: the benchmark nobody in this category has built

There are **no benchmarks in browser-tooling-for-agents. It's all demos.** That's a vacuum, and
the tool with the high bar should fill it — partly because we'd win, but mostly because a
benchmark reframes the argument from *"look what my agent did"* to *"here's what the loop is
worth"*, which is the argument we want and the one Playwright-shaped tools can't win.

- [ ] **Same model, same task, with and without haltija.** Measure iterations-to-working,
      wall-clock, and — the number to put on a slide — **the rate at which the agent catches its
      own errors versus declaring victory on something broken.** Everyone demos success; nobody
      measures how often the agent *thought* it succeeded and hadn't.

*Caveat to keep us honest:* the "agent built a JSON-schema-powered editor in 45 minutes using
haltija, six months ago" story is a **great hypothesis generator and a weak proof** — one agent,
one task, and the models have moved enormously since. A skeptic will fairly say "a current model
would build that with no tool at all," and we can't argue that away with an anecdote. The
benchmark is how we answer it. (See also the fairness rule: claims must survive a hostile reading.)

## Design principles these all serve

- **Token burn is not an expense, it's brain damage.** An agent that spends 10k tokens on a DOM
  dump doesn't just *pay* 10k tokens — it is measurably worse at reasoning for the rest of the
  session, and in a long autonomous build that's what actually ends the run. "Minimize token burn"
  really means **"preserve the agent's reasoning capacity across a long loop."** Same thesis as
  everything else here: high signal, low volume, honest.
- **Pixels are a terrible oracle.** A screenshot of a 3D scene says "that looks wrong" and nothing
  else. What's needed is the scene graph — camera alpha/beta/radius, FOV, which animation group is
  at which frame, how many meshes loaded, whether the light exists. A screenshot-and-click tool
  **structurally cannot see that**; it isn't a few features behind, it's on a design path that
  cannot reach 3D. An eval-first API can ask *"radius is 12, should be 3."*
- **An agent's ceiling is set by the fidelity and honesty of its feedback.** What gates an agent
  building real UI isn't code generation, it's whether **its model of the running page is true.**
  Interrogation, not observation, is what closes the loop on real bugs instead of pixels. This is
  the same idea as settle-based assertions and instrument-must-not-lie — they are one idea.
- **Multi-tenancy plumbing is not housekeeping competing with the high bar — it is the
  precondition for the high bar holding when twenty agents run at once.** In a 45-minute
  autonomous build, one cross-tenant read means the agent builds on a false premise for the next
  forty minutes with no signal that anything is wrong.

### The through-line (tosijs-project's framing — worth putting on the README)

> The differentiator isn't access to a browser, it's the ability to **hold a running UI at an
> arbitrary point in its state space and interrogate it.** Claude-in-Chrome gives an agent
> hands. Playwright gives it a script. **Neither gives it instruments.**

That's an unoccupied niche and it's exactly the shape of the bugs this stack produces. Note it
sharpens Tonio's positioning rather than replacing it: a UI build/test tool, whose distinctive
verb is *instrument*, not *drive*.

### Foundational, not a feature: an instrument must not lie

> "When the tab vanished mid-probe, my measurements didn't fail loudly — they went **ambiguous**,
> and I couldn't tell 'the map is broken' from 'my instrument is broken.' An instrument that lies
> is worse than no instrument." — tosijs-project

This bites harder for a debugging tool than a browsing one, and it's a **correctness** property,
not a nice-to-have. What I verified against 1.4.0 (so this list is evidence, not speculation):

- [x] With **no browser connected**, `/eval` returns `{success:false, error:"No browser
      connected…"}` and plain `hj` exits **1**. The loud signal exists for that case.
- [x] **`hj … --json` printed the failure envelope and then exited 0** — so an agent checking
      the exit code (which is how a harness decides whether a step worked) saw *success* while
      the payload said failure. Fixed in 1.4.0: `--json` now exits 1 when `success:false`.
      *(Correction: I first filed this as "`--json` prints nothing", from a measurement where
      I put `--json` before the subcommand, where it isn't parsed. The review had it right and
      I had it wrong. Worth keeping visible — a false finding from a mis-run instrument, in the
      middle of a thread about instruments that lie.)*
- [ ] **The mid-probe case is untested and is the one that actually bit.** Losing the browser
      *during* an in-flight request is a different path from having none at the start. Needs a
      test that drops the WebSocket mid-`/eval` and asserts the response is an unambiguous,
      machine-readable "I lost the browser" — never a timeout that reads like a slow page, and
      never a partial result.
- [ ] **Liveness in the response envelope.** Every result should be able to say *which* window it
      was measured against and that the window was still alive when the value was taken —
      otherwise a scrub/sample table can silently contain readings from a tab that died halfway.

## From tosijs-3d's pain report (attribution noted honestly)

- [x] **#1 — `hj` self-spawned a server from a read-only-ish call, ignoring `--no-launch` and
      explicit targeting.** `hj --no-launch --port 8700 eval` bound its own listener on 8700 and
      took the dev channel offline. The auto-spawn only checked "is the port answering", not
      "am I allowed to start one" — `--no-launch` gated the browser launch but not the server
      spawn, and an explicit `--port`/`--name` didn't suppress it either. **Fixed in 1.4.0:**
      auto-spawn is now confined to the bare 8700 default, mirroring the Electron rule; an
      explicit target or `--no-launch` that finds nothing is an actionable error, not a spawn.
      *Attribution: pre-existing (the spawn path predates the 1.4.0 work), but squarely in the
      CLI-targeting behavior 1.4.0 overhauls, so fixed here.* Also removes the root cause of #5.
- [x] **#5 — stray servers on random ports muddying the registry.** Downstream of #1 (those
      servers were auto-spawned). With #1 fixed they're no longer created; and every server now
      cleans its registry entry on SIGINT/SIGTERM/exit, with stale entries self-healing on lookup
      (dead pid → removed). *Attribution: 1.4.0's auto-registration made strays visible in the
      registry rather than hidden — net good — but the strays themselves were #1.*
- [ ] **#4 — ambient focus targets the wrong tab; a backgrounded tab can latch `focused:true`.**
      Two dev pages on one channel → `hj eval` silently hits the wrong one, and `hj tabs focus`
      times out on a backgrounded tab. *Not caused by 1.4.0.* This is the same need as
      tosijs-project's fencing-tokens / per-call-targeting item above — **explicit per-call tab
      targeting (by id/url, not ambient focus)** is the fix. Reinforces that item.
- [ ] **#3 — HTTP/HTTPS asymmetry (hj→8700, widget on an https page→8701).** The CLI reports
      "connected" (to 8700) while the widget can't connect (to 8701) — two truths. *Not caused by
      1.4.0*, though the https-only phantom-registration fix helps a little (an https-only server
      no longer advertises an HTTP port it isn't serving). Needs: hj aware of the https port, and
      a too-fast restart leaving 8701 in TIME_WAIT should not silently downgrade to HTTP-only.
- [ ] **#2 — the dev channel dies with the dev server.** Kill the dev server for a clean build →
      channel drops, tab orphans (page loaded, socket dead). *Architectural (the embedding
      model), not caused by 1.4.0.* Design a channel that outlives a dev-server restart, or
      reconnects automatically — erases a class of "reload again" churn.
- [~] **#6 — WebXR suspends `window.rAF`, stalling the heartbeat; the tab goes unreachable while
      immersive.** *Inherent to WebXR, not a haltija bug* — so **docs are the mitigation, and they
      shipped in 1.4.0**: a "tab reads as unreachable" troubleshooting section in `DOCS.md` and a
      gotcha in `llms.txt` (both agent-facing, served at `/docs` and `/llms.txt`) explain that a
      suspended main thread / rAF stalls the heartbeat, and to drive state out through your own
      channel instead of round-tripping `hj eval`. *Still open as a design item:* a heartbeat that
      doesn't ride `window.rAF` (or a fallback timer) would make immersive pages drivable, not just
      diagnosable. (tosijs-3d's workaround: `addDebugSource` → in-headset Perf Stats panel.)

## Post-1.4.0 follow-ups (from the pre-release review — none block the tag)

- [ ] **Kill the cwd-routing duplication** *(dryness + coverage + ecosystem, all confirmed)*.
      `resolveByCwd` / `isAncestorOf` / `listLiveInstances` / the broad-cwd guard exist twice —
      in `src/sessions.ts` (tested) and hand-copied into `bin/hj.mjs` (**shipped, untested**) —
      and the copies have already drifted (`'/'` vs `sep`; inlined guard vs `isTooBroadForCwdMatch`;
      `startedAt||0` vs `startedAt`). `scripts/build.ts` flags this in a comment and then does it.
      It routes *every* `hj` call. Fix with the pattern this release already established: compile
      the routing/registry helpers out of `src/sessions.ts` into a `bin/` module (as done for
      `bin/semver.mjs`) and import them, so there is one tested source. Inert on POSIX today; the
      next routing fix lands in the tested copy and ships nothing.
- [ ] **Default test-mode safety posture, not per-file opt-in** *(practices, confirmed)*. The
      `HALTIJA_REGISTRY_DIR` + `NO_INSTALL` + `NO_RETIRE` guard is a copy-pasted 3-line preamble
      in ~11 spawning test files; a new test that forgets it silently pollutes the real
      `~/.haltija` / `~/.local/bin/hj`. Move it to a `bunfig.toml` preload / shared test-setup
      that defaults these in test mode, and delete the copies. (`unit-tests.yml` asserts the
      footprint, so a regression fails CI — but defense in depth beats a per-file ritual.)
- [ ] **`freePort` is not gated by the test opt-outs.** `NO_RETIRE`/`NO_INSTALL` don't cover it,
      so `bun test src/server.test.ts` on a machine with a real server on the strict port can
      `POST /shutdown` to it and append to the real `machine-actions.log`. Gate freePort behind an
      opt-out the suite sets, and extend `unit-tests.yml`'s footprint check to fail if
      `machine-actions.log` was created/appended during the run.
- [ ] **`bin/tosijs-dev.mjs` `killOnPort` reimplements `port-pid.ts`** *(dryness, confirmed)* —
      compile `listenerPidsOnPort`/`isHaltijaProcess` into `bin/` and reuse, so the SIGTERM
      identity check has one source of truth.
- [ ] **Document `hj`'s exit-code contract** in SKILL.md / DOCS.md: `hj` exits non-zero when an
      operation reports failure (`success:false`), including action commands (click/navigate/key).
      Agents are told to trust the exit code, so the contract should be written down.
- [ ] **Tighten `isHaltijaProcess`** *(blast-radius, unverified)* — it matches any argv containing
      `haltija`/`tosijs-dev`, so a process launched by absolute path from a dir named `haltija`
      could be a false positive before SIGTERM. Match a haltija *invocation* shape
      (`dist/server.js`, `haltija-server`, `bunx haltija`) instead. Same at `apps/desktop/main.js`.
- [ ] **`src/machine-log.ts` has zero tests** — add one against a temp `HALTIJA_MACHINE_LOG`:
      append/parse per action kind, `readMachineActions(limit)` newest-last, missing/garbage file
      → `[]` without throwing, unwritable path doesn't throw.
- [ ] **`installedVersion()` spawns `hj --version` on every boot** — for our own artifact the
      version is already in the `haltija-cli:do-not-edit vX.Y.Z` marker line the head window read;
      parse it, and exec only for the markerless legacy case.
- [ ] **`identifyHj` / `identifyHjBounded` encode the same 4-branch ladder twice** — factor into
      one `classify()` parameterized by a byte-window accessor. This code can delete a file on
      disk; the two paths must stay in lockstep.
- [ ] **Integration tiers can latch onto a transient `src/`-spawned server.** Bare `bun test`
      shows red integration-tier tests; point their skip-probe at a dedicated port (not 8700), and
      document that `bun test src/` and `bun test tests/` are the supported invocations, not bare
      `bun test`.
- [ ] Add the five new 1.4.0 modules to the CLAUDE.md Key Source Files table (`hj-install.ts`,
      `legacy-servers.ts`, `port-pid.ts`, `semver.ts`, `machine-log.ts`).
- [ ] File the ecosystem/upstream items in `UPSTREAM.md` (which doesn't exist yet): `bun build
      --compile` bloat (now shim-worked-around), no port→pid API, npx cache-lock on Electron
      restart. And the repo has **zero GitHub issues** — the remediation this release performs is
      unfindable by the transitive users it exists for; open a tracking issue.

## Build / Distribution

- [x] **`hj` no longer ships as a 60 MB binary to deliver a 66 KB program.** `bun build
      --compile` statically links the *entire Bun runtime* and appends the payload, so
      `hj-arm64` was 60.6 MB and `hj-x64` 66.0 MB — ~99.9% runtime. (That layout also caused a
      real bug: the payload, and therefore the ownership marker, sat at byte 62,735,161, past
      every head window — which is how the installer came to disown its own binary.)

      The DMG already bundles a Node runtime (Electron, via `ELECTRON_RUN_AS_NODE=1`), so the
      app now ships the 66 KB `hj.mjs` and installs a **416-byte shim** that execs it with that
      runtime. **127 MB out of `resources/`, and the DMG carries it twice (two arches).**
      Deleting the artifact also deletes the bug class that came with it.

- [ ] Drop Intel macOS builds, add Linux DMG/installer builds
- [ ] Add npm pack verification test (ensure all renderer modules are included)
- [ ] **Watch for a recurrence of the transient suite failure.** Seen twice while landing 1.4.0
      (once "1 error", once "4 fail" — and in that run only 497 of 500 tests *ran*, so a file
      failed to load rather than an assertion failing). Likely cause found and fixed:
      `src/port-pid.test.ts` bound a hardcoded port (18899) and its `afterEach` killed children
      then slept a fixed 150ms instead of awaiting exit, so back-to-back runs could collide with
      a lingering listener. Port is now pid-derived and teardown awaits `exited`. Never
      reproduced deliberately, so this is *probably* fixed, not provably — if it returns, capture
      the failing file name before assuming it's the same thing.

## Agentic IDE
- [ ] See [docs/AGENTIC-IDE.md](docs/AGENTIC-IDE.md) — plan for post-IDE orchestration environment
  - [x] Phase 1: File viewer/editor in widget
  - [ ] **Phase 1.5: Headless widget & app-owned UI** ← current
    - [ ] `mode="headless"` attribute — skip shadow DOM rendering
    - [ ] `window._haltija` global API (tree, click, type, eval, status, etc.)
    - [ ] Outer widget in Electron renderer (persists across navigations, self-inspection)
    - [ ] Inner widget hidden in desktop app context
    - [ ] App chrome surfaces widget state (connection, recording, events)
    - [ ] Record controls in tab bar → pipe to agent as notification
  - Phase 3: Notification buffer (human-to-agent signals via app chrome)
  - Phase 4: Plan as first-class UI
  - Phase 5: Context proxy (anti-lobotomy)
  - Phase 6: Verification loop

## Features
- [ ] Widget REC control: `<select>` dropdown in widget
  - Not recording: options are "REC", "Script", "Video", "Script + Video"
  - Recording: option changes to "End Recording"
  - On stop: use Electron `dialog.showSaveDialog()` to let user save files (video and/or test JSON)
  - Video: record as WebM, auto-convert to MP4 via ffmpeg if available
  - Non-Electron: hide video option (script recording still works)

## Bugs
- [ ] Playground color buttons have zero-size bounding rect in Electron — investigate layout

## Tech debt
- [x] Eliminate all TypeScript type errors and gate the build on type-checking. Was ~147 (surfaced when `tsc --emitDeclarationOnly` was added; `bun build` never type-checked). Now **0**, and `bun run build` fails on any type error. Root-cause fixes included `EndpointDef.input: Base<TInput>` (repaired all previously-`never` `*Input` exports) and several real latent bugs found en route: duplicate `getKeyCode` dropping punctuation; recorder/test-generator value/text assertions using `expected` instead of `value`/`text`; recorded `key` steps ignoring `selector`; `select`/`cut`/`copy`/`paste` steps silently passing (no runner case); `/send/selection` calling `formatSelectionMessage` with wrong fields/arg-order; `console-empty` assertion unimplemented; `recording` category omitted from event-count stats.

## Testing
- [x] Test helper for `.test.ts` files — `import { hj } from 'haltija/test'` (src/test.ts)
- [ ] Convert `screenshot-verify.sh` to a `.test.ts` using the test helper
- [ ] Desktop integration tests need a running app — `apps/desktop/integration.test.ts` fails with ConnectionRefused when the app isn't up. Skip gracefully or document the requirement clearly.

## Roadmap (migrated from former issue tracker)

Already shipped and dropped during migration: `hj` CLI wrapper, graceful port handling
(`HALTIJA_PORT` + auto-fallback), and optional API token auth (`HALTIJA_TOKEN`).

### Phase 1 — Documentation & Discovery
- [ ] Re-check the README comparison tables ("Haltija vs. Playwright", "Haltija vs. Claude in Chrome") each release — competitors move, so claims silently drift out of date. Keep them strictly fair: credit rivals' real strengths, mark only objective capability gaps, don't editorialize either way.
- [ ] Landing page hero — README buries the lede. Lead with one-liner setup (`bunx haltija` + one script tag), a 30-second video of AI controlling a real app, and a clear "Get Started in 2 Minutes" path.
- [ ] Consolidate documentation — docs scattered across CLAUDE.md, /docs, /api, embedded markdown, README. One organized `docs/` hierarchy: Quick Start → Guides → API Reference → Architecture.
- [ ] Use case galleries / recipes page — common workflows: testing a login flow, exploring a codebase, recording/replaying bug reports, generating tests from manual exploration.

### Phase 2 — Developer Experience
- [ ] Browser extension (Chrome/Firefox) — persistent injection that survives navigation and works on CSP-restricted sites; toggle per-site. Replaces the manual-per-page bookmarklet.
- [ ] Better error messages with suggestions — e.g. `Element not found: #submit` → suggest nearby matches like `#submit-btn`, `button.submit`.
- [ ] TypeScript SDK — type-safe wrapper over the REST API (`import { Haltija } from 'haltija'; await h.click('#submit')`), published to npm.
- [ ] Flight Recorder UI — visual playback in the desktop app: timeline of Action → DOM Diff (visualized) → Result. Builds trust in AI decisions.

### Phase 4 — Enterprise Readiness (dogfood in real CI first; these are hypotheses)
- [ ] Audit logging — record executed commands with timestamps, optional file persistence, queryable history.

### Phase 5 — Cloud & CI Integration
- [ ] GitHub Action for CI/CD — `uses: haltija/action@v1`, plus a GitLab CI template, pre-configured for Next.js / Vite / CRA.
- [ ] Docker image — `docker run -p 4000:4000 haltija/haltija`; headless for CI, Xvfb for headed mode in containers.

### Phase 7 — Hosted Service
- [ ] Agent-as-a-Service — zero-config AI automation with near-zero marginal cost (route messages, don't run browsers): Firebase stack, relay service, magic token, customer subdomains.

### Other features
- [ ] Multi-match reporting — when a selector matches multiple elements, act on the first but report "N others matched"; enables `--nth N` and `--all` flags.
- [ ] Pre-built binaries on GitHub Releases — automated release workflow on git tag publishing macOS (arm64, x64), Linux, and Windows builds.
