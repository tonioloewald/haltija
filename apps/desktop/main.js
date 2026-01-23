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
  desktopCapturer,
  Menu,
  dialog,
  clipboard,
} = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const http = require('http')

// Suppress EIO errors when stdout/stderr pipes break during shutdown
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

// Haltija server config
const HALTIJA_PORT = parseInt(process.env.HALTIJA_PORT || '8700')
const HALTIJA_SERVER = `http://localhost:${HALTIJA_PORT}`

let mainWindow = null
let embeddedServer = null

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
    console.log(
      '[Haltija Desktop] Claude Desktop not detected, skipping MCP setup prompt',
    )
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Allow __dirname in preload
      webviewTag: true, // Enable <webview> tag
    },
    titleBarStyle: 'hiddenInset', // Minimal chrome on macOS
    trafficLightPosition: { x: 12, y: 12 },
  })

  // Load the shell UI
  mainWindow.loadFile('index.html')

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
          label: 'Developer Tools (Shell)',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        {
          label: 'Developer Tools (Tab)',
          accelerator: isMac ? 'Alt+Cmd+J' : 'Ctrl+Shift+J',
          click: () => mainWindow?.webContents.send('menu-devtools-tab'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
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

  // Intercept window.open() calls - redirect to tabs instead of new windows
  // Exception: allow auth popups which need to close and callback
  wc.setWindowOpenHandler(({ url, frameName, features }) => {
    console.log('[Haltija Desktop] Intercepted window.open:', url)

    // Allow OAuth/auth popups - they need popup behavior to work
    const isAuthPopup =
      url.includes('accounts.google.com') ||
      url.includes('/__/auth/') ||
      url.includes('/emulator/auth') ||
      url.includes('firebaseapp.com/__/auth') ||
      url.includes('oauth') ||
      url.includes('signin') ||
      url.includes('login') ||
      frameName === 'firebaseAuth'

    if (isAuthPopup) {
      console.log('[Haltija Desktop] Allowing auth popup:', url)
      return { action: 'allow' }
    }

    // Regular links: open as new tab instead of window
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('open-url-in-tab', url)
    }
    return { action: 'deny' }
  })

  // Capture console messages from the webview
  wc.on('console-message', (event, level, message, line, sourceId) => {
    try {
      const prefix = level === 2 ? 'WARN' : level === 3 ? 'ERROR' : 'LOG'
      console.log(`[Webview ${prefix}] ${message}`)
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
    const wsUrl = HALTIJA_SERVER.replace('http:', 'ws:') + '/ws/browser'
    await webContents.executeJavaScript(
      `window.__haltija_config__ = { serverUrl: '${wsUrl}' };`,
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
    if (!mainWindow) return null

    try {
      // Use the sender's webContents - this is the webview that made the request
      const sender = event.sender
      console.log(
        '[Haltija Desktop] capture-page from:',
        sender.id,
        sender.getType(),
      )

      // Capture the sender (which should be the webview that called this)
      const image = await sender.capturePage()
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

      // Capture with specific rect
      const image = await sender.capturePage(bounds)
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

  // Find component.js - server needs this to inject session ID
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

  if (serverPath && useCompiledBinary) {
    // Run compiled standalone binary with cwd set to find component.js
    embeddedServer = spawn(serverPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: componentDir || path.dirname(serverPath),
      env: { ...process.env, PORT: HALTIJA_PORT.toString() },
    })
  } else if (serverPath) {
    // Run with bun (development)
    embeddedServer = spawn('bun', ['run', serverPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: HALTIJA_PORT.toString() },
    })
  } else {
    // Fallback to bunx haltija
    embeddedServer = spawn(
      'bunx',
      ['haltija', '--port', HALTIJA_PORT.toString()],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
  }

  embeddedServer.stdout.on('data', (data) => {
    try {
      console.log(`[Server] ${data.toString().trim()}`)
    } catch (e) {
      // Ignore write errors when app is closing
    }
  })

  embeddedServer.stderr.on('data', (data) => {
    try {
      console.error(`[Server] ${data.toString().trim()}`)
    } catch (e) {
      // Ignore write errors when app is closing
    }
  })

  embeddedServer.stdout.on('error', () => {})
  embeddedServer.stderr.on('error', () => {})

  embeddedServer.on('error', (err) => {
    console.error('[Haltija Desktop] Failed to start server:', err)
  })

  embeddedServer.on('exit', (code) => {
    if (embeddedServer) {
      console.log(`[Haltija Desktop] Server exited with code ${code}`)
      embeddedServer = null
    }
  })

  // Wait for server to be ready
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
async function killZombieServer() {
  if (os.platform() === 'win32') return

  try {
    const { execSync } = require('child_process')
    const pids = execSync(`lsof -ti:${HALTIJA_PORT} 2>/dev/null`, { encoding: 'utf-8' }).trim()
    if (pids) {
      console.log(`[Haltija Desktop] Killing zombie process(es) on port ${HALTIJA_PORT}: ${pids.replace(/\n/g, ', ')}`)
      execSync(`lsof -ti:${HALTIJA_PORT} | xargs kill 2>/dev/null`, { encoding: 'utf-8' })
      await new Promise(r => setTimeout(r, 1000))
    }
  } catch {
    // No processes found or kill failed — proceed
  }
}

async function ensureServer() {
  const running = await checkServerRunning()

  if (running) {
    console.log('[Haltija Desktop] Using existing server at', HALTIJA_SERVER)
    return true
  }

  // Port might be held by a zombie — kill it before starting fresh
  await killZombieServer()

  return await startEmbeddedServer()
}

// App lifecycle
app.whenReady().then(async () => {
  // Start or connect to server first
  const serverReady = await ensureServer()

  if (!serverReady) {
    console.error(
      '[Haltija Desktop] Could not start server. Install bun: https://bun.sh',
    )
    // Continue anyway - user might start server manually
  }

  setupMenu()
  setupHeaderStripping()
  setupWidgetInjection()
  setupScreenCapture()
  createWindow()

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
  // Kill embedded server when app quits
  if (embeddedServer) {
    console.log('[Haltija Desktop] Stopping embedded server')
    embeddedServer.kill()
    embeddedServer = null
  }
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
