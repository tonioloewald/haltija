/**
 * Renderer process - handles the UI and webview
 */

const HALTIJA_SERVER = 'http://localhost:8700'

// Elements
const urlInput = document.getElementById('url-input')
const goButton = document.getElementById('go')
const backButton = document.getElementById('back')
const forwardButton = document.getElementById('forward')
const refreshButton = document.getElementById('refresh')
const browser = document.getElementById('browser')
const statusDot = document.getElementById('haltija-status')

// Default URL
const DEFAULT_URL = `${HALTIJA_SERVER}/test`

// Navigate to URL
function navigate(url) {
  // Add protocol if missing
  if (url && !url.match(/^https?:\/\//)) {
    // Check if it looks like a domain
    if (url.includes('.') || url === 'localhost' || url.startsWith('localhost:')) {
      url = 'https://' + url
    } else {
      // Treat as search (could integrate with search engine)
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
  }
  
  browser.src = url || DEFAULT_URL
}

// Update UI state
function updateNavButtons() {
  backButton.disabled = !browser.canGoBack()
  forwardButton.disabled = !browser.canGoForward()
}

// Check Haltija server status
async function checkHaltija() {
  try {
    const response = await fetch(`${HALTIJA_SERVER}/status`)
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
async function injectWidget() {
  // Skip injection for about:blank
  const currentUrl = browser.getURL()
  if (!currentUrl || currentUrl === 'about:blank') {
    console.log('[Haltija Desktop] Skipping injection for about:blank')
    return
  }
  
  const script = `
    (function() {
      if (document.querySelector('haltija-dev')) {
        console.log('[Haltija] Widget already present');
        return;
      }
      
      console.log('[Haltija] Fetching inject.js from ${HALTIJA_SERVER}...');
      fetch('${HALTIJA_SERVER}/inject.js')
        .then(r => {
          console.log('[Haltija] Got response:', r.status);
          return r.text();
        })
        .then(code => {
          console.log('[Haltija] Evaluating inject.js...');
          eval(code);
        })
        .catch(e => console.error('[Haltija] Injection failed:', e));
    })();
  `
  
  try {
    await browser.executeJavaScript(script)
    console.log('[Haltija Desktop] Widget injection script executed')
  } catch (err) {
    console.error('[Haltija Desktop] Injection failed:', err)
  }
}

// Event listeners

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
backButton.addEventListener('click', () => browser.goBack())
forwardButton.addEventListener('click', () => browser.goForward())
refreshButton.addEventListener('click', () => browser.reload())

// Webview events
browser.addEventListener('did-start-loading', () => {
  browser.classList.add('loading')
  statusDot.className = 'status-dot connecting'
})

browser.addEventListener('did-stop-loading', () => {
  browser.classList.remove('loading')
  updateNavButtons()
  checkHaltija()
  // Inject widget when page finishes loading
  console.log('[Haltija Desktop] did-stop-loading, injecting widget...')
  injectWidget()
})

browser.addEventListener('did-navigate', (e) => {
  console.log('[Haltija Desktop] did-navigate:', e.url)
  urlInput.value = e.url
  updateNavButtons()
  // Inject widget after navigation
  setTimeout(() => injectWidget(), 500)
})

browser.addEventListener('did-navigate-in-page', (e) => {
  urlInput.value = e.url
  updateNavButtons()
})

browser.addEventListener('did-finish-load', () => {
  // Inject widget after page loads
  console.log('[Haltija Desktop] Page loaded, injecting widget...')
  injectWidget()
  
  // Notify main process (for screen capture coordination)
  if (window.haltija) {
    window.haltija.webviewReady(browser.getWebContentsId())
  }
})

// Also inject on dom-ready for SPAs and client-side navigations
browser.addEventListener('dom-ready', () => {
  console.log('[Haltija Desktop] DOM ready, injecting widget...')
  injectWidget()
})

browser.addEventListener('page-title-updated', (e) => {
  document.title = e.title ? `${e.title} - Haltija` : 'Haltija'
})

// Handle new window requests (open in same webview or external browser)
browser.addEventListener('new-window', (e) => {
  e.preventDefault()
  // Could open in new tab/window, for now navigate in same view
  navigate(e.url)
})

// Console messages from webview
browser.addEventListener('console-message', (e) => {
  const prefix = e.level === 2 ? '⚠️' : e.level === 3 ? '❌' : ''
  console.log(`[Webview${prefix}]`, e.message)
})

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
    browser.reload()
  }
  
  // Cmd/Ctrl + [ = back
  if ((e.metaKey || e.ctrlKey) && e.key === '[') {
    e.preventDefault()
    if (browser.canGoBack()) browser.goBack()
  }
  
  // Cmd/Ctrl + ] = forward
  if ((e.metaKey || e.ctrlKey) && e.key === ']') {
    e.preventDefault()
    if (browser.canGoForward()) browser.goForward()
  }
})

// Initialize
console.log('[Haltija Desktop] Initializing...')
console.log('[Haltija Desktop] Default URL:', DEFAULT_URL)
checkHaltija()

// Wait for webview to be ready before navigating
browser.addEventListener('did-attach', () => {
  console.log('[Haltija Desktop] Webview attached, navigating to:', DEFAULT_URL)
  navigate(DEFAULT_URL)
})

// Fallback: navigate after short delay if did-attach doesn't fire
setTimeout(() => {
  if (browser.getURL() === 'about:blank' || !browser.getURL()) {
    console.log('[Haltija Desktop] Fallback navigation to:', DEFAULT_URL)
    navigate(DEFAULT_URL)
  }
}, 1000)

// Periodic status check
setInterval(checkHaltija, 5000)
