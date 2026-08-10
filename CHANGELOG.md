# Changelog

## Unreleased

### Text selectors pick the element you could actually click — [#27](https://github.com/tonioloewald/haltija/issues/27)

Two ways the same selector chose the wrong element, both found driving a real admin app:

- **A hidden duplicate that came first won.** `click` took the first match in DOM order and left the
  visibility gate to complain afterwards, so a `display:none` copy made `hj click ':text(Save
  Changes)'` fail with "zero-size bounding rect" while the visible copy sat right there — and
  `hj find`, which filters before choosing, returned the right one. One selector, two answers.
- **An off-canvas element was clicked silently.** The `position:absolute; left:-9999px` skip-link
  idiom has a perfectly normal box (measured: 99x35 at x=-9999), so every size and style check
  passed it. `click` actuated an element no human can see and reported **success** — a script then
  asserts against a state it never produced. This is the worse of the two: it fails confidently.

Resolution now filters *before* choosing, and `find` and `click` share one predicate so they cannot
disagree. An off-canvas element that is the ONLY match fails loudly (`positioned off-canvas`) rather
than being clicked invisibly.

Off-canvas is measured in **page** coordinates, so content merely **below the fold** is unaffected —
visible still means *rendered*, not *on screen*. That is also why `elementFromPoint` isn't used
here despite catching this case: it rejects everything scrolled out of view, which would fail
legitimate content in a small headless viewport.

### `hj doctor` probes requestAnimationFrame — [#28](https://github.com/tonioloewald/haltija/issues/28)

**A tab can report `visibilityState: "visible"` and still not be compositing.** Occluded windows,
offscreen windows and a sleeping display all do it. Nothing rAF-driven then renders — React's
scheduler, tosijs `queueRender`, animations, virtual scrollers — while geometry probes keep
returning real numbers, so the absence of an element stops being evidence of anything.

That doesn't merely hide information, it manufactures a plausible wrong answer. The reporter found
four routes "not mounting" on hard navigation, had a coherent mechanism (the router gates its first
mount on rAF), reproduced it four times, and nearly filed it as an application bug. Opening a second
tab fixed all four.

`hj doctor` now measures it directly and fails with `requestAnimationFrame DID NOT FIRE within 2s`.
If the probe itself can't run, that is reported as **unchecked** — never as a pass — and the probe
is bounded at 3s so a pre-flight can't hang on a socket that never answers.

### `hj tabs` — the array is `windows`, and a `tabs` alias now exists ([#29](https://github.com/tonioloewald/haltija/issues/29))

`d['tabs']` KeyError'd because the payload key is `windows` — accurate, since the list holds popups
and iframes too, but the command is `hj tabs`, so the obvious guess failed and it looked like the
caller's bug. `tabs` is now sent as an alias of the same array. The hint no longer mixes the two
vocabularies in one sentence ("Multiple **tabs** connected. Use `?window=<id>`"), which is where the
wrong idea came from.

Popups being indistinguishable from user-opened tabs, the other half of that report, is fixed by the
popup work below: they carry `windowType: "popup"` and never take focus.

### Popups are popups again (desktop app) — [#25](https://github.com/tonioloewald/haltija/issues/25)

A page calling `window.open(url, name, 'width=...')` now gets a genuine popup: `window.open()`
returns a real `WindowProxy`, the child has `window.opener`, and `opener.postMessage(...)` reaches
the parent.

Previously the desktop app decided by **guessing from the URL** — allow if it contained `oauth`,
`signin`, `login`, `accounts.google.com` or `/__/auth/`; deny everything else and re-open it as a
tab, which severs the opener in both directions. `window.open()` returned `null` and the child had
no `opener`. That is the shape of every OAuth popup flow: the SDK keeps the returned window to poll
`.closed` and to `.close()`, and the callback page delivers its credential via `opener.postMessage`.
With neither, a user can complete a sign-in in a window that cannot report back and the app just
waits — arguably worse than a clean block.

The heuristic failed both ways: an innocent `/login-help` page became a popup, while the common SDK
pattern of opening `about:blank` and *then* navigating matched nothing and was denied — the very
case the list existed to catch. The decision now keys on Electron's `disposition`, which is what the
page actually asked for, so there is nothing to guess.

Two things come free, because the window model already handled popups correctly: the popup registers
as `windowType: "popup"` (tellable from a user-opened tab) and it **does not steal focus**, so
untargeted commands keep going to the tab you were driving.

Ordinary `<a target="_blank">` links still open as tabs in the app's tab strip — that behaviour is
deliberate and unchanged. **Known residual:** a featureless `window.open(url, '_blank')` is
indistinguishable from a `target="_blank"` link at this layer (both report `foreground-tab`), so it
still becomes a tab and still returns `null`.

## 1.12.0 — trustworthy by default

**Trustworthy by default.** A minor, gated on the nine-lens pre-release review: every finding it
raised is fixed, not deferred. The theme is narrow and deliberate — *the instrument must not lie*,
and where it cannot know something it must say so rather than guess.

Most of what follows is not new capability. It is haltija being wrong in ways that looked right.

### Two changed defaults — read these

**`hj map --image` now prints ONLY the file path.** It used to print the whole affordance map and
then *append* the image metadata and path, so it cost strictly more than plain `hj map` — measured,
5,910 characters against 5,447. A flag whose entire purpose is to be cheaper could not pay off under
any circumstances. It is now 103 characters; size, format and a measured cost comparison go to
**stderr**. Pass `--json` if you want the map JSON and the image together.

**Artifacts live under `tmpdir()`, not `/tmp`, and are pruned.** These are the same directory on
Linux and *not* on macOS (`/var/folders/…`), and `/tmp` may be unwritable in a sandbox. Screenshots
and schematics: 24 h, most recent 200. Videos: 24 h, most recent **20** — a lower cap because
recordings are orders of magnitude larger, and until now they were never pruned at all. If you keep
captures, copy them out of that directory. Anything already in `/tmp/haltija-screenshots` or
`/tmp/haltija-schematics` from an earlier version is **left alone** — an upgrade that deletes your
files to tidy up its own directory move is exactly the behaviour this release exists to stop.

### The schematic map is now a map

`hj map --image` used to be a stack of boxes — one small step up from the wall of text it exists to
replace. It now draws the page **where it actually is**, at real coordinates. That is the whole
point: layout is high-information, and a diagram that throws it away is barely better than prose.

- **Layout-faithful**, and it reports which renderer ran (`layout`, `boundsCoverage`) instead of
  leaving you to infer it. Force either with `--layout geometric|structural`.
- **Clipped to the viewport by default.** Full-page renders produced 1126x22304 strips that no
  amount of downscaling makes readable. Use `--full-page` when you need what is off screen.
- **Content, not just controls** — text, headings and images are drawn; elements whose only
  contribution is layout are not.
- **A legend beside the image** (`*.legend.json`; path on stderr): a flat `ref -> facts` index. The
  image says *where* and *which*, the legend says *what* — which is what makes it safe to stop
  cramming captions into boxes too small to hold them.
- **Refs on a contrasting chip**, legible against any background; **checkboxes and radios drawn as
  SVG** rather than unicode glyphs that rasterize to mush; **placeholders distinguished from real
  text**; interactive, disabled and focused states visually distinct.
- **Child text is no longer duplicated inside its parent's caption** — a parent shows `[@42]` where
  the child already speaks for itself.
- **`/map` and `/query` pierce open shadow roots.** `hj map` reported a web component as empty while
  `hj tree` listed its contents — in a design-system codebase that is most of the interactive page.

Accessibility findings ride along, because the geometry was already there: **contrast** (a failing
ratio used to round *up* into a pass, so 4.49 reported as 4.5 and passed) and **touch targets**
below the 24x24 / 44x44 thresholds, flagged on the image and in the legend.

### `hj find` returned the entire application, and said `found: true`

[#24](https://github.com/tonioloewald/haltija/issues/24), reported against rc.5 while this release
was being cut.

`/find` carried its **own** text search — `document.querySelectorAll(tag)` in document order,
returning the FIRST match. Every ancestor of a hit also contains its text, so the first match is the
**outermost** one: on a real app it answered `app-layout:nth-of-type(1)`, the whole application,
with `found: true` and exit 0. A false positive that reads as a success is worse than a miss,
because you act on it.

It survived because `:text()` was fixed to prefer the innermost match in a *different* code path,
and nothing tied the two together. `/find` now gathers candidates through the widget's own resolver,
so there is one implementation of "find me the element with this text" — which also gets `/find`
shadow-DOM piercing for free. Matches inside a shadow root are marked `inShadow`, because the CSS
selector we hand back cannot cross that boundary and pretending otherwise is the same class of lie.

Two related visibility fixes, both from the same report:

- **`offsetParent === null` is not a hidden test.** It is null for `html`, `body`, and **every
  `position: fixed` element** — fixed app shells, modals and sticky chrome are all perfectly
  visible. `/find` used that gate with no exemptions at all and skipped them; the click path had
  exemptions but was missing `HTML`. `/find` now uses the same "rendered" rule as
  `assert visible` (non-zero rect plus display/visibility/opacity).
- **The innermost filter was shadow-blind.** `Node.contains` stops at a shadow boundary while the
  candidate list pierces it, so a real ancestor reported "does not contain" and the outermost match
  won anyway. Both filters now walk through shadow hosts.

### A same-origin iframe silently overwrote the tab it was inside

sessionStorage is shared between a tab and its same-origin (or `srcdoc`/`about:blank`) frames, so a
widget injected into a frame read the same `haltija-window-id` and **overwrote the tab's entry** in
the server's window map. `hj windows` then listed one window whose type had flipped to `iframe` and
whose url had become `about:blank`, and every command — including one explicitly targeting the
tab's own id — was answered by the frame. The page you meant to drive was unaddressable while still
appearing present. It bites hardest in CI, where the widget is auto-injected into every frame.

Frames now mint their own id and register as their own window (`windowType: "iframe"`, drivable with
`--window <id>`); only real tabs ever become the untargeted target.

### `hj test` can fail a build again

**`hj test run` and `hj test suite` exited 0 even when tests failed** — in every form, including
`--json`, `--strict` and `HALTIJA_STRICT=1`. The FAIL report printed correctly; only the exit code
was wrong, so a CI lane gating on haltija could not gate on anything. Present in 1.11.2.

The envelope's `success` describes the **request**, not the tests: "the run happened" and "the tests
passed" are different facts, and only the second belongs in an exit code. Gate on `summary.failed`,
`passed`, or `results[].passed`. An unrecognised response shape is still treated as a pass — exiting
1 on something we do not understand would break working lanes — but now says so on stderr instead of
exiting 0 silently.

### Commands that reported success without doing the thing

- **`hj wait <selector>` returned success in ~50 ms without waiting.** The CLI sent `selector`; the
  endpoint reads `forElement`. An unrecognised key validates fine, so the argument was dropped and
  the command reported success. `/wait` now accepts both and returns 400 when given nothing to wait
  for, rather than "succeeding" instantly.
- **Ten CLI flags were advertised in `--help` and read by no parser**, on endpoints that accept all
  of them. Worst: `hj type 10 "hello" --clear` typed the literal characters `hello --clear` into the
  field. And `hj key s --ctrl` sent a keystroke with **no modifier** — the parser emitted `ctrl`
  where `/key` reads `ctrlKey`, the same field-name mismatch as `hj wait`.
- **`/map` ignored `maxWidth`, `maxHeight`, `format` and `quality`.** They were honoured by the
  widget from 1.11.x, never declared in the schema, and dropped by the handler's forwarding list —
  so `{maxWidth:300, format:'jpeg'}` returned a byte-identical full-size PNG with a 200. Now
  declared, forwarded, and available from the CLI as `--max-width` / `--max-height` / `--format` /
  `--quality`.
- **`hj type <ref> "text"` never typed, and `hj key --ref` hit the wrong element.** `/type` and
  `/key` both *declared* `ref` and neither handler forwarded it — so the headline example in README,
  DOCS.md and SKILL.md failed every time, and `/key {ref}` returned `success: true` having acted on
  `document.activeElement`.
- **`hj find` printed nothing and exited 0** on a call that had succeeded and located the element.
  `/find` answers at the top level and the CLI only ever printed `json.data`. Probing every command
  found `hj form` doing the same, unreported. Silence plus a success code is the worst possible
  rendering of a correct answer: no human sees it and no script can detect it.
- **`hj snapshot` with no arguments could never succeed.** An all-optional body was reduced to no
  body at all, so the server answered "Invalid JSON body" — and dumped a schema alongside that
  happens to contain an unrelated malformed entry, so the reporter reasonably blamed the schema. A
  diagnostic that volunteers a plausible-looking irrelevance costs more than a terse one.
- **`hj wait --hidden` (no selector) was a 1-second `sleep` reported as success**, because the CLI
  manufactured an `ms` the user never asked for, which suppressed the endpoint's own 400.

- **The desktop app's "Server URL" setting reverted on every launch.** It saved, displayed, and
  silently stopped applying. A URL you type now persists; a `--private` instance still overrides it,
  because isolation is not a preference.

### Diagnostics that claimed to know things they did not

- **`hj doctor` reports three verdicts, not two.** `✓` checked and fine, `✗` checked and broken,
  `?` **could not be checked** — which is not a pass. `--strict` (or `HALTIJA_STRICT=1`) makes `?`
  exit non-zero too. Collapsing "I could not check" into "fine" is how a preflight reports green on
  a server it never reached.
- **`hj where` and `hj servers` tell an auth refusal from a dead server.** A 401/403 means something
  is *there*.
- **`/screenshot` says what the user actually shared.** The 🖥 button only *defaults* the picker to
  the current tab; a window or whole-monitor grant returns pixels that are not this tab, for the
  life of the grant, on every call. Results now carry `displaySurface`
  (`browser`/`window`/`monitor`/**`null` when the browser doesn't report it**) and warn on the two
  wrong ones. `null` means unchecked, not fine.
- **A `--private` run no longer advertises `http://localhost:8700`.** The banner printed the shared
  address and told you to `curl` it — instructions that drive another project's browser, from the
  one mode whose purpose is not to touch it.
- **`HTTPS-only: not registering an instance`** was printed by private HTTP runs that had just
  announced their HTTP URL. `CAN_BE_REGISTERED` has two reasons; the message only ever cited one.
- **`hj <cmd> --help` was empty for 35 of 69 commands** — including `hj doctor` and `hj where`, the
  two this release most wants you to reach for. Summaries are now generated from the API schema, and
  local commands have written descriptions.

### Fixed

- `resolveCanvasDeep` had an early return that contradicted its own comment and skipped the
  shadow-root fallback.
- A zero-size wrapper no longer prunes its visible children out of the affordance map; `zeroSize:
  true` marks a control that is operable but occupies no box (the accessible file-input pattern).
- The `tosiAgent` tier no longer degrades silently *and* mislabels itself; unexpected shapes warn,
  and `agentSurfaceVersion` is reported so a bug report can name it.
- WebSocket `maxPayloadLength` is explicit (64 MB). Bun's default drops an oversized frame and
  closes the socket, which surfaced as "the browser widget disconnected" while the tab was fine.
- `haltija --private` without `--port-file` crashed with `ReferenceError: tmpdir is not defined`
  ([#17](https://github.com/tonioloewald/haltija/issues/17)) — shipped dead in **nineteen** tagged
  releases, v1.4.1 through v1.11.3.
- `hj navigate file://…` no longer wedges the desktop app. It cannot inject the widget there, so
  the tab disconnected permanently — and `navigate` reported `success: true`, because the navigation
  genuinely happened. The next command failed with a generic "No browser connected", and `hj tabs
  open`, the obvious recovery, needs a connected browser. Now refused **in the desktop app** with
  the HTTP workaround in the message; `file://` still works under `--headless`.
- `hj <anything on Object.prototype>` no longer crashes or runs the wrong command. `hj toString`
  died inside node's own bootstrap; `hj constructor` silently ran `hj console`, because suggestions
  matched on a shared three-character stem. Lookup tables keyed by user input are now
  prototype-less, and a suggestion must be a whole command that prefixes what you typed.
- `queryAllDeep` threw on very large pages: `push(...matches)` passes every match as an argument and
  the engine caps that (measured — 120k fine, 200k `RangeError`). The failure scaled with page size,
  so it appeared only on the documents most worth inspecting.
- The schematic legend could overwrite the image it describes, where an artifact path had no
  extension. Latent rather than live, and now impossible by construction rather than by that
  invariant holding.
- Docs state where the map walk **stops** — closed shadow roots (which nothing can pierce), iframes,
  opaque media, `maxNodes` truncation — so a childless node can be told from a genuinely empty
  element. Related: `pierceShadow` and `pierceFrames` **default to true**; the docs implied opt-in.

### Guards, because most of the above should have been caught

- `bun run build` now type-checks the shipped `bin/*.mjs` and fails on undefined identifiers. That
  is the #17 class exactly: `node --check` parses it happily and it dies at run time.
- The Playwright suites are type-checked too. They were excluded from the only type check in the
  build, which made 116 tests the least-checked code in the repo.
- A declarative invariant asserts every command whose parser handles flags is registered in
  `KNOWN_FLAGS`. It found the ten dead flags above.
- Every handler is asserted against its schema in **both** directions: nothing an endpoint
  declares may be dropped, and nothing a handler reads may be undeclared. The first version of
  that check covered `/map` alone — which is precisely how `/type` and `/key` went out broken in
  the release that fixed `/map`. **A guard written for one instance of a class does not guard the
  class.** The read-direction half was added after a dependency bump began enforcing
  `additionalProperties: false` and turned nine undeclared-but-working fields on
  `/recording/generate` into a 400 on a documented endpoint.
- Running the unit suite **deleted the developer's screenshots** older than 24 h — production prune
  defaults, no test seam. Fixed, and CI now fails if the suite touches the real artifact directory.
- Two Playwright suites still held fixed ports with unconfirmed teardown, so an interrupted run
  poisoned every later run with an EADDRINUSE stack that read as a code bug.

## 1.11.3

Patch. Test infrastructure — no behaviour change.

### New: distribution-parity lane

haltija ships the same CLI twice: `bin/hj.mjs` in the npm package, and `dist/hj.js` as a single
bundled file installed to `~/.local/bin/hj`. They report the same version, so nothing signalled when
they diverged — and in 1.11.0 they did, which is how an adopter verified a readiness probe against a
real repro and still shipped a no-op ([#14](https://github.com/tonioloewald/haltija/issues/14)).

A lane now runs **both artifacts** and diffs what a consumer can observe: version, command list,
stdout bytes, exit codes, and error hints. Mutation-tested rather than assumed — reintroducing each
original bug (bundle without hints; advisory text on stdout) makes it fail.

## 1.11.2

Patch. Four field reports from tosijs-3d and tosijs-ui, all confirmed.

### Fixed: `--canvas` couldn't reach a canvas in a shadow root ([#15](https://github.com/tonioloewald/haltija/issues/15))

Which is where every component-based renderer puts it — so the exact-pixels escape hatch failed on
exactly the pages where pixels are the only thing worth looking at. Canvas resolution now pierces
shadow DOM and accepts every shape someone would reasonably write:

```bash
hj screenshot --canvas "tosi-b3d canvas"       # descendant, crossing the boundary
hj screenshot --canvas "tosi-b3d >>> canvas"   # explicit piercing form
hj screenshot --canvas "canvas"                # found inside shadow roots too
hj screenshot --canvas                         # no selector: the largest canvas on the page
```

A genuine miss now lists the canvases that *do* exist, with working selectors. The **schematic**
embeds shadow-root canvases as well — previously it silently showed none on these pages.

### Fixed: advisory hints were printed to stdout ([#14](https://github.com/tonioloewald/haltija/issues/14))

A dim hint line was appended to **stdout** after JSON output, so `JSON.parse(await $\`hj windows\`)`
threw — and an adopter's readiness probe fell into an open catch and silently did nothing. All
advisory text is on stderr now; stdout is the data channel.

Two related fixes from the same report:

- **`hj <cmd> --help` now describes that command** instead of falling through to global help, which
  read exactly like "unknown command" (a reporter concluded `doctor` and `map` didn't exist in their
  build). haltija's own error messages recommend this form, so the remedy we printed was broken.
- **The standalone `hj` bundle now carries its hints.** They were read from a sibling `hints.json`,
  which doesn't exist next to `~/.local/bin/hj` — so two distributions reporting the same version
  produced different output. Hints are compiled in, like the version and semver helpers.

### Fixed: contrast false positives on text-less ancestors ([#13](https://github.com/tonioloewald/haltija/issues/13))

A container propagates `color`/`background` but has no font size, so `large` is *unknowable* —
defaulting it to false held it to 4.5:1 and manufactured failures for text that passes as large on
the child that actually renders it. About half the findings on a typical page. Only elements with
their own direct text are graded now.

## 1.11.1

Patch, per the rule that a minor bump waits for a cleared backlog and a nine-lens review.

### Fixed: contrast audit noise

Two sources of false findings, fixed before anyone acts on a long list of them:

- **Containers with no text of their own were flagged.** A `<div>`/`<form>` inherits a colour but
  displays nothing, so a "failure" there is noise. Only elements that actually render text, a label
  or a value get a verdict now.
- **Text over a `background-image`** (gradient, photo) was judged against whatever background-*color*
  sat beneath it — which can be wrong in either direction. Those are now reported as
  `colors.uncertain` rather than asserted as pass or fail.

An audit people learn to skim is worth nothing, so the bar is: only claim what can be justified.

### Per-tab routing, by declaration ([#1](https://github.com/tonioloewald/haltija/issues/1), [#2](https://github.com/tonioloewald/haltija/issues/2))

cwd routing gets a command to the right *server*; which **tab** answers then fell back to focus, so
two projects on a shared server could drive each other's pages. Ranking tabs by "this origin looks
like your project" was rejected twice — there's no reliable origin→directory map, and a
usually-right guess reintroduces the silent misroute cwd routing exists to prevent.

So the project declares it. A `.haltija.json` at the project root:

```json
{ "origins": ["https://localhost:8030", "http://localhost:3000"] }
```

…and `hj`, run anywhere inside that project, pins commands to a connected tab on one of those
origins regardless of focus. **Entirely opt-in** (no file = unchanged behaviour) and it never
guesses: if you declared origins and no connected tab matches, `hj` says so loudly instead of
quietly driving another project's page — and refuses outright under `--strict`. `HALTIJA_ORIGINS`
overrides for one-off shells and CI.

### `hj screenshot --schematic`

Ask for the schematic even when real capture *is* available — it's cheaper, deterministic, and
carries the contrast audit. Canvases are still embedded as real pixels.

## 1.11.0

### Errors now tell you what to do

Following the tjs lesson that an error's job is the next action, not the diagnosis:

- **"Element not found"** branches on what you passed. A stale **ref** explains that refs are only
  valid while the element is in the DOM and to re-run `hj tree` (or target by text, which survives
  re-renders); a **selector** gets the recovery order — `hj map`/`hj tree` to see what's there, the
  hidden-elements rule, prefer `:text()`/`[data-testid]` over structural selectors, and `hj wait` if
  the page is still loading.
- **Unknown-action errors list the valid actions** instead of only rejecting yours.
- **"No active recording" / "No selection available" / "url is required"** now say how to reach a
  valid state.
- **Schema-validation failures** carry a `hint` with the CLI form and a runnable example body — and
  `hj` now prints `hint` on errors, which it previously discarded, so the teachable half reached
  nobody.

### Fixed: six endpoints were missing from every generated doc

All three doc generators iterated a hardcoded category list and silently dropped anything not in it,
so every `/network/*` and `/dialog/*` endpoint appeared in **no** generated documentation. They now
append unlisted categories, so a new category can't vanish.

### New: a docs-coverage gate

`docs-drift` catches generated files going stale against the schema; it can't catch a feature
shipping that the prose never mentions — which is how `hj map`, `--canvas` and `hj shutdown` all
shipped undiscoverable. A test now asserts every public endpoint reaches the reference and
`llms.txt`, every agent-facing command is named in `SKILL.md`, and headline capabilities are
explained rather than merely listed — failing with exactly what to add.

## 1.10.0

### New: a screenshot you can't take now degrades to a labelled schematic

In a plain browser with no desktop app and no screen-share grant, `hj screenshot` used to just fail.
It now returns a **schematic** of the page instead — and because canvases need **no permission**, any
`<canvas>` is embedded as **real pixels** inside it. For a 3D app or a chart that's the actual visual
content, so the substitute is genuinely useful rather than a consolation prize.

Labelled three ways, because a schematic quietly standing in for a screenshot would be exactly the
plausible-but-wrong result this tool exists to prevent: `source: "schematic"`, a `warning` naming
both routes to real pixels, and a red banner burned across the image. `--no-fallback` restores the
hard error, and `--strict` turns the warning into a non-zero exit.

### New: the schematic surfaces contrast problems

The schematic is drawn in the **page's own colours** — element background as fill, border as stroke,
text colour for the caption — so a control the user can barely read is a box you can barely read.
Poor contrast shows itself instead of hiding in a JSON blob. It's machine-checkable too: DOM-tier
nodes carry `colors: {fg, bg, contrast, passes}` and a `contrastFail` string when they miss WCAG AA.
(The verdict is drawn in legible red on purpose — a warning about unreadable text mustn't itself be
unreadable.)

### Fixed: the widget was served without a charset

`Content-Type: application/javascript` carried no `; charset=utf-8`, so browsers parsed
`component.js` as Latin-1 and **every non-ASCII string literal in the widget was corrupted at parse
time** — em-dashes, `×`, `·`, and the `⟷`/`⟵` binding-arrow legend. The bytes on disk were always
valid UTF-8; the browser was mis-decoding them. Fixed on all five JS responses.

## 1.9.0

### New: `hj map --image` — the map as a rasterized schematic

Renders the affordance map as a PNG: one labeled box per control, nested by structure, each showing
its handle (`@ref` or `#index`) so the picture doubles as an **index** — glance at it, pick a
target, act on that one record.

It has to be a **bitmap** to be worth anything: an image of text costs a vision encoder far fewer
tokens than the same text tokenized, but that applies to rendered pixels, not to SVG markup (which
is just text tokens, and worse than the JSON it would replace). Rasterized in the browser, so there
is no new dependency.

**The win is density-dependent, and the response says so rather than assuming.** An image costs
~1000–1600 vision tokens regardless of content, so a small page is cheaper as JSON; the image pays
off once the map is large. `cost.approxJsonTokens` reports the JSON size for that page so the choice
is measurable. The schematic is also deterministic, which makes a diff between two runs a regression
a human can see.

## 1.8.0

### New: `hj map` — what can I interact with, and what is it wired to?

An affordance map of the page. Usually a better first move than `hj tree` or a screenshot when
you're deciding what to *do*: structural, deterministic (no fonts/theme/viewport/animation timing),
and dense — a small page is a few hundred bytes (~100 tokens) against ~1–1.5k vision tokens for a
screenshot.

Two tiers, and the response always says which one produced it:

- **`source: "tosi-agent"`** — when the page exposes an agent surface (`globalThis.tosiAgent`, a
  tosijs app calling `enableAgentInterface()`), the map is the app's **own wiring records**, passed
  through unchanged. Those carry what the DOM cannot: which state path each control is bound to and
  in which **direction** (`⟷` two-way/user-writable, `⟵` display-only, absent = static), the handler
  path each event calls, and the callable actions. Act through the paths rather than synthesizing
  input — `hj eval "tosiAgent.write('app.filter','milk')"` — and note that writing a `⟵`
  display-only path via the DOM won't stick, which is exactly the "I typed into it and nothing
  happened" trap.
- **`source: "dom"`** — any other page: structural, visible-only, each node carrying a `ref` for
  `hj click <ref>`. Labelled an approximation with **no** binding provenance, so it can't be
  mistaken for real wiring.

Credit to the tosijs agent for the idea (#12).

## 1.7.0

### New: capture a `<canvas>` directly — `hj screenshot --canvas <selector>`

Reads the canvas's own pixels (`toDataURL`) instead of capturing the screen. For a WebGL scene
(Babylon/three.js) or a UI rendered into a texture that means **exact pixels at native resolution,
no screen-share grant, no desktop app required** — and it works even when the canvas is scrolled
out of view or the tab isn't frontmost. Takes the same `--scale`/`--format`/`--max-width`/file
options as any screenshot.

It also handles the trap that makes naive canvas capture untrustworthy: a WebGL context clears its
drawing buffer after compositing unless created with `{ preserveDrawingBuffer: true }`, so
`toDataURL` can hand back a **blank image with no error**. Haltija samples the result and returns a
`warning` explaining the likely cause instead of a silent empty picture — and deliberately doesn't
cry wolf: a canvas with real content warns not at all, and a uniform *opaque* colour (which may be a
perfectly legitimate solid background) gets a softer note than a fully transparent one. A canvas
tainted by cross-origin textures returns a clear CORS error rather than crashing.

### New: adopter-context test lane

The suite now includes tests that reproduce the *dirty machine* adopters actually have — a server
already running with zero windows, two projects in different directories each expecting their own,
and ambiguous targeting from an unrelated directory. Every field bug this project has shipped lived
in that gap, invisible to a suite that starts from nothing.

## 1.6.1

Makes haltija's detection reachable by automation ([#8](https://github.com/tonioloewald/haltija/issues/8),
[#11](https://github.com/tonioloewald/haltija/issues/11)).

haltija already *detects* the situations that wreck a test lane — the wrong project's browser, a
hidden tab returning stale results, a server with nothing to drive. It only ever **warned on
stderr**, so scripts consumed plausible-but-wrong results and failed much later, pointing at the
caller's own code.

### New: `ready` — "server is up" is not "server is drivable"

`/status` and `/windows` now return **`ready`**: true when at least one top-level tab is connected.
A server running with *zero* windows answers `/status` 200, so an adopter's reuse probe skipped
starting its own browser and then had nothing to navigate. Gate a lane on `ready`, not on the 200.

### New: `hj doctor`

One-command preflight that **exits non-zero**: server reachable → a tab is connected → the target
isn't ambiguous → tabs aren't all hidden → versions aligned. `--json` for machine-readable output.
Use it as the wait-loop condition in CI.

### New: `hj --strict` / `HALTIJA_STRICT=1`

Turns the advisory warnings into **non-zero exits**, and refuses to print a suspect result to
stdout at all — a script must not consume a value that may be wrong. A warning is the right default
for a human at a prompt and the wrong one for a lane.

### Fixed

- **Warning de-duplication silently defeated strict mode.** The server withheld a repeated warning
  entirely, so the first command in a lane failed and every later one within the cooldown passed.
  The server now always reports the condition and marks repeats (`warningRepeated`); de-dup is a
  presentation concern, so `hj` stays quiet on a repeat while `--strict` fails on any warning.

## 1.6.0

Consolidating release: rolls up everything from 1.5.2–1.5.7 (the last npm-published version was
1.5.4) and adds the fixes from a full nine-lens pre-release review of the whole span.

**Highlights since 1.5.4** (see the per-version entries below for detail):

- **`--private --app` teardown** (1.5.5, #7) — private Electron no longer orphans: skips the
  single-instance lock, self-terminates when its spawner dies, `hj shutdown` tears it all down.
- **Console capture** (1.5.6) — uncaught exceptions, unhandled rejections, and `console.error(Error)`
  messages/stacks are now captured (all were previously dropped).
- **Server picker** (1.5.7) — `hj servers` lists every live server; the desktop app is reachable as
  `hj --name desktop`.

**Review-driven fixes in this release:**

- **`hj shutdown` no longer orphans a running desktop app.** It refuses (with a clear message —
  quit the app from its window) instead of killing just the embedded server and leaving the window
  on screen with dead tabs. `--private` instances still tear down fully.
- **`--name desktop` is reserved** — a normal server can no longer claim it and clobber the desktop
  app's registry entry.
- The uncaught-error listeners are removed on widget disconnect (no leak across re-injection).
- `hj ls` is now an alias for `hj servers` (was `hj tree`); the old alias is gone.
- Added tabs-focus regression tests and `hj servers` / `hj --name desktop` / `hj shutdown` to the
  generated docs and the agent skill.

## 1.5.7

Pick between coexisting servers.

When a normal haltija server and the Electron desktop app both ran, there was no way to see them or
target the app — it was unregistered, invisible to `hj where` and the registry.

- **`hj servers`** (alias `hj ls`) lists every live server: registry entries, the probed defaults
  8700/8701, and this shell's target — with port, name, version, tab count, whether it's the
  desktop app, and a `▸` on the one `hj` would drive.
- **The desktop app is now reachable as `hj --name desktop`.** Its public server registers under
  the reserved name `desktop`, but *cwd-less* — so it's nameable without ever hijacking cwd routing.
  (The internal chrome server stays unregistered; a `--private` app registers nothing.)

## 1.5.6

`hj console` now captures the errors that actually matter.

It intercepted `console.*` calls, but the most important errors slipped through: an **uncaught
exception** (`throw`) and an **unhandled promise rejection** were never captured (no `window`
error / `unhandledrejection` listener), and `console.error(new Error(...))` recorded `{}` because
`JSON.stringify` drops an Error's message and stack. A page could be throwing on every action while
`hj console` showed it clean.

- Uncaught exceptions and unhandled rejections are now captured as `error` entries, with the real
  stack. The `error` listener uses the capture phase, so failed resource loads (img/script/…) are
  seen too.
- Error objects serialize to `{name, message, stack}` (at any depth), so the message survives.
- Note: capture begins when the widget is injected, so errors thrown *before* injection are only
  caught by the desktop app (which injects at document-start).

## 1.5.5

`--private` now really is "torn down with the run" ([#7](https://github.com/tonioloewald/haltija/issues/7)).

The private Electron instance used to survive teardown — holding Electron's single-instance lock (so
the **next** `--private` run failed with "Another instance is already running") and leaking a process
per run. Fixed three ways, all verified with real Electron:

- **A private run never takes the single-instance lock.** Private instances are isolated on ephemeral
  ports and meant to run concurrently / back-to-back, so an orphan can no longer block the next run,
  and two private runs coexist.
- **The private Electron self-terminates** when its spawner dies (even via SIGKILL) or on
  SIGTERM/SIGINT. It reparents to launchd, so it watches the launcher's pid (`HALTIJA_SPAWNER_PID`)
  and calls `app.quit()` — which reaps its own helper processes, unlike an external tree-kill.
- **`hj shutdown` / `hj quit`** (and `POST /shutdown`) on a private-desktop instance tears down the
  whole thing — Electron and its servers — for a deterministic end-of-run teardown.

## 1.5.4

The `hj tabs open` client-less-tab trap now explains itself ([#5](https://github.com/tonioloewald/haltija/issues/5)).

Outside the desktop app, `hj tabs open <url>` has no tab API, so it falls back to `window.open()` —
and that new tab has **no haltija widget** unless its page injects one. So the server never hears
from it, it doesn't appear in `hj tabs`, and commands can't reach it (they go to the focused widget
tab). It presents as "the tab opened fine but every command goes somewhere else" — indistinguishable
from a routing bug.

- The fallback response now carries a `reason`, promoted to a top-level `warning` that `hj` prints
  on stderr — at the one moment the client-less tab is created.
- The `/tabs/open` schema and `SKILL.md` now state plainly that only widget-injected tabs are
  controllable and appear in `hj tabs`, so a non-responding tab is the first thing to check.

## 1.5.3

Discoverability fix for the two CI browser engines ([#6](https://github.com/tonioloewald/haltija/issues/6)).

Both `--headless` and `--ci` said "for CI" with no hint that they drive **different** engines:
`--headless` is Playwright Chromium (and needs the `playwright` package), while `--ci` / `--app` /
`--private --app` drive Electron and need no Playwright. An agent picked `--headless`, hit
"Playwright not installed", and wrongly concluded haltija's CI mode is just a Playwright wrapper.

- `hj --help` now names the engine per mode and adds a "Choosing a CI engine" block; `--private` is
  clarified as an *isolation* modifier that pairs with either engine (not "pair with `--headless`").
- The "Playwright not installed" error points at the Electron path (`--ci` / `--private --app`) as
  the no-Playwright alternative.
- `llms.txt`, `docs/CI-INTEGRATION.md`, and `SKILL.md` get an honest "which engine?" framing:
  it's Electron vs Playwright (neither is bundled), and the real reason to choose Playwright is
  multi-engine coverage (Firefox/WebKit), not the words "for CI".

## 1.5.2

Two follow-ups from the 1.5.0 review, both about the multi-tab experience on a shared server.

### Fixed

- **`hj tabs focus <id>` no longer times out** ([#4](https://github.com/tonioloewald/haltija/issues/4)).
  It was dispatching a `focus` command to the browser, routed to the *focused* tab rather than the
  target, so nobody answered — and even routed correctly, a backgrounded tab can't raise itself.
  Focus is now a **server-side** routing change: it validates the tab and points untargeted commands
  at it, returning instantly (unknown tab → a clean error, never a timeout). It does not physically
  raise the tab; to pin a single command use `--window <id>`. "Focus follows the visible tab" still
  applies when you physically switch tabs — that's genuine intent that should win over a stale pin.

### Changed

- **The hidden-tab / focus-ambiguity warnings are de-duplicated within a short (15s) cooldown**, so
  a burst of commands from one agent doesn't repeat the same block every time. A *changed* condition
  (different tab, newly-hidden tab, a new origin on the server) always re-warns; the cooldown
  re-arms rather than suppressing forever. Set `HALTIJA_NO_TAB_WARN=1` to silence them entirely.

## 1.5.1

Low-risk follow-ups from the 1.5.0 pre-release review — the two new "instrument must not lie"
warnings now reach more of the surfaces where they matter.

### Fixed

- **The hidden-tab / focus-ambiguity warning is no longer dropped on the paths where it's most
  useful.** It's now attached on the **timeout** path — a hidden tab whose rAF-driven `eval` never
  resolves now returns a `Timeout` that *explains* it may be asleep, instead of a bare timeout —
  and preserved by the `hj find` / `hj form` handlers, which previously reshaped the response and
  lost it. (`hj screenshot` already carried it; `hj call` intentionally still returns the raw value
  with no envelope.)

### Internal

- Extracted the `hj --window <id>` argument handling into a pure, unit-tested helper
  (`bin/arg-utils.mjs`), covering both the leading and trailing positions — the leading form was
  the escape hatch that broke in 1.4.0, and it now has a regression test.
- A private-app startup that fails to learn its ephemeral port no longer leaves its temp port-files
  behind.

## 1.5.0

Completes the **private-automation** feature (`--private`) begun in 1.4.1 — now for the Electron
app as well as headless — and adds two **"the instrument must not lie"** guards so a command that
lands on the wrong or sleeping tab says so instead of returning a plausible-but-wrong answer.

### New: `--private --app` — isolated Electron automation ([#1](https://github.com/tonioloewald/haltija/issues/1))

`--private` gave headless runs an isolated server + browser on an ephemeral port. `--private --app`
extends that to the desktop app: it spawns its **own** public and internal servers on ephemeral
ports (never 8700/8701), drives its **own** browser, writes the public address to `--port-file`,
and never sees, adopts, registers, or touches the shared interactive channel. The app's port
constants are now resolved *after* the private servers report their ephemeral ports, so every
downstream use — widget injection, `/status`, content tabs — follows the ephemeral instance.

### New: hidden-tab warning ([#3](https://github.com/tonioloewald/haltija/issues/3))

A backgrounded tab **answers** — `hj eval 'document.querySelectorAll("x").length'` returns `0`, not
a timeout — because browsers stop `requestAnimationFrame` and throttle timers in a hidden tab, so
anything mounted by rAF/IntersectionObserver never ran. The page looks broken when it's merely
asleep. When a command is routed to a tab that reported itself hidden, the result now carries a
warning that the number can be plausible-but-wrong, with how to target a visible tab.

### New: focus-ambiguity warning ([#2](https://github.com/tonioloewald/haltija/issues/2))

cwd routing gets an untargeted `hj` command to the right shared *server* and then stops — which
*tab* answers falls back to focus. So two agents each staying in their own project can drive each
other's pages once both have a tab on the shared server. When a command isn't pinned to a window
and the server spans more than one origin, the result now warns that *focus*, not your directory,
chose the tab — and lists the other tabs as `--window` pins. It deliberately does **not** guess
which tab is "yours" (there's no reliable origin→directory map); ranking waits for one that can
justify itself.

### Fixed

- **`hj --window <id> <cmd>`** — the documented leading form printed the usage banner instead of
  targeting the window (`--window` wasn't pre-parsed like `--port`/`--name`). Both positions work now.
- **Desktop-spawned servers get their port** via the env the server actually reads
  (`HALTIJA_PORT`/`DEV_CHANNEL_PORT`, not `PORT`) — the app couldn't control its servers' ports before.

## 1.4.1

Five cross-project bugs, all of the same shape: **haltija reaching out and disrupting a healthy
peer.** If you run more than one project on a machine, this is the release that stops your
browser channel vanishing.

### Behavior changes (no API breaks)

Nothing was removed or renamed — no endpoint, export, or flag — so nothing should fail to compile
or resolve. Two *runtime* behaviors changed, and in both the old behavior was the bug:

- **The desktop app attaches to an existing server instead of replacing it.** If you relied on a
  launch always giving you a pristine embedded server, set `HALTIJA_SERVER_MODE=builtin`.
- **`--https` (https-only) now exits if it cannot bind its port**, instead of silently starting on
  an ephemeral one. The old "success" produced a channel no widget could reach.

### New: `--private` — isolated automation instances ([#1](https://github.com/tonioloewald/haltija/issues/1))

haltija plays two roles that were conflated. A **shared interactive** browser on the default port
is a feature — whatever window is focused is what `hj` drives, across projects. But **ephemeral
automation** (a test lane that spawns a browser, drives fixed pages, and exits) was consulting
that shared server and, if any was reachable, *adopting and navigating it* — so one project's
doc-test lane yanked another project's live browser to different pages, and then failed on a
timeout. Intermittent and baffling, because it only bit when a foreign haltija happened to be up.

`haltija --private` (pair with `--headless`) is isolated by construction:

- binds an **ephemeral port, never 8700** — it can't collide with or be mistaken for the shared server;
- is **not registered** in the shared registry, so interactive `hj` / cwd-routing can't adopt it;
- **never reaches out** — it retires nothing and touches no other server;
- **reports its address** on stdout (`HALTIJA_PRIVATE_READY {json}`) and to `--port-file` — since
  it's not in the registry, that's how you find it.

A consumer's test lane should request a private instance and drive *that* by the port it reports,
instead of an unscoped `hj windows` check that races whatever else is on the machine.

### Fixed: the desktop app killed other projects' channels

Its default was to stop any server on 8700/8701 and start fresh — so launching the app (`bunx
haltija`, an `hj` auto-launch, `--ci`, the integration test) silently took down a live channel
another project was using, and made its widget vanish. It now **attaches to a healthy existing
server and says so**. Force the old behavior with `HALTIJA_SERVER_MODE=builtin`.

### Fixed: a half-dead `--both` channel (HTTPS silently on the wrong port)

When the HTTPS port was busy (a fast restart racing the previous server), the HTTPS side quietly
fell back to an **ephemeral** port. But a widget on an https page connects to the *known* port —
so 8701 sat empty, the page couldn't connect, and the server looked healthy because HTTP was fine.
HTTPS now retries its intended port and, failing that, **fails loudly** rather than relocating;
the startup banner never advertises a port it didn't bind.

### Fixed: silent HTTP port relocation

When the wanted HTTP port was taken, the server bound an ephemeral one without a word — so a
caller probing a fixed port had no idea why nothing was there. It now says
`<port> was taken; bound HTTP on <n> instead. Find it with \`hj where\`.`

### Fixed: the test suite disrupted other servers

`bun test` bound fixed 87xx ports — the range real servers live in — and on a collision would
`POST /shutdown` whatever was there, including another project's channel. The suite now uses
high, per-process-unique ports and can never stop a server it didn't start.

### Docs

A "tab that reads as unreachable" troubleshooting section in `DOCS.md` and `llms.txt`: a hidden,
backgrounded, minimized, or occluded tab (and an active WebXR session) suspends
`requestAnimationFrame` and throttles timers, so the tab can stop answering even though the page
is fine. Bring it forward, or target it explicitly with `hj --window <id>`.


## 1.4.0

**`hj` now routes to the server that owns your current directory.** If you run more than one
project, this changes where your commands go — for the better, but read the first section.

### Fixed: `hj` drove the wrong browser across projects

`hj` never looked at your working directory. Every invocation, in every project, fell back to
port 8700 and drove whatever browser was focused there — silently, with no error. The only way
to target a project's own server was per-shell environment variables that agents spawning fresh
shells routinely lose.

Servers now record the directory they were started in, and `hj` picks the live server whose
directory is the nearest ancestor of your cwd. Inside a project with its own server, plain
`hj tree` just works — no flags, no env vars.

- Falling back to the shared default port while other servers are running now **warns** on
  stderr instead of quietly misrouting.
- **`hj where`** tells you which port you're targeting, *why* it was chosen, and what's alive
  there. Reach for it first when a command seems to hit the wrong page.
- Precedence is unchanged and still wins: `--port` > `--name`/`HALTIJA_NAME` > `HALTIJA_PORT` >
  `DEV_CHANNEL_PORT` > cwd match > port 8700.

### Fixed: a stale server could hand every project an old `hj`

`hj` is a single binary on your `PATH`, and every haltija server used to overwrite it on
startup — so the last server to boot decided which `hj` *every project on the machine* ran. One
forgotten `bunx haltija@beta` could silently downgrade the CLI for an unrelated, up-to-date
project.

- A **symlinked `hj` is never touched.** Point it at your own build and it stays put.
- Servers **only bootstrap or repair** `hj` — they write it when nothing is there, or when
  what's there is strictly older. They never downgrade it, and never rewrite it just because
  the bytes differ. To find out what's installed they ask it (`hj --version`).
- **`hj --version`**, and `hj` now warns when its version differs from the server it's driving.
- `HALTIJA_NO_INSTALL=1` opts out of the install entirely.

### New: pre-1.4.0 servers are retired on startup

Older servers have none of the guards above and cannot be fixed in code that already shipped, so
a 1.4.0+ server **asks** any haltija server **below 1.4.0** to stop when it starts, and says what
it did. Retirement is `POST /shutdown` — an endpoint every haltija has understood since 0.1.7 —
so it needs no process IDs and does no killing.

This is deliberately narrow: it never stops a peer (1.4.0 and 1.4.1 coexist, and once 1.3.x is
gone it never fires again), never touches a running desktop app, and never touches anything it
cannot identify as haltija. When it can't stop a server, it complains rather than failing
silently.

`HALTIJA_NO_RETIRE=1` opts out. See "Housekeeping" in the README.

### Also

- HTTPS-only servers no longer advertise an HTTP port they aren't listening on.
- Every REST response carries `X-Haltija-Version`.
- **`hj` exits non-zero when an operation fails** (`success:false`) — not just with `--json`, but on action commands too (`hj click`, `navigate`, `key`, …). A click that didn't land, or any command with no browser connected, now exits 1 instead of 0, so an agent checking the exit code can't read a failed step as success. (Commands with their own human formatting were already this way; this closes the gap for the rest.)
- `HALTIJA_REGISTRY_DIR` overrides the instance-registry location.
- `hj` no longer auto-spawns a server against an **explicitly targeted** port (`--port`/`--name`/`HALTIJA_PORT`) or under `--no-launch` — a read-only command against a server you manage will not start a colliding one; it errors instead. Auto-spawn remains only for the bare default port.

### Platform

macOS and Linux. Native Windows is not supported — use WSL, where all of this works unmodified.
