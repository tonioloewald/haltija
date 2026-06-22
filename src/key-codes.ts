/**
 * Map a key or typed character to a KeyboardEvent.code value.
 *
 * Used by the browser component's realistic typing and key-press simulation.
 * Handles both named key presses (Enter, ArrowUp, F5, …) and typed single
 * characters including punctuation (".", ",", "/", …) so dispatched
 * KeyboardEvents carry correct `code` values.
 *
 * Pure and dependency-free so it can be unit-tested under Bun (the component
 * itself is browser-only). See key-codes.test.ts.
 */
export function keyToCode(key: string): string {
  const specialKeys: Record<string, string> = {
    // Named keys
    Enter: 'Enter',
    Escape: 'Escape',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ' ': 'Space',
    Space: 'Space',
    // Punctuation characters (for per-character typing)
    '.': 'Period',
    ',': 'Comma',
    '/': 'Slash',
    ';': 'Semicolon',
    "'": 'Quote',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
    '-': 'Minus',
    '=': 'Equal',
    '`': 'Backquote',
  }

  if (specialKeys[key]) return specialKeys[key]

  // Function keys (F1–F12)
  if (/^F\d{1,2}$/.test(key)) return key

  // Letters
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`

  // Digits
  if (/^[0-9]$/.test(key)) return `Digit${key}`

  // Default: use the key as its own code
  return key
}
