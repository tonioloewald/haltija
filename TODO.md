# TODO

## Build / Distribution
- [ ] Drop Intel macOS builds, add Windows and Linux DMG/installer builds
- [ ] Add npm pack verification test (ensure all renderer modules are included)

## Agentic IDE
- [ ] See [docs/AGENTIC-IDE.md](docs/AGENTIC-IDE.md) — plan for post-IDE orchestration environment
  - [x] Phase 1: File viewer/editor in widget
  - [ ] **Phase 1.5: Headless widget & app-owned UI** ← current
    - [ ] `mode="headless"` attribute — skip shadow DOM rendering
    - [ ] `window._haltija` global API (tree, click, type, eval, status, etc.)
    - [ ] Outer widget in Electron renderer (persists across navigations, self-inspection)
    - [ ] Inner widget hidden in desktop app context
    - [ ] App chrome surfaces widget state (connection, recording, events)
    - [ ] Record controls in tab bar → pipe to agent as notification
  - Phase 3: Notification buffer (human-to-agent signals via app chrome)
  - Phase 4: Plan as first-class UI
  - Phase 5: Context proxy (anti-lobotomy)
  - Phase 6: Verification loop

## Features
- [ ] Widget REC control: `<select>` dropdown in widget
  - Not recording: options are "REC", "Script", "Video", "Script + Video"
  - Recording: option changes to "End Recording"
  - On stop: use Electron `dialog.showSaveDialog()` to let user save files (video and/or test JSON)
  - Video: record as WebM, auto-convert to MP4 via ffmpeg if available
  - Non-Electron: hide video option (script recording still works)

## Bugs
- [ ] Playground color buttons have zero-size bounding rect in Electron — investigate layout

## Tech debt
- [ ] Pre-existing TypeScript type errors surfaced by the new `tsc --emitDeclarationOnly` build step (`bun build` never type-checked). Down from ~147 to **70**. Declarations still emit; build is not gated on these. Fixed so far: `api-handlers.ts` (root cause was `EndpointDef.input` erasing the schema type so `Infer<…input>`/handler bodies fell back to examples — now `input: Base<TInput>`, which also repaired the previously-`never` `*Input` exports; plus `screenshot.format`/`quality`, `recordingStart.name`, `recording.id` union); duplicate `getKeyCode` (extracted to `src/key-codes.ts` + test). Remaining, by category:
  - **`component.ts` (50)** — type-def drift: `TestStep` action union missing `select`/`paste`/`cut`/`copy`; visibility-reason union missing `pointer-events-none`/`near-transparent`/`clipped`; `DomQueryRequest` missing `ref`.
  - **`server.ts` (11), `test-generator.ts` (4), `task-board.ts` (2), `agent-shell.ts` (2), `test-data.ts` (1)** — assorted real mismatches (`DevResponse` missing `selection`/`url`; `Element` vs `HTMLElement.dataset`; agent message-type union missing `agent-tool-output`).

## Testing
- [x] Test helper for `.test.ts` files — `import { hj } from 'haltija/test'` (src/test.ts)
- [ ] Convert `screenshot-verify.sh` to a `.test.ts` using the test helper
- [ ] Desktop integration tests need a running app — `apps/desktop/integration.test.ts` fails with ConnectionRefused when the app isn't up. Skip gracefully or document the requirement clearly.

## Roadmap (migrated from former issue tracker)

Already shipped and dropped during migration: `hj` CLI wrapper, graceful port handling
(`HALTIJA_PORT` + auto-fallback), and optional API token auth (`HALTIJA_TOKEN`).

### Phase 1 — Documentation & Discovery
- [ ] Landing page hero — README buries the lede. Lead with one-liner setup (`bunx haltija` + one script tag), a 30-second video of AI controlling a real app, and a clear "Get Started in 2 Minutes" path.
- [ ] Consolidate documentation — docs scattered across CLAUDE.md, /docs, /api, embedded markdown, README. One organized `docs/` hierarchy: Quick Start → Guides → API Reference → Architecture.
- [ ] Use case galleries / recipes page — common workflows: testing a login flow, exploring a codebase, recording/replaying bug reports, generating tests from manual exploration.

### Phase 2 — Developer Experience
- [ ] Browser extension (Chrome/Firefox) — persistent injection that survives navigation and works on CSP-restricted sites; toggle per-site. Replaces the manual-per-page bookmarklet.
- [ ] Better error messages with suggestions — e.g. `Element not found: #submit` → suggest nearby matches like `#submit-btn`, `button.submit`.
- [ ] TypeScript SDK — type-safe wrapper over the REST API (`import { Haltija } from 'haltija'; await h.click('#submit')`), published to npm.
- [ ] Flight Recorder UI — visual playback in the desktop app: timeline of Action → DOM Diff (visualized) → Result. Builds trust in AI decisions.

### Phase 4 — Enterprise Readiness (dogfood in real CI first; these are hypotheses)
- [ ] Audit logging — record executed commands with timestamps, optional file persistence, queryable history.

### Phase 5 — Cloud & CI Integration
- [ ] GitHub Action for CI/CD — `uses: haltija/action@v1`, plus a GitLab CI template, pre-configured for Next.js / Vite / CRA.
- [ ] Docker image — `docker run -p 4000:4000 haltija/haltija`; headless for CI, Xvfb for headed mode in containers.

### Phase 7 — Hosted Service
- [ ] Agent-as-a-Service — zero-config AI automation with near-zero marginal cost (route messages, don't run browsers): Firebase stack, relay service, magic token, customer subdomains.

### Other features
- [ ] Multi-match reporting — when a selector matches multiple elements, act on the first but report "N others matched"; enables `--nth N` and `--all` flags.
- [ ] Pre-built binaries on GitHub Releases — automated release workflow on git tag publishing macOS (arm64, x64), Linux, and Windows builds.
