# E2E Testing with Haltija in CI

Run browser tests in GitHub Actions using Haltija instead of Playwright. Your tests talk to a real Electron browser via REST — same engine your users run, no headless quirks.

## How It Works

```
CI Runner (ubuntu-latest)
├── xvfb (virtual display)
├── Electron app (real Chromium + auto-injected widget)
├── Haltija server (localhost:8700, embedded in Electron)
└── Your tests (curl / fetch / any HTTP client)
```

Tests are JSON files. The test runner (`POST /test/run`) executes each step in the browser and reports pass/fail with context. No test framework required — just HTTP.

## Minimal GitHub Actions Workflow

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install & build Haltija
        run: |
          bun install
          bun run build

      - name: Install Electron display deps
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb libnss3 libatk1.0-0 libatk-bridge2.0-0 \
            libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
            libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2

      - name: Launch Haltija
        run: |
          cd apps/desktop && npm install --omit=dev
          xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" npx electron . &

      - name: Wait for ready
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:8700/status > /dev/null 2>&1 && break
            sleep 1
          done
          # Wait for browser widget to connect
          for i in $(seq 1 30); do
            [ "$(curl -sf http://localhost:8700/windows | jq '.windows | length')" -gt 0 ] && break
            sleep 1
          done

      - name: Run tests
        run: |
          curl -sf -X POST http://localhost:8700/test/run \
            -H "Content-Type: application/json" \
            -d @tests/my-test.json | tee result.json
          jq -e '.passed' result.json
```

## Writing Test JSON

A test is a JSON file with a name and a list of steps:

```json
{
  "version": 1,
  "name": "Login flow",
  "description": "Verify email/password login redirects to dashboard",
  "url": "http://localhost:3000",
  "steps": [
    {
      "action": "navigate",
      "url": "http://localhost:3000/login",
      "description": "Go to login page"
    },
    {
      "action": "type",
      "selector": "#email",
      "text": "user@example.com",
      "description": "Enter email"
    },
    {
      "action": "type",
      "selector": "#password",
      "text": "secret123",
      "description": "Enter password"
    },
    {
      "action": "click",
      "selector": "button[type=submit]",
      "description": "Submit login form",
      "purpose": "Should redirect to dashboard on success"
    },
    {
      "action": "wait",
      "selector": ".dashboard",
      "description": "Wait for dashboard to render"
    },
    {
      "action": "assert",
      "assertion": { "type": "url", "pattern": "/dashboard" },
      "description": "URL is now /dashboard"
    },
    {
      "action": "assert",
      "assertion": { "type": "text", "selector": ".welcome", "text": "Welcome", "contains": true },
      "description": "Welcome message visible"
    }
  ]
}
```

### Step Types

| Action | Required Fields | What It Does |
|--------|----------------|--------------|
| `navigate` | `url` | Load a URL |
| `click` | `selector` | Click an element |
| `type` | `selector`, `text` | Type text into an input (clears first by default) |
| `key` | `key` | Press a key (e.g. `"Enter"`, `"Escape"`, `"Tab"`) |
| `wait` | `selector` or `duration` | Wait for element to appear or fixed ms |
| `assert` | `assertion` | Check a condition (fails the step if false) |
| `eval` | `code` | Run JavaScript, optionally check return value with `expect` |
| `verify` | `eval`, `expect` | Poll an expression until it matches (for async state) |

### Assertion Types

```json
{"type": "exists", "selector": ".modal"}
{"type": "not-exists", "selector": ".error"}
{"type": "text", "selector": "h1", "text": "Dashboard"}
{"type": "text", "selector": "p", "text": "welcome", "contains": true}
{"type": "value", "selector": "#email", "value": "user@example.com"}
{"type": "visible", "selector": "#tab-content"}
{"type": "hidden", "selector": ".loading-spinner"}
{"type": "url", "pattern": "/dashboard"}
{"type": "title", "pattern": "My App"}
{"type": "console-contains", "text": "Error", "level": "error"}
{"type": "eval", "code": "document.cookies.length > 0", "expected": true}
```

### Step Metadata

Every step supports optional metadata that improves failure messages:

```json
{
  "action": "click",
  "selector": "#checkout-btn",
  "description": "Click checkout button",
  "purpose": "Initiates payment flow — button may be disabled if cart is empty",
  "delay": 500
}
```

- `description`: What the step does (shown in results)
- `purpose`: Why it matters (shown on failure — helps agents and humans understand intent)
- `delay`: Ms to wait before executing this step

## Running Tests

### Single test

```bash
curl -X POST http://localhost:8700/test/run \
  -H "Content-Type: application/json" \
  -d @tests/login.json
```

Response:
```json
{
  "test": "Login flow",
  "passed": true,
  "duration": 2340,
  "steps": [
    {"index": 0, "passed": true, "duration": 120, "description": "Go to login page"},
    {"index": 1, "passed": true, "duration": 85, "description": "Enter email"},
    ...
  ],
  "summary": {"total": 7, "executed": 7, "passed": 7, "failed": 0}
}
```

### Test suite (multiple tests)

```bash
curl -X POST http://localhost:8700/test/suite \
  -H "Content-Type: application/json" \
  -d '{
    "tests": [
      '$(cat tests/login.json)',
      '$(cat tests/checkout.json)'
    ]
  }'
```

Or build a suite file:
```json
{
  "tests": [
    { "version": 1, "name": "Login", "url": "...", "steps": [...] },
    { "version": 1, "name": "Checkout", "url": "...", "steps": [...] }
  ],
  "stopOnFailure": false
}
```

### Runner options

Pass these alongside `test` (or at suite level):

| Option | Default | Description |
|--------|---------|-------------|
| `timeout` | 5000 | Per-step timeout in ms |
| `stepDelay` | 100 | Ms between steps |
| `stopOnFailure` | true (run) / false (suite) | Stop on first failure |
| `format` | `"json"` | Output: `"json"`, `"github"`, `"human"` |
| `patience` | 0 | Total step failures allowed before bailing (0 = classic mode) |
| `patienceStreak` | 2 | Consecutive failures to bail immediately |
| `timeoutBonusMs` | 1000 | Ms added to step timeout on success, removed on failure (capped at initial) |

## The Patience Model

By default, the runner stops on the first failure (`stopOnFailure: true`). For CI where timing can be flaky, the patience model is more resilient:

```bash
curl -X POST http://localhost:8700/test/run \
  -H "Content-Type: application/json" \
  -d '{
    "test": ...,
    "patience": 5,
    "patienceStreak": 3,
    "timeout": 8000,
    "timeoutBonusMs": 2000
  }'
```

How it works:
- **`patience: 5`** — up to 5 steps can fail before the test bails
- **`patienceStreak: 3`** — 3 failures *in a row* bails immediately (something is broken, not flaky)
- **`timeout: 8000`** — initial per-step timeout
- **`timeoutBonusMs: 2000`** — each success adds 2s to the timeout (rewarding a responsive app), each failure removes 2s (giving up faster on a stuck app). Never exceeds the initial timeout.

The result includes patience stats:
```json
{
  "passed": false,
  "patience": {
    "allowed": 5,
    "streak": 3,
    "failures": 3,
    "consecutiveFailures": 3,
    "remaining": 2,
    "finalTimeoutMs": 4000
  }
}
```

This is useful for long test suites against apps with variable load times — the runner adapts instead of using fixed waits everywhere.

## Output Formats

### `format: "json"` (default)

Structured data for programmatic use. Parse with `jq` in shell scripts or consume directly from code.

### `format: "github"`

Produces GitHub Actions annotations that show inline on PRs:

```bash
RESULT=$(curl -sf -X POST http://localhost:8700/test/run \
  -H "Content-Type: application/json" \
  -d '{"test": ..., "format": "github"}')

# Annotations go to stdout (GitHub picks them up)
echo "$RESULT" | sed -n '1,/---SUMMARY---/p' | head -n -2

# Summary goes to step summary
echo "$RESULT" | sed -n '/---SUMMARY---/,$p' | tail -n +2 >> $GITHUB_STEP_SUMMARY
```

### `format: "human"`

Colored terminal output with pass/fail symbols. Good for local development.

## Testing Your Own App

To test an app that isn't the Haltija home page, navigate to it first:

```json
{
  "version": 1,
  "name": "My app checkout",
  "url": "http://localhost:3000",
  "steps": [
    {"action": "navigate", "url": "http://localhost:3000/shop"},
    {"action": "click", "selector": ".product:first-child .add-to-cart"},
    {"action": "click", "selector": "#cart-icon"},
    {"action": "assert", "assertion": {"type": "text", "selector": ".cart-count", "text": "1"}}
  ]
}
```

In CI, start your app before Haltija:

```yaml
- name: Start app
  run: |
    npm run build
    npm start &
    # Wait for app
    for i in $(seq 1 30); do
      curl -sf http://localhost:3000 > /dev/null 2>&1 && break
      sleep 1
    done

- name: Launch Haltija
  run: |
    cd apps/desktop && npm install --omit=dev
    xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" npx electron . &

- name: Wait for Haltija
  run: |
    for i in $(seq 1 30); do
      curl -sf http://localhost:8700/status > /dev/null 2>&1 && break
      sleep 1
    done
    for i in $(seq 1 15); do
      [ "$(curl -sf http://localhost:8700/windows | jq '.windows | length')" -gt 0 ] && break
      sleep 1
    done

- name: Run tests
  run: |
    curl -sf -X POST http://localhost:8700/test/run \
      -H "Content-Type: application/json" \
      -d @tests/checkout.json | tee result.json
    jq -e '.passed' result.json
```

## Debugging Failures

### Screenshot on failure

```yaml
- name: Capture failure state
  if: failure()
  run: |
    curl -sf http://localhost:8700/screenshot > /tmp/failure-screenshot.json
    curl -sf http://localhost:8700/console > /tmp/console-logs.json
    curl -sf -X POST http://localhost:8700/snapshot \
      -H "Content-Type: application/json" \
      -d '{"trigger": "ci-failure"}' > /tmp/failure-snapshot.json

- name: Upload artifacts
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: failure-debug
    path: /tmp/failure-*.json
    retention-days: 7
```

### What's in the snapshot?

The `/snapshot` endpoint captures DOM tree, console output, and viewport state — everything you need to understand what the browser was showing when the test failed. Download the artifact and inspect it locally, or pass it to an agent for analysis.

### Console logs

```bash
# Check for errors during test run
curl -sf http://localhost:8700/console | jq '.entries[] | select(.level == "error")'
```

### DOM tree at point of failure

```bash
# See what's on the page right now
curl -sf -X POST http://localhost:8700/tree \
  -H "Content-Type: application/json" \
  -d '{"depth": 3}'
```

## Tab Isolation

Each test navigates to its own URL, but if you need parallel isolation, use tabs:

```bash
# Open a fresh tab
WINDOW=$(curl -sf -X POST http://localhost:8700/tabs/open \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000"}' | jq -r '.data.windowId')

# Run commands in that tab
curl -sf -X POST "http://localhost:8700/click?window=$WINDOW" \
  -H "Content-Type: application/json" \
  -d '{"selector": "#submit"}'

# Close when done
curl -sf -X POST http://localhost:8700/tabs/close \
  -H "Content-Type: application/json" \
  -d "{\"window\": \"$WINDOW\"}"
```

## Platform Notes

### Linux (GitHub Actions default)

Requires `xvfb` for a virtual display and Electron's shared library dependencies:

```bash
sudo apt-get install -y xvfb libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
```

Launch with:
```bash
xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" npx electron . &
```

### macOS

No xvfb needed — macOS runners have a display:
```bash
npx electron . &
```

### Windows

```powershell
Start-Process npx -ArgumentList "electron", "." -WorkingDirectory "apps/desktop"
```

## Tips

- **Start simple**: One test file, a few steps. Add more once the pipeline is green.
- **Use `purpose`** on steps that might fail — it makes the failure output actionable.
- **Use patience for flaky environments**: `patience: 3` handles occasional CI slowness without masking real bugs.
- **Keep step timeouts reasonable**: 5-8s for normal interactions, 15-30s for page loads or heavy operations.
- **Navigate explicitly**: Don't rely on the Haltija home page being loaded. Start each test with a `navigate` step.
- **Check console logs**: If a test fails unexpectedly, the browser console often has the answer.
- **Upload artifacts always**: The snapshot is cheap and invaluable when debugging a failure you can't reproduce locally.

## API Quick Reference

```bash
# Health / readiness
GET  /status                       # Server up?
GET  /windows                      # Browser connected?

# Navigation
POST /navigate  {"url": "..."}     # Go to URL
GET  /location                     # Current URL + title

# Interaction
POST /click     {"selector": "..."} 
POST /type      {"selector": "...", "text": "..."}
POST /key       {"key": "Enter"}

# Inspection
POST /tree      {"depth": 3}       # DOM tree with ref IDs
POST /query     {"selector": "..."} # Find element details

# Testing
POST /test/run  {"test": {...}}    # Run one test
POST /test/suite {"tests": [...]}  # Run multiple tests

# Debugging
GET  /console                      # Browser console output
POST /screenshot                   # Page capture (base64 PNG)
POST /snapshot                     # Full debug state dump

# Tabs
POST /tabs/open  {"url": "..."}    # New tab
POST /tabs/close {"window": "..."}  # Close tab
```

## Real-World Examples

See the test files in this repo:

- [`tests/playground.json`](../tests/playground.json) — Clicks, typing, dropdowns, checkboxes
- [`tests/homepage.json`](../tests/homepage.json) — Tab switching, element visibility, eval assertions
- [`tests/xinjs-spa.json`](../tests/xinjs-spa.json) — External SPA navigation and structure checks
- [`.github/workflows/test-qa.yml`](../.github/workflows/test-qa.yml) — The CI workflow that runs them
