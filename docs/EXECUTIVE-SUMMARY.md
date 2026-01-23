# Haltija Executive Summary

Haltija gives AI agents eyes and hands in the browser. Instead of parsing screenshots or guessing at page structure, agents see the actual DOM, click elements, type text, and watch for changes. One script tag makes any web app AI-controllable.

---

## For the CEO

Haltija is infrastructure for AI-powered quality assurance. It replaces brittle, expensive end-to-end test suites with an AI QA engineer that explores applications, generates test plans, runs tests, and reports failures in plain English.

The business case: E2E test maintenance is a significant engineering cost. Tests break when UI changes, produce cryptic errors, and require constant human attention. Haltija shifts that burden to AI, freeing engineering time for product work.

- **Reduces QA engineering overhead** by automating test creation and maintenance
- **Improves bug reports** with human-readable failure explanations, not stack traces
- **Runs in CI** like existing test infrastructure, no workflow changes required
- **Aligns with core AI strategy** as a practical application of AI agents doing real work
- **Potential product opportunity** beyond internal tooling

**Limitations**: Requires investment to productionize. Not yet proven at scale. Would need dedicated support if deployed broadly.

**Missing**: Cloud-hosted offering, enterprise authentication integrations, usage analytics dashboard.

---

## For the CTO

Haltija is a WebSocket bridge between a browser widget and a REST API. AI agents make HTTP calls; the widget executes them in a real browser context. The architecture is simple: no browser binaries to manage, no protocol complexity, no version mismatches.

The technical differentiator is semantic events. Rather than exposing raw DOM events, Haltija aggregates user intent: "user typed email@example.com" not eighteen keydown events. This makes AI reasoning about browser state tractable.

- **Zero-dependency deployment**: `bunx haltija` starts the server, one script tag injects the widget
- **Schema-driven API** with self-documenting endpoints and type-safe handlers
- **Real browser rendering** via Electron, not headless browser quirks
- **Extensible**: new endpoints require schema definition + handler, router handles the rest
- **Built on Bun** for fast startup and minimal resource footprint

**Limitations**: Shadow DOM support is workable but not seamless. No iframe traversal for cross-origin content.

**Missing**: Node.js support for the server (Bun-only currently), browser extension for persistent injection, pre-built binaries for all platforms (build script works on macOS/Linux, Windows untested).

---

## For the UI Engineer

Haltija lets you test your components with an AI that actually sees what users see. Point it at your dev server, and it can explore your app, find interactive elements, and verify behavior without you writing selectors or maintaining test fixtures.

Integration is one line: `<script src="http://localhost:4000/component.js"></script>`. The widget connects to a local server, and any AI agent with HTTP access can now control your browser tab.

- **DOM tree inspection** with configurable depth, text content, and attribute filtering
- **Visibility heuristics** that match user perception: hidden, off-screen, transparent, and disabled states
- **Input value tracking** shows current form state without querying each field
- **Matched CSS rules** option shows which stylesheets affect an element and why
- **Cursor visualization** shows exactly where clicks land, useful for debugging interaction issues

**Limitations**: Cannot pierce cross-origin iframes. Custom elements with closed shadow roots are opaque. Very dynamic UIs (heavy animation, virtual scrolling) may report stale state.

**Missing**: React/Vue/Angular devtools integration, component-level boundaries in tree output, performance profiling hooks.

---

## For the QA Engineer

Haltija is a QA engineer in a box. It explores your application, identifies interactive elements, generates test plans, executes them, and reports failures in terms you can act on. When tests break because UI changed, it can often fix them automatically.

Unlike Selenium or Playwright, you don't write selectors. You describe intent: "log in as test user, add item to cart, verify checkout total." The AI figures out how to do it on your actual UI.

- **Natural language test specs** that survive UI refactors
- **Failure explanations** like "button not visible because parent has display:none" not "timeout after 30000ms"
- **Semantic event recording** captures what the user did, not raw browser events
- **Test JSON format** for version control and CI integration
- **Actionable summary** lists all buttons, links, inputs on a page with their current state

**Limitations**: AI interpretation adds latency compared to direct selector tests. Novel or highly custom UI patterns may confuse the AI. Not a replacement for unit tests or integration tests.

**Missing**: Visual regression comparison, accessibility audit integration, performance budget assertions, test coverage reporting.

---

## For the Security Consultant

Haltija runs a WebSocket server on localhost that accepts commands to control browser tabs. The widget self-identifies when active (no silent operation), and users can pause or kill the connection at any time.

The threat model assumes a trusted local environment. The server binds to localhost by default. Cross-origin stylesheets cannot be inspected due to browser security. The widget cannot access cross-origin iframe content.

- **Localhost-only by default**, no remote connections without explicit configuration
- **Visible indicator** in browser when agent is connected and operating
- **User kill switch** to immediately disconnect and remove widget
- **No credential storage**, authentication is handled by the browser normally
- **CSP-aware**: widget injection respects Content-Security-Policy where enforced

**Limitations**: Bookmarklet injection bypasses CSP on the injecting page. Desktop app strips CSP headers for universal compatibility. No audit logging of commands executed. No authentication on the REST API.

**Missing**: API authentication/authorization, command audit log, rate limiting, configurable command allowlists, SOC2 compliance documentation.

---

## For the Hobbyist / Vibe Coder

Haltija lets you tell Claude to browse the web for you. Run the server, open the desktop app or inject the widget, and Claude can see pages, click buttons, fill forms, and tell you what happened.

Setup takes two minutes: install Bun, run `bunx haltija`, open the Haltija app, and paste the agent prompt into your conversation. Now Claude has a browser.

- **Copy-paste prompt** gets Claude controlling your browser immediately (simpler than MCP)
- **Visual feedback** shows cursor movement and action subtitles as Claude operates
- **Explore any website** with the included Electron browser
- **Record your actions** and let Claude replay or modify them
- **No coding required** for basic browsing automation

**Limitations**: Some sites block the widget (strict CSP). CAPTCHAs and bot detection will stop automation. Sites requiring login need manual authentication first.

**Missing**: One-click installer, browser extension for easier injection, mobile support, saved session/cookie management.

---

## For the AI Enthusiast

Haltija is what browser MCP tools should be. Instead of sending screenshots and hoping vision models figure it out, Haltija gives agents structured DOM access. The AI sees elements, attributes, text content, and visibility state directly.

The semantic event system is particularly interesting: instead of raw DOM events, Haltija aggregates meaningful actions. This makes it feasible for AI to understand user sessions without drowning in event noise.

- **DOM over screenshots**: structured data beats pixel parsing for reliability
- **Semantic events**: "user typed 'hello'" not 17 keystrokes
- **Hindsight buffer**: review what happened without recording everything upfront
- **Mutation watching** with noise filtering for framework-specific chatter
- **Tool-use optimized**: API returns exactly what agents need, nothing more

**Limitations**: Text-heavy UIs work best. Canvas, WebGL, and video content are opaque. Very large DOMs may need pagination or focused queries.

**Missing**: Vision model fallback for non-DOM content, multi-modal event capture (audio, video), agent memory/persistence across sessions.

---

## Efficiency & Performance

Haltija is designed for efficiency - reducing the data agents need to process while preserving the information they need to act.

### Event Reduction: 99%+

Raw DOM events are noisy. A user typing "hello@example.com" generates dozens of keydown, keypress, input, and keyup events. Haltija's semantic event system aggregates these into a single `input:typed` event with the final value. Typical reduction: **99%+ fewer events** while preserving user intent.

### DOM Reduction

Full DOM trees are massive. Haltija filters to what matters:
- Interactive elements (buttons, inputs, links)
- Visible content (hidden elements filtered)
- Interesting attributes (ARIA, data-*, roles)
- Configurable depth limits

A 10,000-node DOM might reduce to 200 relevant nodes for a form-filling task.

### Ref IDs: Efficient Re-targeting

Every element in `/tree` output includes a ref ID (e.g., `1`, `42`). Agents can use these refs instead of CSS selectors for subsequent commands:

```bash
# First, get the tree
hj tree
# Response includes: 42: button "Submit" [interactive]

# Later, click by ref - no selector matching needed
hj click 42
```

Refs survive DOM changes better than selectors (which break when classes change) and are faster to resolve (direct lookup vs. CSS matching).

### Measuring Efficiency

Use the `/stats` endpoint or click the 📊 button in the widget to see real metrics:

```json
{
  "events": { "raw": 1847, "semantic": 23, "reductionPercent": 98.8 },
  "dom": { "processed": 3420, "inTree": 156, "reductionPercent": 95.4 },
  "refs": { "assigned": 156, "resolved": 42, "stale": 3, "hitRate": 93.3 }
}
```

Console access: `haltija.copyStats()` copies full stats to clipboard.

---

## For Existing Puppeteer MCP / Browser Automation Users

If you're using Puppeteer MCP, Playwright MCP, or similar tools, Haltija offers a different philosophy: user-centric rather than developer-centric.

Puppeteer exposes browser internals. You think in selectors, wait conditions, and protocol commands. When tests fail, you get stack traces. Haltija exposes user-visible state. You think in elements, actions, and outcomes. When tests fail, you get explanations.

- **No browser binary management**: widget runs in any browser, server is a single command
- **Human-readable failures**: "element hidden by ancestor with display:none" vs "timeout"
- **Semantic events**: understand user intent, not DOM mutations
- **Real browser rendering**: Electron app has full engine, not headless quirks
- **Designed for AI agents**: API returns structured, actionable data

**Limitations**: Less low-level control than Puppeteer. Cannot intercept network requests or modify browser behavior. No protocol-level access for advanced debugging.

**Missing**: Network interception, request mocking, browser console forwarding to agent, multi-browser parallel execution.

---

## Summary

| Audience | Primary Value | Key Limitation |
|----------|--------------|----------------|
| CEO | Reduced QA costs, AI-native testing | Needs investment to productionize |
| CTO | Clean architecture, semantic events | Bun-only server, Windows untested |
| UI Engineer | One-line integration, real DOM access | No cross-origin iframe support |
| QA Engineer | Natural language tests, auto-fixing | AI latency vs direct selectors |
| Security | Localhost-only, visible operation | No API auth, CSP bypassed in app |
| Hobbyist | Easy setup, visual feedback | Some sites block widget |
| AI Enthusiast | Structured DOM, semantic events | Canvas/WebGL opaque |
| Puppeteer User | User-centric, human-readable | Less low-level control |

Haltija is production-ready for local development and testing workflows. Cloud deployment and enterprise features would require additional investment.
