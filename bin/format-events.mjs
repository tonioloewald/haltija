/**
 * Text formatter for Haltija semantic events
 *
 * One line per event, chronological. Agent-scannable, human-readable.
 *
 *   1706000000000 input:typed input#email "user@example.com"
 *   1706000001200 interaction:click button#submit "Sign In"
 *   1706000002500 navigation:load /dashboard
 *   1706000003100 console:error "TypeError: Cannot read property 'map'"
 *   ---
 *   hj events --json --since=1706000000000
 */

/**
 * Format an events response as one-liner text
 * @param {object} response - Response from GET /events (has .events array)
 * @returns {string} formatted text output with footer
 */
export function formatEvents(response) {
  const events = response?.events || response
  if (!events || !Array.isArray(events) || events.length === 0) {
    return '(no events)\n---\nhj events --json'
  }

  const lines = events.map(ev => {
    const parts = []
    parts.push(String(ev.timestamp))
    parts.push(ev.type)
    const target = formatTarget(ev.target)
    if (target) parts.push(target)
    const summary = extractPayloadSummary(ev)
    if (summary) parts.push(summary)
    return parts.join(' ')
  })

  // Footer with JSON escape hatch using first event's timestamp
  const sinceTs = events[0].timestamp
  lines.push('---')
  lines.push(`hj events --json --since=${sinceTs}`)

  return lines.join('\n')
}

/**
 * Compact target: tag#id or tag.class or just tag
 */
function formatTarget(target) {
  if (!target) return ''
  let result = target.tag || ''
  if (target.id) {
    result += `#${target.id}`
  } else if (target.selector) {
    // Use selector if no simpler representation
    return target.selector
  }
  return result || ''
}

/**
 * Extract the most meaningful value from event payload
 */
function extractPayloadSummary(ev) {
  const { type, payload, target } = ev
  if (!payload && !target) return ''

  // Type-specific extraction
  if (type === 'input:typed') {
    return quote(payload?.text || payload?.finalValue || '')
  }

  if (type === 'interaction:click') {
    return quote(payload?.text || target?.text || '')
  }

  if (type === 'interaction:submit') {
    return payload?.formAction || payload?.formId || ''
  }

  if (type?.startsWith('navigation:')) {
    return payload?.to || payload?.url || ''
  }

  if (type?.startsWith('console:')) {
    return quote(truncate(payload?.message || '', 120))
  }

  if (type === 'scroll:stop') {
    return `${payload?.direction || ''} ${payload?.distance || 0}px`
  }

  if (type === 'hover:dwell') {
    return `${payload?.duration || 0}ms`
  }

  if (type === 'mutation:change') {
    const what = payload?.changeType || ''
    const el = payload?.element || ''
    return `${what} ${el}`.trim()
  }

  if (type === 'focus:focus' || type === 'focus:blur') {
    return target?.text || target?.selector || ''
  }

  // Default: first short string value in payload
  if (payload) {
    for (const val of Object.values(payload)) {
      if (typeof val === 'string' && val.length > 0 && val.length < 200) {
        return quote(truncate(val, 80))
      }
    }
  }

  return ''
}

function quote(s) {
  if (!s) return ''
  return `"${s}"`
}

function truncate(str, max) {
  if (!str || str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}
