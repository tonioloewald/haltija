---
name: haltija
description: Drive and inspect the browser via the `hj` CLI — live browser control AND writing/running lightweight Haltija regression tests. Use for browser automation, DOM inspection, verifying a change in the real app, and authoring repeatable JSON e2e tests.
user-invocable: true
allowed-tools: Bash
---

# Haltija

Haltija drives the browser through the `hj` CLI. Two uses:

1. **Live control** — inspect/click/type to verify a change works in the real app.
2. **Regression tests** — author repeatable JSON tests and run them with `hj test-suite`.

Start the server with `bunx haltija@latest` (add `-f` to force-kill an existing
instance). **Use the `hj` CLI, never curl.** `hj` installs to `~/.local/bin` — make sure
that's on your PATH. `hj docs` is the quick start, `hj api` the full reference,
`hj --help` lists every command.

## When to use Haltija vs a cross-browser runner

- **Haltija = the default.** Lightweight, fast, scriptable — use it for the vast majority
  of browser checks, and for a pre-commit/pre-PR gate.
- **A cross-browser runner (e.g. Playwright) = only when it's browser-specific.** Reach for
  it solely to reproduce/verify a bug that's unique to a particular engine (e.g. a Firefox
  shadow-DOM quirk). It's slow and heavy for everyday flows.
- **In CI, `--ci` is the default engine (Electron/Chromium) and needs no Playwright.** Haltija's
  own `--headless` mode drives *Playwright* Chromium and requires the `playwright` package — pick
  it only for the browser-specific/multi-engine case above, not just because it says "for CI".
  See [CI integration](../../../../docs/CI-INTEGRATION.md) → "Which engine?".

## Which server am I driving?

`hj` targets **the server owning the directory you're standing in.** A haltija server records
the directory it was started in, and `hj` picks the live server whose directory is the nearest
ancestor of your cwd. So in a project with its own server, plain `hj tree` just works — no
flags, no env vars.

If no server owns your cwd, `hj` falls back to the shared default port 8700 (the standalone
desktop app) and **warns on stderr when other servers are running** — heed that warning. It
means the command you just ran may have driven a *different project's* browser. Misroutes are
silent: they look like a flaky page, not an error.

**Declare your project's origins and `hj` will pin commands to YOUR tab.** On a shared server,
which tab answers otherwise falls back to whatever is focused — so two projects can drive each
other's pages. Put a `.haltija.json` at your project root:

```json
{ "origins": ["https://localhost:8030", "http://localhost:3000"] }
```

Now `hj` (run anywhere inside that project) targets a connected tab on one of those origins,
regardless of focus. Entirely opt-in — no file means behaviour is unchanged — and it never guesses:
if you declared origins and no connected tab matches, `hj` says so loudly rather than quietly
driving someone else's page (and fails outright under `--strict`). `HALTIJA_ORIGINS=…` overrides for
one-off shells and CI.

**A shared channel can be half-open.** `hj where` prints a `transports:` line — which of HTTP/HTTPS
is listening, and why not. An HTTP-only instance leaves every **https** page with nothing to import
(mixed content blocks the fallback), including other projects'. It looks healthy throughout.

**Both diagnostics report what routing will actually do.** `hj where` and `hj doctor` each print an
`origins:` line — what you declared, where the declaration was found, and which connected window it
resolves to (or that none matches yet, so commands still follow focus). A `.haltija.json` that
parses but declares **no usable origins** silently turns per-tab routing off — the exact problem it
was added to fix — so `hj doctor` now **fails** on it (exit 1) and names the file. Trust that line:
"configured" and "working" are different states and it distinguishes them.

**Waiting.** `hj wait 500` delays; `hj wait ".modal" --timeout 5000` polls until the element is
visible and **exits non-zero on timeout** — so a CI lane stops on the real cause. `--hidden` waits
for it to disappear. Passing neither a delay nor a selector is an error, not a no-op.

**When a command seems to hit the wrong page, run `hj where` first.** It reports the port, why it
was chosen, the transports, and what's alive there. Override with `--port <n>` or `--name <foo>`.
When several haltijas are running (e.g. a project server **and** the desktop app), **`hj servers`** (alias **`hj ls`**)
lists them all — port, name, version, tabs, which is the desktop app — with `▸` on the one you'd
drive. The desktop app is reachable as `hj --name desktop`. **`hj shutdown`** (alias `hj quit`) stops
the targeted server; against a `--private` instance it tears down the whole thing (Electron + its
servers), and it refuses to orphan the interactive desktop app (quit that from its window).

## Scripts and CI: `hj doctor` and `--strict`

**"Is the server up?" does NOT mean "can I drive it".** A server can be running with **zero connected
tabs**: it answers `/status` 200, your lane adopts it instead of starting its own browser, and then
fails much later on a timeout that looks like your code's fault. Two things close that gap:

```bash
hj doctor          # preflight: reachable + drivable + unambiguous target? EXITS 1 if not
hj --strict <cmd>  # turn advisory warnings into non-zero exits (or HALTIJA_STRICT=1)
```

- **`hj doctor`** is the one-line pre-flight for a test lane. It checks, in the order they bite:
  server reachable → a tab is actually connected → the target isn't ambiguous (your cwd matches, or
  you chose explicitly) → tabs aren't all hidden → **the tab actually paints** → versions aligned. **Non-zero exit** when any of
  those fails, so the lane stops on the real cause. `--json` for machine-readable output.
- **`--strict` / `HALTIJA_STRICT=1`** makes the warnings you'd otherwise only *read* into failures:
  cross-project targeting, hidden tab, focus ambiguity. In strict mode a suspect result is **not
  printed to stdout at all** — a script must not consume a value that may be wrong.
- **A tab can report `visible` and still not be painting.** `visibilityState` means "is this tab
  selected", not "is it being composited" — they diverge for occluded windows, offscreen windows
  and a sleeping display. In that state nothing rAF-driven ever renders (React's scheduler, tosijs
  `queueRender`, animations, virtual scrollers) while geometry probes keep returning real numbers,
  so **a missing element is not evidence of an application bug**. `hj doctor` probes
  `requestAnimationFrame` directly and fails with `requestAnimationFrame DID NOT FIRE` — believe it
  and bring a window to the front before you debug the page. If the probe itself can't run, doctor
  reports it as *unchecked*, which is not a pass.
- Gate on **`ready`** (in `/windows` and `/status`), not on the HTTP 200, if you're checking by hand.
- Best of all, don't share: `haltija --private` (with `--app` or `--headless`) gives a lane its own
  isolated server + browser on an ephemeral port that nothing else can adopt.

`hj` also warns on stderr when its version differs from the server's (`hj --version` prints its
own). A mismatched `hj` can route or format wrongly — if you see that warning, believe it before
you spend time debugging the page.

## Live control

```
hj status              # Server running?
hj where               # Which server this shell targets + WHY (--json for structured)
hj windows             # Connected browser tabs?
hj tree                # DOM structure with ref IDs (hj tree -d 5 for deeper)
hj console             # Browser console output
hj click 42            # Click by ref ID
hj click "#submit"     # Click by CSS selector
hj type 10 "hello"     # Type into an input
hj key Enter           # Press a key (hj key s --ctrl for shortcuts)
hj navigate <url>      # Go to a URL (also: hj refresh, hj location)
hj evaluate "document.title"   # Run JS in the page (async OK — see below)
hj screenshot          # Capture the page — PNG default; --format webp|jpeg (smaller), --scale 0.5, --maxWidth 800 (Electron app: automatic; browser: user clicks 🖥 in the widget once to grant screen share)
hj highlight 5 "Look here" / hj unhighlight   # Point things out to the user
hj session-attach <tmux>   # Mirror the agent's terminal in (read-only, opt-in; `session-detach` stops)
hj session-read --follow   #   a page — even on a headset over a tunnel — can watch the agent work
```

**Output convention for read commands.** `hj eval`, `hj call`, `hj fetch`,
`hj location`, `hj query`, `hj inspect`, `hj inspectAll`, `hj find`,
`hj console`, and `hj form` print the result value directly to stdout —
strings verbatim (no JSON escaping of newlines or quotes), objects/arrays
as pretty JSON, no envelope wrapper, no trailing hint line. Errors go to
stderr with a non-zero exit. Pass `--json` to get the full `DevResponse`
envelope (useful when you need `.id` / `.timestamp` / etc.).

**Async code in `hj eval`.** A returned Promise is resolved for you, and
top-level `await` works. Multi-statement code runs as a function body, so it
needs an explicit `return` to produce a value:

```bash
hj eval "document.title"                                 # sync expression
hj eval "await fetch('/api/me').then(r => r.json())"     # top-level await
hj eval "const r = await fetch('/api/me'); return r.status"   # needs `return`
```

The same holds for `"action": "eval"` steps in test JSON.

**Reading forms without DOM walking.** `hj form` extracts all values from a
form (or the first form on the page if no selector given) as a structured
object. Handles inputs, checkboxes, radios, selects, and most framework
components. Add `--include-disabled` / `--include-hidden` for those fields.

**`hj map` — what can I interact with, and what is it wired to?** Usually a better first move than
`hj tree` or a screenshot when you're deciding what to *do*: it's structural, compact (a small page
is a few hundred bytes vs a screenshot's (w×h)/750 vision tokens — ~1.4k for a 1280×800 viewport,
though far less if you cap the size), and deterministic — no fonts,
theme, viewport or animation timing to shift under you.

Always check `source`:

- **`source: "tosi-agent"` — EXPERIMENTAL.** The page exposes an agent surface
  (`globalThis.tosiAgent`, a tosijs app calling `enableAgentInterface()`), so the map is the app's
  **own wiring records**. Treat this tier as best-effort: haltija detects it by duck-typing one
  method and consumes a shape tosijs has not committed to (tosijs#23 asks for a version marker). If
  the shape isn't what haltija expects you get a `warning` saying so — believe it, and fall back to
  the DOM tier rather than trusting an empty map. `agentSurfaceVersion` reports the app's version
  when it provides one. These carry
  what the DOM cannot: which state path each control is bound to and in which direction —
  **`⟷`** two-way (user-writable), **`⟵`** display-only, absent (static) — plus the handler path
  each event calls, and a list of callable `actions`. Prefer acting through those paths rather than
  synthesizing input:
  ```bash
  hj map                                              # see the wiring
  hj eval "tosiAgent.write('app.filter', 'milk')"     # set a ⟷ two-way bound value
  hj eval "tosiAgent.call('app.addItem')"             # invoke an action directly
  ```
  Writing a `⟵` display-only path via the DOM won't stick — the binding will overwrite it. That
  distinction is exactly what saves you from "I typed into it and nothing happened".
- **`source: "dom"`** — any other page, reconstructed from tags/roles/labels/state. Each node has a
  `ref` for `hj click <ref>`. Treat it as an **approximation**: it has *no* binding provenance,
  because the DOM doesn't contain that.

**The schematic is drawn in the page's own colours** — element background as box fill, border as
stroke, text colour for the caption — so a control the user can barely read is a box *you* can
barely read. Poor contrast shows itself. It's machine-checkable too: every DOM-tier node carries
`colors: {fg, bg, contrast, passes}` and a `contrastFail` string when it misses WCAG AA, so you can
list failures instead of eyeballing them. (The verdict itself is drawn in legible red on purpose —
a warning about unreadable text mustn't be unreadable.)

**If a screenshot isn't possible you get a schematic instead, clearly labelled.** In a plain browser
with no desktop app and no screen-share grant, `hj screenshot` returns `source: "schematic"` with a
warning and a red banner burned into the image, rather than failing. Canvases need no permission, so
any `<canvas>` is embedded as **real pixels** inside it — for a 3D app that's the actual content.
Use `--no-fallback` if you need the hard error instead — or `--schematic` to *prefer* the schematic
even when real capture is available (cheaper, deterministic, and it carries the contrast audit).

**A screen-share capture may not be this tab.** On the 🖥 path the user picks what to share and the
grant lasts the session, so a wrong pick returns the wrong surface on *every* later capture. Results
carry `displaySurface` (`browser`/`window`/`monitor`, or `null` meaning **unchecked, not fine**) and
a `warning` for the wrong ones. Seeing that warning, don't reason about layout from the image —
re-pick with 🖥 twice. Full table: `hj api screenshot`.

Map nodes can carry **`smallTarget`** (an interactive control below the WCAG 24×24 minimum) and
**`zeroSize: true`** (operable but occupying no box — the accessible file-input pattern; click its
`<label>`, not the input). Both are spelled out in `hj api map`.

`hj map --image` instead **saves a rasterized schematic PNG and prints only its path** — one labeled
box per control, nested by structure, each showing its handle (`@ref` or `#index`) so the picture is
an index you can glance at and then act on. Sizing and encoding take the same flags as a screenshot:
`--max-width`, `--max-height`, `--format png|webp|jpeg`, `--quality`, `--scale`. Pass `--data-url`
for an inline base64 string, or `--json` if you want the map JSON *and* the image together.

**`nodes` is a TREE; the legend is FLAT.** This bites, so it is worth stating plainly:

- `map.nodes` is nested — a `<ul>` appears with its `<li>` children under `children`, and shadow
  content appears under its host. **You must recurse.** Reading only the top level shows containers
  and none of the affordances inside them.
- Structural containers that are only there for grouping carry **no `@ref`** (nothing to act on), so
  they appear in `nodes` and *not* in the legend.
- The legend is a flat `ref → facts` index of the ref-bearing nodes, which is what makes it useful
  next to the image.

So `nodes` and the legend legitimately contain different sets. Comparing them naively suggests the
map has "lost" elements it has not: a non-recursive read of `nodes` shows the `<ul>` and none of its
`<li>`s, while the legend shows the `<li>`s and no `<ul>`.

**A node with no children is not necessarily an empty element.** The walk stops at four places, and
a childless host reads identically to a genuinely empty one:

| Looks empty because | Can you see inside? |
| --- | --- |
| **Open** shadow root | Yes — traversed since 1.12.0; shadow content sits under its host |
| **Closed** shadow root (`mode:'closed'`) | **No.** Invisible to every script; nothing can pierce it |
| `<iframe>` | Not in `map`. `hj tree` pierces same-origin frames (on by default) |
| `<canvas>`, `<video>`, images | No — there is nothing inside to report |
| `maxNodes` cap (default 400) | Subtrees past it are absent; the map carries `truncated: true` |

When a node looks empty and you expected content: `hj tree` pierces open shadow roots and
same-origin frames **by default** (`--shadow` / `--frames` are on unless you turn them off), and
`hj map --image` at least shows you the box that is there.

**A framed widget is its own window.** Where the page injects haltija into an iframe, that frame
registers separately — `hj windows` lists it with `windowType: "iframe"`, and you drive it with
`--window <id>`. It never becomes the untargeted target: only real tabs do. (Before 1.12.0 a
same-origin frame silently *overwrote* the tab's entry, because both read the same window id out of
the sessionStorage they share — so the tab became unaddressable while still appearing present.)

**`hj tabs` returns its array under `windows`.** The list holds popups and iframes too, not only
tabs — so `windows` is the accurate name. Because the command is `hj tabs`, a `tabs` alias of the
same array is also sent, so the obvious guess works either way.

**Popups are real popups (desktop app).** A page calling `window.open(url, name, 'width=…')` gets a
genuine popup: `window.open()` returns a real `WindowProxy`, the child has `window.opener`, and
`opener.postMessage(...)` reaches the parent. That is what OAuth flows need — an SDK keeps the
returned window to poll `.closed`, and the callback page posts its credential back. `hj windows`
lists it as `windowType: "popup"`, drivable with `--window <id>`, and **it does not take focus**, so
your untargeted commands keep going to the tab you were driving.

An ordinary `<a target="_blank">` (or a featureless `window.open(url, '_blank')`) still opens as a
**tab** in the app's tab strip — that is deliberate, not a bug. Before 1.12.1 every non-auth
`window.open` was re-opened as a tab with the opener severed, so it returned `null` and OAuth popups
could never complete.

**`hj map --image` writes a LEGEND beside the image.** stdout stays a bare path; stderr names the
sibling `*.legend.json`, mapping every `@ref` on the picture to what it is. The image says *where*
and *which*; the legend says *what* — so a 16×16 icon button draws just its ref, and you look it up.

`--image` **replaces** the JSON on stdout, it doesn't add to it. Vision cost scales with **pixels**
(~`w×h/750` for Claude) with no fixed floor — a 491×480 schematic is ~314 tokens, `--max-width 200`
makes it ~52. Don't guess: the response carries `cost.approxJsonTokens` and `cost.approxImageTokens`
for this page, and `hj map --image` prints both on stderr. Prefer that measured pair to any rule of
thumb, including this one.

**Seeing a `<canvas>` (3D scenes, render-to-texture UI).** Use `--canvas <selector>` to read the
canvas's own pixels instead of capturing the screen:

```bash
hj screenshot --canvas "#scene"              # saves a PNG, returns the path
hj screenshot --canvas "canvas" --scale 0.5  # same resize/format flags as a screenshot
```

This is the right tool for a WebGL scene (Babylon/three.js) or a UI rendered into a texture:
**exact pixels at native resolution, no screen-share grant, no desktop app required**, and it works
even when the canvas is scrolled out of view or the tab isn't frontmost.

One caveat it handles for you: a WebGL context clears its drawing buffer after compositing unless
created with `{ preserveDrawingBuffer: true }`, so a naive capture can come back **blank with no
error**. Haltija samples the pixels and returns a `warning` saying so (with the fix) rather than
handing you an empty picture — if you see that warning, capture inside the rAF callback that
draws, or set `preserveDrawingBuffer`. A canvas tainted by cross-origin textures gives a clear
error naming CORS, not a crash.

**Target by visible text, not by class.** Every `selector` argument accepts haltija's text
pseudo-selectors, so you don't have to reverse-engineer someone's class names (which break the
moment they restyle):

```bash
hj click 'button:text(sign in)'      # contains, case-insensitive
hj click 'button:text-is(Save)'      # exact match
hj click 'a:text(/docs|blog/i)'      # regex
hj click '.menu :has-text("Edit")'   # Playwright-compatible alias for :text()
```

Prefer these (or `[data-testid=…]`, or a ref ID from `hj tree`) over structural selectors like
`.some-lib-menu-item > div:nth-child(2)`. Works everywhere a selector is accepted — `click`,
`type`, `query`, `inspect`, `tree`, and test JSON.

**When several elements match, the one you can ACT on wins.** A `display:none` duplicate that
happens to come first in the DOM no longer beats the visible copy, and neither does one parked
off-canvas (`position:absolute; left:-9999px` — the skip-link idiom, which has a perfectly normal
box and used to be clicked *silently*). `find` and `click` share one predicate, so they always
agree about which element a text selector means. If the only match is off-canvas, `click` fails
with `positioned off-canvas` rather than actuating something invisible and reporting success.
Content merely **below the fold** is still fine — visible means *rendered*, not *on screen*.

## Targeting a specific tab — and trusting the warnings

An untargeted command drives the **focused** tab. On a shared server that's the whole point, but
it means a command can land on a tab you didn't mean, or one that's asleep. `hj windows` lists
every connected tab with its `id`, url, and a `hidden` flag. To pin a command to one tab, pass
`--window <id>` — it works in **either** position:

```bash
hj windows                              # list tabs; note the id you want
hj --window w2 eval "document.title"    # leading form
hj eval "document.title" --window w2    # trailing form — both work
```

**Heed the stderr warnings** — they exist so the tool never hands you a plausible-but-wrong answer.
Two can appear on an untargeted command:

- **Hidden tab.** The tab that answered is backgrounded, minimized, or the display is asleep, so
  rAF-mounted content may never have run — an empty selector means "not mounted yet," **not**
  "broken." Front the tab, or pin a visible one with `--window <id>`.
- **Focus ambiguity.** Nothing pinned the command and this server has tabs from several origins,
  so *focus* chose which answered — not your working directory. Re-run with `--window <id>` from
  the list the warning prints.

## Watching what the page does

```bash
hj events-watch interactive   # start aggregating semantic events; hj events to read them
hj events                              # "user typed 'x'", not 18 keydowns
hj mutations-watch                     # DOM changes (added/removed/changed), debounced
hj network-watch                       # XHR/fetch traffic; hj network to read, hj network-stats to summarize
hj console                             # console output + uncaught errors and rejections
```

Use these when "did my click actually do anything?" matters: watch, act, then read. `hj click`/`hj
type` also accept `--diff` to return a semantic before/after diff of that single action.

## Multiple tabs

```bash
hj windows                    # list tabs (id, url, hidden)
hj tabs-open <url>            # open a tab (desktop app; elsewhere it warns it can't be controlled)
hj tabs-focus <id>            # point untargeted commands at a tab (server-side; never times out)
hj tabs-close <id>            # close a tab
hj <cmd> --window <id>        # pin ONE command to a tab, either position
```

## Recording a flow into a test

```bash
hj recording-start "my-flow"   # perform the actions in the browser…
hj recording-stop
hj recording-generate          # emits test JSON — then swap brittle selectors for text/testid ones
```

## Writing & running regression tests

Tests are JSON files in a directory, run **alphabetically** (numeric prefixes order them:
`00-…`, `01-…`).

```bash
# Server must be up (bunx haltija@latest), plus whatever the app under test needs.
hj test-suite path/to/tests            # run every test in a directory
hj test-run path/to/tests/01-login.json   # run a single test
```

URLs come from template variables (`${APP_URL}` etc.) so the same tests run against local
dev and CI — set them in the environment when invoking. A common convention: keep fast
**render-only** tests (no auth/data) separate from full e2e tests (which need a backend /
seeded data) so the render set can run as a quick gate.

### Test format

```json
{
  "version": 1,
  "name": "Login renders and submits",
  "description": "What this verifies and any preconditions",
  "steps": [
    { "action": "navigate", "url": "${APP_URL}/login", "description": "Go to login" },
    { "action": "wait", "forElement": "input[type='email']", "timeout": 10000, "description": "Wait for form" },
    { "action": "type", "selector": "input[type='email']", "text": "a@b.com", "description": "Enter email" },
    { "action": "click", "selector": "button:has-text(\"Sign in\")", "description": "Submit" },
    { "action": "assert", "assertion": { "type": "url", "pattern": "/dashboard" }, "description": "On dashboard" }
  ]
}
```

- **Step actions.** The ones you need constantly:

<!-- GENERATED:step-actions -->
<!-- Do not edit by hand — see src/test-actions.ts -->
`navigate` — url; `click` — selector or ref; `type` — selector/ref, text, clear, paste, humanlike; `key` — key, selector, modifiers; `wait` — duration, selector, forWindow, url; `assert` — assertion — exists, visible, hidden, text, value, attribute, url; `eval` — code.

Also available (see [CI integration](../../../../docs/CI-INTEGRATION.md#test-step-actions)): `check`, `select-text`, `cut`, `copy`, `paste`, `drag`, `verify`, `tabs-open`, `tabs-close`, `tabs-focus`.
<!-- END:step-actions -->

  **`select` is deprecated — use `select-text`.** It still runs, and a step that uses it now comes
  back with a `warning` naming the replacement (shown in the test report, and on `step.warning` in
  `--json`). `select` is being freed to mean what everyone expects — pick an option from a
  `<select>` — which haltija cannot do yet; until then, set one with an `eval` step.

  **An HTTP endpoint existing does NOT make it a step.** `hj api` documents the REST surface, which
  is a superset — `/drag` was documented there for releases while the runner had no `drag` case, so
  a reasonable-looking suite failed with `Unsupported step action: drag`. `hj test validate` rejects
  an unknown action (with a "did you mean") before the suite runs.
- **Assertion types:** `exists`, `visible`, `hidden`, `text`, `value`, `attribute`, `url`.
- **Selectors — prefer user-centric:** `button:has-text("Submit")`, `a:has-text("Settings")`,
  `input[type='email']`, `[data-testid='user-menu']`. Avoid brittle structural selectors.

### Record-then-clean

```bash
hj recording start "my-test"   # perform the actions in the browser…
hj recording stop
hj recording generate          # emits JSON — then swap brittle selectors for text/testid ones
```

## File upload / download

Driving `<input type=file>` and capturing downloads aren't supported yet. The OS
file-picker mechanics aren't usually what you're testing, so **fake the file I/O**: use an
`hj evaluate` / JS-execution step to inject the data the file would have provided (e.g. call
the app's import handler with inline content, or set the value a handler reads), then assert
on the resulting UI/state.

## Troubleshooting

- `hj status` / `hj windows` — confirm the server is up and a tab is connected.
- Restart clean: `bunx haltija@latest -f`.
- `hj console` — surfaces page errors, including **uncaught exceptions and unhandled promise
  rejections** (not just `console.error` calls), with Error messages + stacks intact. Capture
  begins at widget injection, so errors thrown before that are only caught in the desktop app
  (which injects at document-start).
- **Only tabs with the widget injected are controllable — and only those appear in `hj tabs`.**
  A page controls itself only if it loads the haltija widget (the desktop app auto-injects; a
  normal browser needs the bookmarklet, a `<script src=".../component.js">`, or the project's
  own opt-in like `HALTIJA_DEV=1` / `haltijaDev:true`). A tab **without** the widget is invisible
  to the server, so it never shows up in `hj tabs` and commands can't reach it — they silently go
  to the focused widget tab, which looks like a routing bug. `hj tabs open <url>` outside the
  desktop app hits exactly this: it returns `fallback: true` + a warning saying the new tab is
  client-less. If a page you opened isn't responding, first check it actually injected the widget.
