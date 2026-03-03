/**
 * Tab management — create, activate, close, navigate browser tabs.
 */

import { tabs, activeTabId, setActiveTabId, nextTabId, el, getServerUrl, lastCwd, setLastCwd } from './state.js'
import { showNotification } from './ui-utils.js'
import { setupWebviewEvents } from './webview-events.js'
import { checkHaltija, updateNavButtons } from './status.js'

export function getDefaultUrl() {
  return `${getServerUrl()}/test`
}

export function createTab(url, activate = true) {
  const tabId = nextTabId()
  const tabUrl = url || getDefaultUrl()

  const tabEl = document.createElement('div')
  tabEl.className = 'tab'
  tabEl.dataset.tabId = tabId
  tabEl.innerHTML = `
    <span class="tab-title">New Tab</span>
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

  el.tabBar.appendChild(tabEl)

  const webview = document.createElement('webview')
  webview.id = tabId
  webview.src = 'about:blank'
  if (window.haltija?.webviewPreloadPath) {
    webview.setAttribute('preload', 'file://' + window.haltija.webviewPreloadPath)
  }
  webview.setAttribute(
    'webpreferences',
    'contextIsolation=yes, nodeIntegration=no, webSecurity=no, allowRunningInsecureContent=yes',
  )
  webview.setAttribute('allowpopups', '')

  el.webviewContainer.appendChild(webview)

  const tab = {
    id: tabId,
    url: tabUrl,
    title: 'New Tab',
    element: tabEl,
    webview: webview,
  }
  tabs.push(tab)

  setupWebviewEvents(tab)

  if (activate) {
    activateTab(tabId)
  }

  webview.addEventListener('did-attach', () => {
    navigate(tabUrl, tabId)
  }, { once: true })

  const fallbackTabId = tabId
  setTimeout(() => {
    const t = tabs.find(tt => tt.id === fallbackTabId)
    if (t && !t.isTerminal && (webview.getURL() === 'about:blank' || !webview.getURL())) {
      navigate(tabUrl, fallbackTabId)
    }
  }, 500)

  return tab
}

export async function createTerminalTab(mode = 'human') {
  const tabId = nextTabId()
  const isAgent = mode === 'agent'
  const prefix = isAgent ? '<span class="agent-status">*</span>' : '>'

  if (isAgent) {
    await checkHjInstalled()
  }

  const activeTab = getActiveTab()
  const initialCwd = (activeTab?.isTerminal && activeTab?.cwd) || lastCwd || ''
  const label = isAgent ? 'agent' : 'shell'

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

  el.tabBar.appendChild(tabEl)

  const iframe = document.createElement('iframe')
  iframe.id = tabId
  const cwdParam = initialCwd ? `&cwd=${encodeURIComponent(initialCwd)}` : ''
  iframe.src = `terminal.html?port=${window.haltija?.port || 8700}&mode=${mode}${cwdParam}`
  iframe.className = 'terminal-frame'

  el.webviewContainer.appendChild(iframe)

  const tab = {
    id: tabId,
    url: 'terminal',
    title: label,
    element: tabEl,
    webview: iframe,
    isTerminal: true,
    terminalMode: mode,
  }
  tabs.push(tab)

  activateTab(tabId)
  return tab
}

export function renameTerminalTab(tab, name) {
  if (!name) return
  tab.shellName = name
  tab.title = name
  const prefix = tab.terminalMode === 'agent' ? '*' : '>'
  tab.element.querySelector('.tab-title').textContent = `${prefix} ${name}`
  document.title = name
  const iframe = tab.webview
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'rename', name }, '*')
  }
}

export function activateTab(tabId) {
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab) return

  // When switching to a terminal/agent tab, keep the last content webview
  // visible underneath so Electron's capturePage() still works and hj commands
  // (screenshot, navigate, etc.) continue to target the right content.
  const isTerminalTab = tab.isTerminal || tab.url === 'terminal'
  const previousActiveId = activeTabId

  tabs.forEach((t) => {
    t.element.classList.remove('active')
    if (isTerminalTab && t.id === previousActiveId && !t.isTerminal && t.url !== 'terminal') {
      // Keep the previously active content webview visible behind the terminal iframe
    } else {
      t.webview.classList.remove('active')
    }
  })

  tab.element.classList.add('active')
  tab.webview.classList.add('active')
  setActiveTabId(tabId)

  el.toolbar.classList.remove('terminal', 'agent')
  if (tab.isTerminal || tab.url === 'terminal') {
    el.urlInput.value = tab.cwd || '~'
    el.urlInput.placeholder = 'working directory'
    el.goButton.textContent = 'Pick folder\u2026'
    el.goButton.title = 'Pick folder\u2026'
    el.toolbar.classList.add(tab.terminalMode === 'agent' ? 'agent' : 'terminal')

    if (window._currentStatusLine) {
      el.agentStatusBar.classList.remove('hidden')
    }

    if (tab.terminalMode === 'agent' && tab.shellId) {
      fetch(`${getServerUrl()}/terminal/agent-focus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shellId: tab.shellId }),
      }).catch(() => {})
    }
  } else {
    el.urlInput.value = tab.url || ''
    el.urlInput.placeholder = 'Enter URL...'
    el.goButton.textContent = 'Go'
    el.goButton.title = 'Go'

    el.agentStatusBar.classList.add('hidden')
  }
  document.title = tab.title || 'Haltija'

  updateNavButtons()
}

export function findTabByWindowId(windowId) {
  if (!windowId) return null
  const wcId = parseInt(windowId.split('-').pop(), 10)
  if (isNaN(wcId)) return null
  return tabs.find(t => {
    try {
      return t.webview && t.webview.getWebContentsId && t.webview.getWebContentsId() === wcId
    } catch { return false }
  }) || null
}

export function closeTab(tabId) {
  const tabIndex = tabs.findIndex((t) => t.id === tabId)
  if (tabIndex === -1) return

  const tab = tabs[tabIndex]

  if (tab.webview && tab.webview.tagName === 'WEBVIEW') {
    try {
      tab.webview.stop()
      tab.webview.src = 'about:blank'
    } catch (e) {}
  }

  tab.element.remove()
  tab.webview.remove()

  tabs.splice(tabIndex, 1)

  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const newIndex = Math.max(0, tabIndex - 1)
      activateTab(tabs[newIndex].id)
    } else {
      window.haltija.closeWindow()
    }
  }
}

export function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId)
}

export function getActiveWebview() {
  const tab = getActiveTab()
  return tab ? tab.webview : null
}

export function navigate(url, tabId = activeTabId) {
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab) return

  let addedHttps = false

  if (url && !url.match(/^(https?|blob|data|file|about|javascript):\/?\/?/i)) {
    if (url.includes('.') || url === 'localhost' || url.startsWith('localhost:')) {
      addedHttps = true
      url = 'https://' + url
    } else {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
  }

  tab.url = url || getDefaultUrl()

  if (addedHttps) {
    const httpUrl = tab.url.replace(/^https:/, 'http:')

    const failHandler = (e) => {
      if (e.errorCode < 0) {
        console.log(`[Haltija] HTTPS failed (${e.errorCode}), trying HTTP...`)
        tab.webview.removeEventListener('did-fail-load', failHandler)
        tab.url = httpUrl
        tab.webview.src = httpUrl
        if (tabId === activeTabId) {
          el.urlInput.value = httpUrl
        }
      }
    }
    tab.webview.addEventListener('did-fail-load', failHandler, { once: true })

    tab.webview.addEventListener('did-finish-load', () => {
      tab.webview.removeEventListener('did-fail-load', failHandler)
    }, { once: true })
  }

  tab.webview.src = tab.url

  if (tabId === activeTabId && !tab.isTerminal) {
    el.urlInput.value = tab.url
  }
}

export async function changeTerminalDirectory(tab, path) {
  if (!path) return
  try {
    const resp = await fetch(`${getServerUrl()}/terminal/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: `cd ${path}`, shellId: tab.shellId }),
    })
    const result = await resp.text()
    if (result.startsWith('cd:')) {
      showNotification(result, 3000)
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 3000)
  }
}

export async function openFolderPicker(tab) {
  if (window.haltija?.showOpenDialog) {
    const result = await window.haltija.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: tab.cwd || undefined,
    })
    if (result && !result.canceled && result.filePaths?.[0]) {
      const picked = result.filePaths[0]
      setLastCwd(picked)
      changeTerminalDirectory(tab, picked)
    }
  } else {
    showNotification('Folder picker not available', 2000)
  }
}

// hj CLI install check
let hjCheckDone = false

async function checkHjInstalled() {
  if (hjCheckDone) return
  hjCheckDone = true

  try {
    const response = await fetch(`${getServerUrl()}/terminal/hj-status`)
    if (!response.ok) return

    const { installed, installCommand, message } = await response.json()
    if (installed) return

    showHjInstallPrompt(installCommand, message)
  } catch (err) {
    console.log('[Haltija Desktop] Could not check hj status:', err.message)
  }
}

function showHjInstallPrompt(installCommand, message) {
  const prompt = document.createElement('div')
  prompt.className = 'hj-install-prompt'
  prompt.innerHTML = `
    <div class="hj-install-content">
      <div class="hj-install-header">
        <span class="hj-install-icon">\u26A0\uFE0F</span>
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
