# Haltija Recipes

Common workflows with copy-paste examples.

---

## Testing a Login Flow

**Goal**: Verify login works end-to-end.

```bash
# Navigate to login page
curl -X POST localhost:8700/navigate -d '{"url":"http://localhost:3000/login"}'

# See what's on the form
curl -X POST localhost:8700/tree -d '{"mode":"actionable"}'

# Fill credentials
curl -X POST localhost:8700/type -d '{"selector":"#email","text":"test@example.com"}'
curl -X POST localhost:8700/type -d '{"selector":"#password","text":"secret123"}'

# Submit
curl -X POST localhost:8700/click -d '{"selector":"button[type=submit]"}'

# Wait for redirect
curl -X POST localhost:8700/wait -d '{"selector":".dashboard","timeout":5000}'

# Verify we landed on dashboard
curl localhost:8700/location
```

**Or just tell the agent**: "Log in with test@example.com / secret123 and verify the dashboard loads"

---

## Exploring a New Codebase UI

**Goal**: Understand what's on the page without reading source code.

```bash
# Get high-level structure
curl -X POST localhost:8700/tree -d '{"depth":2,"compact":true}'

# Find all interactive elements
curl -X POST localhost:8700/tree -d '{"mode":"actionable"}'

# Inspect a specific component
curl -X POST localhost:8700/inspect -d '{"selector":"nav","fullStyles":true}'

# See what CSS rules apply
curl -X POST localhost:8700/inspect -d '{"selector":".header","matchedRules":true}'
```

**Or just tell the agent**: "What's on this page? Walk me through the main sections."

---

## Recording a Bug Reproduction

**Goal**: Capture steps to reproduce a bug for the team.

```bash
# Start recording (tracks all interactions including across page loads)
curl -X POST localhost:8700/recording -d '{"action":"start"}'

# ... user reproduces the bug manually ...
# (can navigate between pages - recording survives!)

# Stop recording and get events
curl -X POST localhost:8700/recording -d '{"action":"stop"}'

# Take a screenshot of the broken state
curl -X POST localhost:8700/screenshot -d '{"scale":0.5}'
```

**Output**: Semantic events like "user clicked Settings", "user typed 'admin'", "navigated to /settings", "error: 500 from /api/users"

**Or just tell the agent**: "Watch what I do and write up repro steps"

---

## Generating Tests from Manual Exploration

**Goal**: Turn a manual walkthrough into an automated test.

```bash
# Start recording (survives page navigations!)
curl -X POST localhost:8700/recording -d '{"action":"start"}'

# ... click around manually, navigate between pages ...

# Check recording status (optional)
curl -X POST localhost:8700/recording -d '{"action":"status"}'
# Returns: {"success":true,"data":{"recording":true,"eventCount":23}}

# Stop and get events
curl -X POST localhost:8700/recording -d '{"action":"stop"}'

# Generate test from recorded events
curl -X POST localhost:8700/recording -d '{"action":"generate","name":"checkout-flow"}'
```

**Cross-page recording**: Recordings now survive page navigations! The server tracks your session by window ID, so you can record multi-page flows like:
- Login → Dashboard → Settings
- Shopping cart → Checkout → Confirmation
- OAuth flows that redirect between pages

**Output**: JSON test file ready for CI.

**Or just tell the agent**: "Watch me go through checkout, then write a test for it"

---

## Debugging a Customer Issue

**Goal**: See exactly what a customer described.

```bash
# Navigate to where they were
curl -X POST localhost:8700/navigate -d '{"url":"https://app.example.com/settings"}'

# Get the current state
curl -X POST localhost:8700/tree -d '{"mode":"actionable"}'

# Check for errors
curl localhost:8700/events

# Highlight what might be wrong
curl -X POST localhost:8700/highlight -d '{"selector":".error-message","label":"This error"}'

# Screenshot for the ticket
curl -X POST localhost:8700/screenshot -d '{"maxWidth":1200}'
```

**Or just tell the agent**: "Customer says Settings page is broken. Check it out."

---

## Checking Accessibility

**Goal**: Audit a page for accessibility issues.

```bash
# Get all interactive elements with ARIA info
curl -X POST localhost:8700/tree -d '{"mode":"actionable","depth":-1}'

# Inspect specific element for ARIA attributes
curl -X POST localhost:8700/inspect -d '{"selector":"button.icon-only"}'

# Check all buttons have accessible names
curl -X POST localhost:8700/find -d '{"selector":"button","text":""}'
```

**Look for**: Missing `aria-label`, buttons with only icons, form inputs without labels.

**Or just tell the agent**: "Check this page for accessibility issues"

---

## Multi-Tab Testing (OAuth, Admin/User)

**Goal**: Test flows that span multiple windows.

```bash
# See all connected tabs
curl localhost:8700/windows

# Returns: {"windows":[{"windowId":"abc","url":"..."},{"windowId":"def","url":"..."}]}

# Click in specific tab
curl -X POST "localhost:8700/click?window=abc" -d '{"selector":"#authorize"}'

# Check other tab updated
curl "localhost:8700/location?window=def"
```

**Use case**: OAuth popups, admin + customer side-by-side, multi-tenant testing.

---

## Waiting for Dynamic Content

**Goal**: Handle SPAs where content loads async.

```bash
# Wait for element to appear
curl -X POST localhost:8700/wait -d '{"selector":".results","timeout":10000}'

# Wait for element to disappear (loading spinner)
curl -X POST localhost:8700/wait -d '{"selector":".loading","appear":false}'

# Wait for text content
curl -X POST localhost:8700/wait -d '{"selector":".status","text":"Complete"}'
```

**Or just tell the agent**: "Click Search and wait for results to load"

---

## Pointing Things Out to Users

**Goal**: Show users what you're talking about.

```bash
# Highlight with label
curl -X POST localhost:8700/highlight -d '{"selector":"#save-btn","label":"Click here"}'

# Highlight problem area in red
curl -X POST localhost:8700/highlight -d '{"selector":".broken","label":"Bug","color":"#ef4444"}'

# Auto-dismiss after 3 seconds
curl -X POST localhost:8700/highlight -d '{"selector":"nav","duration":3000}'

# Clear highlight
curl -X POST localhost:8700/unhighlight
```

**Best practice**: Always highlight when explaining something visual.

---

## User Selection (Point at Problem)

**Goal**: Let user show you what's wrong.

```bash
# Start selection mode
curl -X POST localhost:8700/select/start

# ... user drags rectangle over problem area ...

# Get what they selected
curl localhost:8700/select/result

# Returns: elements in selection with selectors, HTML, bounding boxes
```

**Or just tell the agent**: "Let me show you which element is broken"

---

## Quick Health Check

**Goal**: Verify Haltija is working.

```bash
# Server running?
curl localhost:8700/status

# Browser connected?
curl localhost:8700/windows

# Can we see the page?
curl -X POST localhost:8700/tree -d '{"depth":1}'
```

If all three work, you're ready to go.
