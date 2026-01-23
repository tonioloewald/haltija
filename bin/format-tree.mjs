/**
 * Text formatter for Haltija tree output
 * 
 * Push/pop paren encoding: hierarchy for agents, indentation for humans.
 *
 *   1 body
 *   ( 2 div.header
 *     3 button#submit "Submit" interactive
 *     4 input#email interactive value="user@example.com"
 *   )
 *   ( 5 div.content
 *     ( 6 ul.nav
 *       7 li "Home"
 *       8 li "About"
 *     )
 *     9 p "Welcome back"
 *   )
 *   ---
 *   hj tree --json
 */

const MAX_TEXT_LEN = 80

/**
 * Format a DomTreeNode tree as agent+human readable text
 * @param {object} node - DomTreeNode from server response
 * @param {number} indent - current indentation level (internal)
 * @returns {string} formatted text output with footer
 */
export function formatTree(node, indent = 0) {
  if (!node) return ''

  const lines = []
  formatNode(node, indent, lines)

  // Footer: JSON escape hatch
  lines.push('---')
  lines.push('hj tree --json')

  return lines.join('\n')
}

/**
 * Recursively format a node and its children
 */
function formatNode(node, indent, lines) {
  if (!node) return

  // Skip the haltija widget entirely
  if (node.tag === 'haltija-dev') return

  const prefix = ' '.repeat(indent)
  const hasChildren = (node.children && node.children.length > 0) ||
    (node.shadowChildren && node.shadowChildren.length > 0)

  const line = buildLine(node)

  if (hasChildren) {
    // Push: ( before children
    lines.push(`${prefix}( ${line}`)

    // Recurse children
    if (node.children) {
      for (const child of node.children) {
        formatNode(child, indent + 2, lines)
      }
    }
    if (node.shadowChildren) {
      for (const child of node.shadowChildren) {
        if (child.classes && child.classes.includes('widget')) continue
        formatNode(child, indent + 2, lines)
      }
    }

    // Pop: )
    lines.push(`${prefix})`)
  } else {
    // Leaf node: just the line
    lines.push(`${prefix}${line}`)
  }
}

/**
 * Build a single node's description line (without prefix/indent)
 */
function buildLine(node) {
  const parts = []

  // Ref number (bare, no colon)
  parts.push(node.ref || '?')

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
    parts.push(node.checked ? 'checked' : 'unchecked')
  }

  // Flags (bare words, no brackets)
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

  return parts.join(' ')
}

/** Format flags as bare space-separated words */
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

  return parts.join(' ')
}

/** Truncate a string with ellipsis */
function truncate(str, max) {
  if (!str) return ''
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}
