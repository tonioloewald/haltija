/**
 * Webview event setup — navigation events, title updates, keyboard shortcuts, etc.
 */

import { tabs, activeTabId, el, getServerUrl } from './state.js'
import { updateNavButtons, checkHaltija } from './status.js'

// These are set by renderer.js to avoid circular imports
let _navigate, _createTab, _activateTab, _closeTab
export function setTabFunctions({ navigate, createTab, activateTab, closeTab }) {
  _navigate = navigate
  _createTab = createTab
  _activateTab = activateTab
  _closeTab = closeTab
}

export async function injectWidget(webview) {
  const currentUrl = webview.getURL()
  if (!currentUrl || currentUrl === 'about:blank') return

  const serverUrl = getServerUrl()
  const script = `
    (function() {
      if (document.getElementById('haltija-widget')) return;
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

export function setupWebviewEvents(tab) {
  const webview = tab.webview

  webview.addEventListener('did-start-loading', () => {
    webview.classList.add('loading')
    if (tab.id === activeTabId) {
      el.statusDot.className = 'status-dot connecting'
    }
  })

  webview.addEventListener('did-stop-loading', () => {
    webview.classList.remove('loading')
    if (tab.id === activeTabId) {
      updateNavButtons()
      checkHaltija()
    }
  })

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url
    if (tab.id === activeTabId && !tab.isTerminal) {
      el.urlInput.value = e.url
      updateNavButtons()
    }
  })

  webview.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url
    if (tab.id === activeTabId && !tab.isTerminal) {
      el.urlInput.value = e.url
      updateNavButtons()
    }
  })

  webview.addEventListener('did-finish-load', () => {
    if (window.haltija) {
      window.haltija.webviewReady(webview.getWebContentsId())
    }
  })

  webview.addEventListener('dom-ready', () => {
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

  webview.addEventListener('new-window', async (e) => {
    e.preventDefault()
    const { settings } = await import('./state.js')
    if (settings.confirmNewTabs) {
      const { showNewTabDialog } = await import('./settings.js')
      const allowed = await showNewTabDialog(e.url)
      if (allowed) _createTab(e.url)
    } else {
      _createTab(e.url)
    }
  })

  webview.addEventListener('console-message', (e) => {
    const prefix = e.level === 2 ? '[warn]' : e.level === 3 ? '[error]' : ''
    console.log(`[Tab ${tab.id}${prefix}]`, e.message)
  })

  webview.addEventListener('dialog', (e) => {
    const dialogType = e.type
    const message = e.messageText || ''
    console.log(`[Tab ${tab.id}] Native dialog intercepted: ${dialogType} - "${message}"`)

    if (dialogType === 'confirm') {
      e.dialog.accept()
    } else if (dialogType === 'prompt') {
      e.dialog.dismiss()
    } else {
      e.dialog.accept()
    }
  })

  webview.addEventListener('context-menu', (e) => {
    e.preventDefault()
    const { x, y } = e.params

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
      { label: 'Back', action: () => webview.canGoBack() && webview.goBack(), enabled: webview.canGoBack() },
      { label: 'Forward', action: () => webview.canGoForward() && webview.goForward(), enabled: webview.canGoForward() },
      { label: 'Reload', action: () => webview.reload() },
      { type: 'separator' },
      { label: 'Inspect Element', action: () => webview.inspectElement(x, y) },
    ]

    items.forEach((item) => {
      if (item.type === 'separator') {
        const sep = document.createElement('div')
        sep.style.cssText = 'height: 1px; background: var(--border); margin: 4px 0;'
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
          menuItem.addEventListener('mouseenter', () => { menuItem.style.background = 'var(--hover)' })
          menuItem.addEventListener('mouseleave', () => { menuItem.style.background = 'transparent' })
          menuItem.addEventListener('click', () => {
            document.body.removeChild(menu)
            item.action()
          })
        }
        menu.appendChild(menuItem)
      }
    })

    document.body.appendChild(menu)

    const closeMenu = (evt) => {
      if (!menu.contains(evt.target)) {
        if (document.body.contains(menu)) document.body.removeChild(menu)
        document.removeEventListener('click', closeMenu)
      }
    }
    setTimeout(() => document.addEventListener('click', closeMenu), 0)
  })

  webview.addEventListener('before-input-event', (e) => {
    const input = e.input || e
    const { type, key, meta, control } = input
    if (type !== 'keyDown') return

    if ((meta || control) && key === 'r') {
      e.preventDefault(); e.stopPropagation()
      webview.reload()
      return
    }
    if ((meta || control) && key === 'l') {
      e.preventDefault(); e.stopPropagation()
      el.urlInput.focus(); el.urlInput.select()
      return
    }
    if ((meta || control) && key === 't') {
      e.preventDefault(); e.stopPropagation()
      _createTab()
      return
    }
    if ((meta || control) && key === 'w') {
      e.preventDefault(); e.stopPropagation()
      _closeTab(tab.id)
      return
    }
    if ((meta || control) && key === '[') {
      e.preventDefault(); e.stopPropagation()
      if (webview.canGoBack()) webview.goBack()
      return
    }
    if ((meta || control) && key === ']') {
      e.preventDefault(); e.stopPropagation()
      if (webview.canGoForward()) webview.goForward()
      return
    }
  })
}
