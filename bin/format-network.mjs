/**
 * Format network log entries for terminal output.
 * Token-optimized: one line per request, errors highlighted.
 */

const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`

function statusColor(status) {
  if (status === -1) return red
  if (status >= 500) return red
  if (status >= 400) return yellow
  if (status >= 300) return dim
  if (status >= 200) return green
  return dim // pending (0)
}

/**
 * Format network entries as compact terminal output.
 * @param {object} data - Response from /network endpoint
 * @returns {string}
 */
export function formatNetwork(data) {
  if (!data || data.success === false) {
    return data?.error || 'Network monitoring not available'
  }

  const entries = data.entries || data.data?.entries || []
  const summary = data.summary || data.data?.summary || ''

  if (entries.length === 0) {
    if (summary) return dim(summary)
    return dim('No network entries captured. Run: hj network watch')
  }

  const lines = []

  // Errors first
  const errors = entries.filter(e => e.s >= 400 || e.s === -1 || e.err)
  const ok = entries.filter(e => e.s > 0 && e.s < 400 && !e.err)

  for (const e of errors) {
    lines.push(formatEntry(e))
  }
  if (errors.length > 0 && ok.length > 0) {
    lines.push('')
  }
  for (const e of ok) {
    lines.push(formatEntry(e))
  }

  if (summary) {
    lines.push('')
    lines.push(dim(summary))
  }

  return lines.join('\n')
}

function formatEntry(e) {
  const method = e.m.padEnd(4)
  const colorFn = statusColor(e.s)
  const status = e.s === 0 ? dim('...') : e.s === -1 ? red('ERR') : colorFn(String(e.s))
  const url = e.url || ''
  const time = e.t ? dim(`${e.t}ms`) : ''
  const size = e.sz ? dim(e.sz) : ''
  const err = e.err ? red(` (${e.err})`) : ''
  const redirects = e.redirects ? dim(` ${e.redirects}→`) : ''

  return `${method} ${status} ${url}${redirects}${err} ${time} ${size}`.trimEnd()
}

/**
 * Format network stats as compact summary.
 */
export function formatNetworkStats(data) {
  if (!data || data.success === false) {
    return data?.error || 'Network monitoring not available'
  }

  const stats = data.data || data
  if (!stats.watching) {
    return dim('Not watching. Run: hj network watch')
  }

  return stats.summary || `${stats.total} req, ${stats.failed} failed, ${stats.avgTime}ms avg`
}
