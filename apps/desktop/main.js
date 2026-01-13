/**
 * Haltija Desktop - God Mode Browser
 * 
 * An Electron shell that:
 * 1. Strips CSP and X-Frame-Options headers (works on any site)
 * 2. Auto-injects the Haltija widget on every page
 * 3. Provides screen capture for AI agents
 * 4. Runs its own embedded Haltija server (or connects to existing)
 */

const { app, BrowserWindow, session, ipcMain, desktopCapturer } = require('electron')
const path = require('path')
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
 * Strip security headers that prevent our widget from working
 */
function setupHeaderStripping() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
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

/**
 * Inject the Haltija widget into every page
 */
function setupWidgetInjection() {
  const { webContents } = require('electron')
  
  // Monitor all webContents for page loads
  webContents.getAllWebContents().forEach(wc => setupWebContentsInjection(wc))
  
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
  
  // Skip about:blank and file:// URLs (Electron shell itself)
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
      http.get(`${HALTIJA_SERVER}/component.js?_=${cacheBuster}`, (res) => {
        // Set encoding to UTF-8 to properly handle Unicode characters
        res.setEncoding('utf8')
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve(data))
      }).on('error', reject)
    })
    
    console.log('[Haltija Desktop] Got component.js, length:', componentCode.length)
    
    // Set config for auto-inject, then execute component code
    // component.ts will handle deduplication, ID generation, and element creation
    const wsUrl = HALTIJA_SERVER.replace('http:', 'ws:') + '/ws/browser'
    await webContents.executeJavaScript(`window.__haltija_config__ = { serverUrl: '${wsUrl}' };`)
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
      // Get all webContents and find the webview
      const allContents = require('electron').webContents.getAllWebContents()
      const webview = allContents.find(wc => wc.getType() === 'webview')
      
      if (webview) {
        const image = await webview.capturePage()
        return {
          success: true,
          data: image.toDataURL(),
          size: { width: image.getSize().width, height: image.getSize().height }
        }
      }
      
      // Fallback to main window
      const image = await mainWindow.webContents.capturePage()
      return {
        success: true,
        data: image.toDataURL(),
        size: { width: image.getSize().width, height: image.getSize().height }
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
      const allContents = require('electron').webContents.getAllWebContents()
      const webview = allContents.find(wc => wc.getType() === 'webview')
      
      if (!webview) {
        return { success: false, error: 'No webview found' }
      }
      
      // Get element bounds
      const bounds = await webview.executeJavaScript(`
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
      const image = await webview.capturePage(bounds)
      return {
        success: true,
        data: image.toDataURL(),
        selector,
        bounds
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
  const fs = require('fs')
  const os = require('os')
  
  // Determine architecture
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64'
  const platform = os.platform()
  
  // Find the server binary - look in common locations
  const binaryName = platform === 'win32' 
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
  console.log('[Haltija Desktop] Server path:', serverPath || 'fallback to bunx')
  
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
      env: { ...process.env, PORT: HALTIJA_PORT.toString() }
    })
  } else if (serverPath) {
    // Run with bun (development)
    embeddedServer = spawn('bun', ['run', serverPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: HALTIJA_PORT.toString() }
    })
  } else {
    // Fallback to bunx haltija
    embeddedServer = spawn('bunx', ['haltija', '--port', HALTIJA_PORT.toString()], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
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
    await new Promise(r => setTimeout(r, 200))
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
async function ensureServer() {
  const running = await checkServerRunning()
  
  if (running) {
    console.log('[Haltija Desktop] Using existing server at', HALTIJA_SERVER)
    return true
  }
  
  return await startEmbeddedServer()
}

// App lifecycle
app.whenReady().then(async () => {
  // Start or connect to server first
  const serverReady = await ensureServer()
  
  if (!serverReady) {
    console.error('[Haltija Desktop] Could not start server. Install bun: https://bun.sh')
    // Continue anyway - user might start server manually
  }
  
  setupHeaderStripping()
  setupWidgetInjection()
  setupScreenCapture()
  createWindow()

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
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.startsWith('https://localhost')) {
    event.preventDefault()
    callback(true)
  } else {
    callback(false)
  }
})
