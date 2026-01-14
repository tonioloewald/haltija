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

# Run server for development
bun run dist/server.js
# or
bunx haltija
```

## Critical: Bun vs Playwright Test Separation

**Playwright runs on Node.js, not Bun.** This is the most common source of test failures:

- Unit tests (`*.test.ts` except `playwright.test.ts`) can use Bun APIs
- Playwright tests CANNOT use Bun APIs - if you see "Cannot find package 'bun'" in Playwright, the test is importing Bun-only code
- `playwright.config.ts` uses `testMatch: '**/playwright.test.ts'` to exclude unit tests
- E2E tests are in files matching `*.playwright.ts`

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

### Request Flow

1. Agent makes REST call (e.g., `POST /click {"selector": "#btn"}`)
2. Server validates against schema in `api-schema.ts`
3. Router in `api-router.ts` dispatches to handler
4. Handler calls `requestFromBrowser()` which sends WebSocket message to browser
5. Browser widget (`component.ts`) executes action and returns response
6. Response flows back through WebSocket → REST response

### Multi-Window Support

- Each browser tab gets a stable `windowId` (persisted in sessionStorage)
- Commands can target specific windows: `?window=<id>`
- `focusedWindowId` tracks which window receives untargeted commands
- `windows` Map tracks all connected windows with their state

### Schema-Driven API

Endpoints are defined in `api-schema.ts` using `tosijs-schema`:
- GET on a POST endpoint returns self-documenting schema
- POST validates body against schema before calling handler
- Schema generates MCP tool definitions for Claude Desktop

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
