/**
 * Renderer process - handles the UI, tabs, and webviews
 */

// Settings (loaded from localStorage)
const DEFAULT_SETTINGS = {
  serverMode: 'auto', // 'auto' | 'builtin' | 'external'
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

// Tab management
let tabs = []
let activeTabId = null
let tabIdCounter = 0
let pendingNewTabUrl = null
let pendingNewTabResolve = null

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
  // Share session across all tabs so blob URLs work between tabs
  webview.setAttribute('partition', 'persist:haltija')

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

  // Fallback navigation
  setTimeout(() => {
    if (webview.getURL() === 'about:blank' || !webview.getURL()) {
      navigate(tabUrl, tabId)
    }
  }, 500)

  return tab
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

  // Update URL bar and title
  urlInput.value = tab.url || ''
  document.title = tab.title ? `${tab.title} - Haltija` : 'Haltija'

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

  if (tabId === activeTabId) {
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
    if (tab.id === activeTabId) {
      urlInput.value = e.url
      updateNavButtons()
    }
  })

  webview.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url
    if (tab.id === activeTabId) {
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

    // Inject default styles for blob/data URLs to ensure readability
    const url = webview.getURL()
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      webview.executeJavaScript(`
        if (!document.getElementById('haltija-blob-styles')) {
          const style = document.createElement('style');
          style.id = 'haltija-blob-styles';
          style.textContent = \`
            html, body {
              background: #fff;
              color: #000;
              margin: 0;
              padding: 16px;
              min-height: 100vh;
              box-sizing: border-box;
            }
            pre {
              white-space: pre-wrap;
              word-wrap: break-word;
              margin: 0;
              font-family: ui-monospace, monospace;
              font-size: 13px;
              line-height: 1.4;
            }
          \`;
          document.head.appendChild(style);
        }
      `)
    }
  })

  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || 'New Tab'
    tab.element.querySelector('.tab-title').textContent = tab.title
    if (tab.id === activeTabId) {
      document.title = tab.title ? `${tab.title} - Haltija` : 'Haltija'
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

// Address bar
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigate(urlInput.value)
  }
})

goButton.addEventListener('click', () => {
  navigate(urlInput.value)
})

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
}
