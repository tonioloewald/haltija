/**
 * Webview preload script - exposes capture APIs to web content
 * 
 * This runs in the webview context (the actual web page), not the renderer.
 * It provides window.haltija.capturePage() to the injected widget.
 */

const { contextBridge, ipcRenderer } = require('electron')

console.log('[Haltija] Webview preload loading...')

contextBridge.exposeInMainWorld('haltija', {
  // Screen capture - these IPC calls go to the main process
  capturePage: () => {
    console.log('[Haltija] capturePage called')
    return ipcRenderer.invoke('capture-page')
  },
  captureElement: (selector) => {
    console.log('[Haltija] captureElement called:', selector)
    return ipcRenderer.invoke('capture-element', selector)
  },
  // Navigate with smart https->http fallback (uses renderer's navigate function)
  navigate: (url) => {
    console.log('[Haltija] navigate called:', url)
    return ipcRenderer.invoke('navigate-url', url)
  },
  // Create a new agent tab and return its info
  openAgentTab: () => {
    console.log('[Haltija] openAgentTab called')
    return ipcRenderer.invoke('open-agent-tab')
  },
})

console.log('[Haltija] Webview preload complete, window.haltija exposed')
