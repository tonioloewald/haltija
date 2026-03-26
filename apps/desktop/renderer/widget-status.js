/**
 * Widget status indicators + action menus.
 *
 * Tab bar indicators for outer (chrome) and inner (page) widgets.
 * Click opens a dropdown with actions (screenshot, record, select, etc.).
 * Outputs save to /tmp and copy the path to clipboard.
 */

import { getServerUrl } from './state.js'

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

/** Copy text to clipboard and briefly flash the indicator */
async function copyToClipboard(text, indicator) {
  try {
    await navigator.clipboard.writeText(text)
    if (indicator) {
      indicator.style.outline = '2px solid #22c55e'
      setTimeout(() => indicator.style.outline = '', 600)
    }
  } catch { /* clipboard not available */ }
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

async function handleAction(action) {
  switch (action) {
    case 'screenshot': {
      const data = await pageApi('/screenshot')
      if (data?.data?.path) {
        await copyToClipboard(data.data.path, innerBtn)
      }
      break
    }
    case 'toggle-record': {
      if (isRecordingActions) {
        const data = await pageApi('/recording/stop')
        isRecordingActions = false
        // Generate test JSON and save
        if (data?.success !== false) {
          const gen = await pageApi('/recording/generate')
          if (gen?.data?.path) {
            await copyToClipboard(gen.data.path, innerBtn)
          }
        }
      } else {
        await pageApi('/recording/start')
        isRecordingActions = true
      }
      break
    }
    case 'toggle-video': {
      if (isRecordingVideo) {
        const data = await pageApi('/video/stop')
        isRecordingVideo = false
        if (data?.data?.path) {
          await copyToClipboard(data.data.path, innerBtn)
        }
      } else {
        await pageApi('/video/start')
        isRecordingVideo = true
      }
      break
    }
    case 'toggle-select': {
      if (isSelecting) {
        await pageApi('/select/cancel')
        isSelecting = false
      } else {
        await pageApi('/select/start')
        isSelecting = true
        // Poll for result
        pollSelection()
      }
      break
    }
    case 'console': {
      const data = await api('GET', `/console?window=${innerWindowId}`)
      if (data?.data) {
        const path = `/tmp/haltija-console-${Date.now()}.json`
        // Write via file endpoint if available, otherwise just copy the JSON
        const json = JSON.stringify(data.data, null, 2)
        await copyToClipboard(json, innerBtn)
      }
      break
    }
    case 'events': {
      const data = await api('GET', `/events?window=${innerWindowId}`)
      if (data?.data) {
        const json = JSON.stringify(data.data, null, 2)
        await copyToClipboard(json, innerBtn)
      }
      break
    }
    case 'snapshot': {
      const data = await pageApi('/snapshot')
      if (data?.data) {
        const json = JSON.stringify(data.data, null, 2)
        await copyToClipboard(json, innerBtn)
      }
      break
    }
    case 'console-chrome': {
      const data = await api('GET', `/console?window=${outerWindowId}`)
      if (data?.data) {
        const json = JSON.stringify(data.data, null, 2)
        await copyToClipboard(json, outerBtn)
      }
      break
    }
    case 'tree-chrome': {
      const data = await api('GET', `/tree?window=${outerWindowId}`)
      if (data?.data) {
        const json = JSON.stringify(data.data, null, 2)
        await copyToClipboard(json, outerBtn)
      }
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
      if (data?.data?.status === 'completed') {
        isSelecting = false
        const result = await api('GET', `/select/result?window=${innerWindowId}`)
        if (result?.data) {
          const json = JSON.stringify(result.data, null, 2)
          await copyToClipboard(json, innerBtn)
        }
        return
      }
      if (data?.data?.status !== 'selecting') {
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
