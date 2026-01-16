# Roadmap to 10/10

Current state: **9/10** - Best-in-class developer tool. GET support for actions, `/key` endpoint, diff-on-action, iframe visibility, simplified API.

Goal: **10/10** - The standard way AI agents interact with browsers.

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

**Solution**:
- Ensure server runs on Node.js (may already work, needs testing)
- `npx haltija` as primary install path
- Bun remains recommended for performance

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

## Phase 3: Platform Expansion (Low-medium effort, medium impact)

Build script already works on macOS and Linux. Just needs documentation and pre-built binaries.

### 3.1 Document Local Build Process
**Problem**: Users don't know they can build locally.

**Solution**:
- Document `npm run build` in apps/desktop
- Explain Playwright-like "build where you are" model
- Add to Quick Start for non-macOS users

### 3.2 Windows Testing
**Problem**: Windows build untested.

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
| 3. Platform Expansion | Low-Medium | Medium | After 2 |
| 4. Enterprise Readiness | High | Medium | When needed |
| 5. Cloud & CI | High | Transformative | The goal |
| 6. Ecosystem | Ongoing | Cumulative | Continuous |

---

## What Gets Us to 10/10

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

The question isn't "can we build this?" - the architecture supports it. The question is "do we invest in making it real?"

---

## Non-Goals

Things we're explicitly not building:

- **General browser automation tool**: Playwright exists. We're AI-first.
- **Screenshot-based testing**: DOM is the source of truth, not pixels.
- **Record-and-replay only**: The AI understands, it doesn't just mimic.
- **Selenium replacement**: Different philosophy, different audience.

---

## Success Metrics

How we know we've hit 10/10:

- Teams choosing Haltija over Playwright for new projects
- "We deleted our E2E test suite and use Haltija" case studies
- AI QA catching real bugs before users do
- PR comments from Haltija that developers actually read
- Internal adoption at Anthropic as proof point
