/**
 * Renderer process - handles the UI, tabs, and webviews
 */

// Settings (loaded from localStorage)
const DEFAULT_SETTINGS = {
  serverMode: 'builtin', // 'builtin' | 'external' | 'auto'
  serverUrl: 'http://localhost:8700',
  confirmNewTabs: false,
}

let settings = { ...DEFAULT_SETTINGS }

function loadSettings() {
  try {
    const saved = localStorage.getItem('haltija-settings')
    if (saved) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }
    }
  } catch (e) {
    console.error('[Haltija Desktop] Failed to load settings:', e)
  }
}

function saveSettings() {
  try {
    localStorage.setItem('haltija-settings', JSON.stringify(settings))
  } catch (e) {
    console.error('[Haltija Desktop] Failed to save settings:', e)
  }
}

loadSettings()

// Server URL (from settings)
function getServerUrl() {
  return settings.serverUrl || DEFAULT_SETTINGS.serverUrl
}

// Elements
const tabBar = document.getElementById('tabs')
const newTabButton = document.getElementById('new-tab')
const toolbar = document.getElementById('toolbar')
const urlInput = document.getElementById('url-input')
const goButton = document.getElementById('go')
const backButton = document.getElementById('back')
const forwardButton = document.getElementById('forward')
const refreshButton = document.getElementById('refresh')
const webviewContainer = document.getElementById('webview-container')
const statusDot = document.getElementById('haltija-status')
const settingsBtn = document.getElementById('settings-btn')
const settingsModal = document.getElementById('settings-modal')
const closeSettingsBtn = document.getElementById('close-settings')
const saveSettingsBtn = document.getElementById('save-settings')
const newTabDialog = document.getElementById('new-tab-dialog')
const newTabUrlEl = document.getElementById('new-tab-url')
const allowNewTabBtn = document.getElementById('allow-new-tab')
const denyNewTabBtn = document.getElementById('deny-new-tab')
const agentStatusBar = document.getElementById('agent-status-bar')
const agentStatusItems = document.getElementById('agent-status-items')
const agentSelect = document.getElementById('agent-select')

// Tab management
let tabs = []
let activeTabId = null
let tabIdCounter = 0
let pendingNewTabUrl = null
let pendingNewTabResolve = null
let lastCwd = localStorage.getItem('haltija-lastCwd') || null  // Persisted across restarts

// Default URL
function getDefaultUrl() {
  return `${getServerUrl()}/test`
}

// Create a new tab
function createTab(url, activate = true) {
  const tabId = `tab-${++tabIdCounter}`
  const tabUrl = url || getDefaultUrl()

  // Create tab element
  const tabEl = document.createElement('div')
  tabEl.className = 'tab'
  tabEl.dataset.tabId = tabId
  tabEl.innerHTML = `
    <span class="tab-title">New Tab</span>
    <button class="tab-close" title="Close tab">×</button>
  `

  // Tab click handlers
  tabEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-close')) {
      activateTab(tabId)
    }
  })

  tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation()
    closeTab(tabId)
  })

  tabBar.appendChild(tabEl)

  // Create webview
  const webview = document.createElement('webview')
  webview.id = tabId
  webview.src = 'about:blank'
  // Use preload path from main preload script (exposes window.haltija.capturePage to web content)
  if (window.haltija?.webviewPreloadPath) {
    webview.setAttribute(
      'preload',
      'file://' + window.haltija.webviewPreloadPath,
    )
  }
  webview.setAttribute(
    'webpreferences',
    'contextIsolation=yes, nodeIntegration=no, webSecurity=no, allowRunningInsecureContent=yes',
  )
  webview.setAttribute('allowpopups', '')

  webviewContainer.appendChild(webview)

  // Store tab data
  const tab = {
    id: tabId,
    url: tabUrl,
    title: 'New Tab',
    element: tabEl,
    webview: webview,
  }
  tabs.push(tab)

  // Setup webview events
  setupWebviewEvents(tab)

  // Activate and navigate
  if (activate) {
    activateTab(tabId)
  }

  // Navigate after webview is ready
  webview.addEventListener(
    'did-attach',
    () => {
      navigate(tabUrl, tabId)
    },
    { once: true },
  )

  // Fallback navigation (webview only, did-attach sometimes doesn't fire)
  const fallbackTabId = tabId
  setTimeout(() => {
    const t = tabs.find(tt => tt.id === fallbackTabId)
    if (t && !t.isTerminal && (webview.getURL() === 'about:blank' || !webview.getURL())) {
      navigate(tabUrl, fallbackTabId)
    }
  }, 500)

  return tab
}

// Create a terminal tab (iframe-based, no webview)
// mode: 'human' or 'agent'
async function createTerminalTab(mode = 'human') {
  const tabId = `tab-${++tabIdCounter}`
  const isAgent = mode === 'agent'
  const prefix = isAgent ? '<span class="agent-status">*</span>' : '>'

  // For agent tabs, check if hj CLI is installed
  if (isAgent) {
    await checkHjInstalled()
  }

  // Determine initial cwd: use active terminal's cwd, or lastCwd from localStorage
  const activeTab = getActiveTab()
  const initialCwd = (activeTab?.isTerminal && activeTab?.cwd) || lastCwd || ''
  
  // For agent tabs, use a default name; for human, show 'shell' until cwd is known
  const label = isAgent ? 'agent' : 'shell'

  // Create tab element
  const tabEl = document.createElement('div')
  tabEl.className = `tab ${isAgent ? 'agent ready' : 'terminal'}`
  tabEl.dataset.tabId = tabId
  tabEl.innerHTML = `
    <span class="tab-title">${prefix} ${label}</span>
    <button class="tab-close" title="Close tab">×</button>
  `

  tabEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-close')) {
      activateTab(tabId)
    }
  })

  tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation()
    closeTab(tabId)
  })

  tabBar.appendChild(tabEl)

  // Create iframe (not webview — terminal is local, no widget injection needed)
  const iframe = document.createElement('iframe')
  iframe.id = tabId
  const cwdParam = initialCwd ? `&cwd=${encodeURIComponent(initialCwd)}` : ''
  iframe.src = `terminal.html?port=${window.haltija?.port || 8700}&mode=${mode}${cwdParam}`
  iframe.className = 'terminal-frame'

  webviewContainer.appendChild(iframe)

  // Store tab data
  const tab = {
    id: tabId,
    url: 'terminal',
    title: label,
    element: tabEl,
    webview: iframe, // reuse field for consistency with closeTab/activateTab
    isTerminal: true,
    terminalMode: mode,  // 'human' or 'agent'
  }
  tabs.push(tab)

  activateTab(tabId)
  return tab
}

// Rename a terminal tab (updates shell name on server + tab title)
function renameTerminalTab(tab, name) {
  if (!name) return
  tab.shellName = name
  tab.title = name
  const prefix = tab.terminalMode === 'agent' ? '*' : '>'
  tab.element.querySelector('.tab-title').textContent = `${prefix} ${name}`
  document.title = name
  // Send whoami to server via the terminal iframe
  const iframe = tab.webview
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'rename', name }, '*')
  }
}

// Activate a tab
function activateTab(tabId) {
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab) return

  // Deactivate all tabs
  tabs.forEach((t) => {
    t.element.classList.remove('active')
    t.webview.classList.remove('active')
  })

  // Activate this tab
  tab.element.classList.add('active')
  tab.webview.classList.add('active')
  activeTabId = tabId

  // Update URL bar, Go button, toolbar, and title based on tab type
  toolbar.classList.remove('terminal', 'agent')
  if (tab.isTerminal || tab.url === 'terminal') {
    urlInput.value = tab.cwd || '~'
    urlInput.placeholder = 'working directory'
    goButton.textContent = 'Pick folder…'
    goButton.title = 'Pick folder…'
    toolbar.classList.add(tab.terminalMode === 'agent' ? 'agent' : 'terminal')
    
    // Show status bar for terminal tabs
    if (currentStatusLine) {
      agentStatusBar.classList.remove('hidden')
    }
    
    // If this is an agent tab, notify server it's now the active agent
    if (tab.terminalMode === 'agent' && tab.shellId) {
      fetch(`${getServerUrl()}/terminal/agent-focus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shellId: tab.shellId }),
      }).catch(() => {}) // Ignore errors
    }
  } else {
    urlInput.value = tab.url || ''
    urlInput.placeholder = 'Enter URL...'
    goButton.textContent = 'Go'
    goButton.title = 'Go'
    
    // Hide status bar for browser tabs
    agentStatusBar.classList.add('hidden')
  }
  document.title = tab.title || 'Haltija'

  // Update nav buttons
  updateNavButtons()
}

// Close a tab
function closeTab(tabId) {
  const tabIndex = tabs.findIndex((t) => t.id === tabId)
  if (tabIndex === -1) return

  const tab = tabs[tabIndex]

  // Remove elements
  tab.element.remove()
  tab.webview.remove()

  // Remove from array
  tabs.splice(tabIndex, 1)

  // If this was the active tab, activate another
  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      // Activate the tab to the left, or the first tab
      const newIndex = Math.max(0, tabIndex - 1)
      activateTab(tabs[newIndex].id)
    } else {
      // No tabs left, create a new one
      createTab()
    }
  }
}

// Get active tab
function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId)
}

// Get active webview
function getActiveWebview() {
  const tab = getActiveTab()
  return tab ? tab.webview : null
}

// Navigate to URL (with https->http fallback for any URL without explicit protocol)
function navigate(url, tabId = activeTabId) {
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab) return

  // Track if we added the protocol (vs user explicitly typed it)
  let addedHttps = false

  // Add protocol if missing (but preserve blob:, data:, file:, etc.)
  if (url && !url.match(/^(https?|blob|data|file|about|javascript):\/?\/?/i)) {
    if (
      url.includes('.') ||
      url === 'localhost' ||
      url.startsWith('localhost:')
    ) {
      // Looks like a URL - try https first, will fallback to http on failure
      addedHttps = true
      url = 'https://' + url
    } else {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
  }

  tab.url = url || getDefaultUrl()

  // If we added https://, set up fallback to http:// on connection failure
  if (addedHttps) {
    const httpUrl = tab.url.replace(/^https:/, 'http:')

    // Listen for SSL/connection errors to fall back to http
    const failHandler = (e) => {
      // Common error codes: -501 (insecure), -102 (connection refused), -118 (connection timed out), -200+ (SSL errors)
      if (e.errorCode < 0) {
        console.log(`[Haltija] HTTPS failed (${e.errorCode}), trying HTTP...`)
        tab.webview.removeEventListener('did-fail-load', failHandler)
        tab.url = httpUrl
        tab.webview.src = httpUrl
        if (tabId === activeTabId) {
          urlInput.value = httpUrl
        }
      }
    }
    tab.webview.addEventListener('did-fail-load', failHandler, { once: true })

    // Clean up handler on success
    tab.webview.addEventListener(
      'did-finish-load',
      () => {
        tab.webview.removeEventListener('did-fail-load', failHandler)
      },
      { once: true },
    )
  }

  tab.webview.src = tab.url

  if (tabId === activeTabId && !tab.isTerminal) {
    urlInput.value = tab.url
  }
}

// Update UI state
function updateNavButtons() {
  const webview = getActiveWebview()
  if (webview) {
    try {
      backButton.disabled = !webview.canGoBack()
      forwardButton.disabled = !webview.canGoForward()
    } catch (e) {
      backButton.disabled = true
      forwardButton.disabled = true
    }
  } else {
    backButton.disabled = true
    forwardButton.disabled = true
  }
}

// Check Haltija server status
async function checkHaltija() {
  try {
    const response = await fetch(`${getServerUrl()}/status`)
    if (response.ok) {
      statusDot.className = 'status-dot connected'
      statusDot.title = 'Haltija: Connected'
    } else {
      throw new Error('Not OK')
    }
  } catch {
    statusDot.className = 'status-dot disconnected'
    statusDot.title = 'Haltija: Disconnected - Start server with: bunx haltija'
  }
}

// Inject widget into webview
async function injectWidget(webview) {
  const currentUrl = webview.getURL()
  if (!currentUrl || currentUrl === 'about:blank') {
    return
  }

  const serverUrl = getServerUrl()
  const script = `
    (function() {
      if (document.getElementById('haltija-widget')) {
        return;
      }

      fetch('${serverUrl}/inject.js')
        .then(r => r.text())
        .then(code => eval(code))
        .catch(e => console.error('[Haltija] Injection failed:', e));
    })();
  `

  try {
    await webview.executeJavaScript(script)
  } catch (err) {
    console.error('[Haltija Desktop] Injection failed:', err)
  }
}

// Setup webview events
function setupWebviewEvents(tab) {
  const webview = tab.webview

  webview.addEventListener('did-start-loading', () => {
    webview.classList.add('loading')
    if (tab.id === activeTabId) {
      statusDot.className = 'status-dot connecting'
    }
  })

  webview.addEventListener('did-stop-loading', () => {
    webview.classList.remove('loading')
    if (tab.id === activeTabId) {
      updateNavButtons()
      checkHaltija()
    }
    // Widget injection is handled by main.js
  })

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url
    if (tab.id === activeTabId && !tab.isTerminal) {
      urlInput.value = e.url
      updateNavButtons()
    }
  })

  webview.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url
    if (tab.id === activeTabId && !tab.isTerminal) {
      urlInput.value = e.url
      updateNavButtons()
    }
  })

  webview.addEventListener('did-finish-load', () => {
    // Widget injection is handled by main.js
    if (window.haltija) {
      window.haltija.webviewReady(webview.getWebContentsId())
    }
  })

  webview.addEventListener('dom-ready', () => {
    // Widget injection is handled by main.js

    // Force light mode for blob/data URLs (they inherit dark mode from system/shell)
    const url = webview.getURL()
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      webview.insertCSS(':root { color-scheme: light !important; }')
    }
  })

  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || 'New Tab'
    tab.element.querySelector('.tab-title').textContent = tab.title
    if (tab.id === activeTabId) {
      document.title = tab.title || 'Haltija'
    }
  })

  // Handle new window requests
  webview.addEventListener('new-window', async (e) => {
    e.preventDefault()

    if (settings.confirmNewTabs) {
      const allowed = await showNewTabDialog(e.url)
      if (allowed) {
        createTab(e.url)
      }
    } else {
      createTab(e.url)
    }
  })

  webview.addEventListener('console-message', (e) => {
    const prefix = e.level === 2 ? '[warn]' : e.level === 3 ? '[error]' : ''
    console.log(`[Tab ${tab.id}${prefix}]`, e.message)
  })

  // Right-click context menu with Inspect Element
  webview.addEventListener('context-menu', (e) => {
    e.preventDefault()
    const { x, y } = e.params

    // Create and show context menu
    const menu = document.createElement('div')
    menu.className = 'context-menu'
    menu.style.cssText = `
      position: fixed;
      left: ${e.clientX || x}px;
      top: ${e.clientY || y}px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 0;
      min-width: 150px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
    `

    const items = [
      {
        label: 'Back',
        action: () => webview.canGoBack() && webview.goBack(),
        enabled: webview.canGoBack(),
      },
      {
        label: 'Forward',
        action: () => webview.canGoForward() && webview.goForward(),
        enabled: webview.canGoForward(),
      },
      { label: 'Reload', action: () => webview.reload() },
      { type: 'separator' },
      { label: 'Inspect Element', action: () => webview.inspectElement(x, y) },
    ]

    items.forEach((item) => {
      if (item.type === 'separator') {
        const sep = document.createElement('div')
        sep.style.cssText =
          'height: 1px; background: var(--border); margin: 4px 0;'
        menu.appendChild(sep)
      } else {
        const menuItem = document.createElement('div')
        menuItem.textContent = item.label
        menuItem.style.cssText = `
          padding: 6px 12px;
          cursor: ${item.enabled === false ? 'default' : 'pointer'};
          opacity: ${item.enabled === false ? '0.5' : '1'};
          color: var(--text);
        `
        if (item.enabled !== false) {
          menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = 'var(--hover)'
          })
          menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'transparent'
          })
          menuItem.addEventListener('click', () => {
            document.body.removeChild(menu)
            item.action()
          })
        }
        menu.appendChild(menuItem)
      }
    })

    document.body.appendChild(menu)

    // Close menu on click outside
    const closeMenu = (evt) => {
      if (!menu.contains(evt.target)) {
        if (document.body.contains(menu)) {
          document.body.removeChild(menu)
        }
        document.removeEventListener('click', closeMenu)
      }
    }
    setTimeout(() => document.addEventListener('click', closeMenu), 0)
  })

  // Intercept keyboard shortcuts inside webview
  // This ensures Cmd+R reloads the webview, not the outer shell
  // Note: before-input-event provides input info via e.input property in Electron webview
  webview.addEventListener('before-input-event', (e) => {
    const input = e.input || e // Handle both webview event structure and potential variations
    const { type, key, meta, control } = input
    if (type !== 'keyDown') return

    // Cmd/Ctrl + R = refresh this webview (prevent outer shell refresh)
    if ((meta || control) && key === 'r') {
      e.preventDefault()
      e.stopPropagation()
      webview.reload()
      return
    }

    // Cmd/Ctrl + L = focus address bar
    if ((meta || control) && key === 'l') {
      e.preventDefault()
      e.stopPropagation()
      urlInput.focus()
      urlInput.select()
      return
    }

    // Cmd/Ctrl + T = new tab
    if ((meta || control) && key === 't') {
      e.preventDefault()
      e.stopPropagation()
      createTab()
      return
    }

    // Cmd/Ctrl + W = close this tab
    if ((meta || control) && key === 'w') {
      e.preventDefault()
      e.stopPropagation()
      closeTab(tab.id)
      return
    }

    // Cmd/Ctrl + [ = back
    if ((meta || control) && key === '[') {
      e.preventDefault()
      e.stopPropagation()
      if (webview.canGoBack()) webview.goBack()
      return
    }

    // Cmd/Ctrl + ] = forward
    if ((meta || control) && key === ']') {
      e.preventDefault()
      e.stopPropagation()
      if (webview.canGoForward()) webview.goForward()
      return
    }
  })
}

// Show new tab confirmation dialog
function showNewTabDialog(url) {
  return new Promise((resolve) => {
    pendingNewTabUrl = url
    pendingNewTabResolve = resolve
    newTabUrlEl.textContent = url
    newTabDialog.classList.remove('hidden')
  })
}

function hideNewTabDialog(allowed) {
  newTabDialog.classList.add('hidden')
  if (pendingNewTabResolve) {
    pendingNewTabResolve(allowed)
    pendingNewTabResolve = null
    pendingNewTabUrl = null
  }
}

// Settings modal
function showSettings() {
  // Populate form
  document.querySelector(
    `input[name="server-mode"][value="${settings.serverMode}"]`,
  ).checked = true
  document.getElementById('server-url').value = settings.serverUrl
  document.getElementById('confirm-new-tabs').checked = settings.confirmNewTabs

  settingsModal.classList.remove('hidden')
}

function hideSettings() {
  settingsModal.classList.add('hidden')
}

function applySettings() {
  settings.serverMode = document.querySelector(
    'input[name="server-mode"]:checked',
  ).value
  settings.serverUrl =
    document.getElementById('server-url').value || DEFAULT_SETTINGS.serverUrl
  settings.confirmNewTabs = document.getElementById('confirm-new-tabs').checked

  saveSettings()
  hideSettings()
  checkHaltija()
}

// Event listeners

// New tab button
newTabButton.addEventListener('click', () => createTab())
const newTerminalBtn = document.getElementById('new-terminal')
newTerminalBtn.addEventListener('click', () => createTerminalTab('human'))
const newAgentBtn = document.getElementById('new-agent')
newAgentBtn.addEventListener('click', () => createTerminalTab('agent'))

// Address bar
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const tab = tabs.find(t => t.id === activeTabId)
    if (tab && tab.isTerminal) {
      // cd to the entered path
      changeTerminalDirectory(tab, urlInput.value.trim())
      urlInput.blur()
    } else {
      navigate(urlInput.value)
    }
  }
})

goButton.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId)
  if (tab && tab.isTerminal) {
    // Open folder picker for terminal tabs
    openFolderPicker(tab)
  } else {
    navigate(urlInput.value)
  }
})

// Change terminal working directory via cd command
async function changeTerminalDirectory(tab, path) {
  if (!path) return
  try {
    const resp = await fetch(`${getServerUrl()}/terminal/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: `cd ${path}`, shellId: tab.shellId }),
    })
    const result = await resp.text()
    // If successful, the cwd-changed message will update the URL bar
    if (result.startsWith('cd:')) {
      // Error - show notification
      showNotification(result, 3000)
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 3000)
  }
}

// Open native folder picker and cd to selected folder
async function openFolderPicker(tab) {
  if (window.haltija?.showOpenDialog) {
    const result = await window.haltija.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: tab.cwd || undefined,
    })
    if (result && !result.canceled && result.filePaths?.[0]) {
      const picked = result.filePaths[0]
      lastCwd = picked
      localStorage.setItem('haltija-lastCwd', picked)
      changeTerminalDirectory(tab, picked)
    }
  } else {
    showNotification('Folder picker not available', 2000)
  }
}

// Navigation buttons
backButton.addEventListener('click', () => {
  const webview = getActiveWebview()
  if (webview) webview.goBack()
})

forwardButton.addEventListener('click', () => {
  const webview = getActiveWebview()
  if (webview) webview.goForward()
})

refreshButton.addEventListener('click', () => {
  const webview = getActiveWebview()
  if (webview) webview.reload()
})

// Settings
settingsBtn.addEventListener('click', showSettings)
closeSettingsBtn.addEventListener('click', hideSettings)
saveSettingsBtn.addEventListener('click', applySettings)

// Click outside modal to close
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) hideSettings()
})

// New tab dialog
allowNewTabBtn.addEventListener('click', () => hideNewTabDialog(true))
denyNewTabBtn.addEventListener('click', () => hideNewTabDialog(false))

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + L = focus address bar
  if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
    e.preventDefault()
    urlInput.focus()
    urlInput.select()
  }

  // Cmd/Ctrl + R = refresh
  if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
    e.preventDefault()
    const webview = getActiveWebview()
    if (webview) webview.reload()
  }

  // Cmd/Ctrl + T = new tab
  if ((e.metaKey || e.ctrlKey) && e.key === 't') {
    e.preventDefault()
    createTab()
  }

  // Cmd/Ctrl + W = close tab
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
    e.preventDefault()
    if (activeTabId) closeTab(activeTabId)
  }

  // Cmd/Ctrl + [ = back
  if ((e.metaKey || e.ctrlKey) && e.key === '[') {
    e.preventDefault()
    const webview = getActiveWebview()
    if (webview && webview.canGoBack()) webview.goBack()
  }

  // Cmd/Ctrl + ] = forward
  if ((e.metaKey || e.ctrlKey) && e.key === ']') {
    e.preventDefault()
    const webview = getActiveWebview()
    if (webview && webview.canGoForward()) webview.goForward()
  }

  // Cmd/Ctrl + 1-9 = switch to tab
  if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
    e.preventDefault()
    const index = parseInt(e.key) - 1
    if (tabs[index]) {
      activateTab(tabs[index].id)
    }
  }

  // Escape = close modals
  if (e.key === 'Escape') {
    hideSettings()
    hideNewTabDialog(false)
  }
})

// Initialize
console.log('[Haltija Desktop] Initializing with tabs...')
checkHaltija()

// Create initial tab
createTab()

// Periodic status check
setInterval(checkHaltija, 5000)

// Expose API for widget to manage tabs
window.haltija = window.haltija || {}

window.haltija.openTab = async (url) => {
  if (settings.confirmNewTabs) {
    const allowed = await showNewTabDialog(url)
    if (allowed) {
      createTab(url)
      return true
    }
    return false
  } else {
    createTab(url)
    return true
  }
}

window.haltija.closeTab = (windowId) => {
  // Find tab by windowId (stored in webview's window tracking)
  // For now, we close the active tab if no specific ID
  // TODO: implement proper windowId to tab mapping
  if (activeTabId) {
    closeTab(activeTabId)
    return true
  }
  return false
}

window.haltija.openAgentTab = async () => {
  // Create a new agent tab and return its info once initialized
  const tab = await createTerminalTab('agent')
  // Wait for the agent to initialize and get its shellId
  return new Promise((resolve) => {
    const checkShellId = setInterval(() => {
      if (tab.shellId) {
        clearInterval(checkShellId)
        resolve({ shellId: tab.shellId, name: tab.label || 'agent' })
      }
    }, 100)
    // Timeout after 5 seconds
    setTimeout(() => {
      clearInterval(checkShellId)
      resolve({ shellId: tab.shellId || null, name: tab.label || 'agent' })
    }, 5000)
  })
}

window.haltija.focusTab = (windowId) => {
  // Find tab by windowId and activate it
  // TODO: implement proper windowId to tab mapping
  // For now, this is a no-op since we'd need to map window IDs to tab IDs
  return false
}

// Listen for open-url-in-tab from main process
// This handles window.open() calls that should become tabs instead of windows
if (window.haltija && window.haltija.onOpenUrlInTab) {
  window.haltija.onOpenUrlInTab((url) => {
    console.log('[Haltija Desktop] Opening URL in new tab:', url)
    createTab(url)
  })
}

// Simple toast notification
function showNotification(message, duration = 2000) {
  // Remove existing notification if any
  const existing = document.getElementById('toast-notification')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.id = 'toast-notification'
  toast.textContent = message
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent, #6366f1);
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: toast-in 0.2s ease-out;
  `

  // Add animation style if not present
  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style')
    style.id = 'toast-styles'
    style.textContent = `
      @keyframes toast-in { from { opacity: 0; transform: translateX(-50%) translateY(10px); } }
      @keyframes toast-out { to { opacity: 0; transform: translateX(-50%) translateY(10px); } }
    `
    document.head.appendChild(style)
  }

  document.body.appendChild(toast)

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.2s ease-in forwards'
    setTimeout(() => toast.remove(), 200)
  }, duration)
}

// Listen for menu commands from main process
// These handle Cmd+R, Cmd+T, etc. from the application menu
if (window.haltija) {
  // Notifications
  window.haltija.onShowNotification?.(showNotification)

  window.haltija.onMenuNewTab?.(() => {
    createTab()
  })

  window.haltija.onMenuNewTerminalTab?.(() => {
    createTerminalTab()
  })

  window.haltija.onMenuCloseTab?.(() => {
    if (activeTabId) closeTab(activeTabId)
  })

  window.haltija.onMenuCloseOtherTabs?.(() => {
    if (activeTabId && tabs.length > 1) {
      // Get IDs of tabs to close (all except active)
      const tabsToClose = tabs
        .filter((t) => t.id !== activeTabId)
        .map((t) => t.id)
      tabsToClose.forEach((tabId) => closeTab(tabId))
    }
  })

  window.haltija.onMenuReloadTab?.(() => {
    const webview = getActiveWebview()
    if (webview) webview.reload()
  })

  window.haltija.onMenuForceReloadTab?.(() => {
    const webview = getActiveWebview()
    if (webview) webview.reloadIgnoringCache()
  })

  window.haltija.onMenuDevToolsTab?.(() => {
    const webview = getActiveWebview()
    if (webview) webview.openDevTools()
  })

  window.haltija.onMenuBack?.(() => {
    const webview = getActiveWebview()
    if (webview && webview.canGoBack()) webview.goBack()
  })

  window.haltija.onMenuForward?.(() => {
    const webview = getActiveWebview()
    if (webview && webview.canGoForward()) webview.goForward()
  })

  window.haltija.onMenuFocusUrl?.(() => {
    urlInput.focus()
    urlInput.select()
  })

  // Handle agent tab creation requests from widget (via main process)
  window.haltija.onCreateAgentTab?.(async (data) => {
    console.log('[Haltija Desktop] Creating agent tab for widget, requestId:', data.requestId)
    try {
      const tab = await createTerminalTab('agent')
      
      // Wait for shellId to be set (terminal sends message when ready)
      const result = await new Promise((resolve) => {
        const checkReady = setInterval(() => {
          if (tab.shellId) {
            clearInterval(checkReady)
            resolve({ 
              requestId: data.requestId,
              shellId: tab.shellId, 
              name: tab.label || 'agent' 
            })
          }
        }, 100)
        
        // Timeout after 8 seconds
        setTimeout(() => {
          clearInterval(checkReady)
          resolve({ 
            requestId: data.requestId,
            shellId: tab.shellId || null, 
            name: tab.label || 'agent',
            error: tab.shellId ? null : 'Timeout waiting for agent init'
          })
        }, 8000)
      })
      
      window.haltija.agentTabCreated(result)
    } catch (err) {
      window.haltija.agentTabCreated({ 
        requestId: data.requestId, 
        error: err.message 
      })
    }
  })
  
  // Handle navigation requests from widget (via main process)
  // Uses the smart navigate() function with https->http fallback
  window.haltija.onNavigateUrl?.((data) => {
    console.log('[Haltija Desktop] Navigate request from widget:', data.url)
    navigate(data.url)
  })
}

// Listen for messages from terminal iframes (cwd changes)
window.addEventListener('message', (event) => {
  if (event.data?.type === 'terminal-cwd') {
    const { cwd, shellId } = event.data
    // Find the terminal tab that sent this message
    const tab = tabs.find(t => t.isTerminal && t.webview?.contentWindow === event.source)
    if (tab) {
      tab.cwd = cwd
      tab.shellId = shellId  // Track shellId for sending commands

      
      // Only update tab title for human terminals (show directory name)
      // Agent tabs keep their agent name
      if (tab.terminalMode !== 'agent') {
        const dirName = cwd.replace(/\/$/, '').split('/').pop() || cwd
        tab.title = dirName
        tab.element.querySelector('.tab-title').innerHTML = `> ${dirName}`
      }
      
      // Update URL bar if this tab is active
      if (tab.id === activeTabId) {
        urlInput.value = cwd
        const displayTitle = tab.terminalMode === 'agent' ? tab.title : cwd.replace(/\/$/, '').split('/').pop()
        document.title = displayTitle
      }
    }
  }
  // Shell renamed (update agent tab title)
  if (event.data?.type === 'shell-renamed') {
    const { shellId, name } = event.data
    // Match by shellId or by event source (in case shellId not yet set on tab)
    const tab = tabs.find(t => t.isTerminal && (t.shellId === shellId || t.webview?.contentWindow === event.source))
    if (tab && tab.terminalMode === 'agent' && name) {
      tab.shellId = shellId  // Ensure shellId is set
      tab.title = name
      tab.element.querySelector('.tab-title').innerHTML = `<span class="agent-status">*</span> ${name}`
      if (tab.id === activeTabId) {
        document.title = name
      }
    }
  }
  
  // Agent status updates
  if (event.data?.type === 'agent-status') {
    const { status } = event.data
    const tab = tabs.find(t => t.isTerminal && t.terminalMode === 'agent' && t.webview?.contentWindow === event.source)
    if (tab) {
      tab.element.classList.remove('thinking', 'ready', 'error')
      if (status === 'thinking') {
        tab.element.classList.add('thinking')
      } else if (status === 'error') {
        tab.element.classList.add('error')
      } else {
        tab.element.classList.add('ready')
      }
    }
  }
})

// ==========================================
// Session Restore
// ==========================================

/**
 * Check for saved agent transcripts and offer to restore them.
 * DISABLED - restore feature is broken, causing HTML dumps
 */
async function checkForSavedSessions() {
  // Restore disabled until we fix the underlying issues
  return
}

/**
 * Format a timestamp as relative time (e.g., "5 minutes ago")
 */
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
  return `${Math.floor(seconds / 86400)} days ago`
}

/**
 * Show a restore prompt for a saved session
 */
function showRestorePrompt(transcript, timeAgo) {
  const prompt = document.createElement('div')
  prompt.className = 'restore-prompt'
  prompt.innerHTML = `
    <div class="restore-content">
      <span class="restore-icon">*</span>
      <span class="restore-text">Restore "${transcript.name}" session? (${transcript.entryCount} messages, ${timeAgo})</span>
      <button class="restore-yes" title="Restore session">Restore</button>
      <button class="restore-no" title="Dismiss">×</button>
    </div>
  `
  
  prompt.querySelector('.restore-yes').addEventListener('click', async () => {
    prompt.remove()
    await restoreSession(transcript.filename)
  })
  
  prompt.querySelector('.restore-no').addEventListener('click', () => {
    prompt.remove()
  })
  
  // Auto-dismiss after 15 seconds
  setTimeout(() => {
    if (prompt.parentNode) {
      prompt.style.animation = 'toast-out 0.2s ease-in forwards'
      setTimeout(() => prompt.remove(), 200)
    }
  }, 15000)
  
  document.body.appendChild(prompt)
}

/**
 * Restore a session from a saved transcript file.
 * Creates a fresh agent tab with the same name; condensed context
 * from the old session is prepended to the first prompt.
 */
async function restoreSession(filename) {
  try {
    // Create an agent tab first
    const tab = await createTerminalTab('agent')
    
    // Wait for the terminal iframe to initialize and get its shellId
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Get the shellId from the tab (set via message from terminal.html)
    if (!tab.shellId) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting for shellId')), 5000)
        const checkShellId = setInterval(() => {
          if (tab.shellId) {
            clearInterval(checkShellId)
            clearTimeout(timeout)
            resolve()
          }
        }, 100)
      })
    }
    
    // Restore the session on the server (creates fresh session with condensed context)
    const response = await fetch(`${getServerUrl()}/terminal/transcript/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, shellId: tab.shellId })
    })
    
    if (!response.ok) {
      throw new Error('Failed to restore session')
    }
    
    const result = await response.json()
    
    // Update tab with restored session name
    tab.title = result.name
    tab.element.querySelector('.tab-title').innerHTML = `<span class="agent-status">*</span> ${result.name}`
    
    showNotification(`Restored "${result.name}" — context will be included with your first message`)
  } catch (err) {
    console.error('[Haltija Desktop] Failed to restore session:', err)
    showNotification('Failed to restore session', 3000)
  }
}

// Check for saved sessions after a brief delay (let server start)
setTimeout(checkForSavedSessions, 2000)

// ==========================================
// hj CLI Installation Check
// ==========================================

let hjCheckDone = false

/**
 * Check if hj CLI is globally installed. If not, prompt user to install.
 * Only prompts once per session.
 */
async function checkHjInstalled() {
  if (hjCheckDone) return
  hjCheckDone = true
  
  try {
    const response = await fetch(`${getServerUrl()}/terminal/hj-status`)
    if (!response.ok) return
    
    const { installed, installCommand, message } = await response.json()
    if (installed) return
    
    // Show install prompt
    showHjInstallPrompt(installCommand, message)
  } catch (err) {
    console.log('[Haltija Desktop] Could not check hj status:', err.message)
  }
}

/**
 * Show a prompt to install the hj CLI
 */
function showHjInstallPrompt(installCommand, message) {
  const prompt = document.createElement('div')
  prompt.className = 'hj-install-prompt'
  prompt.innerHTML = `
    <div class="hj-install-content">
      <div class="hj-install-header">
        <span class="hj-install-icon">⚠️</span>
        <span class="hj-install-title">hj CLI not installed</span>
      </div>
      <p class="hj-install-message">${message}</p>
      <div class="hj-install-command">
        <code>${installCommand}</code>
        <button class="hj-copy-btn" title="Copy command">Copy</button>
      </div>
      <div class="hj-install-actions">
        <button class="hj-install-later">Later</button>
      </div>
    </div>
  `
  
  prompt.querySelector('.hj-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(installCommand)
    showNotification('Command copied! Paste in Terminal and enter your password.', 5000)
  })
  
  prompt.querySelector('.hj-install-later').addEventListener('click', () => {
    prompt.remove()
  })
  
  document.body.appendChild(prompt)
}

// ============================================
// Agent Status Bar - Shows what agents see
// ============================================

let agentStatusWs = null
let currentStatusLine = ''
let connectedShells = new Map() // shellId -> { name, isAgent }

/**
 * Connect to the terminal WebSocket to receive status updates
 */
function connectAgentStatusWs() {
  if (agentStatusWs && agentStatusWs.readyState === WebSocket.OPEN) return
  
  const wsUrl = `ws://localhost:${window.haltija?.port || 8700}/ws/terminal`
  agentStatusWs = new WebSocket(wsUrl)
  
  agentStatusWs.onopen = () => {
    console.log('[Agent Status] Connected to terminal WebSocket')
  }
  
  agentStatusWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      handleAgentStatusMessage(msg)
    } catch (err) {
      // Ignore non-JSON messages
    }
  }
  
  agentStatusWs.onclose = () => {
    console.log('[Agent Status] WebSocket closed, reconnecting in 3s...')
    setTimeout(connectAgentStatusWs, 3000)
  }
  
  agentStatusWs.onerror = (err) => {
    console.log('[Agent Status] WebSocket error:', err)
  }
}

/**
 * Handle messages from the terminal WebSocket
 */
function handleAgentStatusMessage(msg) {
  switch (msg.type) {
    case 'status':
      currentStatusLine = msg.line || ''
      renderAgentStatusBar(currentStatusLine)
      break
    
    case 'shell-joined':
      connectedShells.set(msg.shellId, { name: msg.name, isAgent: msg.name?.includes('agent') })
      updateAgentSelector()
      break
    
    case 'shell-left':
      connectedShells.delete(msg.shellId)
      updateAgentSelector()
      break
    
    case 'shell-renamed':
      if (connectedShells.has(msg.shellId)) {
        connectedShells.get(msg.shellId).name = msg.name
        updateAgentSelector()
      }
      break
  }
}

/**
 * Parse and render the status line in the GUI
 * Format: "hj > localhost:8700 'title' | todos 2 active | messages none"
 */
function renderAgentStatusBar(line) {
  if (!line) {
    agentStatusBar.classList.add('hidden')
    return
  }
  
  agentStatusBar.classList.remove('hidden')
  
  // Split by | and render each segment
  const segments = line.split(' | ')
  let html = ''
  
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    
    // Parse "key value" or "key > value" patterns
    let label = ''
    let value = trimmed
    
    // Handle "hj > localhost:8700 'title'" format
    const arrowMatch = trimmed.match(/^(\w+)\s*>\s*(.+)$/)
    if (arrowMatch) {
      label = arrowMatch[1]
      value = arrowMatch[2]
    } else {
      // Handle "todos 2 active" format - first word is label
      const spaceIdx = trimmed.indexOf(' ')
      if (spaceIdx > 0) {
        label = trimmed.substring(0, spaceIdx)
        value = trimmed.substring(spaceIdx + 1)
      }
    }
    
    // Determine color class based on content
    let cls = 'status-segment'
    if (/fail|error|no browser/i.test(trimmed)) cls += ' error'
    else if (/warn|blocked|pending/i.test(trimmed)) cls += ' alert'
    else if (/ready|connected|pass|active/i.test(trimmed)) cls += ' ok'
    
    html += `<div class="${cls}" data-segment="${escapeHtml(label || 'status')}">`
    if (label) {
      html += `<span class="label">${escapeHtml(label)}:</span>`
    }
    html += `<span class="value">${escapeHtml(value)}</span>`
    html += `</div>`
  }
  
  agentStatusItems.innerHTML = html
  
  // Add click handlers to segments
  agentStatusItems.querySelectorAll('.status-segment').forEach(seg => {
    seg.addEventListener('click', (e) => {
      const segmentName = seg.dataset.segment
      handleStatusSegmentClick(segmentName, e.target)
    })
  })
}

/**
 * Handle clicks on status bar segments
 */
function handleStatusSegmentClick(segmentName, target) {
  switch (segmentName) {
    case 'todos':
      showTodosPanel(target)
      break
    case 'hj':
      // Could show connection details or browser info
      break
    case 'messages':
      // Could show message queue
      break
    default:
      console.log('[Agent Status] Clicked segment:', segmentName)
  }
}

/**
 * Show the todos panel as a floating window
 */
async function showTodosPanel(target) {
  // Create content for the panel
  const content = document.createElement('div')
  content.className = 'todos-panel-content'
  content.innerHTML = '<div class="loading">Loading tasks...</div>'
  
  const panel = createFloatPanel({
    target,
    content,
    title: 'Tasks',
    position: 's'
  })
  
  if (!panel) return // Panel was toggled off
  
  // Load tasks
  try {
    const resp = await fetch(`${getServerUrl()}/terminal/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'tasks', command: 'board' })
    })
    const result = await resp.json()
    
    if (result.boardJson?.items) {
      renderTodosPanel(content, result.boardJson.items)
    } else {
      content.innerHTML = '<div class="empty">No tasks</div>'
    }
  } catch (err) {
    content.innerHTML = `<div class="error">Failed to load tasks: ${escapeHtml(err.message)}</div>`
  }
}

/**
 * Render tasks in a simple list view (for now)
 */
function renderTodosPanel(container, items) {
  const columns = ['in_progress', 'blocked', 'queued', 'review']
  const columnNames = {
    in_progress: '🔄 In Progress',
    blocked: '🚧 Blocked', 
    queued: '📋 Queued',
    review: '👀 Review'
  }
  
  let html = '<div class="todos-list">'
  
  for (const col of columns) {
    const colItems = items.filter(i => i.column === col)
    if (colItems.length === 0) continue
    
    html += `<div class="todos-column">
      <div class="todos-column-header">${columnNames[col]} (${colItems.length})</div>`
    
    for (const item of colItems) {
      html += `<div class="todo-item" data-id="${item.id}">
        <span class="todo-title">${escapeHtml(item.title)}</span>
      </div>`
    }
    
    html += '</div>'
  }
  
  if (html === '<div class="todos-list">') {
    html += '<div class="empty">No active tasks</div>'
  }
  
  html += '</div>'
  container.innerHTML = html
}

/**
 * Update the agent selector dropdown
 */
function updateAgentSelector() {
  const agents = Array.from(connectedShells.entries())
    .filter(([_, info]) => info.isAgent)
  
  if (agents.length === 0) {
    agentSelect.innerHTML = '<option value="">No agents</option>'
  } else {
    agentSelect.innerHTML = agents.map(([id, info]) => 
      `<option value="${id}">${escapeHtml(info.name || id)}</option>`
    ).join('')
  }
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Fetch initial status and connect WebSocket
async function initAgentStatusBar() {
  try {
    const response = await fetch(`${getServerUrl()}/terminal/status`)
    if (response.ok) {
      const line = await response.text()
      renderAgentStatusBar(line)
    }
  } catch (err) {
    console.log('[Agent Status] Could not fetch initial status:', err.message)
  }
  
  connectAgentStatusWs()
}

// Initialize agent status bar after a short delay (let server start)
setTimeout(initAgentStatusBar, 1000)

// ============================================
// Float Panel - Draggable floating UI panels
// (Borrowed from tosijs-ui xin-float/trackDrag)
// ============================================

/**
 * Track a drag operation from mousedown/touchstart
 */
function trackDrag(event, callback, cursor = 'move') {
  const isTouchEvent = event.type.startsWith('touch')

  if (!isTouchEvent) {
    const origX = event.clientX
    const origY = event.clientY

    // Create overlay to capture all mouse events during drag
    const tracker = document.createElement('div')
    tracker.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:' + cursor
    document.body.appendChild(tracker)

    const onMove = (e) => {
      const dx = e.clientX - origX
      const dy = e.clientY - origY
      if (callback(dx, dy, e) === true) {
        tracker.removeEventListener('mousemove', onMove)
        tracker.removeEventListener('mouseup', onMove)
        tracker.remove()
      }
    }

    tracker.addEventListener('mousemove', onMove, { passive: true })
    tracker.addEventListener('mouseup', onMove, { passive: true })
  } else if (event.touches) {
    const touch = event.touches[0]
    const touchId = touch.identifier
    const origX = touch.clientX
    const origY = touch.clientY
    const target = event.target

    const onTouch = (e) => {
      const t = [...e.touches].find(t => t.identifier === touchId)
      const dx = t ? t.clientX - origX : 0
      const dy = t ? t.clientY - origY : 0
      if (callback(dx, dy, e) === true || !t) {
        target.removeEventListener('touchmove', onTouch)
        target.removeEventListener('touchend', onTouch)
        target.removeEventListener('touchcancel', onTouch)
      }
    }

    target.addEventListener('touchmove', onTouch)
    target.addEventListener('touchend', onTouch, { passive: true })
    target.addEventListener('touchcancel', onTouch, { passive: true })
  }
}

/**
 * Find highest z-index in document
 */
function findHighestZ() {
  return [...document.querySelectorAll('body *')]
    .map(el => parseFloat(getComputedStyle(el).zIndex))
    .filter(z => !isNaN(z))
    .reduce((max, z) => Math.max(max, z), 0)
}

/**
 * Create a floating panel positioned near a target element
 */
function createFloatPanel({ target, content, title = '', position = 's', onClose }) {
  // Remove existing panel with same title
  const existing = document.querySelector(`.float-panel[data-title="${title}"]`)
  if (existing) {
    existing.remove()
    return null
  }

  const panel = document.createElement('div')
  panel.className = 'float-panel'
  panel.dataset.title = title
  panel.style.zIndex = findHighestZ() + 1

  panel.innerHTML = `
    <div class="float-header">
      <span class="float-title">${escapeHtml(title)}</span>
      <button class="float-close" title="Close">×</button>
    </div>
    <div class="float-content"></div>
  `

  panel.querySelector('.float-content').appendChild(content)

  // Make header draggable
  const header = panel.querySelector('.float-header')
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.float-close')) return
    panel.style.zIndex = findHighestZ() + 1
    const x = panel.offsetLeft
    const y = panel.offsetTop
    trackDrag(e, (dx, dy, evt) => {
      panel.style.left = `${x + dx}px`
      panel.style.top = `${y + dy}px`
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      return evt.type === 'mouseup'
    })
  })

  // Close button
  panel.querySelector('.float-close').addEventListener('click', () => {
    panel.remove()
    onClose?.()
  })

  document.body.appendChild(panel)

  // Position near target
  if (target) {
    const rect = target.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    
    let left, top
    switch (position) {
      case 'n': // above
        left = rect.left + rect.width / 2 - panelRect.width / 2
        top = rect.top - panelRect.height - 8
        break
      case 's': // below (default)
      default:
        left = rect.left + rect.width / 2 - panelRect.width / 2
        top = rect.bottom + 8
        break
    }
    
    // Keep on screen
    left = Math.max(8, Math.min(left, window.innerWidth - panelRect.width - 8))
    top = Math.max(8, Math.min(top, window.innerHeight - panelRect.height - 8))
    
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
  }

  return panel
}
