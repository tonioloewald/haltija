# E2E Testing with Haltija in CI

Run browser tests in GitHub Actions using Haltija. Your tests run against a real Electron browser — same engine your users run, no headless quirks.

## Quick Start (Using npm package)

For most projects, install Haltija as a dev dependency and run tests against your app:

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb jq libnss3 libatk1.0-0 libatk-bridge2.0-0 \
            libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
            libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64

      - name: Start your app
        run: |
          npm start &
          until curl -sf http://localhost:3000 > /dev/null; do sleep 1; done

      - name: Launch Haltija
        run: |
          export PATH="$HOME/.local/bin:$PATH"
          xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" \
            bunx haltija@latest --ci &
          
          # --ci mode waits for server + browser to be ready
          # and sets ELECTRON_DISABLE_SANDBOX automatically

      - name: Run tests
        run: |
          export PATH="$HOME/.local/bin:$PATH"
          hj navigate http://localhost:3000
          hj test-run tests/my-test.json
```

The `--ci` flag is a convenience mode that:
- Launches the Electron app (same browser your users run)
- Sets `ELECTRON_DISABLE_SANDBOX=1` automatically (required in containers)
- Waits for server + browser to be fully ready
- Reports clear errors if startup fails

Use with `xvfb-run` on Linux to provide a virtual display for Electron.

## System Dependencies

### Required packages (Ubuntu/Debian)

```bash
sudo apt-get install -y xvfb jq libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64
```

| Package | Purpose |
|---------|---------|
| `xvfb` | Virtual framebuffer (required for headless display) |
| `jq` | JSON parsing in shell scripts |
| `libnss3`, `libatk*`, etc. | Chromium/Electron runtime dependencies |

### Bun setup

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: latest
```

## Environment Variables

| Variable | Purpose | When needed |
|----------|---------|-------------|
| `ELECTRON_DISABLE_SANDBOX` | Disable Electron sandbox | Containers, some CI environments |
| `PATH` | Include `~/.local/bin` for `hj` CLI | When using `hj` commands |

Example:
```yaml
env:
  ELECTRON_DISABLE_SANDBOX: 1
run: |
  export PATH="$HOME/.local/bin:$PATH"
  hj tree
```

## Launch Options

### Option 1: CI mode (recommended)

```bash
xvfb-run --auto-servernum bunx haltija@latest --ci &
```

This is the simplest and most realistic option. The `--ci` flag:
- Launches the full Electron app (same browser engine your users run)
- Sets `ELECTRON_DISABLE_SANDBOX=1` (required in containers)
- Waits for server + browser to be ready
- Fails with clear error if startup fails

### Option 2: Electron app without wait

```bash
xvfb-run --auto-servernum bunx haltija@latest --app &
```

Same as `--ci` but doesn't wait for ready state. You'll need to poll `/status` yourself.

### Option 3: Playwright headless (lighter weight)

```bash
bunx haltija@latest --headless &
```

Uses Playwright's Chromium instead of Electron. Lighter weight but slightly different browser engine.

### Option 4: Server-only mode (lighter weight)

If you're testing a web app and don't need the Electron shell:

```bash
bunx haltija@latest --server --headless &
```

This starts:
- The Haltija REST API server on port 8700
- A headless Chromium browser with the widget auto-injected

### Option 5: From source (for Haltija development)

```bash
bun install && bun run build
cd apps/desktop && npm install --omit=dev
xvfb-run --auto-servernum npx electron . &
```

## Waiting for Ready State

Don't use `sleep` — use a proper wait loop:

```bash
# Wait for server
for i in $(seq 1 30); do
  if curl -sf http://localhost:8700/status | jq -e '.serverVersion' > /dev/null 2>&1; then
    echo "Haltija server ready after ${i}s"
    break
  fi
  sleep 1
done

# Wait for browser connection (if using Electron app)
for i in $(seq 1 30); do
  WINDOWS=$(curl -sf http://localhost:8700/windows 2>/dev/null | jq '.windows | length' 2>/dev/null || echo 0)
  if [ "$WINDOWS" -gt 0 ]; then
    echo "Browser connected after ${i}s"
    break
  fi
  sleep 1
done
```

## The hj CLI

The `hj` command is installed to `~/.local/bin` when Haltija starts. Add it to PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then use it:

```bash
hj status              # Check connection
hj tree                # See page structure
hj click "#submit"     # Click element
hj type "#email" user@example.com
hj test-run tests/login.json
```

Run `hj --help` for all commands.

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
| `wait` (window) | `{"action": "wait", "forWindow": true}` | Wait for new tab to connect |

### Text Selectors

All selectors support custom pseudo-selectors for finding elements by visible text:

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

### With output formats
```bash
hj test-run tests/login.json                # JSON (default)
hj test-run tests/login.json --format human # Human-readable
hj test-run tests/login.json --format github # GitHub Actions annotations
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
    export PATH="$HOME/.local/bin:$PATH"
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

Requires xvfb and Electron dependencies. In container environments:

```yaml
env:
  ELECTRON_DISABLE_SANDBOX: 1
run: |
  sudo apt-get install -y xvfb libnss3 libatk1.0-0 ...
  xvfb-run --auto-servernum bunx haltija@latest &
```

### macOS

No xvfb needed:

```bash
bunx haltija@latest &
```

### Windows

Coming soon. For now, use WSL2 with the Linux instructions.

## Complete CI Example with Firebase Emulators

For apps that need emulators or other backend services:

```yaml
name: E2E Tests
on: [push]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: |
          npm ci
          sudo apt-get update
          sudo apt-get install -y xvfb jq libnss3 libatk1.0-0 libatk-bridge2.0-0 \
            libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
            libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64

      - name: Run tests with emulators
        env:
          ELECTRON_DISABLE_SANDBOX: 1
        run: |
          firebase emulators:exec --project='my-project' --only functions,firestore,auth,hosting '
            export PATH="$HOME/.local/bin:$PATH"
            
            # Start Haltija
            xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" \
              bunx haltija@latest &
            
            # Wait for ready
            for i in $(seq 1 30); do
              if curl -sf http://localhost:8700/status > /dev/null 2>&1; then
                echo "Haltija ready"
                break
              fi
              sleep 1
            done
            
            # Run tests
            hj navigate http://127.0.0.1:5050
            hj test-run tests/app-tests.json
          '
```

## Shell Script Helpers

For complex test suites, create helper functions:

```bash
#!/bin/bash
# lib.sh

export PATH="$HOME/.local/bin:$PATH"

wait_for_haltija() {
  for i in $(seq 1 30); do
    if curl -sf http://localhost:8700/status | jq -e '.serverVersion' > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Haltija failed to start"
  return 1
}

wait_for_element() {
  local selector="$1"
  local timeout="${2:-10}"
  hj wait --selector "$selector" --timeout "${timeout}000"
}

assert_url_contains() {
  local pattern="$1"
  local url=$(hj location | jq -r '.url')
  if [[ "$url" == *"$pattern"* ]]; then
    return 0
  else
    echo "URL '$url' does not contain '$pattern'"
    return 1
  fi
}
```

## Tips

- **Don't use `sleep`** — use wait loops that check for actual readiness
- **Add `jq` to dependencies** — essential for parsing JSON responses in scripts
- **Export PATH** — `hj` is installed to `~/.local/bin`
- **Use `ELECTRON_DISABLE_SANDBOX`** — required in most container environments
- **Start simple** — one test, few steps, then expand
- **Use `purpose`** on steps that might fail — explains intent on failure
- **Navigate explicitly** — don't rely on default page state
- **Upload artifacts** — screenshots and snapshots are invaluable for debugging

## Troubleshooting

### "hj: command not found"

Add `~/.local/bin` to PATH:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Electron sandbox errors

Set the environment variable:
```yaml
env:
  ELECTRON_DISABLE_SANDBOX: 1
```

### No browser connected

Make sure you're waiting for the browser connection, not just the server:
```bash
WINDOWS=$(curl -sf http://localhost:8700/windows | jq '.windows | length')
```

### Tests timing out

Increase step timeout or use the patience model:
```json
{"timeout": 10000}
```

Or in the test config:
```json
{"patience": 5, "timeout": 8000}
```

## REST API

For direct HTTP integration (scripts, other languages), see [REST-API.md](REST-API.md).

## Examples

See test files in the Haltija repo:
- [`tests/playground.json`](https://github.com/anthropics/haltija/blob/main/tests/playground.json)
- [`tests/homepage.json`](https://github.com/anthropics/haltija/blob/main/tests/homepage.json)
- [`.github/workflows/test-qa.yml`](https://github.com/anthropics/haltija/blob/main/.github/workflows/test-qa.yml)
