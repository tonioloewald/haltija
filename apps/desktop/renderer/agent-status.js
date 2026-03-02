/**
 * Agent status bar — WebSocket connection, status rendering, memos panel.
 */

import { tabs, el, getServerUrl } from './state.js'
import { escapeHtml, createFloatPanel } from './ui-utils.js'

let agentStatusWs = null
let connectedShells = new Map()

// Exposed so tabs.js can check it
window._currentStatusLine = ''

function connectAgentStatusWs() {
  if (agentStatusWs && agentStatusWs.readyState === WebSocket.OPEN) return

  const wsUrl = `ws://localhost:${window.haltija?.port || 8700}/ws/terminal`
  agentStatusWs = new WebSocket(wsUrl)

  agentStatusWs.onopen = () => {
    console.log('[Agent Status] Connected to terminal WebSocket')
  }

  agentStatusWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      handleAgentStatusMessage(msg)
    } catch (err) { /* Ignore non-JSON */ }
  }

  agentStatusWs.onclose = () => {
    console.log('[Agent Status] WebSocket closed, reconnecting in 3s...')
    setTimeout(connectAgentStatusWs, 3000)
  }

  agentStatusWs.onerror = () => {}
}

function handleAgentStatusMessage(msg) {
  switch (msg.type) {
    case 'status':
      window._currentStatusLine = msg.line || ''
      renderAgentStatusBar(window._currentStatusLine)
      break
    case 'shell-joined':
      connectedShells.set(msg.shellId, { name: msg.name, isAgent: msg.name?.includes('agent') })
      updateAgentSelector()
      break
    case 'shell-left':
      connectedShells.delete(msg.shellId)
      updateAgentSelector()
      break
    case 'shell-renamed':
      if (connectedShells.has(msg.shellId)) {
        connectedShells.get(msg.shellId).name = msg.name
        updateAgentSelector()
      }
      break
  }
}

function renderAgentStatusBar(line) {
  if (!line) {
    el.agentStatusBar.classList.add('hidden')
    return
  }

  // Only show for terminal tabs
  const { getActiveTab } = window._tabs
  const activeTab = getActiveTab()
  if (activeTab && !activeTab.isTerminal) {
    el.agentStatusBar.classList.add('hidden')
    return
  }

  el.agentStatusBar.classList.remove('hidden')

  const segments = line.split(' | ')
  let html = ''

  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    let label = ''
    let value = trimmed

    if (trimmed.startsWith('hj ')) {
      const rest = trimmed.substring(3)
      const words = rest.split(' ')
      if (words.length > 1 && /^(memos|board|tasks)$/.test(words[0])) {
        label = words[0]
        value = words.slice(1).join(' ')
      } else {
        label = 'hj'
        value = rest
      }
    }

    let cls = 'status-segment'
    if (/fail|error|no browser/i.test(trimmed)) cls += ' error'
    else if (/warn|blocked|pending/i.test(trimmed)) cls += ' alert'
    else if (/ready|connected|pass|active/i.test(trimmed)) cls += ' ok'

    html += `<div class="${cls}" data-segment="${escapeHtml(label || 'status')}">`
    if (label) html += `<span class="label">${escapeHtml(label)}:</span>`
    html += `<span class="value">${escapeHtml(value)}</span>`
    html += `</div>`
  }

  el.agentStatusItems.innerHTML = html

  el.agentStatusItems.querySelectorAll('.status-segment').forEach(seg => {
    seg.addEventListener('click', (e) => {
      handleStatusSegmentClick(seg.dataset.segment, e.target)
    })
  })
}

function handleStatusSegmentClick(segmentName, target) {
  if (segmentName === 'memos') showMemosPanel(target)
}

async function showMemosPanel(target) {
  const content = document.createElement('div')
  content.className = 'memos-panel-content'
  content.innerHTML = '<div class="loading">Loading memos...</div>'

  const panel = createFloatPanel({ target, content, title: 'Memos', position: 's' })
  if (!panel) return

  try {
    const resp = await fetch(`${getServerUrl()}/terminal/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'tasks', command: 'board' })
    })
    const result = await resp.json()

    if (result.boardJson?.items) {
      renderMemosPanel(content, result.boardJson.items)
    } else {
      content.innerHTML = '<div class="empty">No memos</div>'
    }
  } catch (err) {
    content.innerHTML = `<div class="error">Failed to load memos: ${escapeHtml(err.message)}</div>`
  }
}

function renderMemosPanel(container, items) {
  const columns = ['in_progress', 'blocked', 'queued', 'review']
  const columnNames = {
    in_progress: '\uD83D\uDD04 In Progress',
    blocked: '\uD83D\uDEA7 Blocked',
    queued: '\uD83D\uDCCB Queued',
    review: '\uD83D\uDC40 Review'
  }

  let html = '<div class="memos-list">'

  for (const col of columns) {
    const colItems = items.filter(i => i.column === col)
    if (colItems.length === 0) continue

    html += `<div class="memos-column">
      <div class="memos-column-header">${columnNames[col]} (${colItems.length})</div>`

    for (const item of colItems) {
      html += `<div class="memo-item" data-id="${item.id}">
        <span class="memo-title">${escapeHtml(item.title)}</span>
      </div>`
    }

    html += '</div>'
  }

  if (html === '<div class="memos-list">') {
    html += '<div class="empty">No active memos</div>'
  }

  html += '</div>'
  container.innerHTML = html
}

function updateAgentSelector() {
  const agents = Array.from(connectedShells.entries())
    .filter(([_, info]) => info.isAgent)

  if (agents.length === 0) {
    el.agentSelect.innerHTML = '<option value="">No agents</option>'
  } else {
    el.agentSelect.innerHTML = agents.map(([id, info]) =>
      `<option value="${id}">${escapeHtml(info.name || id)}</option>`
    ).join('')
  }
}

export async function initAgentStatusBar() {
  try {
    const response = await fetch(`${getServerUrl()}/terminal/status`)
    if (response.ok) {
      const line = await response.text()
      renderAgentStatusBar(line)
    }
  } catch (err) {
    console.log('[Agent Status] Could not fetch initial status:', err.message)
  }

  connectAgentStatusWs()
}
