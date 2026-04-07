/**
 * Widget status — polls server state and handles page/chrome widget actions.
 *
 * The chrome/outer menu was removed from the tab bar; those actions live in
 * the app menu (View → Developer Tools). The inner (page) actions live in
 * the per-tab ⋯ menu. This module owns the shared state and action logic.
 */

import { getServerUrl } from './state.js'
import { showNotification } from './ui-utils.js'

// ==========================================
// State (exported as getters so tabs.js can read current values)
// ==========================================

let innerWindowId = null
const outerWindowId = 'hj-chrome'
let isRecordingActions = false
let isRecordingVideo = false
let isSelecting = false

export const getInnerWindowId = () => innerWindowId
export const getIsRecordingActions = () => isRecordingActions
export const getIsRecordingVideo = () => isRecordingVideo
export const getIsSelecting = () => isSelecting

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

function pageApi(path, body = {}) {
  return api('POST', path, { ...body, window: innerWindowId })
}

function chromeApi(path, body = {}) {
  return api('POST', path, { ...body, window: outerWindowId })
}

async function copyToClipboard(text, message) {
  try {
    await navigator.clipboard.writeText(text)
    showNotification(message || 'Copied to clipboard')
  } catch {
    showNotification('Clipboard not available')
  }
}

/** Find a path in a response — handlers are inconsistent about nesting */
function findPath(resp) {
  return resp?.path || resp?.data?.path || null
}

// ==========================================
// Actions
// ==========================================

export async function handleAction(action) {
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
        // Use consolidated /select endpoint so the window ID is respected
        await api('POST', '/select', { action: 'cancel', window: innerWindowId })
        isSelecting = false
        showNotification('Selection cancelled')
      } else {
        await api('POST', '/select', { action: 'start', window: innerWindowId })
        isSelecting = true
        showNotification('Click or drag to select elements')
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
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1000))
    if (!isSelecting) return
    try {
      const data = await api('POST', '/select', { action: 'status', window: innerWindowId })
      const status = data?.data?.status || data?.status
      if (status === 'completed') {
        isSelecting = false
        const result = await api('POST', '/select', { action: 'result', window: innerWindowId })
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
// Status polling
// ==========================================

function updateIndicators(windows) {
  const inner = windows.find(w => w.id !== 'hj-chrome' && w.focused) ||
                windows.find(w => w.id !== 'hj-chrome')
  innerWindowId = inner?.id || null

  if (inner) {
    if (inner.recording) isRecordingActions = true
  }
}

async function poll() {
  try {
    const resp = await fetch(`${serverUrl()}/status`)
    if (resp.ok) {
      const data = await resp.json()
      updateIndicators(data.windows || [])
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
