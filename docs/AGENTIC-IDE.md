# Agentic IDE: Haltija as a Post-IDE Orchestration Environment

Haltija already scores 9-10/10 as an agentic browser tool. This plan extends it into a
full **agentic orchestration environment** — replacing the IDE paradigm (file tree + editor + terminal)
with an activity-centered, agent-first workspace.

Core thesis: when an agent does most of the writing, the human's job is **steering, verifying,
and understanding what changed**. Current IDEs are optimized for the wrong user.

---

## Phase 1: File Viewer in the Console/Agent Tab

**Goal:** Let the human see and edit files without leaving the Haltija workspace.

### Architecture: Split Pane in terminal.html

The file viewer lives **inside** the existing console/agent tab (`terminal.html`), not as a
separate tab. The terminal's current full-page layout becomes a horizontal split pane:

```
 --------
/ tab    \
|         +---------------------+
| Console       | File Viewer   |
| (transcript)  | (CodeMirror)  |
|               |               |
+---------------+---------------+
| status widgets     |  toggles |
+-------------------------------+
```

- **Wide viewport (default):** side-by-side, transcript left, file viewer right
- **Narrow/portrait viewport:** stacked, transcript on top, file viewer below
- **Resizable:** drag handle between panes (user-controllable split)
- **Collapsible:** file viewer pane hidden by default, opens when a file is selected

The file viewer pane has its own internal layout:
- **Sidebar** (left, collapsible): accordion with two sections
  - **Recently Touched** — files the agent/console has read or written, reverse chronological
  - **File Tree** — tree view of the working directory (`cwd`) this console/agent is tied to
- **Main area** (right): file content rendered in **CodeMirror 6**
  - Syntax highlighting, line numbers, read-only by default
  - Click "Edit" to enable editing, save writes back via `/file` endpoint
  - Image files: inline preview
  - Markdown files: rendered HTML preview (with toggle to raw)
  - Breadcrumb path bar above the editor

### Server endpoints

- **`GET /file?path=src/server.ts`** — returns file contents + metadata (language, size, mtime)
- **`POST /file`** — write/patch a file `{ path, content }` or `{ path, patch }` for diffs
- **`GET /files/tree?root=.&depth=3`** — returns directory tree as JSON (respects .gitignore)
- **`GET /files/touches?session=xxx`** — returns touch stream for a session

### Touch tracking (integrated, not a separate phase)

Every file operation the agent makes through the REST API (`/file`, `/eval` that reads files,
etc.) gets logged to a per-session touch stream:

- `{ path, op: "read"|"write"|"diff", timestamp, session }`
- Session-scoped, ephemeral (clears on session end)
- Agent touches and human touches (via the editor) both appear
- Recently touched list updates live via the existing WebSocket connection

### Why CodeMirror 6

- Lightweight, modular — only bundle the languages you need
- Not an IDE (unlike Monaco which drags in half of VS Code)
- Excellent mobile/touch support
- Clean extension API for future features (inline diffs, annotations)
- Tree-shakeable — ship only what's needed

### Why this first

Without file viewing, the human has to context-switch to another tool to verify agent work.
This is the single biggest friction point. And integrating it into the console tab (rather
than a separate tab) means the file context is always tied to the agent that touched it.

---

## Phase 3: Notification Buffer — Human-to-Agent Signals

**Goal:** Let the human proactively send context to the agent via the widget UI.

### What to build

Extend the existing `terminal.ts` push buffer with a **notification queue** that the agent
drains via `hj notifications` (or a new `/notifications` endpoint).

### Notification sources

| Source | Trigger | Agent receives |
|--------|---------|----------------|
| **Screenshot** (widget button) | User captures viewport | `{ type: "screenshot", path: "/tmp/haltija-xxx.png", label: "user screenshot" }` |
| **Select Element** (widget button) | User clicks element in page | `{ type: "selection", selector: "button.submit", text: "Sign In", rect: {...}, html: "..." }` |
| **File viewer** | User opens/edits a file | `{ type: "file_hint", path: "src/auth.ts", op: "edited" }` |
| **Annotate** (widget or file viewer) | User types a short message | `{ type: "annotation", message: "this button should be blue" }` |
| **Plan change** (file viewer) | User edits plan file | `{ type: "plan_changed", diff: "..." }` |

### How the agent consumes it

```bash
hj notifications          # drain buffer, returns array of pending notifications
hj notifications --wait   # long-poll until something arrives (optional)
```

### Why this matters

Currently, human-to-agent communication is limited to typing in the chat. The widget becomes
a **spatial communication channel** — point at things, screenshot things, annotate things.

---

## Phase 4: Plan as First-Class UI

**Goal:** Make the plan a bidirectional, shared document between human and agent.

### What to build

- **Plan component** in the widget — renders `PLAN.md` (or equivalent) as an interactive checklist/outline
- **Inline editing** — human can reorder, check off, add, or delete plan items
- **`/plan` endpoint** — GET returns current plan, POST updates it
- **Change detection** — when the human edits the plan, a `plan_changed` notification is queued (Phase 3)
- **Agent plan updates** — agent can update plan via REST, widget reflects changes live

### Plan format

Keep it simple — Markdown with checkboxes:
```markdown
## Current Task: Fix auth flow
- [x] Read existing auth middleware
- [ ] Update token validation  ← agent is here
- [ ] Add tests
- [ ] Verify in browser
```

### The interaction model

1. Agent proposes a plan (writes to `/plan`)
2. Human sees it in the widget, reorders a step
3. Agent's next `hj notifications` includes `plan_changed`
4. Agent re-reads plan, adapts

No chat needed. The plan is the interface of record.

---

## Phase 5: Context Proxy — Anti-Lobotomy

**Goal:** Optimize the agent's context window by intercepting and deduplicating operations.

### What to build

This is the most architecturally ambitious phase. Haltija becomes a **proxy layer** between
the agent's tool calls and the actual filesystem/browser.

- **Filesystem cache** — when the agent reads a file, cache it. If the agent reads it again
  (unchanged), return from cache and mark the turn as "collapsed" in transcript
- **Operation deduplication** — if the agent runs `tree` then `inspect` on the same element,
  collapse into a single context entry
- **Transcript rewriting ("Virtual Transcript")** — when the agent fumbles (tries 5 commands
  to find something), rewrite history to show only the successful path. The agent doesn't
  learn its own bad habits.
- **Selective pruning** — strip low-signal content from history: npm progress output, success
  logs, redundant confirmations. Keep: errors, decisions, user instructions.
- **Priority weighting** — when compaction is needed, preserve "Initial Mission" and "Latest N
  turns" over middle history

### Cache invalidation

- File cache invalidates on: agent writes, human edits (via Phase 1), `git` operations,
  filesystem watcher events
- DOM cache invalidates on: navigation, mutation events

### How this differs from LLM summarization

Summarization is lossy and introduces hallucination risk. This is **structural editing** of the
message history — deleting noise, collapsing redundancy, keeping full-fidelity signal.

---

## Phase 6: Verification Loop

**Goal:** Automate visual verification of agent work.

### What to build

- **Before/after screenshots** — automatically capture when the agent modifies CSS/HTML,
  present side-by-side in widget
- **Visual diff** — highlight pixel differences between before/after
- **"Vision Check" step** — agent can add `verify` steps that compare a screenshot against
  expected visual state
- **Human approval gate** — widget shows the diff, human clicks approve/reject

This builds on Haltija's existing screenshot and diff infrastructure.

---

## Implementation Notes

### What already exists that we can leverage

- `terminal.html` — the console/agent tab UI, where the file viewer split pane will live
- `terminal.ts` push notification buffer — extend for Phase 3
- `tabs.js` — tab management with `cwd` tracking per terminal tab
- Widget tokenized menu — extend for Phase 3 notification actions
- `events_watch` / `mutations_watch` — patterns for streaming
- Screenshot capture — exists in desktop app
- `select_start` / `select_result` — element selection flow
- Diff mode on `/click` and `/type` — before/after snapshots
- WebSocket connection — already carries real-time updates to the widget

### Guiding principles

- Each phase is independently valuable — ship and use each one before starting the next
- Console-integrated — the file viewer lives in the console/agent tab, not a separate window
- REST-native — every feature is an endpoint the agent can call
- Minimal — not building VS Code, building the minimum viable orchestration surface
- Session-scoped — most state is ephemeral, not persisted to repo
- CWD-rooted — the file tree and touch stream are scoped to the console's working directory

### What we're NOT building

- A full IDE (no LSP, no debugger, no refactoring tools)
- A terminal emulator (agents already have terminals)
- A git GUI (agents use git directly)
- Project management (keep using TODO.md)
