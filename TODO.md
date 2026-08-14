# TODO

## 1.12.2 — RELEASED (2026-08-11)

Tagged `v1.12.2`. Lanes green at the tag: 825 unit, 123 e2e, QA fixtures (playground 26, homepage
15), `hj doctor` exit 0, docs-drift clean. **Publish: `npm publish`** — that is the whole command;
a plain publish sets `latest` itself.

- **#30** the suite runner gained `drag` (the routine moved to `src/drag.ts` so `/drag` and the
  runner share it), a `wait` with nothing to wait for is now an ERROR instead of a silently passing
  guard, and `TEST_STEP_ACTIONS` is published + enforced by a both-directions test against the
  runner's switch. Writing that guard found `screenshot` documented in SKILL.md as a step action
  that never existed.
- **#31** `--private` now gives each instance its own Electron profile. Sharing one made the second
  instance ~10x slower and produced a **false version regression** in side-by-side A/B — the one
  workflow private mode exists for. Also stopped private runs writing the shared
  `~/.haltija/last-quit`, and added a startup sweep for stale private scratch.

**Still open, deliberately: [#26](https://github.com/tonioloewald/haltija/issues/26).** The
reporter's control run disproved the "1.12.0 regression" framing — the known-bad version survived
the original failing surface. A permanently-undrivable tab was really observed, so it stays open,
but neither of us can reproduce it on any version and 1.12.2 claims no fix.

**The pattern across the whole 1.12.x line, worth carrying into 1.13:** every one of these was ONE
idea with TWO implementations and only one of them updated — `/type`'s `ref`, `/map`'s parameters,
`:text()` vs `/find`, the CLI's `hj wait` vs the runner's `wait`, the runner's action list, and the
drag routine. The fix that sticks is a test that derives one registry from the other; the fix that
doesn't is patching the instance you were shown.

## Naming: measured, not argued (`tools/naming-probe.mjs`)

An instrument that asks fresh agents what our vocabulary *means to them*, in the spirit of the
tjs-lang intuitiveness harnesses. **Not a CI gate** — real model calls, non-deterministic, and a
flaky naming test would be switched off within a week. Run it when changing the vocabulary; read the
distribution, not the score.

**First run (n=3) overturned three of my four hand-waved claims**, which is the whole argument for
measuring instead of asserting:

| claim | verdict |
| --- | --- |
| `check` is dangerously confusable with `assert` | **PARTLY RIGHT — the first verdict was contaminated.** In context, fine: 3/3 pick `assert` for an assertion, 3/3 pick `check` for a checkbox. Cold, from a NEUTRAL cwd: **3/3 read it as "asserts a condition is true"**. The original 2/3-correct cold read came from our own CLAUDE.md being in the agent's context. |
| `verify` vs `assert` is arbitrary | **MOSTLY WRONG, weaker than first measured.** 2/3 picked `verify` (was 3/3 contaminated); 1 said `wait`. |
| `tabs-focus` misleads (sounds like a browser action) | **WRONG.** 3/3 picked it correctly. |
| `select` is mis-assigned | **CONFIRMED, unanimously.** 3/3 reached for `select` to choose a dropdown option; 3/3 cold-read it as "choose an `<option>`". **Nobody** read it as text selection. |

So the rename list collapses from four to one.

- [ ] **`select` → `select-text`, with `select` as a deprecated alias.** Then, once the alias can be
  dropped, `select` is free to mean the thing every reader already thinks it means: pick an option
  from a `<select>`. That is also a real capability gap — haltija has no way to choose a dropdown
  option today, which is why the probe's honest expected answer was "none".
  Sequencing matters: the alias and the new meaning must not overlap, or one word means two things
  at once and we are back to a silent wrong action.
- [ ] **`map` is not the word agents reach for — and `map` is where every doc tells them to start.**
  Measured twice, two framings, and it lost both times: "list everything you can interact with and
  what each control is wired to" got **3/3 `form`** (the word "control" pulls toward form fields);
  neutrally reworded to "orient yourself on an unfamiliar page — which command first?" it got
  **`tree`**. `map` never won. The affordance map is the single most valuable thing haltija offers
  an agent, and its name is losing to two neighbours. Options: rename it something that says what it
  is, or accept that `tree` is the natural entry point and make `tree` the thing that leads to it.
  Worth more samples before acting — n=3 and n=1.
- [x] Probe the **CLI command** vocabulary — done. `find`, `where`, `doctor`, `snapshot` all scored
  3/3; `snapshot` vs `screenshot` and `call` vs `eval` were both read correctly cold. Those names
  are fine and need no defending prose.


## 1.12.4 — TAGGED, awaiting publish

`v1.12.4` is tagged with all lanes green. **Publish is one command: `npm publish`** (a plain publish
sets `latest` itself). It supersedes `v1.12.3`, which was tagged but never published — installing
1.12.4 delivers both, and npm simply skipping a version is normal.

**#1 and #2 do NOT need this release.** Their fix — declared-origin routing — shipped in **1.11.1**
and has been on npm for weeks. They are waiting on the reporter's judgement about whether routing by
declaration rather than inference counts as fixed. No release changes that.

## Follow-ups from the 1.12.3 nine-lens review (60 findings, 6 blockers fixed)

Blockers are fixed and verified. These are the routed remainder — filed so nothing evaporates.
Marked `(unverified)` where the review reported but did not independently confirm.

### Coverage — unrun lanes, not red ones

- [ ] **The step runner has ZERO executable coverage.** No unit or Playwright lane calls `/test/run`
  or `/test/validate`; the two blocking CI fixtures exercise 5 of 17 actions. The alias-rewrite
  branch and the `select-text` dispatch never execute anywhere, and the failure mode is a *silent
  success*. `tests/test-page-actions.json` already covers drag/click/type/eval/assert against the
  exact server `test-qa.yml` runs — **and is referenced by no workflow.** Wire it in as blocking,
  and add steps for `select-text`, legacy `select`, `check`, `key`, `wait`, `verify`, clipboard.
- [ ] **`tests/haltija.test.ts` skip-guards to green.** `skipUnlessServer()` returns early and bun
  records PASSED, so a clean checkout prints "no server" and exits 0 with "11 pass". No workflow
  runs it. Use `describe.skipIf` so skips report as skips, then either run it behind
  `haltija --private --headless` or delete the script.

### Stale copies the release did not fold in

- [ ] `src/api-schema.ts:2000` holds a FOURTH step list (8 of 17), propagating to `API.md`,
  `apps/mcp/src/endpoints.json` and `embedded-assets.ts`. Interpolate `stepActionsInline()`.
- [ ] `CLAUDE.md` test-JSON example uses the flat `{"action":"assert","type":"exists"}` shape the
  runner REJECTS (it reads `step.assertion`). Fix it, and extend `staticStepIssue` to require
  `assertion.type` — the same statically-knowable class as the `wait` check it already does.
- [ ] `CLAUDE.md` prose still says "`select`/`cut`/`copy`/`paste` are generated by the recorder",
  eight lines below the generated table saying `select-text`.
- [ ] `docs/CI-INTEGRATION.md` has an orphaned `### Step Types` heading and a bare table header row
  **outside** the generated markers, so no rebuild cleans it up.

### Forward compatibility

- [ ] **The recorder now emits `select-text`, which every released haltija rejects.** A suite
  recorded on an updated box and committed to CI pinned to `haltija@1.12.2` goes red. Document the
  minimum server version. (Bites pinned consumers only; the paved CI path uses `@latest`.)

### Tooling and types

- [ ] `TestActionDoc.example` is mandatory and read by NOTHING, while CI-INTEGRATION lost its
  Example column. Render it or delete the field — do not keep a mandatory field with no consumer.
- [ ] `stepActionsInline` is exported and never called; `coreOnly` is never passed; the
  `filter(a => TEST_ACTIONS[a].core)` expression appears four times. Factor it, drop the
  `as TestActionDoc` casts (the `satisfies` clause makes them unnecessary and they mask real errors).
- [ ] `isTestStepAction('select')` returns true while narrowing to `TestStepAction`, so
  `TEST_ACTIONS[a]` can be `undefined` with no type error. Split canonical vs known. *(latent)*
- [ ] `writeGeneratedBlocks` **fails open** — a missing marker is skipped silently, so CLAUDE.md's
  or CI-INTEGRATION's block could freeze with a green docs-drift. Make a named target with no
  marker a build failure. Also: `stepActionsCompact`'s regex would leak `duration (ms, default 100)`
  into the prompt. *(unverified)*
- [ ] `prompt-budget.test.ts` iterates a hardcoded six-name literal instead of deriving the non-core
  set, so it would not notice a new non-core action; and the headroom assertion should fail with
  "lower SKILL_BUDGET_BYTES to N" rather than a bare number. *(unverified)*
- [ ] `tools/naming-probe.mjs` runs probes strictly sequentially; flatten to a bounded pool. The
  `proc.stdin?.end()` is dead — `stdio: ['ignore', …]` makes it null. *(unverified)*
- [ ] **CLAUDE.md Build Artifacts needs item 15:** the build now rewrites `<!-- GENERATED:… -->`
  regions INSIDE three hand-written docs. Every existing rule enumerates whole files, so those
  files' reputation says "hand-written" and an edit gets silently reverted.

### MCP packaging (surfaced by refuting a different finding)

- [ ] `apps/mcp/build/endpoints.json` is **7 months stale** — the committed MCP server has been
  serving tool definitions missing `/map`, `/find`, `/form`, `/wait`, `/network*`, `/video/*`.
  Nothing in the build runs `tsc` inside `apps/mcp`. A docs-drift-style check would catch it.
- [ ] **`apps/mcp` is not in `package.json` `files`** — so npm users have no `apps/mcp/` at all,
  yet `bin/mcp-setup.mjs` points there. The stale `tosijs-dev` package name in those paths is fixed;
  the packaging question is NOT, because it is a real decision with two defensible answers: ship
  `apps/mcp/build/` (a few KB, and `--setup-mcp` starts working for npm users) or make the setup
  detect the missing file and say so instead of writing a config that points at nothing. Wants a
  release to validate either way, so it is deliberately left for when releases resume.
- [ ] No ceiling on `src/api-schema.ts` description prose while SKILL.md has one — "trim the prompt"
  has a documented outflow and no meter on the inflow.

### Issue hygiene

- [ ] **No GitHub Release was cut for v1.12.0 / v1.12.1 / v1.12.2** — `gh release list` stops at
  v1.11.0, so those CHANGELOG entries exist only in-repo. That is why reporters got no notification.
  Use `Fixes #N` in commits; a bare `(#30)` does not auto-close.
- [ ] **Dispose of #1 and #2** — both narrowed to one ask (a reliable origin→project map) which
  shipped as declared-origin routing in 1.11.1. Their last human comment predates the fix. Say
  whether declaration-rather-than-inference counts, and update `UPSTREAM.md`'s stale "Still open".
- [ ] **Disposition #12** (~90% delivered across 1.8.0/1.9.0/1.12.x) — close it and move the native
  fast path to #16, or retitle to the residue.
- [ ] File a haltija issue for **option selection** (`select-option`, or a step form of `/select`),
  citing the 3/3 probe distribution as demand evidence and the sequencing constraint. Until it
  ships, add POSITIVE guidance to the `select-text` row — "to choose an `<option>`, set `value` via
  `eval` and dispatch `change`" — so a negation is not the whole answer.
- [ ] **`select` has a THIRD meaning already**: `POST /select` is interactive element picking and
  `hj select-start/result/cancel/clear` exist. The shadow invariant only guards the STEP namespace.
  Record this beside the "free `select`" plan before acting on it.

### To `tosijs-coding-practices` (7 entries)

- [ ] Naming measured on readers (**and the isolation IS the instrument** — a neutral cwd, or you
  measure a reader already told the answer); prompt budget + core flag; an instrument must derive
  its own vocabulary; **a drift gate proves the artifact matches the generator, never that the
  generator is right**; extend "never hand-edit generated files" from files to REGIONS; grep the old
  spelling and re-read the paragraphs beside new markers; a deferral pointer is load-bearing —
  prefer a runnable command over a relative path, since the prompt ships where the reference does not.

## "The test passed but the app was wonky" — a third verdict worth having

**The gap this names.** A human tester reports things no assertion covers: *it worked, but the
button flashed twice; there was a red error in the console; something stayed selected; focus went
nowhere.* Automated suites throw all of that away, because the only channels are PASS and FAIL and
none of it is a failure. The result is a green suite over an app that is visibly off — and the tester
who would have mentioned it has been replaced by something that cannot.

Haltija is unusually well placed here: it already watches console, network, mutations and semantic
events, and it drives the app itself, so it knows exactly *when* each thing happened relative to
each step. Nothing else in the stack has that alignment.

**Three channels, and keeping them distinct is the whole design:**

| channel | means | fails the run? |
| --- | --- | --- |
| `error` | the assertion did not hold | **yes** |
| `warning` | *haltija* has something to say about how you drove it (deprecated action, a drag that cannot work) | no |
| **`observations`** *(new)* | the *app* did something a human would have mentioned | **no** |

Folding observations into `warning` would be wrong: one is about the tool, the other about the
product under test, and a consumer wants to act on them very differently. Failing on them would be
worse — the moment a hygiene finding can break a build, it gets suppressed and the channel dies.

**Candidates, cheapest first.** Each is an after-step probe, and each is something a tester says out
loud:

- [ ] **Stray text selection.** `getSelection().toString()` non-empty after a step that should not
  select. *Measured: haltija's own synthetic click and drag leave NO selection* — synthetic events
  don't drive native text selection, the same reason `drag` can't move an `<input type=range>` — so
  anything found here is the app's own doing and worth reporting rather than tool noise.
- [ ] **Console errors / unhandled rejections during the step.** We already capture console; nothing
  correlates it to the step that caused it. The highest-value one: a suite passes while the app is
  throwing.
- [ ] **A 4xx/5xx response during a passing step.** Same shape — captured, uncorrelated.
- [ ] **Focus black hole.** `document.activeElement` is `<body>` after interacting with a focusable
  control. Keyboard users hit this constantly and no assertion notices.
- [ ] **An `aria-live` region announced during a passing step.** Often an error toast. The test
  asserts the happy path held while the app told a screen-reader user it failed.
- [ ] **The element moved between mousedown and mouseup** — the click landed somewhere else, and
  passed because the assertion was about the outcome, not the route.
- [ ] **A step much slower than its peers**, so "it worked but felt awful" has a number.

**Reporting.** Never in the exit code. Print them under the run summary and put them in the JSON, so
CI can *display* wonkiness without gating on it — and a lane that wants to gate can opt in with a
flag, the same way `--strict` promotes advisory warnings today.

**Prior art to check before building:** Playwright has no equivalent (it has traces, which record
everything and interpret nothing); Lighthouse scores a page, not a *flow*. If that survives a proper
look, this is a genuinely new thing rather than a reimplementation — worth saying carefully rather
than claiming.

## Next release — the queue, in the order I would do it

**Blocked on a release being possible** (each changes startup or packaging and wants exercising):

- [ ] **#32(a) — open BOTH transports by default.** The asymmetry is the bug: a shared server's
  capabilities should not depend on which directory started it. Means shipping certs or generating
  them on first run; changes startup for every existing install. (b) is done; (c) — explain a failed
  connection in the page console — is now cheap because `/status` exposes transports.
- [ ] **`apps/mcp` packaging.** Not in `files`, so npm users have no `apps/mcp/` for `--setup-mcp`
  to find. Two defensible answers: ship `apps/mcp/build/`, or detect the absence and say so rather
  than writing a config that points at nothing.

**Open majors carried forward:**

- [ ] **#26** — a tab becoming permanently undrivable. Not reproducible on ANY version, including
  the one it was filed against; the reporter's own control disproved the regression framing. Stays
  open as a record. If it recurs: `hj doctor` now reports rAF, and re-injection can revive a killed
  widget, so those two facts will split the cause.
- [ ] **#1 / #2** — awaiting the reporter's judgement on whether declared-origin routing (declaration,
  not inference) closes them. Commented and retitled; do not close unilaterally.
- [ ] **#16** — native tosiAgent bridge, HOLD pending tosijs.
- [ ] **Option selection** (`select-option`, or a step form of `/select`). 3/3 agents reach for
  `select` for this; haltija cannot do it at all. Sequencing: the `select` alias must be DELETED
  before the word is reused — `no alias may shadow a live action` enforces it. Note `select` already
  has a third meaning (`POST /select` is interactive element picking).
- [ ] **1.13: adopt tosijs-floorplan** as the schematic renderer, delete ours, become a producer.
- [ ] **`map` may be the wrong name** — it lost to `form` and `tree` in two framings. n=3 and n=1 on
  the flagship command; gather more samples before renaming anything.

### Next up (1.13)

- Adopt **tosijs-floorplan** as the schematic renderer (see `UPSTREAM.md`), which subsumes #20.2/#20.5.
- The head-to-head schematic corpus — judgement-heavy and non-deterministic, so an exercise to run
  when schematic rendering changes, not a CI gate.


- [ ] **Replace the 7 `s.any` uses once tosijs-schema#3 lands** (or sooner, with concrete types).
  Our published schemas carry invalid JSON Schema fragments today. Deferred past 1.12.0 because
  changing validation on `test`/`tests` — the JSON test runner's payload — right before a release
  is the kind of late change that bites. See `UPSTREAM.md`.

## Schematic: more instantaneous accessibility wins

Exposing contrast in the schematic turned an invisible audit into something you SEE, and it paid
off immediately — a reporter found three genuine WCAG failures on their own login page without
looking for them. The same trick should extend:

- [ ] **Surface `role`, and shortcomings in role.** The map already reads `role`; the schematic
  does not show it. Draw it, and flag what's wrong or missing: an interactive element with no
  accessible name, a `role` that contradicts the tag, a `role=checkbox` with no `aria-checked`, a
  landmark used twice with no label to tell them apart, a `<button>` whose only content is an icon.
  Each is invisible in a screenshot, obvious in a diagram that draws it, and — like contrast — a
  real defect rather than a style opinion.

  **Sharpened framing (from the tosijs-floorplan#3 discussion):** separate *intrinsic* interactivity
  (`<button>`, `<a href>`, `<input>`, `role=button|link|…` — true by specification) from *observed
  wiring* (a handler). The disagreements are the findings:
  - **intrinsic, not wired** → a control that may be dead, or wired by something outside the
    framework. haltija cannot see handlers at all, so this is upstream's case more than ours.
  - **wired, not intrinsic** → the classic clickable `<div>`: keyboard users cannot reach it and a
    screen reader announces nothing. **We CAN detect this today** — `[onclick]` is already in our
    INTERACTIVE selector, so a node matching on `onclick` alone, with no `role` and no `tabindex`,
    is exactly this defect. Cheapest real a11y win left after contrast and target size.
- [ ] **Localization checking.** A schematic drawn at true geometry already shows where text will
  not fit; the map knows the text and the box. Candidates: text that overflows or is clipped by its
  container, a `lang` attribute that disagrees with the content, hard-coded strings in a page that
  otherwise uses a translation mechanism, untranslated fallbacks sitting next to translated
  siblings, and layout that breaks under a longer translation (German/Finnish are the usual
  canaries). Pseudo-localization — re-render the map with every string expanded ~40% — would show the
  breakage before a translator ever sees it.

## Schematic: delegate rendering to tosijs-floorplan (1.13)

- [ ] **Stop maintaining our own renderer.** See `UPSTREAM.md` and
  https://github.com/tonioloewald/tosijs-floorplan/issues/1.

  **All four contract gaps were adopted in tosijs-floorplan 0.3.0 (renamed from tosijs-floorplan)** — `ref` (takes the index slot,
  so a vision consumer reads a handle it can actually `hj click`), `flags` (severity bars on the
  left edge; our contrast verdict maps in one line), `image` (data-URL only, so the renderer stays
  pure), and caption wrapping. Re-validated against a real map: **145 records, 133 refs, 20
  embedded images, rendered correctly**, with our own `@refs` on the image.

  Their `structural` treatment — a recessive dashed outline — is better than ours, which was
  binary draw-or-omit and lost the grouping.

  **Two facts still have no home** and are filed on that issue: `href` (37 of 145 records — the
  left sidebar renders as empty boxes because a nav link's distinguishing content IS its
  destination) and `value` (10 records — what separates a filled form from an empty one; tosijs
  carries it as a bound prop, a plain-DOM producer has no binding to ride on).

  **Sequencing: 1.13, deliberately.** 1.12.0 is in RC with an agent testing it; swapping the
  rendering engine mid-RC to fix two cosmetic issues would invalidate that testing. When it lands,
  our renderer is deleted and haltija becomes a producer only — DOM extraction is the competence
  worth keeping.

## Schematic: a repeatable head-to-head corpus

- [ ] **Make the screenshot-vs-schematic comparison a repeatable, extensible lane.** The 1.12.0
  layout work was driven by hand-driving the desktop app across four real pages, and it found more
  in twenty minutes than a synthetic fixture did in an hour — because real pages break assumptions
  a fixture is written to satisfy. Every finding below came from that pass and NONE from the
  fixture: content invisible (`<p>`/`<li>` are neither interactive nor structural), the carousel's
  images absent, canvas pixels drawn in the stacked pre-amble on top of the sidebar, web-component
  captions in element children discarded, radios overprinting their handles by one pixel of default
  margin.
  **Not a CI gate — a review instrument.** Judging a schematic is judgement-heavy,
  non-deterministic (live third-party pages, animation, fonts) and expensive; wiring it into the
  test suite would buy flaky failures and slow pushes. It is the thing you RUN, and look at,
  when changing schematic rendering.
  What it should be: a named corpus of pages chosen for what each one stresses, a command that
  captures `screenshot` + `map --image` for every entry into a dated directory, and a
  side-by-side contact sheet a human (or an agent with vision) reads.
  Starting corpus, with what each is for:
  - `https://ui.tosijs.net/form/` — web-component form fields; captions in shadow/slot children,
    placeholder vs value, required markers, three-column grid
  - `https://ui.tosijs.net/carousel/` — images as the actual subject, dot/arrow controls, prose +
    list content around a live component
  - `https://3d.tosijs.net/b3d-terrain/` — canvas-is-the-content, shadow-root canvas, needs a few
    seconds to settle before capture (bake a readiness wait into the harness, not a fixed sleep)
  - `https://webawesome.com/docs/components/dropdown/` — a third-party design system, so nothing is
    tuned to our assumptions
  - a deliberately long page — to exercise viewport-default vs `fullPage`
  Run it against the desktop app in `--private` mode so it can never touch a shared server,
  and resolve the port from the ready line with `"role":"public"` — app mode starts two.

## Deferred from the 1.12.0 review (tracked, not dropped)

- [ ] **Confirm a `browser` screen-share grant is actually THIS tab.** *Half done in 1.12.0.*
  `/screenshot` now reports `displaySurface` (`browser` / `window` / `monitor` / `null` for
  "this browser doesn't say") and warns on a window or monitor share, where the pixels are provably
  not this tab and may include other applications. **What remains is the same-tab case:**
  `preferCurrentTab` only defaults the picker, so a user who switches to another *tab* still gets a
  `browser` surface and no warning. Confirming it needs `setCaptureHandleConfig()` +
  `getCaptureHandle()`, and `setCaptureHandleConfig()` mutates **document-level state on the host
  page** — an injected widget quietly changing its host's capture configuration (and clobbering it
  if the page already uses it) is the same "don't harm a healthy peer" violation as killing another
  project's server. Needs a way to do it without side effects on the host, or an explicit opt-in.
  Deliberately NOT filed upstream — the picker is a consent surface and constraining it would be a
  privacy regression. See `UPSTREAM.md`.
- [ ] **`MAX_PIXELS` is 8e6** (`src/schematic-size.ts`). Vision encoders downsample to roughly a
  1568px long edge, so an 8 Mpx canvas is ~32 MB RGBA in the tab and ~70% of the pixels are
  discarded on arrival. **Deliberately not changed, because the two consumers want opposite
  things:** the encoder caps the long edge at 1568 regardless, so anything above that is waste —
  but the same file is also meant to be looked at by a human and diffed between runs, and a tall
  page capped at a 1568 long edge is 79px wide and useless to a person. Lowering it trades a real
  human-facing property for bytes, and I have no measurement of which users actually care.
  Needs data, not a guess. *(The second half of this item — an explicit WebSocket
  `maxPayloadLength`, so an oversized frame is a diagnosable error rather than a silent close that
  reads as a widget disconnect — is **done**: `src/server.ts`, 64 MB, chosen so hitting it means
  something is wrong rather than merely large.)*
- [ ] **`buildDomAffordances` walks the subtree of a hidden wrapper.** *Measured, deliberately not
  optimized.* The premise is correct — `visibilityOf` is consulted only for interactive/structural
  elements, so a plain `<div style="display:none">` wrapper is descended into. But **this is perf,
  not correctness**: interactive descendants inside it hit `visibilityOf` themselves, return
  `hidden`, and are pruned, which four e2e cases already pin.
  **The cost, measured through `/map` on a live server: a 12,000-node hidden subtree adds 7 ms
  (19 ms vs 12 ms), identical to a visible subtree of the same size.** That is ~0.6 µs/node, so a
  realistic hidden modal costs well under a millisecond. The obvious fix — `getComputedStyle` on
  every element before recursing — would make the common case (few hidden nodes) *slower*, since
  that call is exactly what the current gating avoids. Worth revisiting only with a page where it
  actually shows up. If it is ever done: prune on `display:none` / `visibility:hidden` but NOT on
  the zero-rect half — a wrapper can legitimately have a zero box with visible absolutely-positioned
  children, a mistake already made and fixed once in this cycle.
- [x] **`hj <cmd> --help` was content-free for 35 of 69 commands.** Done in 1.12.0. The build now
  emits `COMMAND_SUMMARIES` from every endpoint's schema `summary` (NOT filtered by
  `visibility: 'internal'` — that flag means "not public API", not "the CLI may decline to say what
  its own command does", which is why the three `send-*` commands were blank). Local commands get
  descriptions from `LOCAL_COMMAND_HELP` in `src/cli-commands.ts`, beside the command list, so an
  undescribed one shows up in the same diff. The guard in `src/adopter-context.test.ts` now asserts
  a body beyond the header — it previously passed on header-only output, which is exactly what all
  35 printed. Mutation-verified: reverting the generator flags 34 commands.
- [x] **`src/distribution-parity.test.ts` timeout.** Done in 1.12.0 — but the premise was wrong and
  that's the useful part. "~140 sequential cold starts, a slow blocking gate" measured at **4.0s**
  for the whole file. A worker pool would have added real concurrency risk (shared registry dir,
  shared port) to save nothing. Instead the two artifacts now run concurrently *within* each
  comparison (2.2s), and the 180s timeout — 45x the real cost, so it caught no hang and merely made
  one expensive to notice — is 30s.


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

## Port discovery: callers must not probe a fixed port (from tosijs-3d)

tosijs-3d's `ensureHaltijaChannel` probed a fixed HTTPS port (8701) while a stale HTTP-only
squatter held 8700; `--both` relocated/failed and the fixed-port probe couldn't tell why
(spawn stderr was ignored). Two sides:

- **haltija side — done (`main`).** Both the HTTP ephemeral-fallback and the HTTPS bind failure
  are now LEGIBLE: HTTP logs "8700 was taken; bound <ephemeral> instead — find it with `hj where`",
  HTTPS retries then fails loudly instead of silently relocating, and the banner no longer names a
  port it didn't bind. So a human/agent reading stderr can now see what happened.
- **Cross-project (tosijs-3d, file-don't-fix — NOT ours to edit).** Their `ensureHaltijaChannel`
  should (a) discover the port via `hj where` / the registry rather than probing a fixed port —
  haltija may legitimately be on an ephemeral port — and/or (b) surface the spawn's stderr instead
  of swallowing it. Relay to the tosijs-3d agent (who offered to write it up); do not touch their repo.
- **haltija DX follow-up:** document prominently (README / DOCS) that the way to find a running
  server's port is `hj where` or the registry, never "assume 8700/8701" — a fixed-port probe is the
  anti-pattern this whole episode is made of.

## Desktop-app reuse: follow-ups (core fix done on main)

- [ ] **Surface the "attached to an existing server" notice in the app UI**, not just the console.
      `main.js` sends a best-effort `server-reused` IPC message on load; the renderer doesn't
      display it yet. Add a small banner/status line so a user driving a REUSED (possibly
      foreign-version) server can see that's what's happening.
- [ ] **Make the desktop integration test deterministic under the new `auto` default.** With
      `serverMode: 'auto'`, `apps/desktop/integration.test.ts` will REUSE a server if one is on
      8700 (testing against a stranger) or start embedded if not. Give it a dedicated high port
      pair (`HALTIJA_PORT`/`HALTIJA_INTERNAL_PORT`) + `HALTIJA_SERVER_MODE=builtin` so it tests
      the app's OWN server on ports nothing else contends — the same hermeticity the unit suite
      got. (On-demand Electron test; not in the CI unit lane.)
- [ ] **The internal chrome server (8701) in the start-embedded path.** When `auto` finds no
      public server and starts embedded, it still spawns an internal server on 8701; if 8701 is
      held by an unrelated channel's HTTPS, that spawn should fall back to another port, never
      kill the occupant. (Bounded: only on the rare no-public-server-but-8701-occupied path, and
      the internal server is best-effort. Verify against a real Electron launch.)

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
- [x] **Default test-mode safety posture, not per-file opt-in** — done (`eb89ed3`).
      `src/test-support.ts` `isolateTestMachineState()` replaces the copy-pasted preamble in the
      spawning test files and also redirects `HALTIJA_MACHINE_LOG` to temp. *(Could still move to a
      `bunfig.toml` preload so a new test can't forget to call it, but the shared helper closes the
      copy-paste-drift gap.)*
- [x] **`freePort` is not gated by the test opt-outs** — done (`eb89ed3`). It now no-ops under
      `HALTIJA_NO_RETIRE` (a reach-out-and-stop-another-server action, which is what NO_RETIRE
      governs), so the suite can no longer `POST /shutdown` a stranger's server on a shared machine.
      *(Follow-up: extend `unit-tests.yml`'s footprint assertion to fail if the REAL
      `~/.haltija/machine-actions.log` was created/appended during a run — belt and braces on top of
      the temp redirect.)*
- [ ] **Test port strategy — a reserved test pair, not arbitrary ephemeral hermeticity** *(Tonio's
      scoping; low priority)*. The current fix hands each test a high, pid-derived unique port
      (`uniqueTestPort()`) so a shared machine doesn't collide, and `freePort` gating makes any
      residual collision *harmless* (fails to bind rather than touching another process). That is
      enough. **Full ephemeral-port + discovery hermeticity is explicitly NOT the goal** — it's the
      over-engineered direction. The real design target is **one port pair for actual use (8700/8701)
      and one for testing** — nothing more. Supporting arbitrary numbers of agents building
      *different versions simultaneously* is a non-goal (same "working set, not infinite instances"
      instinct as the multi-tenancy section above — don't spin up a bazillion of anything). If this
      is ever revisited, the move is to *simplify* toward a documented reserved test pair, not to add
      more concurrency machinery. Leave the current harmless approach until there's a concrete reason
      to touch it.
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

## Follow-ups

### From the 1.5.0 pre-release review

**Done in 1.5.1:**

- ✅ **[correctness] Forward `warning` on the drop paths.** Now attached on the *timeout* path
  (shared `attachWarning` in `requestFromBrowser`) — a hidden tab whose rAF-driven eval never
  resolves now explains *why* it timed out — and preserved by the reshaping handlers
  `find`/`formData` via a `withWarning` helper. (`screenshot` already spread it; `call` deliberately
  left alone — its contract is to return the raw value, so a `warning` field would corrupt it.)
- ✅ **[coverage] Regression-test the `hj --window <id>` fix.** Extracted `extractWindowTarget` into
  `bin/arg-utils.mjs` (pure); `src/hj-args.test.ts` covers leading/trailing/middle/absent/no-value
  and non-mutation.
- ✅ **[docs] SKILL.md + plugin.json** — done in the 1.5.0 cut.
- ✅ **[nit] Private-startup failure path leaks tmp port-files** — `rmSync` added to the `!pubPort`
  early-return in `startEmbeddedServer`.

**Deferred (not "little risk / easy" — kept tracked):**

- ✅ **[DX] Throttle the hidden-tab / focus-ambiguity warnings** — done in 1.5.2. Pure
  `shouldEmitWarning` (`src/warning-dedupe.ts`, 6 tests) dedups an *identical* warning within a 15s
  cooldown, keyed on the full warning text (so a changed condition always re-warns) and re-arming
  after the cooldown rather than suppressing forever. Deliberately a short cooldown, not
  "once forever": the server can't tell its clients apart, so a permanent global suppress would hide
  the warning from a *second* agent that never saw it — the exact failure these warnings prevent.
  `HALTIJA_NO_TAB_WARN=1` disables them entirely.
- ✅ **[coverage] desktop server-env** — extracted to src/desktop-server-env.ts, 9 tests, main.js calls
  it; verified with real Electron since it refactors the live launch path.
- ~~**[coverage] Unit-test the desktop server-env / port logic** — extract
  `buildServerEnv({port,isPrivate,portFile})` from `apps/desktop/main.js` and test it. *Deferred:*
  the extraction refactors the live desktop launch path; more than a low-risk change.
- **[coverage] Server-level warning-wiring test** (two origins → untargeted warns, `?window=`
  doesn't, `/status` reports `hidden`). *Deferred:* needs a two-widget harness; verified live for
  now (eval + form both carry the warning).
- ✅ **[ecosystem] `hj tabs focus` timed out (issue #4)** — fixed in 1.5.2. Now a server-side
  routing change (`ctx.focusWindow`): validates the tab, sets `focusedWindowId`, returns instantly,
  never dispatches to the (possibly hidden) tab. Verified live (37ms, was a 5s timeout).
  - **Remaining follow-up [desktop, deferred]:** physically *raise* the focused tab in the desktop
    app. Needs a renderer widget-`windowId`→webview-tab bridge (the renderer doesn't track the
    widget's client-generated windowId today) plus a server→main→renderer signal. Deprioritized
    desktop surface; the server-side routing fix already makes the tab addressable everywhere.
- ✅ **[ecosystem] `tabs open` fallback / client-less tab (issue #5)** — addressed in 1.5.4. The
  `window.open` fallback response now carries a `reason`, promoted to a top-level `warning` (so `hj`
  prints it on stderr) explaining the new tab is client-less, won't appear in `hj tabs`, and can't
  be reached. Documented the injection model in the tabs-open schema + SKILL troubleshooting.
  Targeted commands (`--window <id>`) at a client-less tab already error ("Window not found") since
  the server never knew it — so suggestion 3 was already satisfied.
  - **Remaining follow-up [desktop, deferred]:** in the desktop app, surface tabs the app knows
    about but that have no *widget* connected (a `connected: false` row in `hj tabs`). Only the app
    knows its client-less webviews; the shared-server case genuinely can't see a `window.open` tab.
- ✅ **[nit] port-file timeouts** — NOT drift: 10s waits on a spawned server child, 30s on an Electron
  boot. Documented as deliberate and cross-referenced so nobody 'aligns' them.
- ~~**[nit] Share a `readPortFile(path,{timeoutMs})` util** — `readPort` (main.js) and
  `discoverPrivatePort` (tosijs-dev.mjs) are near-identical and drifted on timeout. *Deferred:* nit;
  touches timing behavior in two files.

### Adopter-context test lanes (from issue #11's structural point) — HIGH VALUE

The sharpest observation any reporter has made: **haltija is tested in a clean room, and adopters
run it on a machine that already has haltija on it.** Every field bug we've shipped — #1 (shared
routing), #7 (orphaned Electron), #8 (cross-project targeting), #11 (server up, zero windows) — is
invisible to a test that starts from nothing and ends at nothing. The gap is *context*, not depth.
Lanes to add (each maps to a shipped bug class):

- **A server already running when the lane starts** — with windows, and with **none** (that's #11
  as an executable test).
- **Two projects at once**, different cwds, each expecting its own window (#1 and #2 as a test
  rather than a report).
- **A stale-but-satisfying version in the bunx cache** — `^1.5.0` is satisfied by a cached 1.5.0
  that predates the 1.5.5 teardown fix. No range protects against this; only a lane that runs with
  such a cache catches the next one.
- **A half-dead instance** — server without windows, and the reverse.
- **Pack-and-install**: install the tarball and drive it from outside the repo.

Generalized into the shared KB (`practices/testing.md` → "Test the environment adopters have, not
the clean room"), since tosijs-ui hit the identical shape with packaging.

### Deferred from #8 (strict mode shipped; these did not)

- **Refuse cross-project targeting by DEFAULT** (not just under `--strict`). Correct end state, but
  a behavior break for every interactive user who relies on the 8700 fallback — wants a deprecation
  cycle, not a patch. Strict mode covers the automation case today.
- **Age out windows whose target no longer answers** (a 21-hour-old window pointing at a dead dev
  server lingering as a navigation candidate). Deliberately deferred: this is the same trap as the
  rejected `lastSeen` staleness idea — an idle-but-healthy tab is indistinguishable from a dead one
  without a probe, so a naive timeout would invent a *new* false signal to fix a real one. Wants an
  actual liveness probe before acting. `hj doctor` surfaces the condition in the meantime.

### From the 1.6.0 pre-release review (deferred nits)

- ✅ **[dead code] `haltija.focusTab`** — REPURPOSED, not removed: it's now the desktop tab-raise,
  triggered by the server via an AWAKE messenger tab (see raiseTabInDesktopApp). Original text:
- ~~**[dead code] Remove the now-unreachable `haltija.focusTab` / `'tabs' 'focus'` branch in
  `src/component.ts`.** tabs-focus is fully server-side since #4, so the server never dispatches
  `focus` to the widget. Either delete the handler, or (if the desktop *physical* raise follow-up
  lands) repurpose it via a non-blocking dispatch. Tie to the deferred "raise the tab in the desktop
  app" item.
- ✅ **[coverage] `runServers` enumeration** — extracted to src/server-list.ts, 12 tests, hj calls it.
- ~~**[coverage] Extract `runServers`' enumeration into a tested `src/` module** — `bin/hj.mjs` gained
  ~106 lines of untested runtime logic (`runServers`, `hj shutdown`). Move the server-list
  derivation into `src/` with unit tests; `hj.mjs` stays a thin caller. (review: practices)
- **[coverage] Unit-test the tabs-open fallback→`warning` promotion and the `/shutdown` guard
  predicates** (private→signal-parent, non-private-desktop→409). `src/api-handlers.ts`, `src/server.ts`.
- ✅ **[nit] hj de-dup** — 14 local ANSI redefinitions collapsed to one; shared /status probe via
  src/server-list.ts.
- ~~**[nit] De-dup `hj servers`/`hj where`** — share one `/status` probe + hoist the `bold`/`dim`/
  `green` ANSI helpers to a single definition in `bin/hj.mjs`.

### Pre-existing

- ✅ **[teardown] `--private --headless` orphan** — fixed with the same spawner-pid poll as #7; verified
  by SIGKILLing the launcher. Original:
- ~~**[teardown] `--private --headless` can orphan its server when the launcher is SIGKILLed.**
  Sibling of the fixed #7 (which was `--private --app`). Observed orphaned ephemeral `dist/server.js`
  (ppid=1) after killing a `--private --headless` launcher — the launcher's SIGINT/SIGTERM handlers
  close the Playwright browser but don't reliably reap the spawned server, and a SIGKILL bypasses
  them entirely. The server should self-terminate when its spawner dies (the same
  `HALTIJA_SPAWNER_PID`-poll idea as the Electron fix, applied to the server process), or the
  launcher should spawn it in its own process group and kill the group. Lower urgency than #7 (no
  single-instance lock, so it doesn't *block* the next run — it just leaks a process). `hj shutdown`
  already stops it cleanly on demand.

- ✅ **[desktop, isolation] `--private --app` single-instance lock + teardown (issue #7)** — fixed
  in 1.5.5. A private run no longer requests the single-instance lock (so an orphan can't block the
  next run and concurrent runs coexist); the private Electron self-terminates when its spawner dies
  (spawner-pid poll, since Electron reparents to launchd) or on SIGTERM/SIGINT; and `hj shutdown` /
  `POST /shutdown` on a private-desktop server tears down the whole instance. Verified with real
  Electron (`hj shutdown`, launcher-SIGKILL, two concurrent runs).
- ✅ **[desktop] `--private --app` shared-server leak** — was WORSE than cosmetic: the renderer read
  process.env, which private mode never updated, so the chrome widget connected to the SHARED 8701
  and the first tab to 8700. Fixed at the root; verified the shared servers gain nothing.
- ~~**[desktop] `--private --app` default tab points at `localhost:8700`.** `apps/desktop/index.html`
  hardcodes the address bar default to `http://localhost:8700`, so a private app's first content
  tab loads the *shared* server's landing page. No isolation break — the app injects its own widget
  at the private ephemeral port and the shared channel is untouched (verified) — but it pollutes the
  private window list and inflates the new focus-ambiguity origin count. In private mode the initial
  tab should default to `about:blank` (or the private server's own URL). Desktop is deprioritized
  (deployment path #3), so low priority. (surfaced verifying issue #2 warning)
