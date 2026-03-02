# TODO

## Build / Distribution
- [ ] Drop Intel macOS builds, add Windows and Linux DMG/installer builds
- [ ] Add npm pack verification test (ensure all renderer modules are included)

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
- [ ] Test helper for `.test.ts` files — e.g. `import { hj } from 'haltija/test'`
  - Wraps `DevChannelClient` with ergonomic API: `hj.click()`, `hj.type()`, `hj.screenshot()`
  - `hj.suite()` / `hj.suite('./tests')` runs all JSON tests in a directory (default: cwd)
  - Works with `bun test` and any test runner
  - Replaces ad-hoc shell scripts like `screenshot-verify.sh`
- [ ] Convert `screenshot-verify.sh` to a `.test.ts` using the test helper
