# Haltija Roadmap — history

The finished phases and the design records that used to open `ROADMAP.md`. Moved here
(2026-09-26) so the task board's importer does not read ~250 shipped features as open work.
History, not a backlog: nothing here is a task.

## Architecture Principles

1. **No spam** - Aggregate at source, not destination
2. **Semantic over raw** - Events should mean something
3. **Subscribe to what you need** - Don't broadcast everything
4. **System messages are internal** - Don't leak implementation details
5. **AI-readable** - Events a model can reason about
6. **Efficient** - Virtual rendering, debouncing, batching

## Files

- `src/types.ts` - All type definitions
- `src/server.ts` - WebSocket + REST server
- `src/component.ts` - Browser widget
- `src/client.ts` - Agent/CLI client
- `src/bookmarklet.ts` - Injection code


## Completed

### Phase 1: Core Infrastructure ✅
- WebSocket server with REST API
- Browser component (bookmarklet injection)
- Basic DOM queries, clicks, typing, eval
- Console capture (buffered locally, errors sent to server)
- Playwright tests (13 passing)

### Phase 2: Tab Switching ✅
- Browser generates unique `browserId`
- On seeing another browser's `connected` message, kill self
- Prevents reconnect loops with `killed` flag
- Tested with Playwright (2 dedicated tests)

### Phase 3: Clean Message Architecture ✅
- Removed debug logging spam
- System messages only go to browsers (tab coordination)
- Non-system messages only go to agents (via REST)
- Console.log only sends errors automatically (rest queryable via REST)
- Clean separation: browsers↔server for coordination, agent→browser via REST

### Phase 4: JSON Test Format Types ✅
- `DevChannelTest` type defined in types.ts
- Steps: navigate, click, type, key, wait, assert, eval
- Assertions: exists, text, value, visible, url, console-contains
- `TestResult` / `StepResult` for reporting

### Phase 4.5: HTTPS & Agent Onboarding ✅
- HTTP/HTTPS dual-mode server (`--http`, `--https`, `--both`)
- Auto-generate certificates with mkcert or openssl
- Protocol-aware bookmarklet (adapts to target page)
- `/docs` endpoint - quick-start guide for AI agents
- `/api` endpoint - complete API reference
- Human-like typing with variable latency and typos
- Node-compatible CLI (`npx haltija` works)

### Phase 5: JSON Test Framework ✅

Pure JSON tests that map to atomic actions. No code files - just data.
AI writes tests, runs them, captures snapshots on failure.

#### Test Format
```json
{
  "version": 1,
  "name": "Login flow",
  "description": "Verify user can log in with valid credentials",
  "url": "https://example.com/login",
  "createdAt": 1704067200000,
  "createdBy": "human" | "ai",
  "tags": ["auth", "critical-path"],
  "steps": [
    {
      "action": "type",
      "selector": "#email",
      "text": "user@example.com",
      "description": "Enter email address",
      "purpose": "Provide valid user credentials for authentication"
    },
    {
      "action": "click",
      "selector": "#submit",
      "description": "Submit login form",
      "purpose": "Trigger authentication request"
    },
    {
      "action": "assert",
      "assertion": { "type": "url", "pattern": "/dashboard" },
      "description": "Verify redirect to dashboard",
      "purpose": "Confirm successful authentication"
    }
  ]
}
```

#### AI Test Generation
- AI inspects page via `/tree`, `/inspectAll`, proposes test plan
- Each step includes `description` (what) and `purpose` (why)
- AI generates assertions based on expected behavior
- Metadata enables meaningful failure messages:
  - "Step 3 failed: Submit login form - button was disabled"
  - NOT: "Click on #submit failed"

#### Test Runner
- `POST /test/run` - Execute a test, return results
- `POST /test/validate` - Dry-run to check selectors exist
- Sequential execution with configurable delays
- Per-step results with timing and error details
- Clear failure reporting: which step, what failed, why

#### Test Results Format
```json
{
  "test": "Login flow",
  "passed": false,
  "duration": 2340,
  "snapshotId": "snap_1736600123456",
  "steps": [
    { "index": 0, "passed": true, "duration": 120 },
    { "index": 1, "passed": true, "duration": 85 },
    { 
      "index": 2, 
      "passed": false, 
      "duration": 5000,
      "error": "Timeout waiting for URL to match /dashboard",
      "description": "Verify redirect to dashboard",
      "purpose": "Confirm successful authentication",
      "context": { "actualUrl": "/login?error=invalid" },
      "snapshotId": "snap_1736600128456"
    }
  ]
}
```

#### Failure Snapshots (Time Travel Debugging)
When a test fails, capture a lightweight DOM snapshot:
- `snapshotId` returned in test results
- `GET /snapshot/:id` - Retrieve snapshot HTML
- Snapshot includes: DOM tree, computed styles, console logs, network state
- Developers can "time travel" to exact failure state locally
- CI artifacts include snapshots, not just JSON results

#### CI/Cloud Testing

**The Goal**: Replace meaningless test failures and log spam with AI that understands what broke and why.

##### GitHub Actions Example
```yaml
jobs:
  ai-qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Start app + haltija
        run: |
          npm start &
          npx playwright install chromium
          bunx haltija --headless &
          sleep 5
          
      - name: AI executes test plan
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx claude-code -p "$(cat .tosijs/prompts/run-tests.md)" \
            --output-file results.json \
            --max-tokens 50000 \
            --timeout 300
          
      - name: Check results
        run: jq -e '.summary.failed == 0' results.json
        
      - name: Upload failure analysis
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: ai-qa-report
          path: results.json
```

##### Headless Mode
- `bunx haltija --headless` - Starts Playwright browser automatically
- No manual browser/bookmarklet needed
- Chromium runs headless in CI environment
- Widget auto-injected into every page

##### AI QA Prompt Template (`.tosijs/prompts/run-tests.md`)
```markdown
You are a QA engineer. Connect to http://localhost:8700.

1. Load test files from ./tests/*.test.json
2. For each test, POST to /test/run
3. If a test fails:
   - Inspect the page state via /tree
   - Check /console for errors
   - Determine root cause (selector changed? element disabled? timing?)
   - Suggest fix or flag as real bug
4. Output JSON: { summary: {passed, failed}, results: [...], analysis: "..." }

Be concise. Focus on actionable insights, not log dumps.
```

##### Structured Output
- `POST /test/run` returns machine-readable JSON
- Exit codes: 0 = all passed, 1 = failures, 2 = infrastructure error
- `--output-file` flag writes results for CI artifact upload

##### Cost Control
- `--max-tokens` limits AI spend
- `--timeout` kills runaway agents  
- Test suite timeout separate from per-test timeout

##### GitLab CI Example
```yaml
ai-qa:
  image: mcr.microsoft.com/playwright:v1.40.0
  script:
    - npm start &
    - bunx haltija --headless &
    - sleep 5
    - npx claude-code -p "$(cat .tosijs/prompts/run-tests.md)" > results.json
    - jq -e '.summary.failed == 0' results.json
  artifacts:
    when: on_failure
    paths:
      - results.json
```

##### What AI QA Provides Over Traditional CI
| Traditional CI | AI QA |
|---------------|-------|
| "Element #submit not found" | "Submit button moved to .form-actions > button:first-child, selector needs update" |
| 500 lines of browser logs | "API returned 401, login token expired" |
| "Timeout after 30s" | "Spinner never dismissed - loading state stuck, check network tab" |
| "Expected 'Dashboard' got 'Login'" | "Auth cookie not set, CORS issue with new API domain" |

### Phase 6: Smart Event Streams ✅

**Problem**: Current approach is "log everything" which is noisy and useless.

**Principle**: SPAM IS EVIL, NOISE KILLS SIGNAL

**Solution**: Source-side aggregation + semantic events

#### Event Categories (subscribe to what you need)
```
interaction   - clicks, submits, form changes (always useful)
navigation    - page loads, hash changes, history
input         - keystrokes aggregated into "typed X" (debounced)
hover         - only boundary crossings + dwell (not every mousemove)
scroll        - only meaningful stops, not every pixel
console       - errors always, logs optional
system        - internal only, never broadcast to agents
```

#### Smart Aggregation (at source, before sending)
- "user typed 'hello'" not 5 keydown events
- "user scrolled to #pricing" not 200 scroll events  
- "user hovered on .btn for 1.2s" not mousemove spam
- "cursor entered #submit-btn" / "cursor left .dropdown-menu"
- Dwell detection: "hovered for 500ms"

#### Mouse Movement Filtering
- Ignore movements < 5px (jitter)
- Only report when crossing element boundaries
- Track velocity/acceleration for gesture detection
- "Mouse moved to #submit" not 200 coordinate pairs

#### Default Filter Presets
- **minimal**: Only clicks, submits, navigation
- **interactive**: + hovers on buttons/links, form changes
- **detailed**: + all element boundary crossings
- **debug**: Everything (rarely needed)
- Agents choose their noise tolerance
- Gesture recognition: "drag from #item-3 to #trash"

#### Semantic Events (what AI actually needs to see)
- "User hesitated" (mouse stopped, no click)
- "User abandoned" (started typing, cleared, left)
- "User explored" (moused over several options before clicking)
- "User confidently clicked" vs "User hesitated then clicked"

#### Event Payloads (Context History Stream)
**Key insight**: Events must carry their *payload*, not just their type.

Bad: `mutation(div.error)` - Agent must query DOM to know what changed
Good: `mutation(div.error, text="Invalid Password")` - Context is self-contained

- Mutations include text content, attribute values, added/removed nodes
- Clicks include element text, state (disabled, aria-pressed, etc.)
- Form changes include old and new values
- Navigation includes referrer, timing, resource count
- Rolling buffer captures element tree snapshots at key moments
- Agent can answer "what happened?" without re-querying the DOM

#### Filtering/Debouncing
- Debounce tiny movements (< 5px)
- Collapse sequential keystrokes into single "typed" event
- Group related events: click + focus + input = "filled in field"
- Configurable thresholds

#### Clean Message Format
```
user:click       not events:dispatch
user:typed       not console:log  
page:loaded      not system:connected
user:entered     (element boundary crossing)
user:dwelled     (hovered > threshold)
```

### Phase 7: Log Viewer Widget ✅

- Toggle with 📋 button in widget header
- Auto-starts semantic event watching when opened
- Filterable by category (clicks, input, nav, hover, focus, console)
- Console error indicator (⚠ count) with click-to-filter
- Color-coded entries by category (including console error/warn/log styling)
- Details/summary expand for payload (compact key-value table)
- Auto-scroll with pause on manual scroll
- Drag detection with smart thresholds (>10px fast, or >200ms deliberate)
- Bookmarklet auto-replaces stale widgets (version check)
- Hot reload via `POST /reload` - widget updates without page refresh
- Custom element re-registration (auto-renames to `haltija-1`, etc.)
- Widget min-width 240px for better readability
- Recording buttons: 🎬 (start) / 💾 (stop/save)

**Future enhancements:**
- Direction change detection for drags (reversal = intentional)
- Virtual scrolling if buffer size increases beyond 100

### Phase 8: Recording & Test Generation ✅

With smart events, recording becomes useful:
- Record semantic actions, not raw events
- Generate readable test steps via `/recording/generate`
- AI can understand *intent* not just actions
- Suggest assertions based on observed behavior

**Implementation:**
- `POST /recording/generate` converts semantic events to DevChannelTest JSON
- Maps `input:typed` → TypeStep, `interaction:click` → ClickStep, etc.
- Auto-generates value assertions after typing
- Auto-generates URL assertions after navigation-triggering clicks
- Calculates realistic delays between steps from timestamps
- Human-readable descriptions: "Type 'user@example.com' in Email"
- Purpose annotations: "Enter email value", "Confirm navigation completed"

**Event capture refinements:**
- Fixed duplicate events for checkbox/radio/range inputs
- Added form event handlers: `form:submit`, `form:reset`, `form:invalid`
- Proper validation message capture with validity details

**Test suite infrastructure:**
- `POST /test/suite` runs multiple JSON test files
- Test page enhanced with form validation, scrollable containers, resizable elements
- Comprehensive test suites in `tests/` directory:
  - `test-page-actions.json` - 14 tests exercising all interactive elements
  - `test-recording-capture.json` - Verifies semantic event capture for all action types

### Phase 8.5: Shadow DOM Mutation Watching ✅

**Problem:** Mutations inside shadow DOMs weren't being watched, missing changes in web components.

**Solution:** Recursive shadow DOM piercing for mutation observers

- Mutation watching now pierces shadow boundaries
- Proper selectors for shadow DOM elements (e.g., `haltija-dev >>> .widget-header`)
- Auto-watches new shadow roots as they're attached
- Tree inspector also pierces shadow DOM with depth control
- React/framework detection works inside shadow DOMs

**Implementation:**
- `watchShadowRoots()` recursively finds and observes shadow DOMs
- Shadow-aware selector generation with `>>>` piercing combinator
- MutationObserver on each shadow root with same config as main observer

### Phase 8.6: Noise Reduction Metrics ✅

**Problem:** How effective is semantic aggregation? Need hard data.

**Solution:** On-demand stats endpoint (not per-event overhead)

- `GET /events/stats` returns noise reduction metrics
- Tracks raw DOM events vs emitted semantic events
- Breakdown by event type and category
- Per-preset event counts (minimal, interactive, detailed, debug)
- Duration tracking for rate calculations

**Real-world benchmarks (4 minutes heavy interaction):**

| Raw DOM Events | With `minimal` | With `interactive` |
|----------------|----------------|-------------------|
| 2,153 events | 78 events (96% reduction) | 244 events (89% reduction) |

**Savings by type:**
- Scrolling: 625 → 26 events (96% reduction)
- Typing: 446 → 53 events (88% reduction)
- Mouse movement: aggregated to hover/dwell events

**Implementation details:**
- `countRawEvent()` called in all DOM event handlers
- `semanticEventCounts` incremented when events emitted
- Stats reset when watching starts
- Dynamic component.js loading (fresh on each request for hot reload)

### Phase 9: AI-Assisted Testing ✅

The holy grail - AI that can:
- Watch you use a UI
- Understand intent, not just actions
- Generate robust tests that survive UI changes
- Suggest better UX based on observed behavior
- "User seemed confused here" insights

**Implementation:**
- Semantic event stream captures user intent, not raw DOM events
- `/recording/generate` converts events to test JSON
- AI can adapt selectors when UI changes
- CI integration with snapshot artifacts for debugging

**User Recording Flow:**
- User clicks 🎬 → `recording:started` event emitted
- User interacts with page → semantic events captured
- User clicks 💾 → `recording:stopped` event + recording saved server-side
- Agent fetches recording via `GET /recordings` and `GET /recording/:id`
- Perfect for "show me how you do X" workflows

**Endpoints:**
- `GET /recordings` - List all recordings (metadata)
- `GET /recording/:id` - Get full recording with events
- `DELETE /recording/:id` - Delete a recording

**Future enhancements (parking lot):**
- "User seemed confused here" detection (hesitation, backtracking)
- Automatic UX suggestions based on interaction patterns
- Heatmap generation from event data

### Phase 9.5: Extensible Docs System ✅

**Problem:** Agents need project-specific knowledge (style guides, API docs, testing conventions) but built-in docs are one-size-fits-all.

**Solution:** Pluggable docs directory with discovery endpoint

**Endpoints:**
- `GET /docs/list` - Discover all available docs (built-in + custom)
- `GET /docs/:name` - Fetch specific doc by name (e.g., `/docs/ux-crimes`)

**CLI flag:**
```bash
npx haltija --docs-dir ./my-docs
```

**Built-in docs:**
- `ux-crimes` - The Haltija Criminal Code (35 detectable UX anti-patterns)

**Custom docs:**
- Add any `.md` files to your docs directory
- Description auto-extracted from first heading
- Custom docs can override built-in docs (same filename)
- Agents discover available docs via `/docs/list`

**Use cases:**
- Project style guides
- API reference docs
- Testing conventions
- Business rules
- Accessibility requirements

**Response format:**
```json
{
  "docs": [
    {"name": "style-guide", "description": "Project Style Guide", "source": "custom"},
    {"name": "ux-crimes", "description": "The Haltija Criminal Code", "source": "builtin"}
  ],
  "customDocsDir": "/path/to/docs",
  "hint": "Use GET /docs/:name to fetch a specific doc"
}
```

**Headers:** `X-Doc-Source: custom|builtin` indicates doc origin.

### Phase 10: Native App Shell (Electron) ✅

**The "God Mode" Browser** - CSP bypass for universal compatibility.

#### Completed
- Electron app with minimal chrome (address bar, back/forward, tabs)
- Strip `Content-Security-Policy`, `X-Frame-Options` headers
- Auto-inject widget on page load
- Multi-tab support with proper window targeting (`?window=id`)
- Screen capture for agents (`/api/screenshot`)
- Keyboard shortcuts (Cmd+R reloads tab not shell, Cmd+T, Cmd+W, etc.)
- HTTPS→HTTP fallback for URL bar
- Circular icon with transparency
- DMG builds, Linux CI builds

#### Remaining (Distribution)
- Code signing / notarization (complicated by EU regulations)
- Auto-update server

### Phase 11: MCP Bridge (Claude Desktop Integration) ✅

**Native browser tools for Claude Desktop.**

#### Completed
- MCP server in `apps/mcp/` translates JSON-RPC to REST API
- Tool definitions auto-generated from `api-schema.ts` (single source of truth)
- All endpoints exposed as MCP tools (tree, query, click, type, etc.)
- Auto-setup via CLI: `haltija --setup-mcp`
- Auto-setup via Electron: First-run prompt configures Claude Desktop
- `/status` endpoint includes MCP configuration info for agents
- Comprehensive API documentation with examples in schema

#### How It Works
```
Claude Desktop ←→ MCP Server ←→ Haltija REST API ←→ Browser
     (JSON-RPC)      (apps/mcp)      (localhost:8700)
```

#### Setup Options
1. **CLI**: `bunx haltija --setup-mcp` (recommended)
2. **Electron**: Prompted on first launch of Haltija Desktop
3. **Manual**: Add to `claude_desktop_config.json`

#### Future Enhancement (Parking Lot)
- Live event stream via MCP Resource (nice-to-have)
