# Haltija CI Integration Guide

This guide covers running Haltija in CI environments (GitHub Actions, GitLab CI, etc.) for automated browser testing.

## Overview

Haltija in CI works differently than Playwright/Puppeteer:

| Aspect | Playwright | Haltija |
|--------|------------|---------|
| Browser | Launches headless browser | Connects to running browser |
| Setup | `npx playwright install` | Start server + launch Electron |
| Control | Direct API calls | REST API over HTTP |
| State | Fresh per test | Persistent (use tabs for isolation) |

**Key insight**: Haltija connects to a *live* browser. In CI, we launch the Electron app (which auto-injects the widget) and control it via REST.

## Architecture in CI

```
┌─────────────────────────────────────────────────────────────┐
│  CI Runner (GitHub Actions, etc.)                           │
│                                                             │
│  ┌─────────────────┐     ┌─────────────────────────────┐   │
│  │  Your Test      │     │  Haltija Desktop (Electron)  │   │
│  │  Script         │────▶│  - Embedded server :8700     │   │
│  │  (curl/fetch)   │     │  - Auto-injected widget      │   │
│  └─────────────────┘     │  - CSP bypassed              │   │
│                          └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start: GitHub Actions

```yaml
name: E2E Tests with Haltija

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      # Install dependencies for your app
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      # Start your app (adjust for your setup)
      - name: Start app
        run: npm run dev &
        env:
          PORT: 3000
      
      # Install Haltija Desktop dependencies
      - name: Setup Haltija
        run: |
          # Install Bun (needed to build)
          curl -fsSL https://bun.sh/install | bash
          export PATH="$HOME/.bun/bin:$PATH"
          
          # Clone and build Haltija
          git clone https://github.com/tonioloewald/haltija.git /tmp/haltija
          cd /tmp/haltija
          bun install
          bun run build
          
          # Build desktop app for Linux
          cd apps/desktop
          npm install
          npm run build:linux
      
      # Start Haltija with xvfb (virtual display)
      - name: Start Haltija
        run: |
          export DISPLAY=:99
          Xvfb :99 -screen 0 1920x1080x24 &
          sleep 2
          
          # Launch the AppImage
          chmod +x /tmp/haltija/apps/desktop/dist/Haltija-*-x86_64.AppImage
          /tmp/haltija/apps/desktop/dist/Haltija-*-x86_64.AppImage --no-sandbox &
          
          # Wait for server to be ready
          timeout 30 bash -c 'until curl -s http://localhost:8700/status; do sleep 1; done'
      
      # Run your tests
      - name: Run E2E tests
        run: |
          # Navigate to your app
          curl -X POST http://localhost:8700/navigate -d '{"url":"http://localhost:3000"}'
          
          # Run test script
          ./tests/e2e.sh
```

## The Haltija Server

The desktop app embeds a Haltija server that starts automatically. Key points:

- **Port**: 8700 (default)
- **Protocol**: HTTP REST + WebSocket
- **No auth**: Localhost only in CI (secure by isolation)

Check it's running:
```bash
curl http://localhost:8700/status
# {"ok":true,"windows":[...],"serverVersion":"0.1.9",...}
```

## Test Isolation with Tabs

Unlike Playwright where each test gets a fresh browser, Haltija maintains state. Use tabs for isolation:

```bash
# Open a fresh tab for this test
WINDOW_ID=$(curl -s -X POST http://localhost:8700/tabs/open \
  -d '{"url":"http://localhost:3000/login"}' | jq -r '.data.windowId')

# Run test in that tab
curl -X POST "http://localhost:8700/click?window=$WINDOW_ID" \
  -d '{"selector":"#submit"}'

# Close tab when done
curl -X POST http://localhost:8700/tabs/close \
  -d "{\"window\":\"$WINDOW_ID\"}"
```

## Writing Tests

### Shell Script (simplest)

```bash
#!/bin/bash
# tests/login.sh

set -e  # Exit on error

BASE_URL="http://localhost:8700"
APP_URL="http://localhost:3000"

# Navigate to login page
curl -s -X POST "$BASE_URL/navigate" -d "{\"url\":\"$APP_URL/login\"}"

# Type credentials
curl -s -X POST "$BASE_URL/type" \
  -d '{"selector":"#email","text":"test@example.com"}'

curl -s -X POST "$BASE_URL/type" \
  -d '{"selector":"#password","text":"password123"}'

# Click submit
curl -s -X POST "$BASE_URL/click" -d '{"selector":"button[type=submit]"}'

# Wait for redirect
curl -s -X POST "$BASE_URL/wait" \
  -d '{"forElement":".dashboard","timeout":5000}'

# Verify we're on dashboard
LOCATION=$(curl -s "$BASE_URL/location")
if echo "$LOCATION" | grep -q "dashboard"; then
  echo "✓ Login test passed"
  exit 0
else
  echo "✗ Login test failed - not on dashboard"
  exit 1
fi
```

### JSON Test Format

Haltija has a native JSON test format:

```json
{
  "version": 1,
  "name": "Login flow",
  "url": "http://localhost:3000/login",
  "steps": [
    {"action": "type", "selector": "#email", "text": "test@example.com"},
    {"action": "type", "selector": "#password", "text": "password123"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "wait", "forElement": ".dashboard", "timeout": 5000},
    {"action": "assert", "assertion": {"type": "url", "pattern": "/dashboard"}}
  ]
}
```

Run it:
```bash
curl -X POST http://localhost:8700/test/run \
  -H "Content-Type: application/json" \
  -d @tests/login.json
```

### GitHub Actions Output Format

For nice PR annotations:
```bash
curl -X POST http://localhost:8700/test/run \
  -d '{"test": ..., "format": "github"}'
```

This outputs GitHub Actions annotations that show inline in PRs.

## Platform-Specific Setup

### Ubuntu/Linux (GitHub Actions default)

```yaml
- name: Install display dependencies
  run: |
    sudo apt-get update
    sudo apt-get install -y xvfb libnss3 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
      libxfixes3 libxrandr2 libgbm1 libasound2

- name: Start virtual display
  run: |
    Xvfb :99 -screen 0 1920x1080x24 &
    echo "DISPLAY=:99" >> $GITHUB_ENV
```

### macOS

```yaml
jobs:
  test:
    runs-on: macos-latest
    steps:
      # No xvfb needed - macOS has a display
      - name: Start Haltija
        run: |
          open /tmp/haltija/apps/desktop/dist/Haltija.app &
          sleep 5
```

### Windows

```yaml
jobs:
  test:
    runs-on: windows-latest
    steps:
      - name: Start Haltija
        run: |
          Start-Process -FilePath "C:\path\to\Haltija.exe"
          Start-Sleep -Seconds 5
```

## Pre-built Binaries (Recommended)

Instead of building in CI, download pre-built binaries:

```yaml
- name: Download Haltija
  run: |
    # Download latest release
    curl -L -o haltija.AppImage \
      https://github.com/tonioloewald/haltija/releases/latest/download/Haltija-linux-x86_64.AppImage
    chmod +x haltija.AppImage
```

*(Note: Release binaries coming soon - for now, build from source)*

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HALTIJA_PORT` | 8700 | Server port |
| `DISPLAY` | - | X display (Linux, set to `:99` with xvfb) |

## Debugging CI Failures

### Capture screenshot on failure

```bash
# In your test script
if ! run_test; then
  curl -s http://localhost:8700/screenshot > failure.png
  echo "Screenshot saved to failure.png"
  exit 1
fi
```

### Get console logs

```bash
curl -s http://localhost:8700/console | jq '.entries[]'
```

### Capture full snapshot

```bash
curl -s -X POST http://localhost:8700/snapshot \
  -d '{"trigger":"test-failure"}' > snapshot.json
```

### Upload artifacts

```yaml
- name: Upload failure artifacts
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: test-failures
    path: |
      failure.png
      snapshot.json
```

## Complete Example Workflow

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install app dependencies
        run: npm ci
      
      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb libnss3 libatk1.0-0 libatk-bridge2.0-0 \
            libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
            libxfixes3 libxrandr2 libgbm1 libasound2
      
      - name: Install Bun
        uses: oven-sh/setup-bun@v1
      
      - name: Build Haltija
        run: |
          git clone --depth 1 https://github.com/tonioloewald/haltija.git /tmp/haltija
          cd /tmp/haltija
          bun install
          bun run build
          cd apps/desktop
          npm install
          npm run compile:server:linux
          npm run build:linux
      
      - name: Start services
        run: |
          # Start virtual display
          Xvfb :99 -screen 0 1920x1080x24 &
          export DISPLAY=:99
          
          # Start your app
          npm run dev &
          
          # Start Haltija
          chmod +x /tmp/haltija/apps/desktop/dist/*.AppImage
          /tmp/haltija/apps/desktop/dist/*.AppImage --no-sandbox &
          
          # Wait for both to be ready
          timeout 30 bash -c 'until curl -s http://localhost:3000 > /dev/null; do sleep 1; done'
          timeout 30 bash -c 'until curl -s http://localhost:8700/status | grep -q "ok"; do sleep 1; done'
        env:
          DISPLAY: ':99'
      
      - name: Run E2E tests
        run: |
          # Navigate to app
          curl -X POST http://localhost:8700/navigate -d '{"url":"http://localhost:3000"}'
          
          # Run test suite
          curl -X POST http://localhost:8700/test/suite \
            -H "Content-Type: application/json" \
            -d @tests/suite.json \
            --output results.json
          
          # Check results
          if jq -e '.summary.failed > 0' results.json > /dev/null; then
            echo "Tests failed!"
            jq '.results[] | select(.passed == false)' results.json
            exit 1
          fi
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: results.json
      
      - name: Capture failure state
        if: failure()
        run: |
          curl -s http://localhost:8700/screenshot > failure-screenshot.png
          curl -s -X POST http://localhost:8700/snapshot -d '{"trigger":"ci-failure"}' > failure-snapshot.json
          curl -s http://localhost:8700/console > console-logs.json
      
      - name: Upload failure artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: failure-artifacts
          path: |
            failure-screenshot.png
            failure-snapshot.json
            console-logs.json
```

## API Quick Reference for CI

```bash
# Status & connection
GET  /status                    # Server health
GET  /windows                   # Connected tabs

# Navigation
POST /navigate {"url":"..."}    # Go to URL
POST /refresh                   # Reload page
GET  /location                  # Current URL

# Interaction
POST /click {"selector":"..."}  # Click element
POST /type {"selector":"...","text":"..."}  # Type text
POST /key {"key":"Enter"}       # Press key

# Inspection
POST /tree {"depth":3}          # DOM structure
POST /query {"selector":"..."}  # Find element
POST /inspect {"selector":"..."} # Element details

# Waiting
POST /wait {"forElement":"...","timeout":5000}  # Wait for element
POST /wait {"ms":1000}          # Simple delay

# Testing
POST /test/run {"test":{...}}   # Run single test
POST /test/suite {"tests":[...]} # Run test suite

# Debugging
GET  /console                   # Browser console logs
POST /screenshot                # Capture page
POST /snapshot                  # Full debug state

# Tab management (isolation)
POST /tabs/open {"url":"..."}   # New tab
POST /tabs/close {"window":"..."} # Close tab
```

## Troubleshooting

### "No windows connected"

The Electron app started but hasn't loaded a page yet:
```bash
# Navigate to trigger widget injection
curl -X POST http://localhost:8700/navigate -d '{"url":"about:blank"}'
sleep 2
curl http://localhost:8700/status
```

### "Connection refused"

Server not running. Check:
```bash
# Is the process running?
ps aux | grep -i haltija

# Check port
netstat -tlnp | grep 8700
```

### Electron won't start on Linux

Missing dependencies. Install:
```bash
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2
```

### Tests flaky

Add explicit waits:
```bash
# Bad: assume element exists
curl -X POST http://localhost:8700/click -d '{"selector":".modal-button"}'

# Good: wait for it first
curl -X POST http://localhost:8700/wait -d '{"forElement":".modal-button"}'
curl -X POST http://localhost:8700/click -d '{"selector":".modal-button"}'
```

## Next Steps

- **Local development**: See [Getting Started](getting-started/app.md)
- **API Reference**: See [API.md](../API.md)
- **Test format**: See [Test JSON schema](../API.md#run-tests)
- **Recipes**: See [Common workflows](recipes.md)
