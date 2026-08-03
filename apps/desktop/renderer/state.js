/**
 * Shared renderer state — tab list, settings, DOM element references.
 * All modules import from here instead of accessing globals.
 */

import { resolveServerUrl, SHARED_PUBLIC_URL } from './isolation.js'

/** What main injected for this instance, or null when it didn't (see src/desktop-isolation.ts). */
const injectedServerUrl = () =>
  (typeof window !== 'undefined' && window.haltija?.serverUrl) || null
const isPrivate = () => !!(typeof window !== 'undefined' && window.haltija?.isPrivate)

// Settings
const DEFAULT_SETTINGS = {
  serverMode: 'builtin',
  // This app instance's own server, injected by main after port resolution. Hardcoding 8700 made a
  // --private app open its first tab against the SHARED server.
  serverUrl: injectedServerUrl() || SHARED_PUBLIC_URL,
  confirmNewTabs: false,
  // Set only when the user edits the field. Distinguishes "the user chose this address" from "this
  // is a snapshot of whatever the last run happened to use" — without it, the code could not tell
  // a deliberate preference from a stale default, so it discarded both.
  serverUrlIsUserSet: false,
}

export let settings = { ...DEFAULT_SETTINGS }

export function loadSettings() {
  try {
    const saved = localStorage.getItem('haltija-settings')
    if (saved) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }
      // Priority: private isolation > a URL the user deliberately typed > this instance's own
      // address > a stale persisted one. The previous version collapsed to "injected always wins",
      // and since `injected` had a `|| 8700` fallback baked in, it was *always* set — so the user's
      // saved Server URL was silently reverted on every launch. Rules live in
      // src/desktop-isolation.ts and are unit-tested without launching Electron.
      settings.serverUrl = resolveServerUrl({
        injected: injectedServerUrl(),
        isPrivate: isPrivate(),
        persisted: settings.serverUrl,
        persistedIsUserSet: settings.serverUrlIsUserSet,
      })
    }
  } catch (e) {
    console.error('[Haltija Desktop] Failed to load settings:', e)
  }
}

export function saveSettings() {
  try {
    localStorage.setItem('haltija-settings', JSON.stringify(settings))
  } catch (e) {
    console.error('[Haltija Desktop] Failed to save settings:', e)
  }
}

export function getServerUrl() {
  return settings.serverUrl || DEFAULT_SETTINGS.serverUrl
}

// Tab state
export const tabs = []
export let activeTabId = null
export let tabIdCounter = 0
export let lastCwd = localStorage.getItem('haltija-lastCwd') || null

export function setActiveTabId(id) { activeTabId = id }
export function nextTabId() { return `tab-${++tabIdCounter}` }
export function setLastCwd(cwd) {
  lastCwd = cwd
  localStorage.setItem('haltija-lastCwd', cwd)
}

// DOM element references (initialized in renderer.js after DOM is ready)
export const el = {
  tabBar: null,
  newTabButton: null,
  toolbar: null,
  urlInput: null,
  goButton: null,
  backButton: null,
  forwardButton: null,
  refreshButton: null,
  webviewContainer: null,
  statusDot: null,
  settingsBtn: null,
  settingsModal: null,
  closeSettingsBtn: null,
  saveSettingsBtn: null,
  newTabDialog: null,
  newTabUrlEl: null,
  allowNewTabBtn: null,
  denyNewTabBtn: null,
  agentStatusBar: null,
  agentStatusItems: null,
  agentSelect: null,
}

export function initElements() {
  el.tabBar = document.getElementById('tabs')
  el.newTabButton = document.getElementById('new-tab')
  el.toolbar = document.getElementById('toolbar')
  el.urlInput = document.getElementById('url-input')
  el.goButton = document.getElementById('go')
  el.backButton = document.getElementById('back')
  el.forwardButton = document.getElementById('forward')
  el.refreshButton = document.getElementById('refresh')
  el.webviewContainer = document.getElementById('webview-container')
  el.statusDot = document.getElementById('haltija-status')
  el.settingsBtn = document.getElementById('settings-btn')
  el.settingsModal = document.getElementById('settings-modal')
  el.closeSettingsBtn = document.getElementById('close-settings')
  el.saveSettingsBtn = document.getElementById('save-settings')
  el.newTabDialog = document.getElementById('new-tab-dialog')
  el.newTabUrlEl = document.getElementById('new-tab-url')
  el.allowNewTabBtn = document.getElementById('allow-new-tab')
  el.denyNewTabBtn = document.getElementById('deny-new-tab')
  el.agentStatusBar = document.getElementById('agent-status-bar')
  el.agentStatusItems = document.getElementById('agent-status-items')
  el.agentSelect = document.getElementById('agent-select')
}
