# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Haltija?

Haltija gives AI agents eyes and hands in the browser. Instead of guessing what's on screen, agents can see the actual DOM, click elements, type text, and watch for changes. The server exposes a REST API that routes commands to browser widgets connected via WebSocket.

## Build & Test Commands

```bash
# Build (compiles TypeScript, embeds assets, bundles component.js)
bun run build

# Unit tests (run with Bun)
bun test                          # All unit tests
bun test src/server.test.ts       # Single test file

# E2E tests (run with Playwright on Node.js - NOT Bun)
bun run test:e2e

# Run all tests (unit + E2E)
bun run test:all

# Run server for development
bun run dist/server.js
# or
bunx haltija

# Server CLI options
haltija --https              # HTTPS mode (auto-generates certs)
haltija --both               # HTTP + HTTPS simultaneously
haltija --port 3000          # Custom port
haltija --headless           # Playwright mode for CI
haltija --docs-dir ./docs    # Custom reference docs directory
```

## Critical: Bun vs Playwright Test Separation

**Playwright runs on Node.js, not Bun.** This is the most common source of test failures:

- Unit tests (`*.test.ts`) use Bun APIs and run with `bun test`
- E2E tests use `.playwright.ts` suffix (e.g., `e2e.playwright.ts`, `mutation.playwright.ts`)
- Playwright tests CANNOT import Bun-only code - if you see "Cannot find package 'bun'" in Playwright, you're importing Bun-specific code
- `playwright.config.ts` uses `testMatch: '**/*.playwright.ts'` to only run Playwright tests

## Architecture

```
Browser Tab              Server (Bun)           AI Agent
    │                        │                      │
    │◄──── WebSocket ───────►│◄──── REST API ──────►│
    │                        │                      │
    └─ component.ts          └─ server.ts           └─ curl/MCP
       Widget in browser        Routes messages         Any HTTP client
```

### Key Source Files

| File | Purpose |
|------|---------|
| `src/server.ts` | HTTP/WebSocket server, REST endpoints, window tracking |
| `src/component.ts` | Browser widget (custom element `<haltija-dev>`) |
| `src/api-schema.ts` | Schema definitions for all endpoints (single source of truth) |
| `src/api-router.ts` | Schema-driven request routing |
| `src/api-handlers.ts` | Handler implementations for routed endpoints |
| `src/types.ts` | All TypeScript types (DevMessage, TestStep, SemanticEvent, etc.) |
| `src/test-generator.ts` | Converts semantic events to test JSON |
| `src/test-formatters.ts` | Output formatting for test results (JSON, GitHub, human-readable) |

### Request Flow

1. Agent makes REST call (e.g., `POST /click {"selector": "#btn"}`)
2. Server validates against schema in `api-schema.ts`
3. Router in `api-router.ts` dispatches to handler
4. Handler calls `requestFromBrowser()` which sends WebSocket message to browser
5. Browser widget (`component.ts`) executes action and returns response
6. Response flows back through WebSocket → REST response

### Ref ID System

The `/tree` endpoint assigns stable ref IDs (e.g., `@1`, `@42`) to elements. Interaction endpoints (`/click`, `/type`, `/key`) accept `ref` parameter as an alternative to `selector`:
- More efficient than CSS selectors (direct lookup vs DOM query)
- Survives DOM updates within same page load
- Use `ref: "@1"` instead of `selector: "#btn"` when working with tree output

### Multi-Window Support

- Each browser tab gets a stable `windowId` (persisted in sessionStorage)
- Commands can target specific windows: `?window=<id>`
- `focusedWindowId` tracks which window receives untargeted commands
- `windows` Map tracks all connected windows with their state
- Window types: `tab`, `popup`, `iframe` (tracked via `windowType`)

### Schema-Driven API

Endpoints are defined in `api-schema.ts` using `tosijs-schema`:
- GET on a POST endpoint returns self-documenting schema
- POST validates body against schema before calling handler
- Schema generates MCP tool definitions for Claude Desktop
- `SCHEMA_FINGERPRINT` tracks API changes for cache invalidation

### Semantic Events

The "hindsight buffer" - aggregated events that capture user intent:
- "user typed 'hello@example.com'" not 18 keydown events
- Categories: `interaction`, `navigation`, `input`, `hover`, `scroll`, `mutation`, `console`, `focus`
- Presets: `minimal`, `interactive`, `detailed`, `debug`

## Adding New Endpoints

1. Define schema in `src/api-schema.ts` using the `endpoint()` helper
2. Add to `endpoints` registry at bottom of file
3. Add handler in `src/api-handlers.ts` if using schema-driven routing
4. For complex endpoints, may need fallback handling in `src/server.ts`

## Test JSON Format

Tests are pure JSON with atomic steps:
```json
{
  "version": 1,
  "name": "Login flow",
  "url": "http://localhost:3000",
  "steps": [
    {"action": "type", "selector": "#email", "text": "user@example.com"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "assert", "type": "exists", "selector": ".dashboard"}
  ]
}
```

Step types: `navigate`, `click`, `type`, `key`, `wait`, `assert`, `eval`, `verify`

## Desktop App (Electron)

Located in `apps/desktop/`. The Electron shell:
- Strips CSP headers for universal compatibility
- Auto-injects widget on page load
- Provides native screenshot capture
- Supports multi-tab browsing

## MCP Integration

Located in `apps/mcp/`. Provides Model Context Protocol tools for Claude Desktop:
- Generates tool definitions from `api-schema.ts`
- Translates MCP JSON-RPC to REST API calls
- Setup: `bunx haltija --setup-mcp`

## Build Artifacts

The build script (`scripts/build.ts`) generates:
1. `src/version.ts` - Auto-generated from `package.json` version (do not edit)
2. `dist/component.js` - Browser widget bundle (IIFE)
3. `dist/server.js`, `dist/client.js`, `dist/index.js` - Bun runtime modules
4. `apps/desktop/resources/component.js` - Synced copy for desktop app
5. `apps/mcp/src/endpoints.json` - MCP endpoint definitions from schema
6. `API.md` - Auto-generated API reference (do not edit directly)

## Version Management

Version is managed in `package.json` only. The build script generates `src/version.ts` automatically. Never edit `version.ts` directly.

## Issue Tracking

This project uses **bd (beads)** for issue tracking. Run `bd prime` for full workflow context.

**Quick reference:**
- `bd ready` - Find unblocked work to start on
- `bd create "Title" --type task --priority 2` - Create issue (priority 0-4, not high/medium/low)
- `bd update <id> --status=in_progress` - Claim work
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

**Session close protocol** - before finishing work:
```bash
git status              # Check changes
git add <files>         # Stage code
bd sync                 # Sync beads
git commit -m "..."     # Commit code  
git push                # Push to remote
```
