# Dev Channel Roadmap

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
- Node-compatible CLI (`npx tosijs-dev` works)

## In Progress

### Phase 5: Test Runner & AI QA Agent

#### Manual Test Scripts (Playwright but good)
- Add `runTest(test: DevChannelTest)` to client.ts
- Execute steps sequentially with delays
- Run assertions and collect results
- REST endpoint for running tests
- Human-readable test format (not code)

#### AI as QA Professional
- **Exploratory testing**: Agent fuzzes around, finds edge cases
- **Test plan generation**: Agent inspects page, proposes what to test
- **Bug reports**: Structured reports with repro steps, screenshots, DOM state
- **Regression verification**: "Is bug #123 fixed?" → Agent checks
- **Accessibility audits**: WCAG compliance, contrast ratios, focus order, ARIA

#### Smart Input Behaviors
- **Segmented inputs**: Detect split fields (OTP, credit card 4-4-4-4, SSN, phone)
  - Auto-tab between segments with natural pause
  - Type at human speed across the group
- **Password fields**: Occasional show/hide toggle, variable timing
- **Restricted inputs**: Respect maxlength, input masks, validation
- **Form field detection**: Know when it's email vs phone vs credit card
- **Phone/Zip nightmare handling**: 
  - Detect expected format from placeholder, mask, or validation errors
  - Try raw digits first, adapt if rejected
  - Handle country code dropdowns
  - Cope with auto-formatting that fights input
  - Report badly-behaved fields as accessibility/UX bugs

#### Idle Behaviors (Bug Discovery + Human Mimicry)
- Random micro-movements when "thinking"
- Occasional scroll jitter
- Tab between fields without typing
- Hover over elements before clicking
- These uncover bugs (hover states, focus traps, tooltip issues)

## Planned

### Phase 6: Smart Event Streams (THE BIG ONE)

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

### Phase 7: Log Viewer Widget

Use xinjs-ui `data-table` patterns:
- Virtual scrolling (handle thousands of events)
- Filterable by category
- Color-coded by type
- Expandable details
- Real-time streaming
- Compact by default, expand on click

### Phase 8: Recording & Test Generation

With smart events, recording becomes useful:
- Record semantic actions, not raw events
- Generate readable test steps
- AI can understand *intent* not just actions
- Suggest assertions based on observed behavior

### Phase 9: AI-Assisted Testing

The holy grail - AI that can:
- Watch you use a UI
- Understand intent, not just actions
- Generate robust tests that survive UI changes
- Suggest better UX based on observed behavior
- "User seemed confused here" insights

### Phase 10: Native App Shell (Electron/Tauri)

**The "God Mode" Browser** - CSP bypass for universal compatibility.

#### Core Features
- Strip `Content-Security-Policy`, `X-Frame-Options` headers
- Auto-inject tosijs-dev widget on page load
- Minimal chrome (address bar, back/forward, agent status)
- Works on any site, no bookmarklet needed

#### Screen Capture for Agents
- Full page screenshots on demand
- Element-specific captures
- **Visual accessibility testing**: Actual rendered colors including:
  - Background blur/translucency
  - Glows and shadows
  - Overlapping elements
  - Computed contrast ratios from pixels, not CSS
- Video recording of sessions

#### Distribution Options
1. **DIY (open source)** - Build script, user code-signs
2. **Pre-built (paid)** - Signed, notarized, auto-updates

#### App Store Version
- Mac App Store distribution (sandboxed, trusted)
- One-click install for non-technical users
- Apple handles payments

### Phase 11: Apple Intelligence Integration

**Private, on-device AI for basic automation.**

- Default AI backend (free, no API keys needed)
- On-device processing (privacy-first)
- Good enough for basic QA: find elements, fill forms, verify state
- Optional upgrade path to Claude/OpenAI for advanced tasks

#### Positioning
- "Works with your Mac's built-in AI"
- Enterprise-friendly: DOM never leaves the device
- Differentiator vs. cloud-only tools

### Phase 12: MCP Bridge (Claude Desktop Integration)

**Buzzword compliance for Claude Desktop users.**

- Thin wrapper: translates MCP JSON-RPC to REST API
- `browser_act` → `POST /click`, `POST /type`
- `browser_sense` → `GET /tree`, `GET /location`
- Live event stream via MCP Resource
- No new capabilities, just integration

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

### Visual Replay Cursor

When replaying tests or recordings, show a visible animated cursor:
- **Cursor graphic** - Smooth movement to click targets
- **Click ripple** - Visual feedback when clicking
- **Typing animation** - Text appearing character-by-character with blinking caret
- **Scroll indicator** - Show scroll direction/distance
- **Hover glow** - Highlight elements being interacted with

Makes replays feel alive and helps users understand what the agent is doing.

## Ideas Parking Lot

- Sourcemaps for transpiled code debugging
- Session replay (video-like scrubbing)
- Heatmaps from hover/click data
- A/B test integration
- Performance metrics (LCP, FID, CLS)
- Network request monitoring
- Screenshot capture on events
- Diff between expected/actual DOM
