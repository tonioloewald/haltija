# E2E Testing with Haltija in CI

Run browser tests in GitHub Actions using Haltija. Your tests run against a real Electron browser — same engine your users run, no headless quirks.

## Quick Start

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install Haltija
        run: bun install && bun run build

      - name: Install display deps
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb libnss3 libatk1.0-0 libatk-bridge2.0-0 \
            libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
            libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64

      - name: Launch Haltija
        run: |
          cd apps/desktop && npm install --omit=dev
          xvfb-run --auto-servernum npx electron . &
          # Wait for ready
          until hj status 2>/dev/null | grep -q '"ok":true'; do sleep 1; done

      - name: Run tests
        run: hj test-run tests/my-test.json
```

## The hj CLI

The `hj` command is the simplest way to interact with Haltija:

```bash
# Check status
hj status

# See the page
hj tree

# Interact
hj click "#submit"
hj type "#email" user@example.com
hj key Enter

# Run tests
hj test-run tests/login.json
hj test-suite tests/           # Run all tests in directory
```

Run `hj --help` for all commands. The CLI auto-starts the server if needed.

## Writing Tests

Tests are JSON files with steps:

```json
{
  "version": 1,
  "name": "Login flow",
  "url": "http://localhost:3000/login",
  "steps": [
    {"action": "type", "selector": "#email", "text": "user@example.com"},
    {"action": "type", "selector": "#password", "text": "secret123"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "wait", "selector": ".dashboard"},
    {"action": "assert", "assertion": {"type": "url", "pattern": "/dashboard"}}
  ]
}
```

### Step Types

| Action | Example | What It Does |
|--------|---------|--------------|
| `navigate` | `{"action": "navigate", "url": "..."}` | Load a URL (waits for reconnect) |
| `click` | `{"action": "click", "selector": "#btn"}` | Click element |
| `type` | `{"action": "type", "selector": "#input", "text": "..."}` | Type text (realistic keystrokes) |
| `type` (paste) | `{"action": "type", "selector": "#input", "text": "...", "paste": true}` | Paste text (fast, React-compatible) |
| `check` | `{"action": "check", "selector": "#agree"}` | Toggle checkbox/radio |
| `key` | `{"action": "key", "key": "Enter"}` | Press key |
| `wait` | `{"action": "wait", "selector": ".loaded"}` | Wait for element |
| `assert` | `{"action": "assert", "assertion": {...}}` | Check condition |
| `eval` | `{"action": "eval", "code": "..."}` | Run JavaScript (auto-awaits promises) |
| `verify` | `{"action": "verify", "eval": "...", "expect": {...}}` | Poll until expression matches |
| `tabs-open` | `{"action": "tabs-open", "url": "..."}` | Open a new tab |
| `tabs-close` | `{"action": "tabs-close", "window": "id"}` | Close a tab |
| `tabs-focus` | `{"action": "tabs-focus", "window": "id"}` | Focus a tab |

### Text Selectors

All selectors support custom pseudo-selectors for finding elements by visible text — no need to hunt for CSS classes or test IDs:

```json
{"action": "click", "selector": "button:text(sign in)"}
{"action": "click", "selector": "a:text(forgot password)"}
{"action": "wait", "selector": "h1:text-is(Dashboard)"}
```

| Syntax | Behavior |
|--------|----------|
| `:text(str)` | Contains `str` (case-insensitive) |
| `:text-is(str)` | Exact text match (case-insensitive) |
| `:has-text(str)` | Alias for `:text()` |
| `:text(/regex/)` | Regex match (case-sensitive) |
| `:text(/regex/i)` | Regex match (case-insensitive) |

Combine with CSS selectors to narrow scope: `nav a:text(home)`, `form button:text(/submit/i)`.

### Assertions

```json
{"type": "exists", "selector": ".modal"}
{"type": "not-exists", "selector": ".error"}
{"type": "text", "selector": "h1", "text": "Welcome"}
{"type": "url", "pattern": "/dashboard"}
{"type": "visible", "selector": "#content"}
```

### Step Metadata

Add context to improve failure messages:

```json
{
  "action": "click",
  "selector": "#checkout",
  "description": "Click checkout button",
  "purpose": "Button may be disabled if cart is empty"
}
```

## Running Tests

### Single test
```bash
hj test-run tests/login.json
```

### Multiple tests
```bash
hj test-suite tests/
```

### With options
```bash
# JSON output (default)
hj test-run tests/login.json

# Human-readable output
hj test-run tests/login.json --format human

# GitHub Actions annotations
hj test-run tests/login.json --format github
```

## Handling Flaky Tests

Use the patience model for CI environments with variable timing:

```json
{
  "test": {...},
  "patience": 5,
  "patienceStreak": 3,
  "timeout": 8000
}
```

- `patience: 5` — allow up to 5 step failures before bailing
- `patienceStreak: 3` — 3 consecutive failures bails immediately
- `timeout: 8000` — per-step timeout in ms

## Debugging Failures

### Capture state on failure
```yaml
- name: Debug info
  if: failure()
  run: |
    hj screenshot > failure-screenshot.json
    hj console > console-logs.json
    hj snapshot > failure-state.json

- uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: debug
    path: "*.json"
```

### Check what's on the page
```bash
hj tree                    # DOM structure
hj console                 # Browser console
hj screenshot              # Visual capture
```

## Platform Notes

### Linux (GitHub Actions)
Requires xvfb and Electron dependencies:
```bash
sudo apt-get install -y xvfb libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64

xvfb-run --auto-servernum npx electron . &
```

### macOS
No xvfb needed:
```bash
npx electron . &
```

## Testing Your Own App

Start your app before running tests:

```yaml
- name: Start app
  run: |
    npm start &
    until curl -sf http://localhost:3000 > /dev/null; do sleep 1; done

- name: Run tests
  run: hj test-run tests/app-tests.json
```

## Tips

- **Start simple** — one test, few steps, then expand
- **Use `purpose`** on steps that might fail — explains intent on failure
- **Navigate explicitly** — don't rely on default page state
- **Upload artifacts** — screenshots and snapshots are invaluable for debugging
- **Port conflicts** — `bunx haltija` auto-kills any existing process on port 8700, so you can restart cleanly without manual cleanup

## REST API

For direct HTTP integration (scripts, other languages), see [REST-API.md](REST-API.md).

## Examples

See test files in this repo:
- [`tests/playground.json`](../tests/playground.json)
- [`tests/homepage.json`](../tests/homepage.json)
- [`.github/workflows/test-qa.yml`](../.github/workflows/test-qa.yml)
