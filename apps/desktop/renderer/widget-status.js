/**
 * Widget status indicators — shows outer (chrome) and inner (page) widget state
 * in the tab bar. Clicking opens devtools for the respective context.
 */

import { getServerUrl } from './state.js'

const outerBtn = document.getElementById('ws-outer')
const innerBtn = document.getElementById('ws-inner')
const outerDot = outerBtn?.querySelector('.ws-dot')
const innerDot = innerBtn?.querySelector('.ws-dot')
const innerLabel = innerBtn?.querySelector('.ws-label')

let lastInnerWindowId = null

function updateIndicators(windows) {
  // Outer widget: look for hj-chrome
  const outer = windows.find(w => w.id === 'hj-chrome')
  if (outerDot) {
    outerDot.className = 'ws-dot ' + (outer ? 'connected' : 'disconnected')
  }

  // Inner widget: find the focused non-chrome content tab
  const inner = windows.find(w => w.id !== 'hj-chrome' && w.focused) ||
                windows.find(w => w.id !== 'hj-chrome')
  if (innerDot) {
    const cls = inner
      ? (inner.recording ? 'recording' : 'connected')
      : 'disconnected'
    innerDot.className = 'ws-dot ' + cls
  }
  if (innerLabel && inner) {
    // Show truncated title or "page"
    const title = inner.title || inner.url || 'page'
    innerLabel.textContent = title.length > 20 ? title.slice(0, 18) + '…' : title
    innerLabel.title = inner.title || inner.url || ''
  } else if (innerLabel) {
    innerLabel.textContent = 'page'
  }
  lastInnerWindowId = inner?.id || null
}

async function poll() {
  try {
    const resp = await fetch(`${getServerUrl()}/status`)
    if (resp.ok) {
      const data = await resp.json()
      updateIndicators(data.windows || [])
    }
  } catch { /* server not running */ }
}

// Click handlers — open devtools
outerBtn?.addEventListener('click', () => {
  // Open renderer devtools (the app chrome itself)
  window.haltija?.openRendererDevTools?.()
})

innerBtn?.addEventListener('click', () => {
  // Open active webview devtools
  const { getActiveWebview } = window._tabs || {}
  if (getActiveWebview) {
    const wv = getActiveWebview()
    if (wv) wv.openDevTools()
  }
})

export function initWidgetStatus() {
  poll()
  setInterval(poll, 3000)
}
