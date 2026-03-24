/**
 * CDP Network Monitor — Captures network traffic via Chrome DevTools Protocol.
 *
 * Uses Electron's webContents.debugger API to attach to webviews and
 * capture request/response data. Output is token-optimized for AI agents.
 *
 * Usage from main process:
 *   const { attachNetwork, detachNetwork, getNetworkLog, getNetworkStats, clearNetwork } = require('./cdp-network.js')
 *   attachNetwork(webContents)       // Start monitoring
 *   getNetworkLog(webContents.id)    // Get buffered entries
 */

// Per-webContents state
const monitors = new Map()

// Default noise patterns — URLs matching these are filtered in standard/minimal presets
const NOISE_PATTERNS = [
  /google-analytics\.com/,
  /googletagmanager\.com/,
  /facebook\.net\/tr/,
  /doubleclick\.net/,
  /hotjar\.com/,
  /sentry\.io\/api/,
  /clarity\.ms/,
  /segment\.io/,
  /mixpanel\.com/,
  /amplitude\.com/,
  /intercom\.io/,
  /fullstory\.com/,
  /newrelic\.com/,
  /datadoghq\.com/,
]

// Resource types considered "noise" for minimal preset
const ASSET_TYPES = new Set(['Image', 'Font', 'Stylesheet', 'Media'])

const PRESETS = {
  errors: { showAssets: false, showNoise: false, errorsOnly: true },
  minimal: { showAssets: false, showNoise: false, errorsOnly: false },
  standard: { showAssets: true, showNoise: false, errorsOnly: false },
  verbose: { showAssets: true, showNoise: true, errorsOnly: false },
}

/**
 * Attach CDP Network monitoring to a webContents.
 * @param {Electron.WebContents} wc
 * @param {object} opts
 * @param {string} opts.preset - 'errors' | 'minimal' | 'standard' | 'verbose'
 * @param {number} opts.maxBuffer - Max entries to keep (default 200)
 * @param {string[]} opts.includePatterns - URL patterns to include (overrides noise filter)
 * @param {string[]} opts.excludePatterns - Additional URL patterns to exclude
 */
function attachNetwork(wc, opts = {}) {
  const wcId = wc.id
  if (monitors.has(wcId)) {
    // Already attached — update options
    const mon = monitors.get(wcId)
    mon.preset = opts.preset || mon.preset
    mon.maxBuffer = opts.maxBuffer || mon.maxBuffer
    return { success: true, alreadyAttached: true }
  }

  const monitor = {
    wc,
    preset: opts.preset || 'standard',
    maxBuffer: opts.maxBuffer || 200,
    includePatterns: (opts.includePatterns || []).map(p => new RegExp(p)),
    excludePatterns: (opts.excludePatterns || []).map(p => new RegExp(p)),
    entries: [],          // circular buffer of NetworkEntry
    pending: new Map(),   // requestId → partial entry (waiting for response)
    attached: false,
  }

  try {
    wc.debugger.attach('1.3')
    monitor.attached = true
  } catch (err) {
    // Debugger may already be attached by DevTools
    if (err.message?.includes('Already attached')) {
      monitor.attached = true
    } else {
      return { success: false, error: `CDP attach failed: ${err.message}` }
    }
  }

  // Enable Network domain
  wc.debugger.sendCommand('Network.enable', {}).catch(err => {
    console.error(`[CDP Network] Network.enable failed for wc ${wcId}:`, err.message)
  })

  // Listen for CDP events
  const handler = (event, method, params) => {
    handleCdpEvent(monitor, method, params)
  }
  wc.debugger.on('message', handler)
  monitor._handler = handler

  // Clean up when webContents is destroyed
  const destroyHandler = () => {
    detachNetwork(wc)
  }
  wc.once('destroyed', destroyHandler)
  monitor._destroyHandler = destroyHandler

  monitors.set(wcId, monitor)
  return { success: true }
}

/**
 * Detach CDP Network monitoring from a webContents.
 */
function detachNetwork(wc) {
  const wcId = wc.id
  const monitor = monitors.get(wcId)
  if (!monitor) return

  try {
    if (monitor._handler) {
      wc.debugger.removeListener('message', monitor._handler)
    }
    if (monitor.attached) {
      wc.debugger.sendCommand('Network.disable', {}).catch(() => {})
      wc.debugger.detach()
    }
  } catch {
    // Already detached or destroyed
  }

  monitors.delete(wcId)
}

/**
 * Get buffered network entries for a webContents, filtered by preset.
 * @param {number} wcId - webContents.id
 * @param {object} opts
 * @param {string} opts.preset - Override the monitor's preset
 * @param {number} opts.since - Only entries after this timestamp
 * @param {number} opts.limit - Max entries to return
 * @returns {{ entries: NetworkEntry[], summary: string }}
 */
function getNetworkLog(wcId, opts = {}) {
  const monitor = monitors.get(wcId)
  if (!monitor) return { entries: [], summary: 'not watching' }

  const preset = PRESETS[opts.preset || monitor.preset] || PRESETS.standard
  const since = opts.since || 0
  const limit = opts.limit || 100

  let filtered = monitor.entries.filter(e => e.ts >= since)

  // Apply preset filtering
  if (preset.errorsOnly) {
    filtered = filtered.filter(e => e.s >= 400 || e.s === -1 || e.err)
  }
  if (!preset.showAssets) {
    filtered = filtered.filter(e => !ASSET_TYPES.has(e.type))
  }
  if (!preset.showNoise) {
    filtered = filtered.filter(e => !isNoise(e.url, monitor))
  }

  // Apply custom include/exclude
  if (monitor.includePatterns.length > 0) {
    // Include patterns override noise filter
    filtered = monitor.entries.filter(e =>
      e.ts >= since && monitor.includePatterns.some(p => p.test(e.url))
    )
  }
  if (monitor.excludePatterns.length > 0) {
    filtered = filtered.filter(e => !monitor.excludePatterns.some(p => p.test(e.url)))
  }

  // Most recent first, limited
  filtered = filtered.slice(-limit)

  const summary = buildSummary(monitor.entries.filter(e => e.ts >= since))

  return { entries: filtered, summary }
}

/**
 * Get summary statistics.
 */
function getNetworkStats(wcId) {
  const monitor = monitors.get(wcId)
  if (!monitor) return { watching: false }

  const entries = monitor.entries
  const total = entries.length
  const failed = entries.filter(e => e.s >= 400 || e.s === -1 || e.err).length
  const pending = monitor.pending.size
  const totalBytes = entries.reduce((sum, e) => sum + (e.bytes || 0), 0)
  const avgTime = total > 0 ? Math.round(entries.reduce((sum, e) => sum + (e.t || 0), 0) / total) : 0

  return {
    watching: true,
    preset: monitor.preset,
    total,
    failed,
    pending,
    totalBytes,
    avgTime,
    summary: buildSummary(entries),
  }
}

/**
 * Clear the network buffer.
 */
function clearNetwork(wcId) {
  const monitor = monitors.get(wcId)
  if (!monitor) return
  monitor.entries = []
  monitor.pending.clear()
}

/**
 * Check if a webContents is being monitored.
 */
function isMonitoring(wcId) {
  return monitors.has(wcId)
}

// ============================================
// Internal: CDP event handling
// ============================================

function handleCdpEvent(monitor, method, params) {
  switch (method) {
    case 'Network.requestWillBeSent':
      handleRequestStart(monitor, params)
      break
    case 'Network.responseReceived':
      handleResponse(monitor, params)
      break
    case 'Network.loadingFinished':
      handleLoadingFinished(monitor, params)
      break
    case 'Network.loadingFailed':
      handleLoadingFailed(monitor, params)
      break
  }
}

function handleRequestStart(monitor, params) {
  const { requestId, request, redirectResponse, type, timestamp } = params

  // If this is a redirect, update the existing entry
  if (redirectResponse && monitor.pending.has(requestId)) {
    const existing = monitor.pending.get(requestId)
    existing.redirects = (existing.redirects || 0) + 1
    existing.url = trimUrl(request.url)
    existing.m = request.method
    return
  }

  const entry = {
    id: requestId.slice(0, 8),
    m: request.method,
    url: trimUrl(request.url),
    fullUrl: request.url,
    s: 0,         // pending
    t: 0,
    sz: '',
    bytes: 0,
    type: type || 'Other',
    ts: Math.round(timestamp * 1000),
    _startTime: timestamp,
  }

  monitor.pending.set(requestId, entry)
}

function handleResponse(monitor, params) {
  const { requestId, response } = params
  const entry = monitor.pending.get(requestId)
  if (!entry) return

  entry.s = response.status
  entry.mimeType = response.mimeType

  // Detect CORS errors
  if (response.status === 0 && response.headers?.['access-control-allow-origin'] === undefined) {
    entry.cors = true
    entry.err = 'CORS'
  }
}

function handleLoadingFinished(monitor, params) {
  const { requestId, encodedDataLength, timestamp } = params
  const entry = monitor.pending.get(requestId)
  if (!entry) return

  entry.bytes = encodedDataLength || 0
  entry.sz = humanSize(entry.bytes)
  entry.t = Math.round((timestamp - entry._startTime) * 1000)
  delete entry._startTime
  delete entry.fullUrl

  finishEntry(monitor, requestId, entry)
}

function handleLoadingFailed(monitor, params) {
  const { requestId, errorText, canceled, timestamp } = params
  const entry = monitor.pending.get(requestId)
  if (!entry) return

  entry.s = -1
  entry.err = canceled ? 'canceled' : (errorText || 'failed')
  entry.t = Math.round((timestamp - entry._startTime) * 1000)
  delete entry._startTime
  delete entry.fullUrl

  finishEntry(monitor, requestId, entry)
}

function finishEntry(monitor, requestId, entry) {
  monitor.pending.delete(requestId)
  monitor.entries.push(entry)

  // Trim buffer
  while (monitor.entries.length > monitor.maxBuffer) {
    monitor.entries.shift()
  }
}

// ============================================
// Internal: formatting helpers
// ============================================

function trimUrl(url) {
  try {
    const u = new URL(url)
    let path = u.pathname
    // Collapse long paths
    if (path.length > 60) {
      const parts = path.split('/')
      if (parts.length > 4) {
        path = '/' + parts[1] + '/.../' + parts[parts.length - 1]
      }
    }
    // Trim query
    let query = u.search
    if (query.length > 30) {
      query = query.slice(0, 27) + '...'
    }
    // Omit localhost origin
    const origin = (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
      ? '' : u.host
    return (origin ? origin : '') + path + query
  } catch {
    return url.length > 80 ? url.slice(0, 77) + '...' : url
  }
}

function humanSize(bytes) {
  if (bytes === 0) return '0B'
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace(/\.0$/, '') + 'K'
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + 'M'
}

function isNoise(url, monitor) {
  return NOISE_PATTERNS.some(p => p.test(url))
}

function buildSummary(entries) {
  const total = entries.length
  const failed = entries.filter(e => e.s >= 400 || e.s === -1 || e.err).length
  const totalBytes = entries.reduce((sum, e) => sum + (e.bytes || 0), 0)
  const avgTime = total > 0 ? Math.round(entries.reduce((sum, e) => sum + (e.t || 0), 0) / total) : 0
  const parts = [`${total} req`]
  if (failed > 0) parts.push(`${failed} failed`)
  parts.push(`${avgTime}ms avg`)
  parts.push(humanSize(totalBytes))
  return parts.join(', ')
}

module.exports = { attachNetwork, detachNetwork, getNetworkLog, getNetworkStats, clearNetwork, isMonitoring, humanSize }
