# tosijs-dev

**Give AI agents eyes and hands in the browser.**

tosijs-dev lets AI agents see and control live browser tabs - not headless puppets, but the actual pages your users see. Query the DOM, click buttons, fill forms, watch for changes, run JavaScript. The agent works like a QA engineer, not a test script.

## Why This Matters

**Current state of AI + browsers:**
- Puppeteer/Playwright control headless browsers the agent spawns
- The agent can't see what the user is looking at
- Test scripts break when the UI changes
- Engineers debug the test harness, not the product

**With tosijs-dev:**
- Agent sees the user's live browser session
- Explores the app like a human would
- Finds real bugs, writes repro steps in plain English
- Verifies fixes without maintaining brittle test code

This isn't "better test automation." It's replacing manual QA with an agent that works 24/7, never gets bored, and catches race conditions humans miss.

## Quick Start

```bash
# Start the server
bunx tosijs-dev

# For HTTPS sites
bunx tosijs-dev --https

# Both HTTP and HTTPS  
bunx tosijs-dev --both
```

Visit the server URL, drag the bookmarklet to your toolbar. Click it on any page.

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
bunx tosijs-dev

# Or install globally
npm install -g tosijs-dev
tosijs-dev

# Or add to your project
npm install tosijs-dev
```

Works with Bun (preferred) or Node.js.

## CLI Options

```bash
tosijs-dev              # HTTP on port 8700
tosijs-dev --https      # HTTPS on port 8701 (auto-generates certs)
tosijs-dev --both       # Both HTTP and HTTPS
tosijs-dev --port 3000  # Custom HTTP port
```

Environment variables:
- `DEV_CHANNEL_PORT` - HTTP port (default: 8700)
- `DEV_CHANNEL_HTTPS_PORT` - HTTPS port (default: 8701)
- `DEV_CHANNEL_MODE` - `http`, `https`, or `both`

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

## Full API Reference

See the [complete API documentation](./API.md) or run:

```bash
curl http://localhost:8700/docs
```

## License

MIT
