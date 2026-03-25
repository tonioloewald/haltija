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

## Testing
- [x] Test helper for `.test.ts` files — `import { hj } from 'haltija/test'` (src/test.ts)
- [ ] Convert `screenshot-verify.sh` to a `.test.ts` using the test helper
