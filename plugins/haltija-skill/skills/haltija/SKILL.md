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

## Live control

```
hj status              # Server running?
hj windows             # Connected browser tabs?
hj tree                # DOM structure with ref IDs (hj tree -d 5 for deeper)
hj console             # Browser console output
hj click 42            # Click by ref ID
hj click "#submit"     # Click by CSS selector
hj type 10 "hello"     # Type into an input
hj key Enter           # Press a key (hj key s --ctrl for shortcuts)
hj navigate <url>      # Go to a URL (also: hj refresh, hj location)
hj evaluate "document.title"   # Run JS in the page (prints the result verbatim; pass --json for the full DevResponse)
hj screenshot          # Capture the page
hj highlight 5 "Look here" / hj unhighlight   # Point things out to the user
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
- `hj console` — surfaces page errors.
