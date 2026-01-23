/**
 * Preload script - bridge between renderer and main process
 */

console.log('[Haltija] Renderer preload loading...')

const { contextBridge, ipcRenderer } = require('electron')

// Expose the webview preload path for the renderer to use
// __dirname is available in preload scripts
const webviewPreloadPath = __dirname + '/webview-preload.js'

contextBridge.exposeInMainWorld('haltija', {
  // Path to webview preload script
  webviewPreloadPath: webviewPreloadPath,
  // Navigation
  navigate: (url) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  refresh: () => ipcRenderer.send('refresh'),
  
  // Screen capture
  capturePage: () => ipcRenderer.invoke('capture-page'),
  captureElement: (selector) => ipcRenderer.invoke('capture-element', selector),
  
  // Webview ready notification
  webviewReady: (webContentsId) => ipcRenderer.send('webview-ready', webContentsId),
  
  // Events from main
  onCaptureElementRequest: (callback) => {
    ipcRenderer.on('capture-element-request', (event, selector) => callback(selector))
  },
  
  // Open URL in new tab (from main process intercepting window.open)
  onOpenUrlInTab: (callback) => {
    ipcRenderer.on('open-url-in-tab', (event, url) => callback(url))
  },
  
  // Menu commands from main process
  onMenuNewTab: (callback) => ipcRenderer.on('menu-new-tab', callback),
  onMenuNewTerminalTab: (callback) => ipcRenderer.on('menu-new-terminal-tab', callback),
  onMenuCloseTab: (callback) => ipcRenderer.on('menu-close-tab', callback),
  onMenuCloseOtherTabs: (callback) => ipcRenderer.on('menu-close-other-tabs', callback),
  onMenuReloadTab: (callback) => ipcRenderer.on('menu-reload-tab', callback),
  onMenuForceReloadTab: (callback) => ipcRenderer.on('menu-force-reload-tab', callback),
  onMenuDevToolsTab: (callback) => ipcRenderer.on('menu-devtools-tab', callback),
  onMenuBack: (callback) => ipcRenderer.on('menu-back', callback),
  onMenuForward: (callback) => ipcRenderer.on('menu-forward', callback),
  onMenuFocusUrl: (callback) => ipcRenderer.on('menu-focus-url', callback),
  
  // Notifications from main process
  onShowNotification: (callback) => ipcRenderer.on('show-notification', (event, message) => callback(message)),
})

console.log('[Haltija] Renderer preload complete, exposed:', Object.keys(window.haltija || {}))
