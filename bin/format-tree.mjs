/**
 * Text formatter for Haltija tree output
 * 
 * Converts DomTreeNode JSON into scannable text:
 *   1: body
 *     2: h1 "Sign Up"
 *     3: div.form-row
 *       4: label "Email:"
 *       5: input#email-input type=email placeholder="you@example.com" [interactive]
 */

const MAX_TEXT_LEN = 80

/**
 * Format a DomTreeNode tree as human-readable text
 * @param {object} node - DomTreeNode from server response
 * @param {number} indent - current indentation level
 * @returns {string} formatted text output
 */
export function formatTree(node, indent = 0) {
  if (!node) return ''

  // Skip the haltija widget entirely
  if (node.tag === 'haltija-dev') return ''

  const lines = []
  const prefix = ' '.repeat(indent)

  // Build the line: "N: tag#id.classes attrs [flags] "text""
  const parts = []

  // Ref number (bare number, no prefix)
  const refNum = node.ref || '?'
  parts.push(`${refNum}:`)

  // Tag with id and classes
  let tagPart = node.tag || '?'
  if (node.id) tagPart += `#${node.id}`
  if (node.classes && node.classes.length) {
    tagPart += '.' + node.classes.join('.')
  }
  parts.push(tagPart)

  // Attributes (key=value, quote values with spaces)
  if (node.attrs) {
    for (const [key, val] of Object.entries(node.attrs)) {
      if (val === '' || val === 'true') {
        parts.push(key)
      } else if (/\s/.test(val) || val.length > 40) {
        parts.push(`${key}="${truncate(val, 40)}"`)
      } else {
        parts.push(`${key}=${val}`)
      }
    }
  }

  // Form value (for inputs)
  if (node.value !== undefined && node.value !== '') {
    parts.push(`value="${truncate(node.value, 30)}"`)
  }
  if (node.checked !== undefined) {
    parts.push(node.checked ? '[checked]' : '[unchecked]')
  }

  // Flags in brackets
  const flags = formatFlags(node.flags)
  if (flags) parts.push(flags)

  // Text content (quoted, at end)
  if (node.text) {
    parts.push(`"${truncate(node.text, MAX_TEXT_LEN)}"`)
  }

  // Truncation indicator
  if (node.truncated && node.childCount) {
    parts.push(`(${node.childCount} children)`)
  }

  lines.push(prefix + parts.join(' '))

  // Recurse children
  if (node.children) {
    for (const child of node.children) {
      const childText = formatTree(child, indent + 2)
      if (childText) lines.push(childText)
    }
  }

  // Shadow children (only if present — usually from --shadow flag)
  if (node.shadowChildren) {
    for (const child of node.shadowChildren) {
      // Skip haltija widget shadow DOM
      if (child.classes && child.classes.includes('widget')) continue
      const childText = formatTree(child, indent + 2)
      if (childText) lines.push(childText)
    }
  }

  return lines.join('\n')
}

/** Format flags into bracket notation */
function formatFlags(flags) {
  if (!flags) return ''
  const parts = []

  if (flags.interactive) parts.push('interactive')
  if (flags.disabled) parts.push('disabled')
  if (flags.required) parts.push('required')
  if (flags.readOnly) parts.push('readonly')
  if (flags.focused) parts.push('focused')
  if (flags.hidden && flags.hiddenReason) {
    parts.push(`hidden:${flags.hiddenReason}`)
  } else if (flags.hidden) {
    parts.push('hidden')
  }
  if (flags.offScreen && !flags.hidden) parts.push('offscreen')
  if (flags.customElement) parts.push('custom')
  if (flags.hasAria) parts.push('aria')

  return parts.length ? `[${parts.join(', ')}]` : ''
}

/** Truncate a string with ellipsis */
function truncate(str, max) {
  if (!str) return ''
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}
