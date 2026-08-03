/**
 * Settings modal and new tab dialog.
 */

import { settings, saveSettings as persistSettings, el } from './state.js'
import { SHARED_PUBLIC_URL } from './isolation.js'
import { checkHaltija } from './status.js'

let pendingNewTabResolve = null

export function showNewTabDialog(url) {
  return new Promise((resolve) => {
    pendingNewTabResolve = resolve
    el.newTabUrlEl.textContent = url
    el.newTabDialog.classList.remove('hidden')
  })
}

export function hideNewTabDialog(allowed) {
  el.newTabDialog.classList.add('hidden')
  if (pendingNewTabResolve) {
    pendingNewTabResolve(allowed)
    pendingNewTabResolve = null
  }
}

export function showSettings() {
  document.querySelector(`input[name="server-mode"][value="${settings.serverMode}"]`).checked = true
  document.getElementById('server-url').value = settings.serverUrl
  document.getElementById('confirm-new-tabs').checked = settings.confirmNewTabs
  el.settingsModal.classList.remove('hidden')
}

export function hideSettings() {
  el.settingsModal.classList.add('hidden')
}

export function applySettings() {
  settings.serverMode = document.querySelector('input[name="server-mode"]:checked').value
  const typed = document.getElementById('server-url').value.trim()
  settings.serverUrl = typed || SHARED_PUBLIC_URL
  // Saving the form is the ONLY thing that marks the URL as a deliberate user choice. Clearing the
  // field un-marks it, so "reset to whatever this instance actually runs" stays reachable — without
  // that, a URL typed once could never be handed back to the app's own resolution.
  settings.serverUrlIsUserSet = typed.length > 0
  settings.confirmNewTabs = document.getElementById('confirm-new-tabs').checked
  persistSettings()
  hideSettings()
  checkHaltija()
}

export function initSettingsListeners() {
  el.settingsBtn.addEventListener('click', showSettings)
  el.closeSettingsBtn.addEventListener('click', hideSettings)
  el.saveSettingsBtn.addEventListener('click', applySettings)
  el.settingsModal.addEventListener('click', (e) => {
    if (e.target === el.settingsModal) hideSettings()
  })
  el.allowNewTabBtn.addEventListener('click', () => hideNewTabDialog(true))
  el.denyNewTabBtn.addEventListener('click', () => hideNewTabDialog(false))
}
