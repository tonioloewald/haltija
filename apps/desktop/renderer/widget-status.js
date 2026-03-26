/**
 * Widget status indicators + action menus.
 *
 * Tab bar indicators for outer (chrome) and inner (page) widgets.
 * Click opens a dropdown with actions (screenshot, record, select, etc.).
 * Outputs save to /tmp and copy the path to clipboard.
 */

import { getServerUrl } from './state.js'
import { showNotification } from './ui-utils.js'

// DOM refs
const outerBtn = document.getElementById('ws-outer')
const innerBtn = document.getElementById('ws-inner')
const outerDot = outerBtn?.querySelector('.ws-dot')
const innerDot = innerBtn?.querySelector('.ws-dot')
const innerLabel = innerBtn?.querySelector('.ws-label')
const outerMenu = document.getElementById('ws-outer-menu')
const innerMenu = document.getElementById('ws-inner-menu')

// State
let innerWindowId = null
let outerWindowId = 'hj-chrome'
let isRecordingActions = false
let isRecordingVideo = false
let isSelecting = false
let openMenu = null // currently open menu element

// ==========================================
// Helpers
// ==========================================

function serverUrl() { return getServerUrl() }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const resp = await fetch(`${serverUrl()}${path}`, opts)
  return resp.json()
}

/** POST to endpoint targeting the inner widget's window */
function pageApi(path, body = {}) {
  return api('POST', path, { ...body, window: innerWindowId })
}

/** POST to endpoint targeting the outer widget's window */
function chromeApi(path, body = {}) {
  return api('POST', path, { ...body, window: outerWindowId })
}

/** Copy text to clipboard and show a toast */
async function copyToClipboard(text, message) {
  try {
    await navigator.clipboard.writeText(text)
    showNotification(message || 'Copied to clipboard')
  } catch {
    showNotification('Clipboard not available')
  }
}

// ==========================================
// Menu rendering
// ==========================================

function buildInnerMenu() {
  if (!innerMenu) return
  const connected = !!innerWindowId
  const items = [
    { icon: '📷', label: 'Screenshot', action: 'screenshot', disabled: !connected },
    { icon: '⏺', label: isRecordingActions ? 'Stop Recording' : 'Record Actions',
      action: 'toggle-record', cls: isRecordingActions ? 'recording' : '', disabled: !connected },
    { icon: '🎥', label: isRecordingVideo ? 'Stop Video' : 'Record Video',
      action: 'toggle-video', cls: isRecordingVideo ? 'recording' : '', disabled: !connected },
    { sep: true },
    { icon: '🎯', label: isSelecting ? 'Cancel Selection' : 'Select Element',
      action: 'toggle-select', cls: isSelecting ? 'active' : '', disabled: !connected },
    { icon: '📋', label: 'Console', action: 'console', disabled: !connected },
    { icon: '📊', label: 'Events', action: 'events', disabled: !connected },
    { icon: '📸', label: 'Snapshot', action: 'snapshot', disabled: !connected },
    { sep: true },
    { icon: '🔍', label: 'Inspect (DevTools)', action: 'devtools-inner' },
  ]
  renderMenu(innerMenu, items)
}

function buildOuterMenu() {
  if (!outerMenu) return
  const items = [
    { icon: '📋', label: 'Console', action: 'console-chrome' },
    { icon: '🌳', label: 'DOM Tree', action: 'tree-chrome' },
    { sep: true },
    { icon: '🔍', label: 'Inspect (DevTools)', action: 'devtools-outer' },
  ]
  renderMenu(outerMenu, items)
}

function renderMenu(menuEl, items) {
  menuEl.innerHTML = ''
  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement('div')
      sep.className = 'ws-menu-sep'
      menuEl.appendChild(sep)
      continue
    }
    const btn = document.createElement('button')
    btn.className = 'ws-menu-item' + (item.cls ? ` ${item.cls}` : '') + (item.disabled ? ' disabled' : '')
    btn.innerHTML = `<span class="mi-icon">${item.icon}</span><span class="mi-label">${item.label}</span>`
    btn.dataset.action = item.action
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      closeMenus()
      if (!item.disabled) handleAction(item.action)
    })
    menuEl.appendChild(btn)
  }
}

// ==========================================
// Actions
// ==========================================

/** Find a path in a response — handlers are inconsistent about nesting */
function findPath(resp) {
  return resp?.path || resp?.data?.path || null
}

async function handleAction(action) {
  switch (action) {
    case 'screenshot': {
      const resp = await pageApi('/screenshot')
      const path = findPath(resp)
      if (path) {
        await copyToClipboard(path, `Screenshot saved: ${path}`)
      } else {
        showNotification('Screenshot failed')
      }
      break
    }
    case 'toggle-record': {
      if (isRecordingActions) {
        await pageApi('/recording/stop')
        isRecordingActions = false
        const gen = await pageApi('/recording/generate')
        const path = findPath(gen)
        if (path) {
          await copyToClipboard(path, `Test saved: ${path}`)
        } else if (gen?.test || gen?.data?.test) {
          // Generate returns test JSON directly, not a file path
          const test = gen.test || gen.data?.test || gen.data
          await copyToClipboard(JSON.stringify(test, null, 2), 'Test JSON copied')
        } else {
          showNotification('Recording stopped')
        }
      } else {
        await pageApi('/recording/start')
        isRecordingActions = true
        showNotification('Recording actions…')
      }
      break
    }
    case 'toggle-video': {
      if (isRecordingVideo) {
        const resp = await pageApi('/video/stop')
        isRecordingVideo = false
        const path = findPath(resp)
        if (path) {
          await copyToClipboard(path, `Video saved: ${path}`)
        } else {
          showNotification('Video stopped')
        }
      } else {
        await pageApi('/video/start')
        isRecordingVideo = true
        showNotification('Recording video…')
      }
      break
    }
    case 'toggle-select': {
      if (isSelecting) {
        await pageApi('/select/cancel')
        isSelecting = false
        showNotification('Selection cancelled')
      } else {
        await pageApi('/select/start')
        isSelecting = true
        showNotification('Click an element to select it')
        pollSelection()
      }
      break
    }
    case 'console': {
      const resp = await api('GET', `/console?window=${innerWindowId}`)
      if (resp) await copyToClipboard(JSON.stringify(resp.data || resp, null, 2), 'Console output copied')
      break
    }
    case 'events': {
      const resp = await api('GET', `/events?window=${innerWindowId}`)
      if (resp) await copyToClipboard(JSON.stringify(resp.data || resp, null, 2), 'Events copied')
      break
    }
    case 'snapshot': {
      const resp = await pageApi('/snapshot')
      if (resp) await copyToClipboard(JSON.stringify(resp.data || resp, null, 2), 'Snapshot copied')
      break
    }
    case 'console-chrome': {
      const resp = await api('GET', `/console?window=${outerWindowId}`)
      if (resp) await copyToClipboard(JSON.stringify(resp.data || resp, null, 2), 'Chrome console copied')
      break
    }
    case 'tree-chrome': {
      const resp = await api('GET', `/tree?window=${outerWindowId}`)
      if (resp) await copyToClipboard(JSON.stringify(resp.data || resp, null, 2), 'Chrome DOM tree copied')
      break
    }
    case 'devtools-inner': {
      const { getActiveWebview } = window._tabs || {}
      if (getActiveWebview) {
        const wv = getActiveWebview()
        if (wv) wv.openDevTools()
      }
      break
    }
    case 'devtools-outer': {
      window.haltija?.openRendererDevTools?.()
      break
    }
  }
}

async function pollSelection() {
  // Check selection status until resolved or cancelled
  for (let i = 0; i < 120; i++) { // 2 min max
    await new Promise(r => setTimeout(r, 1000))
    if (!isSelecting) return
    try {
      const data = await api('GET', `/select/status?window=${innerWindowId}`)
      const status = data?.data?.status || data?.status
      if (status === 'completed') {
        isSelecting = false
        const result = await api('GET', `/select/result?window=${innerWindowId}`)
        if (result) {
          await copyToClipboard(JSON.stringify(result.data || result, null, 2), 'Selection copied')
        }
        return
      }
      if (status !== 'selecting') {
        isSelecting = false
        return
      }
    } catch { isSelecting = false; return }
  }
  isSelecting = false
}

// ==========================================
// Menu open/close
// ==========================================

function toggleMenu(menuEl) {
  if (openMenu === menuEl) {
    closeMenus()
  } else {
    closeMenus()
    // Rebuild menu to reflect current state
    if (menuEl === innerMenu) buildInnerMenu()
    else buildOuterMenu()
    menuEl.classList.add('open')
    openMenu = menuEl
  }
}

function closeMenus() {
  outerMenu?.classList.remove('open')
  innerMenu?.classList.remove('open')
  openMenu = null
}

// Click handlers
outerBtn?.addEventListener('click', (e) => {
  e.stopPropagation()
  toggleMenu(outerMenu)
})

innerBtn?.addEventListener('click', (e) => {
  e.stopPropagation()
  toggleMenu(innerMenu)
})

// Close on outside click
document.addEventListener('click', closeMenus)

// ==========================================
// Status polling
// ==========================================

function updateIndicators(windows) {
  const outer = windows.find(w => w.id === 'hj-chrome')
  if (outerDot) {
    outerDot.className = 'ws-dot ' + (outer ? 'connected' : 'disconnected')
  }

  // Inner: focused non-chrome tab, or any non-chrome tab
  const inner = windows.find(w => w.id !== 'hj-chrome' && w.focused) ||
                windows.find(w => w.id !== 'hj-chrome')
  innerWindowId = inner?.id || null

  if (innerDot) {
    let cls = 'disconnected'
    if (inner) {
      if (isRecordingActions || isRecordingVideo || inner.recording) cls = 'recording'
      else cls = 'connected'
    }
    innerDot.className = 'ws-dot ' + cls
  }

  if (innerLabel && inner) {
    const title = inner.title || inner.url || 'page'
    innerLabel.textContent = title.length > 20 ? title.slice(0, 18) + '…' : title
    innerLabel.title = inner.title || inner.url || ''
  } else if (innerLabel) {
    innerLabel.textContent = 'page'
  }
}

async function poll() {
  try {
    const resp = await fetch(`${serverUrl()}/status`)
    if (resp.ok) {
      const data = await resp.json()
      updateIndicators(data.windows || [])
      // Sync recording state from server
      if (data.recording !== undefined) {
        isRecordingActions = data.activeRecordings > 0
      }
    }
  } catch { /* server not running */ }
}

export function initWidgetStatus() {
  poll()
  setInterval(poll, 3000)
}
