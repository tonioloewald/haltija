/**
 * Server status checking and nav button updates.
 */

import { el, getServerUrl } from './state.js'

export async function checkHaltija() {
  try {
    const response = await fetch(`${getServerUrl()}/status`)
    if (response.ok) {
      el.statusDot.className = 'status-dot connected'
      el.statusDot.title = 'Haltija: Connected'
    } else {
      throw new Error('Not OK')
    }
  } catch {
    el.statusDot.className = 'status-dot disconnected'
    el.statusDot.title = 'Haltija: Disconnected - Start server with: bunx haltija'
  }
}

export function updateNavButtons() {
  // Import dynamically to avoid circular dependency
  const { getActiveWebview } = window._tabs
  const webview = getActiveWebview()
  if (webview) {
    try {
      el.backButton.disabled = !webview.canGoBack()
      el.forwardButton.disabled = !webview.canGoForward()
    } catch (e) {
      el.backButton.disabled = true
      el.forwardButton.disabled = true
    }
  } else {
    el.backButton.disabled = true
    el.forwardButton.disabled = true
  }
}
