/**
 * Preload script - bridge between renderer and main process
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('haltija', {
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
})
