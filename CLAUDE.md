# Haltija - Session Context for Claude

## What This Is

Haltija gives AI agents eyes and hands in the browser. Instead of guessing what's on screen, agents can see the actual DOM, click elements, type text, and watch for changes.

## Current State (as of 2026-01-11)

**Completed Phases:**
- Phase 1-9: Core infrastructure, DOM queries, smart events, recordings, test generation
- Phase 9.5: Extensible docs system (`--docs-dir`, `/docs/list`, `/docs/:name`)

**All tests passing:**
- 24 unit tests
- 32 Playwright e2e tests

## Key Files

| File | Purpose |
|------|---------|
| `src/server.ts` | Bun HTTP/WebSocket server, REST API |
| `src/component.ts` | Browser widget (custom element) |
| `src/types.ts` | TypeScript types |
| `docs/UX-CRIMES.md` | The Haltija Criminal Code (35 UX anti-patterns) |
| `ROADMAP.md` | Full feature roadmap with completed/planned phases |
| `README.md` | User-facing documentation |

## Quick Dev Loop

```bash
# Build
bun run build

# Test
bun test                    # unit tests (Bun runtime)
bun run test:e2e           # playwright tests (Node runtime)

# Run server
bun run dist/server.js
# or
bunx haltija
```

## Testing Gotcha: Bun vs Playwright

**Playwright runs on Node.js, not Bun.** This matters because:

- Unit tests (`*.test.ts` except `playwright.test.ts`) can use Bun APIs like `bun:spawn`
- Playwright tests CANNOT use Bun APIs - they run in Node.js
- `playwright.config.ts` must use `testMatch: '**/playwright.test.ts'` (not `**/*.test.ts`)
- If you see errors like "Cannot find package 'bun'" in Playwright, check the testMatch pattern

## Architecture

```
Browser Tab          Server (Bun)         AI Agent
    │                    │                   │
    │◄── WebSocket ─────►│◄── REST API ─────►│
    │                    │                   │
    └─ Widget injects    └─ Routes messages  └─ curl/fetch
       via bookmarklet      Buffers state       Any LLM
```

## Next Up (from ROADMAP.md)

**Phase 10: Native App Shell (Electron/Tauri)**
- CSP bypass for universal compatibility
- Auto-inject widget on page load
- Screen capture for agents

**Phase 11-13:** Apple Intelligence, MCP Bridge, UX Crimes Database heuristics

## Semantic Events (Key Innovation)

Instead of raw DOM events, we aggregate at source:
- "user typed 'hello'" not 5 keydown events
- "user scrolled to #pricing" not 200 scroll events
- 96% noise reduction measured in benchmarks

## Commercial Potential

This has significant commercial value. The semantic event aggregation and tree inspection approaches are patentable innovations protected under Apache 2.0 with patent grant.

## Integration with tosijs-agent

See `~/Documents/GitHub/agent-99/.haltija.md` for how to use haltija when developing tosijs-agent.
