/**
 * Shared renderer state — tab list, settings, DOM element references.
 * All modules import from here instead of accessing globals.
 */

// Settings
const DEFAULT_SETTINGS = {
  serverMode: 'builtin',
  serverUrl: 'http://localhost:8700',
  confirmNewTabs: false,
}

export let settings = { ...DEFAULT_SETTINGS }

export function loadSettings() {
  try {
    const saved = localStorage.getItem('haltija-settings')
    if (saved) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }
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
