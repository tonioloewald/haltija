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
      connected…"}` and `hj` exits **1**. The loud signal exists for that case.
- [ ] **`hj --json` prints NOTHING on that error** (empty stdout, exit 1). A machine-readable
      consumer — i.e. every agent — gets nothing to parse, and must infer failure from an exit
      code it may not be checking. `--json` must always emit a structured error object.
- [ ] **The mid-probe case is untested and is the one that actually bit.** Losing the browser
      *during* an in-flight request is a different path from having none at the start. Needs a
      test that drops the WebSocket mid-`/eval` and asserts the response is an unambiguous,
      machine-readable "I lost the browser" — never a timeout that reads like a slow page, and
      never a partial result.
- [ ] **Liveness in the response envelope.** Every result should be able to say *which* window it
      was measured against and that the window was still alive when the value was taken —
      otherwise a scrub/sample table can silently contain readings from a tab that died halfway.

## Build / Distribution
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
