/**
 * Custom pseudo-selector support: :text(), :text-is(), :has-text()
 * 
 * Plain string (case-insensitive by default):
 *   :text(str)              - element's visible text CONTAINS str (case-insensitive)
 *   :text-is(str)           - element's visible text IS exactly str (case-insensitive)  
 *   :has-text(str)          - alias for :text() (Playwright compat)
 *   :text("str") / :text('str') - quoted strings work identically
 *
 * Regex mode (case-sensitive by default, like real regex):
 *   :text(/pattern/)        - element's text matches regex (case-sensitive)
 *   :text(/pattern/i)       - element's text matches regex (case-insensitive)
 *   :text-is(/^Dashboard$/i) - regex with :text-is (regex overrides exact-match semantics)
 *
 * Examples:
 *   button:text(sign in)       - button containing "sign in" (case-insensitive)
 *   button:text(/Sign in/)     - button containing "Sign in" (case-sensitive)
 *   button:text(/sign in/i)    - button containing "sign in" (case-insensitive, explicit)
 *   h1:text(/^Dashboard$/)     - h1 whose exact text is "Dashboard" (case-sensitive)
 *   a:text(/docs|blog/i)       - link containing "docs" or "blog"
 */

export const TEXT_PSEUDO_RE = /:(?:text-is|has-text|text)\(/

export interface ParsedTextSelector {
  baseSelector: string
  pseudoType: 'text' | 'text-is' | 'has-text'
  // Exactly one of these is set:
  searchText?: string   // Plain text match (lowercased)
  searchRegex?: RegExp  // Regex match
}

export function parseTextSelector(selector: string): ParsedTextSelector | null {
  const match = selector.match(/:(?:text-is|has-text|text)\(/)
  if (!match || match.index === undefined) return null

  const pseudoStart = match.index
  const pseudoName = match[0].slice(1, -1) as 'text' | 'has-text' | 'text-is'

  // Find matching closing paren (handle nested parens)
  let depth = 1
  let i = pseudoStart + match[0].length
  while (i < selector.length && depth > 0) {
    if (selector[i] === '(') depth++
    else if (selector[i] === ')') depth--
    i++
  }

  if (depth !== 0) return null

  const rawArg = selector.slice(pseudoStart + match[0].length, i - 1).trim()
  const baseSelector = (selector.slice(0, pseudoStart) + selector.slice(i)).trim() || '*'

  // Check for regex: /pattern/ or /pattern/flags
  const regexMatch = rawArg.match(/^\/(.+)\/([gimsuy]*)$/)
  if (regexMatch) {
    try {
      return {
        baseSelector,
        pseudoType: pseudoName,
        searchRegex: new RegExp(regexMatch[1], regexMatch[2]),
      }
    } catch {
      // Invalid regex, fall through to plain text
    }
  }

  // Plain text: strip optional quotes
  const unquoted = (rawArg.startsWith('"') && rawArg.endsWith('"')) ||
                   (rawArg.startsWith("'") && rawArg.endsWith("'"))
    ? rawArg.slice(1, -1)
    : rawArg

  return {
    baseSelector,
    pseudoType: pseudoName,
    searchText: unquoted.toLowerCase(),
  }
}

export function textMatches(elementText: string, parsed: ParsedTextSelector): boolean {
  const text = elementText.trim()

  if (parsed.searchRegex) {
    // Regex mode: regex controls matching semantics entirely
    return parsed.searchRegex.test(text)
  }

  // Plain text mode: case-insensitive
  const lower = text.toLowerCase()
  if (parsed.pseudoType === 'text-is') {
    return lower === parsed.searchText
  }
  // :text() and :has-text() do substring match
  return lower.includes(parsed.searchText!)
}
