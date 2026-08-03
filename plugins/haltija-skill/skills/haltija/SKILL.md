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
  See [CI integration](../../../docs/CI-INTEGRATION.md) → "Which engine?".

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

**Both diagnostics report what routing will actually do.** `hj where` and `hj doctor` each print an
`origins:` line — what you declared, where the declaration was found, and which connected window it
resolves to (or that none matches yet, so commands still follow focus). A `.haltija.json` that
parses but declares **no usable origins** silently turns per-tab routing off — the exact problem it
was added to fix — so `hj doctor` now **fails** on it (exit 1) and names the file. Trust that line:
"configured" and "working" are different states and it distinguishes them.

**Waiting.** `hj wait 500` delays; `hj wait ".modal" --timeout 5000` polls until the element is
visible and **exits non-zero on timeout** — so a CI lane stops on the real cause. `--hidden` waits
for it to disappear. Passing neither a delay nor a selector is an error, not a no-op: a wait that
returns success without waiting makes every assertion after it race the page.

**When a command seems to hit the wrong page, run `hj where` first.** It tells you the port,
*why* that port was chosen, and what's alive there. Override with `--port <n>` or `--name <foo>`.
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
  you chose explicitly) → tabs aren't all hidden → versions aligned. **Non-zero exit** when any of
  those fails, so the lane stops on the real cause. `--json` for machine-readable output.
- **`--strict` / `HALTIJA_STRICT=1`** makes the warnings you'd otherwise only *read* into failures:
  cross-project targeting, hidden tab, focus ambiguity. In strict mode a suspect result is **not
  printed to stdout at all** — a script must not consume a value that may be wrong.
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
is a few hundred bytes vs ~1–1.5k vision tokens for a screenshot), and deterministic — no fonts,
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

Nodes can carry **`zeroSize: true`** — a control that works but occupies no box (the accessible
file-input / custom-checkbox pattern: a 0x0 `<input>` operated through its `<label>`). Click the
label, not the input; the input's coordinates mean nothing. Anything genuinely hidden is left out
altogether, so `zeroSize` always means *operable but invisible* — never *not there*.

`hj map --image` instead **saves a rasterized schematic PNG and prints only its path** — one labeled
box per control, nested by structure, each showing its handle (`@ref` or `#index`) so the picture is
an index you can glance at and then act on. Sizing and encoding take the same flags as a screenshot:
`--max-width`, `--max-height`, `--format png|webp|jpeg`, `--quality`, `--scale`. Pass `--data-url`
for an inline base64 string, or `--json` if you want the map JSON *and* the image together.

Three things to know:

- **`--image` replaces the JSON on stdout; it doesn't add to it.** Before 1.12.0 it printed the
  whole map *plus* the image metadata and path, so it was strictly more expensive than plain
  `hj map` (measured: 5,910 chars vs 5,447) — the flag whose purpose is to be cheaper could never
  pay off. It now prints one line, and the size/format/cost summary goes to **stderr**, so stdout
  stays a bare path you can hand straight to a file read.
- It must be a bitmap to be worth it. An image of text costs a vision encoder far fewer tokens than
  the same text tokenized — but that's true of the **rendered pixels**, not of SVG markup (which is
  just text tokens, and worse than the JSON).
- **The win is density-dependent, so check before spending it — and use the right number.** An image
  costs ~1000-1600 vision tokens no matter how little it contains, so for a small page the JSON map
  is cheaper. `cost.approxJsonTokens` measures the **compact** JSON; anything that pretty-prints it
  (including `hj map`) emits roughly 1.8x more, so treat that field as a lower bound. `hj map
  --image` prints the measured comparison for that page on stderr — prefer it over estimating. The
  schematic is also worth rendering for a human: it's deterministic, so a diff between two runs is a
  regression you can see.

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

**Heed the stderr warnings — they exist because the tool must not hand you a plausible-but-wrong
answer.** Two can appear on an untargeted command:

- **Hidden tab.** The tab that answered reports it is hidden (backgrounded, minimized, or the
  display is asleep). Browsers freeze `requestAnimationFrame` and throttle timers there, so
  anything mounted by rAF/IntersectionObserver may never have run — an empty selector means "not
  mounted yet," **not** "broken." Bring the tab to the front or target a visible one with
  `--window <id>` before concluding anything is wrong.
- **Focus ambiguity.** The command wasn't pinned and this server has tabs from more than one
  origin, so *focus* — not your working directory — chose which tab answered. If you meant a
  different page (another project's tab on a shared server), re-run pinned with `--window <id>`
  from the list the warning prints.

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

- **Common actions:** `navigate` (`url`), `wait` (`ms`, or `selector`/`forElement` + `timeout`),
  `click` (`selector`), `type` (`selector`,`text`), `key`, `drag` (`selector`,`deltaX`,`deltaY`),
  `select`, `assert`, `screenshot`. See `hj api` for the complete list.
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
