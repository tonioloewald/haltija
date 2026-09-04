/**
 * Haltija Desktop - God Mode Browser
 *
 * An Electron shell that:
 * 1. Strips CSP and X-Frame-Options headers (works on any site)
 * 2. Auto-injects the Haltija widget on every page
 * 3. Provides screen capture for AI agents
 * 4. Runs its own embedded Haltija server (or connects to existing)
 */

const {
  app,
  BrowserWindow,
  session,
  ipcMain,

  Menu,
  dialog,
  clipboard,
} = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const http = require('http')
const { attachNetwork, detachNetwork, getNetworkLog, getNetworkStats, clearNetwork, isMonitoring } = require('./cdp-network.js')
const { buildServerEnv } = require('./server-env.js')
// ONE definition of where artifacts live and how long they live. Built from src/artifacts.ts.
const { artifactDir, pruneKind } = require('./artifacts.js')

// Suppress EIO errors when stdout/stderr pipes break during shutdown
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

// PRIVATE (isolated automation) mode — the Electron half of issue #1. `bunx haltija --private
// --app` must be an isolated instance that never sees/adopts/touches the shared servers on
// 8700/8701: it binds EPHEMERAL ports, discovered after the servers start. So these are `let`,
// not `const` — reassigned once the private servers report their ports (below), which means every
// downstream use (widget injection, status checks, help text, content tabs) automatically follows
// the ephemeral ports with no other edits.
const IS_PRIVATE = process.env.HALTIJA_PRIVATE === '1'
// The caller's port-file (from `--port-file`), captured before we repurpose the env for our own
// per-server discovery. In private mode the app writes the PUBLIC ephemeral address here so the
// consumer (e.g. a dev-server test lane) can drive this instance.
const CALLER_PORT_FILE = IS_PRIVATE ? (process.env.HALTIJA_PORT_FILE || null) : null

// A PRIVATE INSTANCE GETS ITS OWN ELECTRON PROFILE.
//
// Private mode isolated the ports, the registry, retirement and teardown — but not the profile, so
// every instance ran with the same `--user-data-dir`. Chromium single-instance locking means the
// second one to launch cannot take the profile lock and falls back to caches it cannot persist,
// losing the HTTP cache and the V8 code cache. A large app bundle is then fully re-parsed on every
// navigation: measured at roughly 10x slower page boots (issue #31).
//
// The damage is not just slowness, it is a LIE in the one workflow private mode exists for. Running
// two versions side by side, the failure followed LAUNCH ORDER rather than version — 22.1s vs 2.04s,
// and the same version passed or failed depending only on which started first. The reporter nearly
// wrote up a version regression that did not exist. Every health signal read green throughout,
// including `hj doctor` and a 120fps rAF cadence, because nothing was broken; it was just slow.
//
// Keyed on pid, not port: the private ports are ephemeral and not known yet at this point, and pid
// is unique across concurrent runs by construction. Set BEFORE `app.whenReady()` and before
// anything reads `app.getPath('userData')` (preferences.json does), or the isolation is partial —
// which is how this bug existed at all.
let PRIVATE_USER_DATA = null
if (IS_PRIVATE) {
  PRIVATE_USER_DATA = path.join(os.tmpdir(), `haltija-private-${process.pid}`)
  try {
    fs.mkdirSync(PRIVATE_USER_DATA, { recursive: true })
    app.setPath('userData', PRIVATE_USER_DATA)
    // Also keep the disk cache with it, so nothing is left in the shared profile.
    app.setPath('sessionData', PRIVATE_USER_DATA)
  } catch (err) {
    // Falling back to the shared profile is slow and pollutes it, but it still WORKS — so say so
    // loudly rather than refusing to start a run over a temp-directory failure.
    console.error(
      `[Haltija Desktop] Could not create a private profile at ${PRIVATE_USER_DATA}: ${err.message}. ` +
        `Falling back to the shared profile — concurrent private instances will be slow and are ` +
        `NOT safe to compare against each other (see issue #31).`,
    )
    PRIVATE_USER_DATA = null
  }
}

// Haltija server config
let HALTIJA_PORT = IS_PRIVATE ? 0 : parseInt(process.env.HALTIJA_PORT || '8700')
let HALTIJA_SERVER = `http://localhost:${HALTIJA_PORT}`

// Internal port for the chrome widget (the haltija UI inspecting itself).
// Lives on a separate server so it never appears in agent-facing window lists
// — agents see only content tabs unless they explicitly target this port.
let HALTIJA_INTERNAL_PORT = IS_PRIVATE ? 0 : parseInt(process.env.HALTIJA_INTERNAL_PORT || '8701')
let HALTIJA_INTERNAL_SERVER = `http://localhost:${HALTIJA_INTERNAL_PORT}`

// Unique app instance ID - used to create stable window IDs across navigations
// Combined with webContents.id to create globally unique tab identifiers
const APP_INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

// Pending navigate-url requests: main asks renderer to route a navigation,
// then awaits a result so the widget's promise resolves with real success/failure.
const pendingNavigates = new Map()
let navigateRequestId = 0

// ============================================
// Preferences
// ============================================
// TODO: Sync these with renderer via IPC, persist to disk
// For now, these are compile-time defaults

const DEFAULT_PREFS = {
  // Server startup behavior:
  // 'auto'     - Use an existing healthy server if one is on the port, else start embedded (DEFAULT)
  // 'builtin'  - Always stop any existing server and start fresh (the old default)
  // 'external' - Never start a server, expect one running externally
  //
  // Default is 'auto', NOT 'builtin'. On a machine running more than one project, 8700/8701 are
  // shared: another project may legitimately have a live channel there (e.g. `haltija --server
  // --both`). 'builtin' treated that channel as a "zombie" and killed it to start fresh — so
  // launching the desktop app (or `bunx haltija`, or an `hj` auto-launch) silently took down
  // another project's channel and made its widget vanish. 'auto' reuses a healthy server instead.
  // Force the old behavior with HALTIJA_SERVER_MODE=builtin when you specifically want your own.
  serverMode: process.env.HALTIJA_SERVER_MODE || 'auto',
}

// Active prefs (will be overwritten by persisted prefs when IPC is wired up)
const prefs = { ...DEFAULT_PREFS }

let mainWindow = null
const embeddedServers = []
// True when this app attached to a server it did not start (auto mode found one already on the
// port). Surfaced to the window so the user knows they're driving a reused, possibly-foreign server.
let reusedExternalServer = false
let reusedServerBanner = ''

// ============================================
// MCP Setup for Claude Desktop
// ============================================

/** Get Claude Desktop config path based on platform */
function getClaudeDesktopConfigPath() {
  const home = os.homedir()
  switch (process.platform) {
    case 'darwin':
      return path.join(
        home,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      )
    case 'win32':
      return path.join(
        home,
        'AppData',
        'Roaming',
        'Claude',
        'claude_desktop_config.json',
      )
    case 'linux':
      return path.join(home, '.config', 'claude', 'claude_desktop_config.json')
    default:
      return path.join(home, '.config', 'claude', 'claude_desktop_config.json')
  }
}

/** Find the Haltija MCP server entry point */
function findMcpServerPath() {
  const candidates = [
    // Packaged app
    process.resourcesPath
      ? path.join(process.resourcesPath, 'mcp', 'index.js')
      : null,
    // Development - relative to this file
    path.join(__dirname, '..', 'mcp', 'build', 'index.js'),
    // From repo root
    path.join(__dirname, '..', '..', 'apps', 'mcp', 'build', 'index.js'),
  ].filter(Boolean)

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

/** Check if Haltija is already configured in Claude Desktop */
function isHaltijaConfigured() {
  const configPath = getClaudeDesktopConfigPath()
  if (!fs.existsSync(configPath)) return false

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return !!config.mcpServers?.haltija
  } catch {
    return false
  }
}

/** Check if Claude Desktop is installed */
function isClaudeDesktopInstalled() {
  const configPath = getClaudeDesktopConfigPath()
  return fs.existsSync(path.dirname(configPath))
}

/** Setup Haltija in Claude Desktop config */
function setupMcpConfig() {
  const mcpPath = findMcpServerPath()
  if (!mcpPath) {
    return { success: false, error: 'MCP server not found' }
  }

  const configPath = getClaudeDesktopConfigPath()
  const configDir = path.dirname(configPath)

  // Create config directory if needed
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  // Read or create config
  let config = { mcpServers: {} }
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (!config.mcpServers) config.mcpServers = {}
    } catch {
      // Backup invalid config
      const backupPath = configPath + '.backup'
      fs.writeFileSync(backupPath, fs.readFileSync(configPath))
      config = { mcpServers: {} }
    }
  }

  // Add Haltija
  config.mcpServers.haltija = {
    command: 'node',
    args: [mcpPath],
  }

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    return { success: true, configPath }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/** Show MCP setup prompt on first run */
async function checkAndPromptMcpSetup() {
  // Skip if Claude Desktop isn't installed
  if (!isClaudeDesktopInstalled()) {
    // Claude Desktop app not installed — no MCP auto-setup dialog needed
    return
  }

  // Skip if already configured
  if (isHaltijaConfigured()) {
    console.log(
      '[Haltija Desktop] Haltija MCP already configured in Claude Desktop',
    )
    return
  }

  // Skip if MCP server not found
  const mcpPath = findMcpServerPath()
  if (!mcpPath) {
    console.log('[Haltija Desktop] MCP server not found, skipping setup prompt')
    return
  }

  // Show dialog
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Configure', 'Skip', "Don't Ask Again"],
    defaultId: 0,
    cancelId: 1,
    title: 'Claude Desktop Integration',
    message: 'Configure Haltija for Claude Desktop?',
    detail:
      "This will give Claude native browser control tools (click, type, query DOM, etc.).\n\nYou'll need to restart Claude Desktop after configuration.",
  })

  if (result.response === 0) {
    // Configure
    const setupResult = setupMcpConfig()
    if (setupResult.success) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['OK'],
        title: 'Configuration Complete',
        message: 'Haltija configured successfully!',
        detail:
          'Restart Claude Desktop to activate the integration.\n\nMake sure Haltija is running when you use Claude.',
      })
    } else {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        buttons: ['OK'],
        title: 'Configuration Failed',
        message: 'Could not configure Haltija',
        detail: setupResult.error,
      })
    }
  } else if (result.response === 2) {
    // Don't ask again - store preference
    const store = require('electron-store')
    try {
      const Store = store.default || store
      const appStore = new Store()
      appStore.set('skipMcpSetup', true)
    } catch {
      // electron-store not available, use a simple file
      const prefPath = path.join(app.getPath('userData'), 'preferences.json')
      let prefs = {}
      try {
        prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8'))
      } catch {}
      prefs.skipMcpSetup = true
      fs.writeFileSync(prefPath, JSON.stringify(prefs, null, 2))
    }
  }
}

/** Check if user has opted out of MCP setup prompt */
function hasSkippedMcpSetup() {
  try {
    const store = require('electron-store')
    const Store = store.default || store
    const appStore = new Store()
    return appStore.get('skipMcpSetup', false)
  } catch {
    // Fallback to simple file
    const prefPath = path.join(app.getPath('userData'), 'preferences.json')
    try {
      const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8'))
      return prefs.skipMcpSetup === true
    } catch {
      return false
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false, // Don't show until content is ready
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Allow __dirname in preload
      webviewTag: true, // Enable <webview> tag
    },
    titleBarStyle: 'hiddenInset', // Minimal chrome on macOS
    windowButtonPosition: { x: 12, y: 12 },
  })

  // Show window once shell UI is rendered (avoids flashing empty/intermediate states)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Load the shell UI
  mainWindow.loadFile('index.html')

  // If we attached to a server we didn't start, tell the renderer so it can surface it in the
  // UI. Best-effort: harmless if the renderer doesn't handle 'server-reused' yet (that UI is a
  // filed follow-up); the reuse is also announced on the app's console output regardless.
  if (reusedExternalServer) {
    mainWindow.webContents.once('did-finish-load', () => {
      try { mainWindow.webContents.send('server-reused', reusedServerBanner) } catch {}
    })
  }

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }
}

/**
 * Create custom menu that prevents Cmd+R from reloading the outer shell
 * Instead, Cmd+R is handled by renderer.js to reload the active webview
 */
function setupMenu() {
  const isMac = process.platform === 'darwin'

  const template = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow?.webContents.send('menu-new-tab'),
        },
        {
          label: 'New Terminal Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => mainWindow?.webContents.send('menu-new-terminal-tab'),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('menu-close-tab'),
        },
        {
          label: 'Close Other Tabs',
          accelerator: 'CmdOrCtrl+Alt+W',
          click: () => mainWindow?.webContents.send('menu-close-other-tabs'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    // View menu - CRITICAL: No reload accelerators here
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Tab',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('menu-reload-tab'),
        },
        {
          label: 'Force Reload Tab',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow?.webContents.send('menu-force-reload-tab'),
        },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          submenu: [
            {
              label: 'Shell DevTools',
              accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
              click: () => mainWindow?.webContents.toggleDevTools(),
            },
            {
              label: 'Tab DevTools',
              accelerator: isMac ? 'Alt+Cmd+J' : 'Ctrl+Shift+J',
              click: () => mainWindow?.webContents.send('menu-devtools-tab'),
            },
            { type: 'separator' },
            {
              label: 'Chrome Console',
              click: () => mainWindow?.webContents.send('menu-chrome-console'),
            },
            {
              label: 'Chrome DOM Tree',
              click: () => mainWindow?.webContents.send('menu-chrome-tree'),
            },
          ],
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            if (mainWindow) {
              const current = mainWindow.webContents.getZoomFactor()
              mainWindow.webContents.setZoomFactor(Math.min(current + 0.1, 3.0))
            }
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            if (mainWindow) {
              const current = mainWindow.webContents.getZoomFactor()
              mainWindow.webContents.setZoomFactor(Math.max(current - 0.1, 0.5))
            }
          },
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.setZoomFactor(1.0)
            }
          },
        },
      ],
    },

    // Navigate menu
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => mainWindow?.webContents.send('menu-back'),
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => mainWindow?.webContents.send('menu-forward'),
        },
        { type: 'separator' },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: () => mainWindow?.webContents.send('menu-focus-url'),
        },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : []),
      ],
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Copy Agent Prompt',
          click: () => {
            const prompt = getAgentPrompt()
            clipboard.writeText(prompt)
            // Show brief notification
            if (mainWindow) {
              mainWindow.webContents.send(
                'show-notification',
                'Agent prompt copied to clipboard',
              )
            }
          },
        },
        { type: 'separator' },
        {
          label: 'API Documentation',
          click: () => {
            require('electron').shell.openExternal(
              `http://localhost:${HALTIJA_PORT}/api`,
            )
          },
        },
        {
          label: 'Quick Start Guide',
          click: () => {
            require('electron').shell.openExternal(
              `http://localhost:${HALTIJA_PORT}/docs`,
            )
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/**
 * Get the agent prompt for clipboard copy
 */
function getAgentPrompt() {
  return `I have Haltija running at http://localhost:${HALTIJA_PORT}. You can see and control my browser.

**Quick start:**
1. Check server: curl http://localhost:${HALTIJA_PORT}/status
2. Find tabs: curl http://localhost:${HALTIJA_PORT}/windows
3. See what's on page: curl -X POST http://localhost:${HALTIJA_PORT}/tree -d '{"selector":"body","mode":"actionable"}'
4. Do something: curl -X POST http://localhost:${HALTIJA_PORT}/click -d '{"selector":"button"}'

**Key endpoints:**
- GET /status - check connection, list tabs
- GET /windows - list connected tabs with IDs
- GET /endpoints - compact JSON list of all capabilities
- POST /tree - see page structure (use mode:"actionable" for interactive elements)
- POST /click - click an element
- POST /type - type into a field
- POST /scroll - smooth scroll to element or position
- POST /highlight - show the user an element (with optional label)
- POST /wait - wait for element to appear/disappear or fixed delay
- POST /eval - run JavaScript (escape hatch)
- POST /screenshot - capture page image
- GET /events - recent events including network errors
- GET /console - recent console logs/errors
- GET /select/result - get elements user has selected in browser

**Screenshot options:**
- format: "png" (default), "webp", "jpeg"
- scale: 0.5 = half size (saves bandwidth)
- maxWidth/maxHeight: constrain dimensions
- selector: capture specific element instead of full page

Example: curl -X POST http://localhost:${HALTIJA_PORT}/screenshot -d '{"scale":0.5,"format":"webp"}'

**Wait for async UI:**
- curl -X POST http://localhost:${HALTIJA_PORT}/wait -d '{"forElement":".modal"}'
- curl -X POST http://localhost:${HALTIJA_PORT}/wait -d '{"forElement":".loading","hidden":true}'

**Showing things to the user:**
Use /highlight to visually show the user what you're referring to:
- curl -X POST http://localhost:${HALTIJA_PORT}/highlight -d '{"selector":"#btn","label":"Click here"}'

**Target a specific tab:** Add ?window=<id> or include "window":"id" in POST body

All POST endpoints return: {"success": true, "data": ...} or {"success": false, "error": "..."}
`
}

/**
 * Strip security headers that prevent our widget from working
 */
function setupHeaderStripping() {
  // Apply to both default session and our custom partition
  const sessions = [
    session.defaultSession,
    session.fromPartition('persist:haltija'),
  ]

  for (const sess of sessions) {
    sess.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders }

      // Remove CSP headers
      delete headers['content-security-policy']
      delete headers['Content-Security-Policy']
      delete headers['content-security-policy-report-only']
      delete headers['Content-Security-Policy-Report-Only']

      // Remove frame options
      delete headers['x-frame-options']
      delete headers['X-Frame-Options']

      // Remove other restrictive headers
      delete headers['x-content-type-options']
      delete headers['X-Content-Type-Options']

      callback({ responseHeaders: headers })
    })
  }
}

/**
 * Inject the Haltija widget into every page
 */
function setupWidgetInjection() {
  const { webContents } = require('electron')

  // Monitor all webContents for page loads
  webContents.getAllWebContents().forEach((wc) => setupWebContentsInjection(wc))

  // Also monitor for new webContents (like webviews)
  app.on('web-contents-created', (event, wc) => {
    setupWebContentsInjection(wc)
  })

  // Close window (triggered when last tab is closed)
  ipcMain.on('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.close()
  })

  // Inject into the main webview when it loads (legacy support)
  ipcMain.on('webview-ready', (event, webContentsId) => {
    const wc = webContents.fromId(webContentsId)
    if (wc) {
      injectWidget(wc)
    }
  })
}

function setupWebContentsInjection(wc) {
  const wcType = wc.getType()

  // Inject into webviews (tabs) and popup windows (auth flows, etc.)
  // Skip the main Electron renderer (browserView/webview parent)
  if (wcType !== 'webview' && wcType !== 'window') return

  // For windows, skip the main Electron shell
  if (wcType === 'window') {
    // The main window loads index.html - don't inject there
    // But do inject into popup windows (auth, etc.)
    const url = wc.getURL()
    if (url.startsWith('file://') || url === 'about:blank') return
  }

  console.log('[Haltija Desktop] Monitoring webContents:', wc.id, wc.getType())

  // Intercept window.open(): a genuine POPUP stays a popup; an ordinary new-window link becomes a
  // tab in our own tab strip.
  //
  // This used to decide by GUESSING FROM THE URL — allow if it contained `oauth`, `signin`,
  // `login`, `accounts.google.com`, `/__/auth/`. Everything else was denied and re-opened as a tab,
  // which severs the opener relationship in both directions: `window.open()` returns **null** and
  // the child has no `window.opener`. That is the shape of every OAuth popup flow (issue #25):
  // an SDK keeps the returned WindowProxy to poll `.closed` and to `.close()`, and the callback
  // page delivers its credential via `opener.postMessage(...)`. With neither, the user can complete
  // a sign-in in a window that cannot report back — worse than a clean block, because the app just
  // waits.
  //
  // The heuristic failed in both directions: an innocent `/login-help` page became a popup, while
  // the common SDK pattern of opening `about:blank` and *then* navigating matched nothing and was
  // denied — the case the list was written to catch.
  //
  // `disposition` is what the page actually asked for, so there is nothing to guess (verified
  // against Electron):
  //   window.open(url, name, 'width=420,height=320')  -> 'new-window'     features: "width=..."
  //   window.open(url, '_blank')                      -> 'foreground-tab' features: ""
  //   <a target="_blank">                             -> 'foreground-tab' features: ""
  //
  // Allowing a real popup also fixes two things for free, because the window model already handles
  // popups correctly: it registers as `windowType: "popup"` (so scripts can tell it from a
  // user-opened tab) and it does NOT steal focus, since only real tabs become the untargeted
  // command target.
  //
  // KNOWN RESIDUAL: a featureless `window.open(url, '_blank')` is indistinguishable from a
  // `target="_blank"` link at this layer — both report 'foreground-tab' — so it still becomes a tab
  // and still returns null. Preserving the tab UX for ordinary links is worth that; if an SDK turns
  // up that opens featureless popups and needs the opener, this is the line to revisit.
  wc.setWindowOpenHandler((details) => {
    const { url, disposition } = details
    console.log('[Haltija Desktop] Intercepted window.open:', url, `(disposition: ${disposition})`)

    if (disposition === 'new-window') {
      console.log('[Haltija Desktop] Genuine popup — preserving the opener relationship:', url)
      return { action: 'allow' }
    }

    // Ordinary new-window link: open as a tab instead.
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('open-url-in-tab', url)
    }
    return { action: 'deny' }
  })

  // Capture console messages from the webview
  wc.on('console-message', (event) => {
    try {
      const prefix = event.level === 2 ? 'WARN' : event.level === 3 ? 'ERROR' : 'LOG'
      console.log(`[Webview ${prefix}] ${event.message}`)
    } catch (e) {
      // Ignore write errors when app is closing
    }
  })

  wc.on('did-finish-load', () => {
    try {
      const url = wc.getURL()
      console.log('[Haltija Desktop] did-finish-load:', url)
      if (url && url !== 'about:blank') {
        setTimeout(() => injectWidget(wc), 100)
      }
    } catch (e) {
      // Ignore errors when app is closing
    }
  })

  wc.on('did-navigate', (event, url) => {
    try {
      console.log('[Haltija Desktop] did-navigate:', url)
    } catch (e) {
      // Ignore errors when app is closing
    }
  })

  // Handle beforeunload dialogs — allow navigation by default so agents aren't blocked.
  // The component's dialog policy (configurable via /dialog/configure) controls this,
  // but as a safety net, Electron's will-prevent-unload always allows navigation.
  wc.on('will-prevent-unload', (event) => {
    console.log('[Haltija Desktop] Preventing beforeunload block for:', wc.getURL())
    event.preventDefault() // Tells Electron to proceed with navigation despite beforeunload
  })
}

/**
 * Find the webview webContents for a given IPC sender.
 * If sender IS a webview, return it directly.
 * If sender is the renderer (main window), return null (caller should use explicit wcId).
 */
function findWebContentsForSender(sender) {
  if (!sender) return null
  // webview-preload.js IPC: sender is the webview itself
  if (sender.getType() === 'webview') return sender
  // renderer preload.js IPC: sender is the main window, not useful for targeting a specific webview
  return null
}

async function injectWidget(webContents) {
  const url = webContents.getURL()
  console.log('[Haltija Desktop] Injecting widget into:', url)

  // Skip about:blank and file:// URLs
  if (!url || url === 'about:blank' || url.startsWith('file://')) {
    return
  }

  try {
    // Check if already injected
    const alreadyPresent = await webContents.executeJavaScript(`
      !!(window.__haltija_widget_id__ && document.getElementById(window.__haltija_widget_id__))
    `)
    if (alreadyPresent) {
      console.log('[Haltija Desktop] Widget already present')
      return
    }

    // Fetch component.js from our local server (main process can do this, bypasses CORS)
    // Add cache-buster to ensure we always get fresh code
    const cacheBuster = Date.now()
    const componentCode = await new Promise((resolve, reject) => {
      http
        .get(`${HALTIJA_SERVER}/component.js?_=${cacheBuster}`, (res) => {
          // Set encoding to UTF-8 to properly handle Unicode characters
          res.setEncoding('utf8')
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => resolve(data))
        })
        .on('error', reject)
    })

    console.log(
      '[Haltija Desktop] Got component.js, length:',
      componentCode.length,
    )

    // Set config for auto-inject, then execute component code
    // component.ts will handle deduplication, ID generation, and element creation
    // windowId combines app instance ID + webContents.id for globally unique tab identification
    // This is stable across navigations (even cross-origin) enabling cross-page recording
    const wsUrl = HALTIJA_SERVER.replace('http:', 'ws:') + '/ws/browser'
    const windowId = `hj-${APP_INSTANCE_ID}-${webContents.id}`
    const configObj = { serverUrl: wsUrl, windowId, mode: 'headless' }
    await webContents.executeJavaScript(
      `window.__haltija_config__ = ${JSON.stringify(configObj)};`,
    )
    await webContents.executeJavaScript(componentCode)

    console.log('[Haltija Desktop] Widget injected successfully')
  } catch (err) {
    console.error('[Haltija Desktop] Failed to inject widget:', err.message)
  }
}

/**
 * Screen capture API for agents
 */
function setupScreenCapture() {
  // Full page capture
  ipcMain.handle('capture-page', async (event) => {
    if (!mainWindow) return { success: false, error: 'No window' }

    try {
      // Use the sender's webContents - this is the webview that made the request
      const sender = event.sender
      console.log(
        '[Haltija Desktop] capture-page from:',
        sender.id,
        sender.getType(),
      )

      // Capture with timeout to prevent hanging
      const captureWithTimeout = (timeoutMs = 5000) => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Screenshot capture timed out after ${timeoutMs}ms`))
          }, timeoutMs)
          
          sender.capturePage().then((image) => {
            clearTimeout(timeout)
            resolve(image)
          }).catch((err) => {
            clearTimeout(timeout)
            reject(err)
          })
        })
      }

      const image = await captureWithTimeout(5000)
      return {
        success: true,
        data: image.toDataURL(),
        size: { width: image.getSize().width, height: image.getSize().height },
      }
    } catch (err) {
      console.error('Screen capture failed:', err)
      return { success: false, error: err.message }
    }
  })

  // Element-specific capture (crops from full page)
  ipcMain.handle('capture-element', async (event, selector) => {
    if (!mainWindow) return { success: false, error: 'No window' }

    try {
      // Use event.sender to get the correct webview (fixes multi-tab issue)
      const sender = event.sender
      console.log(
        '[Haltija Desktop] capture-element from:',
        sender.id,
        sender.getType(),
        'selector:',
        selector,
      )

      // Get element bounds
      const bounds = await sender.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
        })()
      `)

      if (!bounds) {
        return { success: false, error: `Element not found: ${selector}` }
      }

      // Capture with timeout to prevent hanging
      const captureWithTimeout = (rect, timeoutMs = 5000) => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Element capture timed out after ${timeoutMs}ms`))
          }, timeoutMs)
          
          sender.capturePage(rect).then((image) => {
            clearTimeout(timeout)
            resolve(image)
          }).catch((err) => {
            clearTimeout(timeout)
            reject(err)
          })
        })
      }

      const image = await captureWithTimeout(bounds, 5000)
      return {
        success: true,
        data: image.toDataURL(),
        selector,
        bounds,
      }
    } catch (err) {
      console.error('Element capture failed:', err)
      return { success: false, error: err.message }
    }
  })

  // Native folder picker dialog
  ipcMain.handle('show-open-dialog', async (event, options) => {
    return dialog.showOpenDialog(mainWindow, options)
  })

  ipcMain.handle('open-renderer-devtools', async () => {
    if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' })
    return true
  })

  // Navigate URL with smart fallback (called from widget in webview)
  // Routes through renderer's navigate() which has https->http fallback.
  // Awaits a result from the renderer so failures (no matching tab, terminal
  // tab targeted, etc.) propagate back to the widget — and to `hj navigate`.
  ipcMain.handle('navigate-url', async (event, url) => {
    if (!mainWindow) throw new Error('No window')

    const id = ++navigateRequestId
    const senderWcId = event.sender.id
    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingNavigates.delete(id)
        resolve({ success: false, error: 'navigate-url: renderer did not respond within 5s' })
      }, 5000)
      pendingNavigates.set(id, { resolve, timeout })
      mainWindow.webContents.send('navigate-url', { id, url, webContentsId: senderWcId })
    })

    if (!result.success) throw new Error(result.error || 'Navigation failed')
    return result
  })

  ipcMain.on('navigate-url-result', (event, { id, success, error }) => {
    const pending = pendingNavigates.get(id)
    if (!pending) return
    clearTimeout(pending.timeout)
    pendingNavigates.delete(id)
    pending.resolve({ success, error })
  })

  // Tab management — forwarded to renderer
  ipcMain.handle('open-tab', async (event, url) => {
    if (!mainWindow) return false
    mainWindow.webContents.send('open-tab', { url })
    return true
  })

  ipcMain.handle('close-tab', async (event, windowId) => {
    if (!mainWindow) return false
    mainWindow.webContents.send('close-tab', { windowId })
    return true
  })

  ipcMain.handle('focus-tab', async (event, windowId) => {
    if (!mainWindow) return false
    mainWindow.webContents.send('focus-tab', { windowId })
    return true
  })

  // CDP Network monitoring — manages per-webContents debugger sessions
  // Accepts explicit wcId for renderer-routed calls, falls back to sender for direct webview calls
  const resolveNetworkWc = (event, wcId) => {
    if (wcId) {
      const { webContents: wcModule } = require('electron')
      return wcModule.fromId(wcId)
    }
    return findWebContentsForSender(event.sender)
  }

  ipcMain.handle('network-watch', async (event, opts = {}) => {
    const wc = resolveNetworkWc(event, opts.wcId)
    if (!wc) return { success: false, error: 'No webview found' }
    return attachNetwork(wc, opts)
  })

  ipcMain.handle('network-unwatch', async (event, wcId) => {
    const wc = resolveNetworkWc(event, wcId)
    if (!wc) return { success: false, error: 'No webview found' }
    detachNetwork(wc)
    return { success: true }
  })

  ipcMain.handle('network-log', async (event, opts = {}) => {
    const wc = resolveNetworkWc(event, opts.wcId)
    if (!wc) return { entries: [], summary: 'no webview' }
    return getNetworkLog(wc.id, opts)
  })

  ipcMain.handle('network-stats', async (event, wcId) => {
    const wc = resolveNetworkWc(event, wcId)
    if (!wc) return { watching: false }
    return getNetworkStats(wc.id)
  })

  ipcMain.handle('network-clear', async (event, wcId) => {
    const wc = resolveNetworkWc(event, wcId)
    if (!wc) return { success: false }
    clearNetwork(wc.id)
    return { success: true }
  })

  // Video capture — forwarded to renderer where MediaRecorder runs
  // Widget (webview) → main → renderer → main → widget
  // Main also provides media source ID from webContents (not available on webview DOM element)
  ipcMain.handle('get-media-source-id', async (event, webContentsId) => {
    try {
      const { webContents } = require('electron')
      const wc = webContents.fromId(webContentsId)
      if (!wc) return null
      // getMediaSourceId requires the requesting WebContents as argument —
      // i.e. the renderer that will call getUserMedia with the returned ID
      const requestingWc = event.sender
      return wc.getMediaSourceId(requestingWc)
    } catch (err) {
      console.error('[Haltija Desktop] Failed to get media source ID:', err.message)
      return null
    }
  })

  // Video file streaming — renderer sends chunks, main writes to disk
  const activeVideoFiles = new Map() // recordingId -> { fd, path, size }

  ipcMain.handle('video-file-create', async () => {
    try {
      // This path streams chunks rather than decoding a data URL, so it can't share
      // `saveDataUrl` — but it DOES share the directory and the retention policy, via the real
      // module rather than a restatement of it. The restatement had already drifted: it ignored
      // HALTIJA_ARTIFACT_DIR (so the unit-test seam didn't cover videos) and pruned nothing, which
      // made screen recordings — the biggest files haltija writes — the only artifacts that
      // accumulated without bound.
      const dir = artifactDir('videos')
      fs.mkdirSync(dir, { recursive: true })
      const shortId = Math.random().toString(36).slice(2, 6)
      const recordingId = `vid-${Date.now().toString(36)}-${shortId}`
      const filepath = `${dir}/hj-${Date.now()}-${shortId}.webm`
      const fd = fs.openSync(filepath, 'w')
      activeVideoFiles.set(recordingId, { fd, path: filepath, size: 0 })
      return { success: true, recordingId }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.on('video-file-chunk', (event, recordingId, buffer) => {
    const file = activeVideoFiles.get(recordingId)
    if (!file) return
    try {
      const data = Buffer.from(buffer)
      fs.writeSync(file.fd, data)
      file.size += data.length
    } catch (err) {
      console.error('[Haltija Desktop] Failed to write video chunk:', err.message)
    }
  })

  ipcMain.handle('video-file-close', async (event, recordingId, duration) => {
    const file = activeVideoFiles.get(recordingId)
    if (!file) return { success: false, error: 'No active recording with that ID' }
    try {
      fs.closeSync(file.fd)
      activeVideoFiles.delete(recordingId)
      // Prune AFTER closing, so the recording we just finished is the newest survivor and can never
      // be the file we delete. Fire-and-forget for the same reason saveDataUrl's is: housekeeping
      // must not delay — or fail — the capture the user actually asked for.
      void pruneKind('videos')
      return { success: true, path: file.path, duration, size: file.size, format: 'webm' }
    } catch (err) {
      activeVideoFiles.delete(recordingId)
      return { success: false, error: err.message }
    }
  })

  // Video start/stop/status — forwarded to renderer where MediaRecorder runs
  ipcMain.handle('video-start', async (event, opts) => {
    if (!mainWindow) return { success: false, error: 'No main window' }
    mainWindow.webContents.send('video-start', { ...opts, senderWebContentsId: event.sender.id })
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: 'Video start timed out' }), 10000)
      ipcMain.once('video-start-result', (_, result) => {
        clearTimeout(timeout)
        resolve(result)
      })
    })
  })

  ipcMain.handle('video-stop', async (event) => {
    if (!mainWindow) return { success: false, error: 'No main window' }
    mainWindow.webContents.send('video-stop', { senderWebContentsId: event.sender.id })
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: 'Video stop timed out' }), 30000)
      ipcMain.once('video-stop-result', (_, result) => {
        clearTimeout(timeout)
        resolve(result)
      })
    })
  })

  ipcMain.handle('video-status', async (event) => {
    if (!mainWindow) return { recording: false }
    mainWindow.webContents.send('video-status', { senderWebContentsId: event.sender.id })
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ recording: false }), 5000)
      ipcMain.once('video-status-result', (_, result) => {
        clearTimeout(timeout)
        resolve(result)
      })
    })
  })

  // Hard refresh — bypasses all caches (called from widget in webview)
  ipcMain.handle('hard-refresh', async (event) => {
    const wc = event.sender
    if (wc) {
      wc.reloadIgnoringCache()
      return { success: true }
    }
    return { success: false, error: 'No webContents' }
  })

  // Create a new agent tab (called from widget in webview)
  ipcMain.handle('open-agent-tab', async (event) => {
    if (!mainWindow) return { error: 'No window' }

    try {
      // Send message to renderer to create agent tab, wait for response
      const result = await new Promise((resolve) => {
        // Generate unique request ID
        const requestId = `agent-tab-${Date.now()}`
        
        // Listen for response from renderer
        const responseHandler = (event, response) => {
          if (response.requestId === requestId) {
            ipcMain.removeListener('agent-tab-created', responseHandler)
            resolve(response)
          }
        }
        ipcMain.on('agent-tab-created', responseHandler)
        
        // Tell renderer to create the tab
        mainWindow.webContents.send('create-agent-tab', { requestId })
        
        // Timeout after 10 seconds
        setTimeout(() => {
          ipcMain.removeListener('agent-tab-created', responseHandler)
          resolve({ error: 'Timeout waiting for agent tab' })
        }, 10000)
      })

      return result
    } catch (err) {
      return { error: err.message }
    }
  })
}

/**
 * Check if Haltija server is already running
 */
function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${HALTIJA_SERVER}/status`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * Spawn a single haltija server subprocess on a given port.
 * Stdout/stderr are piped to the desktop app's console with a label, and
 * `__NEED_WINDOW__` from the public server triggers window recreation.
 */
// Registered at MODULE SCOPE, once. It was originally inside spawnHaltijaServer, which runs twice
// (public and internal servers) — Electron throws "Attempted to register a second handler" and the
// app dies at startup. Found by launching the app; no unit test would have caught it.
/**
 * Machine control over the public server's stdio (#40).
 *
 * /terminal/* and /files/* are refused on the network listener, because a text/plain POST is a
 * CORS-simple request and any web page could reach them. The desktop app's own tabs still need
 * them, so they travel down a pipe instead: no port, no origin, nothing fetch() can name.
 *
 * A Unix socket was the first choice and does not work — Bun 1.4.0 accepts the connection and
 * never answers (verified three ways against a working Node<->Node control). Don't retry it.
 */
const MACHINE_REQ_PREFIX = 'HJ_MACHINE_REQ '
const MACHINE_RES_PREFIX = 'HJ_MACHINE_RES '
const machinePending = new Map()
let machineBuffer = ''
let machineSeq = 0
let machineProc = null

function machineRequest(path, init = {}) {
  return new Promise((resolve) => {
    if (!machineProc || !machineProc.stdin || machineProc.stdin.destroyed) {
      // The likeliest cause by far: serverMode 'auto' found a healthy server on 8700 and ATTACHED
      // to it rather than starting its own (which is deliberate — it must not kill another
      // project's channel). But the pipe requires being the server's PARENT, so an adopted server
      // has no machine control. Name the remedy; "unavailable" alone sends people hunting.
      const adopted = reusedExternalServer
      resolve({ status: 503, bodyB64: Buffer.from(JSON.stringify({
        success: false,
        error: adopted
          ? 'Terminal, agent and file features need a server this app started itself, and this '
            + 'instance ATTACHED to a haltija server that was already running (it will not kill '
            + 'another project\'s channel). Quit that server, or relaunch with '
            + 'HALTIJA_SERVER_MODE=builtin to force its own. See issue #40.'
          : 'The machine-control channel is not open. It exists only for the desktop app\'s own '
            + 'server (issue #40); terminal and file features are unavailable in this instance.',
      })).toString('base64') })
      return
    }
    const id = `m${++machineSeq}`
    // ALWAYS resolve. A tab awaiting an id that never returns looks frozen, which is far worse to
    // diagnose than an error, so every request carries its own deadline.
    const timer = setTimeout(() => {
      if (machinePending.delete(id)) {
        resolve({ status: 504, bodyB64: Buffer.from(JSON.stringify({
          success: false, error: `Timed out waiting for ${path} on the machine channel.`,
        })).toString('base64') })
      }
    }, 30000)
    machinePending.set(id, (res) => { clearTimeout(timer); resolve(res) })
    const frame = { id, method: init.method || 'GET', path, headers: init.headers || {} }
    if (init.bodyB64 !== undefined) frame.bodyB64 = init.bodyB64
    try {
      machineProc.stdin.write(MACHINE_REQ_PREFIX + JSON.stringify(frame) + '\n')
    } catch (err) {
      if (machinePending.delete(id)) {
        clearTimeout(timer)
        resolve({ status: 500, bodyB64: Buffer.from(JSON.stringify({
          success: false, error: String(err && err.message || err),
        })).toString('base64') })
      }
    }
  })
}

ipcMain.handle('machine-request', async (_evt, path, init) => {
  // Only this prefix pair is reachable, so a compromised renderer cannot use the channel as a
  // general proxy to the server (e.g. to bypass a token on some unrelated endpoint).
  if (typeof path !== 'string' || !(path.startsWith('/terminal/') || path.startsWith('/files/'))) {
    return { status: 400, bodyB64: Buffer.from(JSON.stringify({
      success: false, error: 'machine-request only carries /terminal/* and /files/* paths',
    })).toString('base64') }
  }
  return machineRequest(path, init || {})
})

  function spawnHaltijaServer({ port, role, serverPath, useCompiledBinary, componentDir, portFile }) {
  // Built by src/desktop-server-env.ts, whose contract is unit-tested without launching Electron —
  // getting this wrong is silent (a child that ignores its port, binds the parent's, and dies).
const env = buildServerEnv(process.env, {
    port,
    role: role === 'public' ? 'public' : 'internal',
    isPrivate: IS_PRIVATE,
    portFile,
  })
  let proc
  if (serverPath && useCompiledBinary) {
    proc = spawn(serverPath, [], {
      stdio: [role === 'public' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      cwd: componentDir || path.dirname(serverPath),
      env,
    })
  } else if (serverPath) {
    proc = spawn('bun', ['run', serverPath], {
      stdio: [role === 'public' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env,
    })
  } else {
    proc = spawn('bunx', ['haltija', '--port', port.toString()], {
      stdio: [role === 'public' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env,
    })
  }

  if (role === 'public') machineProc = proc

  const label = `[${role} server]`

  proc.stdout.on('data', (data) => {
    try {
      // Machine-channel responses first, on the RAW chunk. The logging path below trims and
      // reformats, and a pipe splits frames wherever it likes — so parsing has to be line-based
      // and buffered, or a large /files/tree answer arrives as fragments and never resolves.
      if (role === 'public') {
        machineBuffer += data.toString()
        const parts = machineBuffer.split('\n')
        machineBuffer = parts.pop()
        for (const line of parts) {
          if (!line.startsWith(MACHINE_RES_PREFIX)) {
            if (line.trim()) console.log(`${label} ${line.trim()}`)
            continue
          }
          try {
            const res = JSON.parse(line.slice(MACHINE_RES_PREFIX.length))
            const waiting = machinePending.get(res.id)
            if (waiting) { machinePending.delete(res.id); waiting(res) }
          } catch {}
        }
        if (role === 'public' && machineBuffer.includes('__NEED_WINDOW__') && BrowserWindow.getAllWindows().length === 0) {
          console.log('[Haltija Desktop] Server requested window, recreating...')
          createWindow()
        }
        return
      }
      const text = data.toString().trim()
      console.log(`${label} ${text}`)
      if (role === 'public' && text.includes('__NEED_WINDOW__') && BrowserWindow.getAllWindows().length === 0) {
        console.log('[Haltija Desktop] Server requested window, recreating...')
        createWindow()
      }
    } catch {}
  })
  proc.stderr.on('data', (data) => {
    try { console.error(`${label} ${data.toString().trim()}`) } catch {}
  })
  proc.stdout.on('error', () => {})
  proc.stderr.on('error', () => {})
  proc.on('error', (err) => {
    console.error(`[Haltija Desktop] Failed to start ${role} server:`, err)
  })
  proc.on('exit', (code) => {
    console.log(`[Haltija Desktop] ${role} server exited with code ${code}`)
    const idx = embeddedServers.indexOf(proc)
    if (idx !== -1) embeddedServers.splice(idx, 1)
  })

  embeddedServers.push(proc)
  return proc
}

/**
 * Start embedded Haltija server
 */
async function startEmbeddedServer() {
  // Determine architecture
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64'
  const platform = os.platform()

  // Find the server binary - look in common locations
  const binaryName =
    platform === 'win32'
      ? `haltija-server-${arch}.exe`
      : `haltija-server-${arch}`

  const possiblePaths = [
    // Packaged app: in resources
    path.join(process.resourcesPath || '', binaryName),
    // Development: in resources folder
    path.join(__dirname, 'resources', binaryName),
    // Fallback: try the repo dist
    path.join(__dirname, '..', '..', 'dist', 'server.js'),
  ]

  let serverPath = null
  let useCompiledBinary = false

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) {
      serverPath = p
      useCompiledBinary = !p.endsWith('.js')
      break
    }
  }

  console.log('[Haltija Desktop] Starting embedded server...')
  console.log(
    '[Haltija Desktop] Server path:',
    serverPath || 'fallback to bunx',
  )

  const componentPaths = [
    path.join(process.resourcesPath || '', 'component.js'),
    path.join(__dirname, 'resources', 'component.js'),
  ]
  let componentDir = null
  for (const p of componentPaths) {
    if (fs.existsSync(p)) {
      componentDir = path.dirname(p)
      console.log('[Haltija Desktop] Component.js found at:', p)
      break
    }
  }

  if (IS_PRIVATE) {
    // Private: both servers bind ephemeral ports we don't know yet. Give each its own port-file,
    // wait for them to report, then reassign the module ports so everything downstream (injection,
    // status, tabs, help) follows the ephemeral instance. Never touches 8700/8701.
    const pubFile = path.join(os.tmpdir(), `haltija-app-pub-${process.pid}.json`)
    const intFile = path.join(os.tmpdir(), `haltija-app-int-${process.pid}.json`)
    try { fs.rmSync(pubFile, { force: true }); fs.rmSync(intFile, { force: true }) } catch {}

    spawnHaltijaServer({ port: 0, role: 'public', serverPath, useCompiledBinary, componentDir, portFile: pubFile })
    spawnHaltijaServer({ port: 0, role: 'internal', serverPath, useCompiledBinary, componentDir, portFile: intFile })

    // Poll a child server's port-file. 10s, DELIBERATELY shorter than the launcher's 30s in
    // bin/tosijs-dev.mjs (discoverPrivatePort) — these wait on different things and the numbers are
    // not drift: here we await a local server process we just spawned (sub-second normally), there
    // the launcher awaits a full Electron boot. If you change one, don't "align" the other.
    const PORT_FILE_TIMEOUT_MS = 10_000
    const readPort = async (file) => {
      const deadline = Date.now() + PORT_FILE_TIMEOUT_MS
      while (Date.now() < deadline) {
        try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d && d.port) return d.port } catch {}
        await new Promise((r) => setTimeout(r, 200))
      }
      return null
    }
    const pubPort = await readPort(pubFile)
    const intPort = await readPort(intFile)
    if (!pubPort) {
      // Don't leak the pid-scoped tmp port-files on the failure path (the success path cleans below).
      try { fs.rmSync(pubFile, { force: true }); fs.rmSync(intFile, { force: true }) } catch {}
      console.error('[Haltija Desktop] Private public server did not report its port')
      return false
    }

    HALTIJA_PORT = pubPort
    HALTIJA_SERVER = `http://localhost:${pubPort}`
    if (intPort) {
      HALTIJA_INTERNAL_PORT = intPort
      HALTIJA_INTERNAL_SERVER = `http://localhost:${intPort}`
    } else {
      // The internal server never reported. Leaving the port at 0 makes the preload's
      // `parseInt(...) || 8701` fall back to the SHARED internal port — a private app's chrome
      // widget would attach to another project's server. Better to have no chrome widget than to
      // silently join the channel this mode exists to stay out of.
      console.error('[Haltija Desktop] Private internal server did not report a port — chrome widget disabled (refusing to fall back to the shared 8701)')
      HALTIJA_INTERNAL_PORT = 0
      HALTIJA_INTERNAL_SERVER = ''
    }
    try { fs.rmSync(pubFile, { force: true }); fs.rmSync(intFile, { force: true }) } catch {}

    // Hand the PUBLIC address to the consumer that asked for this private instance.
    if (CALLER_PORT_FILE) {
      try {
        fs.writeFileSync(CALLER_PORT_FILE, JSON.stringify({ port: pubPort, url: HALTIJA_SERVER, internalPort: intPort || null, pid: process.pid }))
      } catch (err) { console.error('[Haltija Desktop] Could not write caller port-file:', err.message) }
    }
    console.log(`[Haltija Desktop] Private instance ready — public ${HALTIJA_SERVER}, internal :${intPort || 'n/a'} (8700/8701 untouched)`)
    return true
  }

  spawnHaltijaServer({ port: HALTIJA_PORT, role: 'public', serverPath, useCompiledBinary, componentDir })
  spawnHaltijaServer({ port: HALTIJA_INTERNAL_PORT, role: 'internal', serverPath, useCompiledBinary, componentDir })

  // Wait for the public server to be ready (the internal one is best-effort —
  // the chrome widget will retry until it connects).
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200))
    if (await checkServerRunning()) {
      console.log('[Haltija Desktop] Server ready')
      return true
    }
  }

  console.error('[Haltija Desktop] Server failed to start')
  return false
}

/**
 * Ensure Haltija server is available
 */
/** Is anything listening on this port? Listeners only — never connected clients. */
function listenerPidsOnPort(port) {
  const { execSync } = require('child_process')
  try {
    // `-sTCP:LISTEN` is load-bearing. `lsof -i :PORT` matches sockets whose local OR
    // REMOTE port is PORT, so without it this also returns every connected CLIENT —
    // i.e. the user's browser, holding a WebSocket to this very server. Browsers open
    // since login have the lower pid and sort first, so killing what this returns used
    // to kill the browser and leave the server running.
    const out = execSync(`lsof -ti:${port} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf-8' }).trim()
    if (!out) return []
    return out.split('\n').filter(Boolean).map(Number)
      .filter(pid => Number.isFinite(pid) && pid !== process.pid)
  } catch {
    return []
  }
}

/** Only signal something we can positively identify as haltija. */
function isHaltijaProcess(pid) {
  const { execSync } = require('child_process')
  try {
    const cmd = execSync(`ps -p ${pid} -o command= 2>/dev/null`, { encoding: 'utf-8' }).trim()
    return !!cmd && /haltija|tosijs-dev/i.test(cmd)
  } catch {
    return false
  }
}

/**
 * Free a port held by an old haltija server.
 *
 * ASK FIRST. `POST /shutdown` has shipped since 0.1.7, so any haltija server on this
 * port can stop itself — cleanly, and with no pid involved. That matters: this used to
 * run `lsof -ti:PORT | xargs kill -9`, which kills every pid matching the port
 * INCLUDING connected clients, i.e. the user's browser. It ran on the default launch
 * path, whenever a server was already up — exactly when browsers are attached.
 *
 * Signalling is now the fallback only, restricted to LISTENERS that `ps` confirms are
 * haltija, and it never escalates to -9 against something it could not identify.
 */
async function killZombieOnPort(port) {
  if (os.platform() === 'win32') return true

  if (listenerPidsOnPort(port).length === 0) {
    console.log(`[Haltija Desktop] Port ${port} is free`)
    return true
  }

  // 1. Ask.
  try {
    await fetch(`http://localhost:${port}/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // Dying mid-response is a success; the liveness check below decides.
  }
  for (let i = 0; i < 20; i++) {
    if (listenerPidsOnPort(port).length === 0) {
      console.log(`[Haltija Desktop] Server on port ${port} shut down cleanly`)
      return true
    }
    await new Promise(r => setTimeout(r, 100))
  }

  // 2. It didn't answer. Signal only what we can identify.
  for (const pid of listenerPidsOnPort(port)) {
    if (!isHaltijaProcess(pid)) {
      console.error(`[Haltija Desktop] Port ${port} is held by pid ${pid}, which is not a haltija server — leaving it alone`)
      continue
    }
    try {
      process.kill(pid, 'SIGTERM')
      console.log(`[Haltija Desktop] Stopped unresponsive haltija (pid ${pid}) on port ${port}`)
    } catch {}
  }
  await new Promise(r => setTimeout(r, 500))

  if (listenerPidsOnPort(port).length === 0) {
    console.log(`[Haltija Desktop] Port ${port} freed`)
    return true
  }
  console.error(`[Haltija Desktop] Warning: could not free port ${port}`)
  return false
}

async function killZombieServer() {
  const publicOk = await killZombieOnPort(HALTIJA_PORT)
  const internalOk = await killZombieOnPort(HALTIJA_INTERNAL_PORT)
  return publicOk && internalOk
}

async function ensureServer() {
  // Private is isolated by construction: never look for, adopt, or replace a shared server. It
  // always starts its own on ephemeral ports. `checkServerRunning` would probe 8700 (which we
  // must ignore), so skip it entirely.
  if (IS_PRIVATE) {
    return await startEmbeddedServer()
  }

  const running = await checkServerRunning()

  switch (prefs.serverMode) {
    case 'external':
      // Never start embedded server, expect external
      if (running) {
        console.log('[Haltija Desktop] Using external server at', HALTIJA_SERVER)
        return true
      }
      console.log('[Haltija Desktop] No external server found at', HALTIJA_SERVER)
      return false

    case 'auto':
      // Use existing if found, else start embedded. Reusing is the whole point: it means the
      // app does NOT kill a channel another project may be running on 8700/8701.
      if (running) {
        // Surface this prominently — the user should know the app attached to a server it did
        // NOT start (possibly a different version/config), rather than silently assuming its own.
        const banner = `Attached to an existing haltija server at ${HALTIJA_SERVER} (did not start my own; set HALTIJA_SERVER_MODE=builtin to force a fresh one)`
        console.log(`[Haltija Desktop] ${banner}`)
        reusedExternalServer = true
        reusedServerBanner = banner
        return true
      }
      console.log('[Haltija Desktop] No server found, starting embedded')
      return await startEmbeddedServer()

    case 'builtin':
    default:
      // Always kill existing and start fresh
      if (running) {
        console.log('[Haltija Desktop] Killing existing server for fresh start')
        await killZombieServer()
      }
      console.log('[Haltija Desktop] Starting embedded server')
      return await startEmbeddedServer()
  }
}

/**
 * Hand the renderer this instance's REAL addresses.
 *
 * The renderer learns them from `process.env` via the preload, but private mode only reassigns the
 * module-level `let`s — which does not touch `process.env`. Without this, a private app's chrome
 * widget attached to the SHARED 8701 and its first tab loaded the shared 8700. Must run on EVERY
 * path that reaches `createWindow()`, including the startup-failure one, or the leak returns
 * through the error path. 0 / '' mean "no server", and the renderer treats them as such.
 */
function publishResolvedAddresses() {
  process.env.HALTIJA_INTERNAL_PORT = String(HALTIJA_INTERNAL_PORT)
  process.env.HALTIJA_PUBLIC_URL = HALTIJA_SERVER
}

// Single-instance lock — prevent multiple Electron windows from launching.
// A PRIVATE run must NOT contend for it (issue #7): private instances are isolated on ephemeral
// ports and are meant to run many at once / back-to-back. Taking the shared lock means an orphaned
// private Electron blocks the NEXT private run ("Another instance is already running"), and two
// concurrent private runs collide. So a private run never requests and never holds the lock.
const gotTheLock = IS_PRIVATE ? true : app.requestSingleInstanceLock()

if (!gotTheLock) {
  console.log('[Haltija Desktop] Another instance is already running. Focusing existing window.')
  app.quit()
} else {
  app.on('second-instance', () => {
    // Focus the existing window when user tries to launch again
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  // "Torn down with the run": a PRIVATE Electron must not outlive its spawner (issue #7). An
  // orphaned private Electron holds nothing shared anymore (we skip the lock above), but it still
  // leaks a process + its servers. Electron reparents to launchd shortly after startup, so
  // process.ppid is useless — the launcher passes its own pid as HALTIJA_SPAWNER_PID and we poll
  // it. On the spawner's death, or a SIGTERM/SIGINT, quit via app.quit() → 'will-quit' kills the
  // child servers AND Electron reaps its own helper processes (which an EXTERNAL kill notoriously
  // fails to do — the reason we self-terminate instead of asking the consumer to hunt the tree).
  if (IS_PRIVATE) {
    let quitting = false
    const quitOnce = () => { if (quitting) return; quitting = true; try { app.quit() } catch {} }
    process.on('SIGTERM', quitOnce)
    process.on('SIGINT', quitOnce)
    const spawnerPid = parseInt(process.env.HALTIJA_SPAWNER_PID || '', 10)
    if (Number.isFinite(spawnerPid)) {
      const iv = setInterval(() => {
        let alive = true
        try { process.kill(spawnerPid, 0) } catch { alive = false } // signal 0 = existence check
        if (!alive) { clearInterval(iv); console.log('[Haltija Desktop] spawner gone — tearing down private instance'); quitOnce() }
      }, 1000)
      if (iv.unref) iv.unref()
    }
  }

  // App lifecycle
  app.whenReady().then(async () => {
    console.log('[Haltija Desktop] App ready, starting initialization...')

    // Clear the "manually quit" marker — user is explicitly starting Haltija,
    // so hj should resume auto-launching when needed.
    try {
      const quitMarker = path.join(os.homedir(), '.haltija', 'last-quit')
      if (fs.existsSync(quitMarker)) fs.rmSync(quitMarker, { force: true })
    } catch {}
    
    try {
      // Start or connect to server first
      const serverReady = await ensureServer()

      if (!serverReady) {
        console.error(
          '[Haltija Desktop] Could not start server. Install bun: https://bun.sh',
        )
        // Continue anyway - user might start server manually
      }

      publishResolvedAddresses()

      setupMenu()
      setupHeaderStripping()
      setupWidgetInjection()
      setupScreenCapture()
      
      console.log('[Haltija Desktop] Creating main window...')
      createWindow()
      console.log('[Haltija Desktop] Window created successfully')
    } catch (err) {
      console.error('[Haltija Desktop] Fatal error during startup:', err)
      // Publish here too. This path still creates a window, so without it the preload would see
      // NEITHER variable and fall back to the shared 8701/8700 — the isolation leak, via the
      // error path. On a failed startup the values are 0/'' , which is the safe state.
      publishResolvedAddresses()
      // Still try to create a window so user sees something
      try {
        createWindow()
      } catch (windowErr) {
        console.error('[Haltija Desktop] Failed to create window:', windowErr)
      }
    }

    // Check for Claude Desktop MCP setup (after window is ready)
    if (!hasSkippedMcpSetup()) {
      // Small delay to let window fully render
      setTimeout(() => checkAndPromptMcpSetup(), 1500)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    if (embeddedServers.length > 0) {
      console.log(`[Haltija Desktop] Stopping ${embeddedServers.length} embedded server(s)`)
      for (const proc of embeddedServers) {
        try { proc.kill() } catch {}
      }
      embeddedServers.length = 0
    }
    // Drop a marker so hj's auto-launch knows the user explicitly quit.
    // Cleared next time the user manually starts Haltija.
    //
    // NOT in private mode: `~/.haltija/last-quit` is SHARED state, and an automated run ending is
    // not the user quitting anything. Writing it suppressed auto-launch for the interactive app the
    // developer is actually using — the same class as the profile sharing above (#31), where
    // "private" turned out to mean "private ports" rather than "touches nothing of yours".
    if (!IS_PRIVATE) {
      try {
        const dir = path.join(os.homedir(), '.haltija')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'last-quit'), String(Date.now()))
      } catch {}
    }

    // NOTE: the private profile is deliberately NOT deleted here. Chromium flushes its caches
    // AFTER 'will-quit', so removing the directory at this point just gets it recreated — measured:
    // both dirs survived a clean shutdown. Stale profiles are swept at the START of the next
    // private run instead (see sweepStalePrivateState in bin/tosijs-dev.mjs), keyed on whether the
    // owning pid is still alive, which is immune to shutdown ordering.
  })

  // Handle certificate errors (for self-signed certs in dev)
  app.on(
    'certificate-error',
    (event, webContents, url, error, certificate, callback) => {
      if (url.startsWith('https://localhost')) {
        event.preventDefault()
        callback(true)
      } else {
        callback(false)
      }
    },
  )
}
