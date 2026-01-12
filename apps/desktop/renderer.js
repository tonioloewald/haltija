/**
 * Renderer process - handles the UI, tabs, and webviews
 */

// Settings (loaded from localStorage)
const DEFAULT_SETTINGS = {
  serverMode: 'auto', // 'auto' | 'builtin' | 'external'
  serverUrl: 'http://localhost:8700',
  confirmNewTabs: false
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
  webview.setAttribute('webpreferences', 'contextIsolation=no, nodeIntegration=no, webSecurity=no, allowRunningInsecureContent=yes')
  webview.setAttribute('allowpopups', '')
  
  webviewContainer.appendChild(webview)
  
  // Store tab data
  const tab = {
    id: tabId,
    url: tabUrl,
    title: 'New Tab',
    element: tabEl,
    webview: webview
  }
  tabs.push(tab)
  
  // Setup webview events
  setupWebviewEvents(tab)
  
  // Activate and navigate
  if (activate) {
    activateTab(tabId)
  }
  
  // Navigate after webview is ready
  webview.addEventListener('did-attach', () => {
    navigate(tabUrl, tabId)
  }, { once: true })
  
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
  const tab = tabs.find(t => t.id === tabId)
  if (!tab) return
  
  // Deactivate all tabs
  tabs.forEach(t => {
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
  const tabIndex = tabs.findIndex(t => t.id === tabId)
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
  return tabs.find(t => t.id === activeTabId)
}

// Get active webview
function getActiveWebview() {
  const tab = getActiveTab()
  return tab ? tab.webview : null
}

// Navigate to URL
function navigate(url, tabId = activeTabId) {
  const tab = tabs.find(t => t.id === tabId)
  if (!tab) return
  
  // Add protocol if missing
  if (url && !url.match(/^https?:\/\//)) {
    if (url.includes('.') || url === 'localhost' || url.startsWith('localhost:')) {
      url = 'https://' + url
    } else {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
  }
  
  tab.url = url || getDefaultUrl()
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
      if (document.querySelector('haltija-dev')) {
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
    injectWidget(webview)
  })
  
  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url
    if (tab.id === activeTabId) {
      urlInput.value = e.url
      updateNavButtons()
    }
    setTimeout(() => injectWidget(webview), 500)
  })
  
  webview.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url
    if (tab.id === activeTabId) {
      urlInput.value = e.url
      updateNavButtons()
    }
  })
  
  webview.addEventListener('did-finish-load', () => {
    injectWidget(webview)
    if (window.haltija) {
      window.haltija.webviewReady(webview.getWebContentsId())
    }
  })
  
  webview.addEventListener('dom-ready', () => {
    injectWidget(webview)
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
  document.querySelector(`input[name="server-mode"][value="${settings.serverMode}"]`).checked = true
  document.getElementById('server-url').value = settings.serverUrl
  document.getElementById('confirm-new-tabs').checked = settings.confirmNewTabs
  
  settingsModal.classList.remove('hidden')
}

function hideSettings() {
  settingsModal.classList.add('hidden')
}

function applySettings() {
  settings.serverMode = document.querySelector('input[name="server-mode"]:checked').value
  settings.serverUrl = document.getElementById('server-url').value || DEFAULT_SETTINGS.serverUrl
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

// Expose API for widget to open new tabs
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
