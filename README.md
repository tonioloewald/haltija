# Haltija 🧝

**Give AI agents eyes and hands in the browser.**

Haltija lets AI agents see and control live browser tabs - not headless puppets, but the actual pages your users see. Query the DOM, click buttons, fill forms, watch for changes, run JavaScript. The agent works like a QA engineer, not a test script.

## Why This Matters

### The Immediate Win: AI That Can See

Before this tool, working with an AI on frontend code was painful:

1. You describe what's wrong: "the tab isn't underlining"
2. AI guesses at the cause, suggests a fix
3. It doesn't work
4. You try to explain what happened - screenshots, copy-pasted HTML, "it's still not working"
5. AI guesses again
6. Frustration. Context lost. Velocity destroyed.

**Now:**

1. AI looks at the page via `/tree`
2. Sees the actual DOM, the actual classes, the actual structure
3. Understands immediately: "the `active` class is there but your CSS selector expects `.tab-bar > .active` and the structure is `.tab-bar > .tab-container > .tab.active`"
4. Fixes it. Two minutes.

An AI that can see is fundamentally different from an AI that has to be told.

### The Bigger Picture

**Current state of AI + browsers:**
- Puppeteer/Playwright control headless browsers the agent spawns
- The agent can't see what the user is looking at
- Test scripts break when the UI changes
- Engineers debug the test harness, not the product

**With Haltija:**
- Agent sees the user's live browser session
- Explores the app like a human would
- Finds real bugs, writes repro steps in plain English
- Verifies fixes without maintaining brittle test code

This isn't "better test automation." It's giving AI the ability to understand what's actually on screen - during development, during testing, during debugging. Everything else follows from that.

## Quick Start

```bash
# Start the server
bunx haltija

# For HTTPS sites
bunx haltija --https

# Both HTTP and HTTPS  
bunx haltija --both
```

### Option 1: Bookmarklet
Visit the server URL, drag the bookmarklet to your toolbar. Click it on any page.

### Option 2: One-liner (recommended for development)
Add this to your app - it only runs on localhost:

```javascript
/^localhost$|^127\./.test(location.hostname)&&import('http://localhost:8700/dev.js')
```

Safe to leave in your codebase - it's a no-op in production. You'll see a colored console badge when connected.

### Option 3: Headless Mode (for CI)
```bash
bunx haltija --headless --headless-url http://localhost:3000
```

Starts Playwright Chromium with the widget auto-injected. Perfect for CI pipelines.

**For AI agents** - one endpoint has everything:
```bash
curl http://localhost:8700/docs
```

## What Agents Can Do

```bash
# Where am I?
curl http://localhost:8700/location

# What's on the page?
curl -X POST http://localhost:8700/tree -d '{"selector":"body","depth":3}'

# Find all buttons
curl -X POST http://localhost:8700/inspectAll -d '{"selector":"button"}'

# Click one
curl -X POST http://localhost:8700/click -d '{"selector":"#submit"}'

# Type into an input
curl -X POST http://localhost:8700/type -d '{"selector":"#email","text":"test@example.com"}'

# Watch what changes
curl -X POST http://localhost:8700/mutations/watch
curl -X POST http://localhost:8700/click -d '{"selector":"#save"}'
curl http://localhost:8700/messages  # See exactly what changed

# Run arbitrary JavaScript
curl -X POST http://localhost:8700/eval -d '{"code":"localStorage.getItem(\"token\")"}'

# Point at something for the human
curl -X POST http://localhost:8700/highlight -d '{"selector":".error","label":"Bug is here"}'
```

## Key Capabilities

**DOM Exploration**
- `/tree` - Structured DOM tree with configurable depth
- `/inspect` - Deep element inspection (box model, ARIA, computed styles)
- `/inspectAll` - Inspect multiple matching elements
- Shadow DOM piercing built in

**Interaction**
- `/click` - Full mouse event lifecycle (not just `.click()`)
- `/type` - Type into inputs with proper events
- `/drag` - Drag elements with realistic timing
- `/eval` - Execute JavaScript in page context

**Observation**
- `/mutations/watch` - Watch DOM changes with smart filtering
- `/events/watch` - Semantic event stream (aggregated, not raw)
- `/console` - Captured console output (logs, errors, warnings)
- `/highlight` - Visual pointer for human collaboration

**Navigation**
- `/location` - Current URL and title
- `/navigate` - Go to URL
- `/refresh` - Reload page

## Smart Mutation Filtering

Auto-detects React, Vue, Tailwind, and filters out noise:

```bash
# Smart mode auto-detects your framework
curl -X POST http://localhost:8700/mutations/watch -d '{"preset":"smart"}'

# Or be specific
curl -X POST http://localhost:8700/mutations/watch -d '{"preset":"react"}'
curl -X POST http://localhost:8700/mutations/watch -d '{"preset":"tailwind"}'
```

See only the changes that matter, not framework internals or utility class churn.

## Semantic Events (Context History Stream)

Raw DOM events are noise. Semantic events are signal.

```bash
# Start watching with a preset
curl -X POST http://localhost:8700/events/watch -d '{"preset":"interactive"}'

# Get the event buffer
curl http://localhost:8700/events

# Stop watching
curl -X POST http://localhost:8700/events/unwatch
```

**What you get:**
- `input:typed` - "user typed 'hello@example.com'" (not 18 keydown events)
- `input:checked` - "user checked Accept Terms" (checkbox/radio, no duplicates)
- `input:changed` - "user selected 'Large'" (select, date, color, range inputs)
- `interaction:click` - "user clicked Submit button" (with element text, position)
- `interaction:drag` - "user dragged slider from 50 to 75" (not 100 mousemove events)
- `scroll:stop` - "user scrolled to #pricing section" (not 200 scroll events)
- `hover:dwell` - "user hovered on Help link for 1.2s" (not mousemove spam)
- `navigation:navigate` - "user went from /login to /dashboard"
- `form:submit` - "user submitted Contact form" (with form metadata)
- `form:reset` - "user reset form"
- `form:invalid` - "email field failed validation: missing @" (with validity details)

**Presets:**
- `minimal` - clicks, submits, navigation only
- `interactive` - + typing, focus changes
- `detailed` - + hover, scroll
- `debug` - everything including mutations

**Why this matters:**
The AI can ask "what just happened?" and get a meaningful answer:
"User typed email, clicked Submit, got error 'Invalid password'"

Not: "keydown e, keydown m, keydown a, keydown i, keydown l, mousedown, mouseup, click..."

## Log Viewer Widget

Click the 📋 button on the widget to open the interactive event log. It auto-starts semantic event watching so you can immediately see what's happening.

**Features:**
- **Filter by category** - clicks, input, navigation, hover, focus
- **Color-coded entries** - instantly distinguish event types
- **Expandable details** - click any entry to see the full payload
- **Auto-scroll** - stays at bottom for new events, pauses when you scroll up
- **Drag detection** - captures resize handles, sliders, and other drag interactions

The log viewer is perfect for:
- Debugging "what just happened?" during development
- Understanding user interaction patterns
- Verifying that your UI responds correctly to events
- Watching an AI agent interact with your page in real-time
- **Building tests** - the event stream becomes test steps
- **Failure analysis** - see exactly what led up to a crash or bug

**Same data, two views.** The log viewer shows exactly what AI agents see via the API:

```bash
# Same event stream the log viewer displays
curl http://localhost:8700/events

# Get events since a timestamp (for polling)
curl "http://localhost:8700/events?since=1736600000000"
```

Humans and AI agents share the same context history stream - both can answer "what just happened?" without re-querying the DOM.

## Smart Element Selectors

Element identification prioritizes what engineers actually use:

1. **ARIA labels** - `button[aria-label="Close dialog"]`
2. **Form labels** - `input labeled "Email address"`
3. **Semantic landmarks** - `section "Pricing"`, `nav`, `footer`
4. **Button/link text** - `button "Sign Up"`, `link "Learn more"`
5. **Title/tooltip** - `img[title="Company logo"]`
6. **Context** - `input[2] in form "Contact us"`

**Not:** `div.flex.mt-4.p-2 > button.btn.btn-primary`

This creates a virtuous cycle: apps with good accessibility get useful selectors. Apps without get `div[47] in body` - a nudge to add semantic markup that helps everyone (users, screen readers, *and* testing tools).

## Security Model

- Widget is always visible when agent is connected (no silent snooping)
- User can pause, minimize, or kill the widget at any time
- Localhost only by default
- HTTPS mode with auto-generated certificates (mkcert or openssl)

## Architecture

```
Browser Tab          Server (Bun)         AI Agent
    │                    │                   │
    │◄── WebSocket ─────►│◄── REST API ─────►│
    │                    │                   │
    └─ Widget injects    └─ Routes messages  └─ curl/fetch
       via bookmarklet      Buffers state       Any LLM
```

The agent doesn't need special libraries. It's just HTTP.

## Installation

```bash
# Run directly
bunx haltija

# Or install globally
npm install -g haltija
haltija

# Or add to your project
npm install haltija
```

Works with Bun (preferred) or Node.js.

## CLI Options

```bash
haltija                    # HTTP on port 8700
haltija --https            # HTTPS on port 8701 (auto-generates certs)
haltija --both             # Both HTTP and HTTPS
haltija --port 3000        # Custom HTTP port
haltija --headless         # Start Playwright browser with widget auto-injected
haltija --headless-url URL # Headless mode, navigate to specific URL
```

Environment variables:
- `DEV_CHANNEL_PORT` - HTTP port (default: 8700)
- `DEV_CHANNEL_HTTPS_PORT` - HTTPS port (default: 8701)
- `DEV_CHANNEL_MODE` - `http`, `https`, or `both`

## JSON Tests

Tests are pure JSON - no code, just data. The AI writes them by exploring the page - or you can **record them automatically** from user interactions.

### Recording Tests

**One-click recording from the widget:**

1. Click the ⏺ button in the widget header to start recording
2. Use the app normally - click, type, navigate
3. Click ⏺ again to stop
4. A modal appears with the generated test JSON
5. Edit the test name, then Copy or Save

**Via API** (for automation):

```bash
# Start watching semantic events
curl -X POST http://localhost:8700/events/watch -d '{"preset":"interactive"}'

# ... use the app (click, type, navigate) ...

# Generate a test from the recorded events
curl -X POST http://localhost:8700/recording/generate \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Login Flow",
    "description": "Test user login",
    "url": "http://localhost:3000/login",
    "addAssertions": true
  }'
```

The generator converts semantic events to test steps:
- `input:typed` → TypeStep with value assertion
- `interaction:click` → ClickStep (with URL assertion if navigation follows)
- Calculates realistic delays between steps
- Generates human-readable descriptions: "Type 'user@example.com' in Email"

### Editing Generated Tests

The generated JSON is a starting point. Common edits:

**Add assertions** - verify the app did what you expected:
```json
{
  "action": "assert",
  "assertion": { "type": "exists", "selector": ".success-message" },
  "description": "Success message appears"
}
```

**Add waits** - for slow operations:
```json
{
  "action": "wait",
  "wait": { "type": "selector", "selector": ".loading", "state": "hidden" },
  "description": "Wait for loading to complete"
}
```

**Fix selectors** - recorded selectors might be brittle:
```json
// Before (fragile)
"selector": "body > div:nth-child(3) > form > button"

// After (robust)  
"selector": "button[type='submit']"
// or
"selector": "button:has-text('Submit')"
```

**Remove noise** - delete accidental clicks or redundant steps

**Add descriptions** - explain intent for future maintainers:
```json
{
  "action": "click",
  "selector": "#checkout",
  "description": "Proceed to checkout",
  "purpose": "User completes their purchase flow"
}
```

**Assertion types available:**
- `exists` / `not-exists` - element presence
- `text` - element text content (exact or pattern)
- `value` - input field value
- `visible` / `hidden` - visibility state
- `url` - current URL (exact or pattern)
- `console-contains` - check console output

### Writing Tests Manually

The AI can also write tests by exploring the page:
1. Inspects the page via `/tree` and `/inspectAll`
2. Understands the UI semantically (not just pixels)
3. Writes a test plan as JSON
4. Runs it via `/test/run`
5. On failure, captures a snapshot for "time travel" debugging

Test format:

```json
{
  "version": 1,
  "name": "Login flow",
  "description": "Verify user can log in with valid credentials",
  "url": "http://localhost:3000/login",
  "createdAt": 1736600000000,
  "createdBy": "human",
  "steps": [
    {
      "action": "type",
      "selector": "#email",
      "text": "user@example.com",
      "description": "Enter email address",
      "purpose": "Fill in the email field with valid email"
    },
    {
      "action": "type", 
      "selector": "#password",
      "text": "password123",
      "description": "Enter password"
    },
    {
      "action": "click",
      "selector": "button[type=submit]",
      "description": "Click login button"
    },
    {
      "action": "assert",
      "type": "exists",
      "selector": ".dashboard",
      "description": "Dashboard appears",
      "purpose": "Verify login succeeded and user lands on dashboard"
    }
  ]
}
```

Run tests via API:

```bash
# Run a single test
curl -X POST http://localhost:8700/test/run \
  -H "Content-Type: application/json" \
  -d @login-test.json

# Validate test format
curl -X POST http://localhost:8700/test/validate \
  -H "Content-Type: application/json" \
  -d @login-test.json

# Run a test suite
curl -X POST http://localhost:8700/test/suite \
  -H "Content-Type: application/json" \
  -d '{"tests": ["./tests/login.json", "./tests/checkout.json"]}'
```

### Snapshots (Time Travel Debugging)

When a test fails, a snapshot is automatically captured. The `snapshotId` is included in the test result.

```bash
# Get the snapshot
curl http://localhost:8700/snapshot/snap_1736600123456_abc123
```

The snapshot includes:
- DOM tree at the moment of failure
- Console logs up to that point
- Viewport dimensions
- Test context (which step failed, why)

This lets you "time travel" to the exact state when the test broke - no more guessing.

```bash
# Capture a snapshot manually
curl -X POST http://localhost:8700/snapshot

# List all snapshots
curl http://localhost:8700/snapshots
```

## CI Integration

Replace brittle test scripts with AI-powered QA. Instead of meaningless stack traces and flaky tests, get intelligent analysis of what went wrong.

### GitHub Actions

```yaml
name: AI QA
on: [push, pull_request]

jobs:
  ai-qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Start app
        run: npm start &
        
      - name: Run AI QA
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx haltija --headless --headless-url http://localhost:3000 &
          sleep 3
          
          # Let Claude run the tests
          npx claude --print "
            Run the test suite at ./tests/*.json using the haltija API at localhost:8700.
            For each test, report: passed/failed, and if failed explain what went wrong
            and suggest a fix. Output as markdown.
          " > qa-report.md
          
      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: qa-report
          path: qa-report.md
```

### GitLab CI

```yaml
ai-qa:
  stage: test
  script:
    - npm start &
    - npx haltija --headless --headless-url http://localhost:3000 &
    - sleep 3
    - |
      npx claude --print "
        Run the JSON tests in ./tests/ against localhost:8700.
        Report results as markdown with analysis.
      " > qa-report.md
  artifacts:
    paths:
      - qa-report.md
```

### Why AI QA?

| Traditional CI | AI QA |
|----------------|-------|
| `Error: element not found` | "The submit button moved from #submit to .btn-primary after the redesign" |
| `Timeout after 30000ms` | "The API is returning 503. Check if the database connection pool is exhausted" |
| `AssertionError: false !== true` | "Login fails because the session cookie isn't being set - likely a SameSite issue" |

The AI reads your tests, understands the intent, runs them, and explains failures in context.

## Use Cases

**AI-Powered QA**
- Agent explores your app, finds bugs, writes repro steps
- No test scripts to maintain
- Catches timing issues, race conditions, edge cases

**Support Automation**
- Agent sees exactly what the customer sees
- Can reproduce issues in real-time
- Guides users through complex workflows

**Accessibility Testing**
- Inspect ARIA attributes across the whole page
- Verify keyboard navigation works
- Check focus management

**Development Assistance**
- AI pair programmer that can actually see your app
- Debug CSS/layout issues together
- Prototype interactions

**UX Auditing** *(coming soon)*
- Automatically flags common anti-patterns during test runs
- Bad form inputs, accessibility traps, mobile hostility
- Built-in heuristics detect 50+ "UX crimes"

## Full API Reference

See the [complete API documentation](./API.md) or run:

```bash
curl http://localhost:8700/docs
```

## License

MIT
