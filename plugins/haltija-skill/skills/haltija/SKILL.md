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

**When a command seems to hit the wrong page, run `hj where` first.** It tells you the port,
*why* that port was chosen, and what's alive there. Override with `--port <n>` or `--name <foo>`.
When several haltijas are running (e.g. a project server **and** the desktop app), **`hj servers`**
lists them all — port, name, version, tabs, which is the desktop app — with `▸` on the one you'd
drive. The desktop app is reachable as `hj --name desktop`.

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
