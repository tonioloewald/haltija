# TODO

## Build / Distribution
- [ ] Drop Intel macOS builds, add Windows and Linux DMG/installer builds
- [ ] Add npm pack verification test (ensure all renderer modules are included)

## Features
- [ ] Widget REC button: toggle video and/or script recording (either or both)
  - On stop: offer to open the video or reveal in Finder
  - Record as WebM (native MediaRecorder), auto-convert to MP4 via ffmpeg if available

## Bugs
- [ ] Playground color buttons have zero-size bounding rect in Electron — investigate layout

## Testing
- [ ] More haltija-native tests via `hj` CLI and test JSON (not Playwright)
