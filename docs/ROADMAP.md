# Roadmap to 11/10

Current state: **9/10** - Best-in-class developer tool. GET support for actions, `/key` endpoint, diff-on-action, iframe visibility, simplified API.

Goal: **10/10** - The standard way AI agents interact with browsers.

Beyond: **11/10** - Agent-as-a-Service for browsers. Zero-config AI automation.

**Current Focus: Phase 5 - CI Integration POC**
- ✅ CI documentation written (`docs/CI-INTEGRATION.md`)
- 🔄 Dogfooding in real CI environment
- 🔄 Discovering actual friction points

**Recent Progress (v0.1.9):**
- ✅ GET support for `/click`, `/type`, `/key` - simpler curl commands
- ✅ `/key` endpoint for keyboard shortcuts with realistic event lifecycle
- ✅ `diff: true` option - see what changed after actions
- ✅ `/form` endpoint - extract all form values as JSON
- ✅ Iframe visibility - always show `frameSrc` even for cross-origin
- ✅ `/status` includes windows - fewer round trips
- ✅ Contextual tree flags - validation state, wouldScroll, focused

---

## Phase 1: Documentation & Discovery (Low effort, high impact)

The product is better than people can tell. Fix that first.

### 1.1 Landing Page Hero
**Problem**: README buries the lede. Users don't immediately understand the value.

**Solution**:
- Lead with the one-liner setup: `bunx haltija` + one script tag
- 30-second video showing AI controlling a real app
- Clear "Get Started in 2 Minutes" path

### 1.2 Consolidate Documentation
**Problem**: Docs scattered across CLAUDE.md, /docs, /api, embedded markdown, README.

**Solution**:
- Single docs site or well-organized docs/ folder
- Clear hierarchy: Quick Start → Guides → API Reference → Architecture
- Remove duplication, cross-reference instead

### 1.3 Use Case Galleries
**Problem**: Users don't know what's possible.

**Solution**:
- "Recipes" page with common workflows:
  - Testing a login flow
  - Exploring a new codebase
  - Recording and replaying a bug report
  - Generating tests from manual exploration
- Each recipe: problem, solution, code, expected output

### 1.4 API Reference Polish
**Problem**: /api endpoint is a wall of text.

**Solution**:
- Structured JSON output option for programmatic consumption
- Interactive examples (curl commands that work)
- Group by workflow, not just category

---

## Phase 2: Developer Experience & "Hobbyist Lock-In" (Medium effort, high impact)

Make it impossible for an individual developer to use anything else.

### 2.1 Node.js Support
**Problem**: Bun-only limits adoption. Many teams aren't on Bun yet.

**Status**: Server uses `Bun.serve()` - Node.js would require abstracting HTTP layer. Low priority since:
- Desktop app bundles the server (no runtime dependency)
- REST/MCP API means any client works regardless of server runtime
- Bun installs easily: `bunx haltija`

**Solution** (if needed):
- Abstract HTTP server to support both Bun and Node
- `npx haltija` as alternative install path

### 2.2 Browser Extension
**Problem**: Bookmarklet requires manual click per page. CSP blocks injection on some sites.

**Solution**:
- Chrome extension for persistent injection
- Firefox extension
- Survives navigation, works on CSP-restricted sites
- Toggle on/off per-site

### 2.3 Better Error Messages
**Problem**: Some failures are still cryptic.

**Solution**:
- Audit all error paths
- Every error should suggest a fix
- "Element not found" → "Element not found: #submit. Did you mean: #submit-btn, button.submit?"

### 2.4 TypeScript SDK
**Problem**: Raw HTTP calls are tedious.

**Solution**:
```typescript
import { Haltija } from 'haltija'

const h = new Haltija('http://localhost:4000')
await h.click('#submit')
const tree = await h.tree({ depth: 2 })
```
- Type-safe, auto-complete friendly
- Async/await native
- Publish to npm

### 2.5 "Watch and Learn" Mode ✅ (Mostly done)
**Problem**: Copy/pasting prompts is low friction, but *zero* friction is better.

**Status**: Recording infrastructure exists (`/recording/start`, `/recording/stop`, `/recording/generate`). Generates test JSON from user actions.

**Remaining**:
- Add prompt generation option (convert recording to Claude prompt, not just test JSON)
- Or: document that Claude can read the test JSON and replicate the workflow

**Low priority**: CLI test runner (`bunx haltija run test.json`) - works via API already, CLI feels like regression to Playwright model

**Key differentiator**: We connect to a *live browser* you're already using - no cold start, existing auth/cookies/state preserved. Test the actual thing you're looking at, not a sterile simulation. Need isolation? Open a new tab - instant fresh context without browser spinup.

### 2.6 "Flight Recorder" UI
**Problem**: "Click with Diff" produces powerful data, but it's just JSON.

**Solution**:
- Visual playback UI in Desktop App
- Timeline view: Action → DOM Diff (visualized) → Result
- Let humans *see* the diff the way the AI saw it
- Builds trust in the "black box" of AI decision-making

### 2.7 Skill Marketplace / Community Registry
**Problem**: Sharing automation recipes is ad-hoc.

**Solution**:
- GitHub repo or lightweight registry of "Haltija Skills"
- Pre-built skills for top SaaS apps (Stripe checkout, Gmail, etc.)
- `haltija-skill-stripe-checkout`, `haltija-skill-gmail-cleanup`
- Install Haltija → instantly have robust skills for common workflows

---

## Phase 3: Platform Expansion ✅ (Mostly done)

Build scripts work for all platforms. v0.1.9 includes:
- ✅ macOS: DMG (arm64, x64)
- ✅ Windows: NSIS installer + portable exe
- ✅ Linux: AppImage + deb (arm64)

### 3.1 Document Local Build Process
**Problem**: Users don't know they can build locally.

**Solution**:
- Document `npm run build:mac/win/linux` in apps/desktop
- Explain Playwright-like "build where you are" model
- Add to Quick Start for non-macOS users

### 3.2 Windows Testing ✅ (Build works)
**Problem**: Windows build untested.

**Status**: Build scripts work, produces installer + portable exe. Needs real Windows testing.

**Solution**:
- Test build script on Windows
- Fix any platform-specific issues
- Add Windows to CI build matrix

### 3.3 Pre-built Binaries
**Problem**: Building locally requires dev environment.

**Solution**:
- GitHub releases with macOS (arm64, x64), Linux, Windows builds
- Automated release workflow on tag

### 3.4 Docker Image
**Problem**: Cloud deployment requires manual setup.

**Solution**:
```bash
docker run -p 4000:4000 haltija/haltija
```
- Pre-built image with server ready
- Headless mode for CI environments
- Xvfb for headed mode in containers

---

## Phase 4: Enterprise Readiness (High effort, high impact for adoption)

What's needed for production deployment at scale.

**Approach**: Dogfood in real CI environment first. The items below are hypotheses - actual friction points will emerge from integration with real workflows (CI systems, Copilot, PR processes). Build what's actually needed, not what's imagined.

### 4.1 API Authentication
**Problem**: No auth on REST API. Anyone on localhost can control the browser.

**Solution**:
- Optional API key authentication
- Token-based auth for multi-user scenarios
- Configurable via environment variable or config file

### 4.2 Audit Logging
**Problem**: No record of what commands were executed.

**Solution**:
- Log all commands with timestamps
- Optional persistence to file or external service
- Queryable history: "What did the agent do in the last hour?"

### 4.3 Rate Limiting
**Problem**: Runaway agent could spam commands.

**Solution**:
- Configurable rate limits per endpoint
- Backpressure signaling to agents
- Circuit breaker for repeated failures

### 4.4 Multi-Browser Support
**Problem**: One browser per server instance.

**Solution**:
- Connection pooling for multiple browser instances
- Session isolation
- Parallel test execution

### 4.5 Automated Test Reports
**Problem**: Managers don't trust AI. They need to see the work.

**Solution**:
- Generate markdown or HTML reports after test runs
- "Checked 40 flows. Found 2 bugs."
- Screenshots and plain-English reproduction steps for failures
- Replaces Jira tickets with artifacts of proof
- Exportable for stakeholder review

### 4.6 "Signed/Safe" Enterprise Mode
**Problem**: Security teams hate "Magic Apps" that strip CSP.

**Solution**:
- Browser extension deployed via Group Policy
- Respects CSP but gets necessary access legitimately
- Checks the compliance box for enterprise security reviews
- Optional: extension-only mode (no CSP stripping)

### 4.7 Fleet Orchestration
**Problem**: Localhost is a ceiling for enterprise scale.

**Solution**:
- Spin up 50+ headless Haltija instances in Kubernetes
- Hammer staging environments in parallel
- "My personal AI assistant" → "Our CI/CD Infrastructure"
- Central management console for fleet status

---

## Phase 5: Cloud & CI Integration (High effort, transformative impact)

This is the 10/10 unlock.

### 5.1 Hosted Haltija Cloud
**Problem**: Requires local server for every user.

**Solution**:
- Hosted service: sign up, get API key, inject widget
- No local server needed
- Usage-based pricing

### 5.2 CI/CD Integration
**Problem**: Running in CI requires manual setup.

**Solution**:
- GitHub Action: `uses: haltija/action@v1`
- GitLab CI template
- Pre-configured for common setups (Next.js, Vite, CRA)

### 5.3 AI QA Agent
**Problem**: Users still have to write test specs.

**Solution**:
- Agent that explores app automatically
- Generates test plan from exploration
- Runs tests, reports failures in plain English
- Auto-fixes tests when UI changes intentionally

### 5.4 PR Integration
**Problem**: Test results are separate from code review.

**Solution**:
- PR comments with test results
- Screenshots of failures
- "This test broke because button moved from header to sidebar"
- Suggested fixes as PR suggestions

---

## Phase 6: Ecosystem (Ongoing)

Build the moat through adoption.

### 6.1 Framework Integrations
- Next.js plugin
- Vite plugin
- Remix loader
- One-line setup for each framework

### 6.2 Test Framework Bridges
- Jest integration
- Vitest integration
- Export to Playwright format (escape hatch)

### 6.3 IDE Extensions
- VS Code extension: run Haltija tests from editor
- See test status inline with code
- Jump to failing element in browser

### 6.4 Community
- Discord/Slack for users
- Example repository with real-world patterns
- Blog posts on advanced usage

---

## Priority Matrix

| Phase | Effort | Impact | Do When |
|-------|--------|--------|---------|
| 1. Docs & Discovery | Low | High | Now |
| 2. Developer Experience | Medium | High | Next |
| 3. Platform Expansion | Low-Medium | Medium | ✅ Done |
| 4. Enterprise Readiness | High | Medium | Dogfood first |
| 5. Cloud & CI | High | Transformative | The 10/10 |
| 6. Ecosystem | Ongoing | Cumulative | Continuous |
| 7. Hosted Service | Medium | Business | The 11/10 |

---

## What Gets Us to 10/10 (and Beyond)

A product is 10/10 when it becomes the obvious default choice.

**We're at 9/10 now**: Best-in-class developer tool. GET support, `/key`, diff-on-action, simplified API.

**Phase 2 additions lock in developers**:
- "Watch and Learn" mode (zero-friction automation)
- Flight Recorder UI (visualize the AI's view)
- Skill Marketplace (community moat)

**Phase 4-5 unlocks enterprise**:
- Fleet orchestration (Kubernetes scale)
- Automated reports (artifacts of proof)
- Signed/Safe mode (compliance checkbox)

**Phase 5 gets us to 10/10**: AI QA in CI that just works. Push code, get human-readable test results, auto-fixed tests, real bug reports.

**Phase 7 gets us to 11/10**: Agent-as-a-Service. One curl command = AI controlling a browser. No setup, no MCP, no local Claude. Just:
```bash
curl https://yourco.haltija.net/do -d '{"task": "fill out the signup form"}'
```

The architecture makes this possible: we route messages, we don't run browsers. Near-zero marginal cost while competitors burn money on browser infrastructure.

---

## Phase 7: Hosted Service & Agent-as-a-Service (The 11/10)

This is what makes Haltija a business, not just a tool.

### The Architecture Insight

**Why this is cheap to run:**
- Competitors (Browserbase, Playwright Cloud) host actual browsers = $$$
- Haltija just routes messages between agent and browser
- Browser runs on customer's machine/CI (they pay for compute)
- Our relay is WebSocket routing = pennies

**Cost projection:**
| Users | Concurrent Sessions | Monthly Cost |
|-------|---------------------|--------------|
| 1,000 | ~200 | ~$5 |
| 10,000 | ~2,000 | ~$20 |
| 100,000 | ~20,000 | ~$50 |

That's 95%+ margins on the relay itself.

### 7.1 Core Infrastructure

**Firebase stack (known quantity):**
- **Auth**: Firebase Auth (OAuth, email, API keys for CI)
- **Database**: Firestore for users, subscriptions, test definitions, run history
- **Storage**: Firebase Storage for recordings, screenshots, reports
- **Hosting**: Firebase Hosting for dashboard UI

**Relay service (Fly.io):**
- Lightweight WebSocket routing
- Scales horizontally
- Global edge locations
- ~$20/mo handles thousands of customers

### 7.2 Domain Structure

```
haltija.dev           - marketing site, docs
app.haltija.dev       - dashboard (Firebase Hosting)
api.haltija.dev       - shared API (free tier, auth via token)

*.haltija.net         - customer-specific endpoints
acme.haltija.net      - Acme Corp's dedicated relay
initech.haltija.net   - Initech's dedicated relay
```

**Benefits of customer subdomains:**
- Session isolation (can't accidentally route to wrong customer)
- Natural CORS scoping
- Per-customer rate limiting
- Premium feel for enterprise

### 7.3 Payments & Subscriptions

**Stripe integration:**
- Usage-based pricing model
- Metered billing on commands/test runs

**Proposed tiers:**
| Tier | Price | Limits |
|------|-------|--------|
| Free | $0 | 1K commands/mo, 10 test runs |
| Pro | $29/mo | 50K commands/mo, 500 test runs |
| Team | $99/mo | 500K commands/mo, unlimited tests |
| Enterprise | Custom | Unlimited, SLA, dedicated subdomain |

### 7.4 Telemetry & Analytics

**Instrument Haltija to learn what works:**

```
┌─────────────────────────────────────────────────────────────┐
│                    Telemetry Events                          │
├─────────────────────────────────────────────────────────────┤
│ Usage:     command_invoked, test_run_started, test_passed   │
│ Utility:   command_success_rate, avg_response_time          │
│ Usability: command_retry_count, error_frequency, feedback   │
└─────────────────────────────────────────────────────────────┘
```

**Per-command tracking:**
- Invocation count
- Success/failure rate
- Average latency
- Common error messages
- Retry patterns (agent retried 3x = friction signal)

### 7.5 Agent Feedback Endpoint

Let agents report friction directly:

```
POST /feedback
{
  "type": "friction" | "suggestion" | "error",
  "context": "tried to click dropdown but it was inside shadow DOM",
  "command": "/click",
  "severity": "medium"
}
```

**Dashboard aggregates:**
- "Agents retry /click 40% more when targeting shadow DOM"
- "Common friction: form submission timing"
- "Feature request: better iframe support (12 reports)"

### 7.6 Magic Token: Agent-as-a-Service

**The killer feature - zero config agents:**

Current setup requires:
1. Install Claude Desktop / configure MCP
2. Get API keys from Anthropic
3. Configure the MCP server
4. Figure out the system prompt
5. Connect to Haltija

**Magic token flow:**
1. Sign up at haltija.dev
2. Add your Anthropic key (stored encrypted)
3. Get a magic token
4. Done:
```bash
curl https://yourco.haltija.net/do \
  -H "Authorization: Bearer xxx" \
  -d '{"task": "click the login button"}'
```

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│              haltija.net (hosted)                            │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                 │
│  │  Auth   │───▶│  Agent  │───▶│  Relay  │─────────────────┼──▶ Browser
│  │ + Keys  │    │ (Claude)│    │         │                 │    (your machine)
│  └─────────┘    └─────────┘    └─────────┘                 │
└─────────────────────────────────────────────────────────────┘
         ▲
         │
    curl/REST (your CI, scripts, whatever)
```

**What this enables:**
- **Zero config agents** - no MCP setup, no local Claude
- **API-first automation** - natural language over REST
- **Composable** - chain from shell scripts, CI, webhooks
- **Key management** - one place for API keys, rotate easily

**Pricing options:**
- Bring your own key: just pay relay costs
- Use our pool: markup on token usage (like OpenRouter model)

### 7.7 Bookmarklet + HTTPS

**HTTPS is non-negotiable** for the hosted service:
- Bookmarklet can `fetch()` from any page without CSP blocking
- WebSocket upgrades work (`wss://`)
- No mixed-content warnings
- Agents in CI connect without cert hacks

**Magic bookmarklet flow:**
1. User clicks bookmarklet on any page
2. Widget injected, connects to `wss://api.haltija.dev/ws?token=xxx`
3. Agent can now control that browser from anywhere

Use case: "Click this bookmarklet and I can see your browser" for remote debugging/support.

### 7.8 Dashboard

**What users see:**
- Active sessions (which browsers connected)
- Usage metrics (commands, test runs, costs)
- Telemetry insights (what's working, what's failing)
- Feedback inbox (agent-reported friction)
- Test history and reports
- API key management

---

## The Business Model

**Why this works:**

1. **Near-zero marginal cost** - we route messages, we don't run browsers
2. **Competitor moat** - they're stuck with expensive browser infrastructure
3. **Usage-aligned pricing** - customers pay for value delivered
4. **Enterprise upsell** - dedicated subdomains, SLAs, compliance

**Revenue projection (conservative):**
- 100 Pro × $29 = $2,900/mo
- 10 Team × $99 = $990/mo
- Infrastructure: ~$100/mo
- Margin: ~95%

**The real insight:** A week to build the core product. Another week or two for hosted service MVP. Competitors maintain Kubernetes clusters of browsers.

---

## Non-Goals

Things we're explicitly not building:

- **General browser automation tool**: Playwright exists. We're AI-first.
- **Screenshot-based testing**: DOM is the source of truth, not pixels.
- **Record-and-replay only**: The AI understands, it doesn't just mimic.
- **Selenium replacement**: Different philosophy, different audience.

---

## Success Metrics

**How we know we've hit 10/10:**
- Teams choosing Haltija over Playwright for new projects
- "We deleted our E2E test suite and use Haltija" case studies
- AI QA catching real bugs before users do
- PR comments from Haltija that developers actually read

**How we know we've hit 11/10:**
- Customers using `/do` endpoint without ever installing anything locally
- Revenue from hosted service exceeds infrastructure costs by 10x+
- Agent feedback endpoint surfacing real product insights
- "I just curl Haltija" becomes a thing people say
- Startups building products on top of the Haltija API
