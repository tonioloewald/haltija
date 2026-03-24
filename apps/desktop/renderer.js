/**
 * Renderer process — entry point.
 * Imports modules and wires up event listeners.
 */

import { loadSettings, initElements, tabs, activeTabId, el, getServerUrl, setLastCwd } from './renderer/state.js'
import { showNotification } from './renderer/ui-utils.js'
import {
  createTab, createTerminalTab, activateTab, closeTab,
  getActiveTab, getActiveWebview, navigate,
  findTabByWindowId, changeTerminalDirectory, openFolderPicker,
} from './renderer/tabs.js'
import { setTabFunctions } from './renderer/webview-events.js'
import { checkHaltija } from './renderer/status.js'
import { initSettingsListeners, hideSettings, hideNewTabDialog } from './renderer/settings.js'
import { initAgentStatusBar } from './renderer/agent-status.js'
import { initVideoCapture } from './renderer/video-capture.js'

// ============================================
// Initialize
// ============================================

loadSettings()
initElements()

// Expose tab functions for modules that need them (avoids circular imports)
window._tabs = { getActiveTab, getActiveWebview, createTab, activateTab, closeTab, navigate }
setTabFunctions({ navigate, createTab, activateTab, closeTab })

console.log('[Haltija Desktop] Initializing with tabs...')
checkHaltija()
createTab()

// Periodic status check
setInterval(checkHaltija, 5000)

// ============================================
// Event Listeners
// ============================================

// New tab buttons
el.newTabButton.addEventListener('click', () => createTab())
document.getElementById('new-terminal').addEventListener('click', () => createTerminalTab('human'))
document.getElementById('new-agent').addEventListener('click', () => createTerminalTab('agent'))

// Address bar
el.urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const tab = tabs.find(t => t.id === activeTabId)
    if (tab && tab.isTerminal) {
      changeTerminalDirectory(tab, el.urlInput.value.trim())
      el.urlInput.blur()
    } else {
      navigate(el.urlInput.value)
    }
  }
})

el.goButton.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId)
  if (tab && tab.isTerminal) {
    openFolderPicker(tab)
  } else {
    navigate(el.urlInput.value)
  }
})

// Navigation buttons
el.backButton.addEventListener('click', () => {
  const webview = getActiveWebview()
  if (webview) webview.goBack()
})

el.forwardButton.addEventListener('click', () => {
  const webview = getActiveWebview()
  if (webview) webview.goForward()
})

el.refreshButton.addEventListener('click', () => {
  const webview = getActiveWebview()
  if (webview) webview.reload()
})

// Settings
initSettingsListeners()

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
    e.preventDefault()
    el.urlInput.focus()
    el.urlInput.select()
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
    e.preventDefault()
    const webview = getActiveWebview()
    if (webview) webview.reload()
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 't') {
    e.preventDefault()
    createTab()
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
    e.preventDefault()
    if (activeTabId) closeTab(activeTabId)
  }
  if ((e.metaKey || e.ctrlKey) && e.key === '[') {
    e.preventDefault()
    const webview = getActiveWebview()
    if (webview && webview.canGoBack()) webview.goBack()
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ']') {
    e.preventDefault()
    const webview = getActiveWebview()
    if (webview && webview.canGoForward()) webview.goForward()
  }
  if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
    e.preventDefault()
    const index = parseInt(e.key) - 1
    if (tabs[index]) activateTab(tabs[index].id)
  }
  if (e.key === 'Escape') {
    hideSettings()
    hideNewTabDialog(false)
  }
})

// ============================================
// IPC Bridge — expose tab APIs to widget/main
// ============================================

// Tab management from widget (via main process IPC)
window.haltija?.onOpenTab?.((data) => createTab(data.url, { session: data.session }))
window.haltija?.onCloseTab?.((data) => {
  const tab = findTabByWindowId(data.windowId)
  if (tab) closeTab(tab.id)
})
window.haltija?.onFocusTab?.((data) => {
  const tab = findTabByWindowId(data.windowId)
  if (tab) activateTab(tab.id)
})

// Open URL from main process (window.open intercepted by main.js)
window.haltija?.onOpenUrlInTab?.((url) => {
  console.log('[Haltija Desktop] Opening URL in new tab:', url)
  createTab(url)
})

// ============================================
// Menu Commands from Main Process
// ============================================

if (window.haltija) {
  window.haltija.onShowNotification?.(showNotification)
  window.haltija.onMenuNewTab?.(() => createTab())
  window.haltija.onMenuNewTerminalTab?.(() => createTerminalTab())
  window.haltija.onMenuCloseTab?.(() => { if (activeTabId) closeTab(activeTabId) })
  window.haltija.onMenuCloseOtherTabs?.(() => {
    if (activeTabId && tabs.length > 1) {
      tabs.filter(t => t.id !== activeTabId).map(t => t.id).forEach(id => closeTab(id))
    }
  })
  window.haltija.onMenuReloadTab?.(() => {
    const wv = getActiveWebview(); if (wv) wv.reload()
  })
  window.haltija.onMenuForceReloadTab?.(() => {
    const wv = getActiveWebview(); if (wv) wv.reloadIgnoringCache()
  })
  window.haltija.onMenuDevToolsTab?.(() => {
    const wv = getActiveWebview(); if (wv) wv.openDevTools()
  })
  window.haltija.onMenuBack?.(() => {
    const wv = getActiveWebview(); if (wv && wv.canGoBack()) wv.goBack()
  })
  window.haltija.onMenuForward?.(() => {
    const wv = getActiveWebview(); if (wv && wv.canGoForward()) wv.goForward()
  })
  window.haltija.onMenuFocusUrl?.(() => {
    el.urlInput.focus(); el.urlInput.select()
  })

  window.haltija.onCreateAgentTab?.(async (data) => {
    console.log('[Haltija Desktop] Creating agent tab for widget, requestId:', data.requestId)
    try {
      const tab = await createTerminalTab('agent')
      const result = await new Promise((resolve) => {
        const checkReady = setInterval(() => {
          if (tab.shellId) {
            clearInterval(checkReady)
            resolve({ requestId: data.requestId, shellId: tab.shellId, name: tab.label || 'agent' })
          }
        }, 100)
        setTimeout(() => {
          clearInterval(checkReady)
          resolve({ requestId: data.requestId, shellId: tab.shellId || null, name: tab.label || 'agent', error: tab.shellId ? null : 'Timeout waiting for agent init' })
        }, 8000)
      })
      window.haltija.agentTabCreated(result)
    } catch (err) {
      window.haltija.agentTabCreated({ requestId: data.requestId, error: err.message })
    }
  })

  window.haltija.onNavigateUrl?.((data) => {
    console.log('[Haltija Desktop] Navigate request from widget:', data.url, 'wcId:', data.webContentsId)
    // Find the tab that owns the webview that sent the navigate request
    // so we navigate the correct tab, not the active (possibly terminal) tab
    let targetTabId = undefined
    if (data.webContentsId) {
      const match = tabs.find(t => {
        try {
          return t.webview?.getWebContentsId && t.webview.getWebContentsId() === data.webContentsId
        } catch { return false }
      })
      if (match) targetTabId = match.id
    }
    // Fallback: navigate the first non-terminal tab (never navigate a terminal/agent iframe)
    if (!targetTabId) {
      const contentTab = tabs.find(t => !t.isTerminal)
      if (contentTab) targetTabId = contentTab.id
    }
    navigate(data.url, targetTabId)
  })
}

// ============================================
// Window Messages (terminal iframe communication)
// ============================================

window.addEventListener('message', (event) => {
  if (event.data?.type === 'terminal-cwd') {
    const { cwd, shellId } = event.data
    const tab = tabs.find(t => t.isTerminal && t.webview?.contentWindow === event.source)
    if (tab) {
      tab.cwd = cwd
      tab.shellId = shellId

      if (tab.terminalMode !== 'agent') {
        const dirName = cwd.replace(/\/$/, '').split('/').pop() || cwd
        tab.title = dirName
        tab.element.querySelector('.tab-title').innerHTML = `> ${dirName}`
      }

      if (tab.id === activeTabId) {
        el.urlInput.value = cwd
        const displayTitle = tab.terminalMode === 'agent' ? tab.title : cwd.replace(/\/$/, '').split('/').pop()
        document.title = displayTitle
      }
    }
  }

  if (event.data?.type === 'shell-renamed') {
    const { shellId, name } = event.data
    const tab = tabs.find(t => t.isTerminal && (t.shellId === shellId || t.webview?.contentWindow === event.source))
    if (tab && tab.terminalMode === 'agent' && name) {
      tab.shellId = shellId
      tab.title = name
      tab.element.querySelector('.tab-title').innerHTML = `<span class="agent-status">*</span> ${name}`
      if (tab.id === activeTabId) document.title = name
    }
  }

  if (event.data?.type === 'agent-status') {
    const { status } = event.data
    const tab = tabs.find(t => t.isTerminal && t.terminalMode === 'agent' && t.webview?.contentWindow === event.source)
    if (tab) {
      tab.element.classList.remove('thinking', 'ready', 'error')
      if (status === 'thinking') tab.element.classList.add('thinking')
      else if (status === 'error') tab.element.classList.add('error')
      else tab.element.classList.add('ready')
    }
  }
})

// ============================================
// Deferred Init
// ============================================

setTimeout(() => initAgentStatusBar(), 1000)
initVideoCapture()
