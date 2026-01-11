# Haltija Desktop

**God Mode Browser for AI Agents**

An Electron-based browser that strips CSP headers and auto-injects the Haltija widget, enabling AI agents to control any website.

## Quick Start

```bash
cd apps/desktop
npm install
npm start
```

That's it. The app starts its own embedded Haltija server automatically.

## Features

- **Self-Contained**: Embedded server - just launch and go
- **CSP Bypass**: Strips `Content-Security-Policy` and `X-Frame-Options` headers
- **Auto-Injection**: Widget injected automatically on every page load
- **Screen Capture**: Full page and element-specific screenshots
- **Minimal Chrome**: Clean UI that stays out of the way
- **Keyboard Shortcuts**: Standard browser shortcuts (Cmd+L, Cmd+R, etc.)

## Server Behavior

On launch, the app:
1. Checks if a Haltija server is already running on port 8700
2. If yes, connects to it (useful for development)
3. If no, starts its own embedded server

When you quit the app, the embedded server is automatically stopped.

## Build for Distribution

```bash
npm run build:mac   # macOS (DMG + ZIP)
npm run build:win   # Windows (NSIS + Portable)
npm run build:linux # Linux (AppImage + deb)
```

Output goes to `dist/`.

## Architecture

```
┌─────────────────────────────────────────┐
│  Haltija Desktop (Electron)             │
│  ┌───────────────────────────────────┐  │
│  │  Toolbar (address bar, nav)       │  │
│  ├───────────────────────────────────┤  │
│  │                                   │  │
│  │  Webview                          │  │
│  │  (CSP stripped, widget injected)  │  │
│  │                                   │  │
│  │  ┌─────────┐                      │  │
│  │  │ 🧝      │ ← Haltija Widget     │  │
│  │  └─────────┘                      │  │
│  │                                   │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
            │
            │ WebSocket
            ▼
┌─────────────────────────────────────────┐
│  Haltija Server (localhost:8700)        │
│  - REST API for agents                  │
│  - WebSocket for real-time events       │
└─────────────────────────────────────────┘
            │
            │ REST/curl
            ▼
┌─────────────────────────────────────────┐
│  AI Agent (Claude, GPT, etc.)           │
│  - Queries DOM via /tree, /inspect      │
│  - Controls via /click, /type           │
│  - Captures via desktop screen capture  │
└─────────────────────────────────────────┘
```

## Why Electron?

We need to:
1. Strip security headers (CSP, X-Frame-Options)
2. Inject scripts into any page
3. Access screen capture APIs

Tauri's Rust-based security model actively prevents these. Electron lets us be "sufficiently insecure" for our use case.

## Distribution

**Not for the Mac App Store** - Apple will reject apps that strip CSP headers.

Instead:
- Notarized DMG for macOS (direct download)
- NSIS installer for Windows
- AppImage/deb for Linux

## Screen Capture API

The desktop app exposes screen capture to the renderer:

```javascript
// Full page screenshot
const result = await window.haltija.capturePage()
// { success: true, data: "data:image/png;base64,...", size: { width, height } }

// Element screenshot  
const result = await window.haltija.captureElement('#my-button')
// { success: true, data: "data:image/png;base64,...", selector, bounds }
```

Future: Expose these via REST API so agents can request screenshots.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl + L | Focus address bar |
| Cmd/Ctrl + R | Refresh page |
| Cmd/Ctrl + [ | Go back |
| Cmd/Ctrl + ] | Go forward |

## Configuration

Environment variables:
- `HALTIJA_SERVER`: Server URL (default: `http://localhost:8700`)
- `NODE_ENV`: Set to `development` to open DevTools

## License

Apache-2.0
