/**
 * Test Data Generators
 *
 * Produces deterministic, recognizable test data from a seed.
 * All output is clearly identifiable as test data for easy cleanup.
 *
 * Usage:
 *   const gen = createTestDataGenerator(seed?)
 *   gen.generate('EMAIL')           // "tessia.7f3a@haltija-test.example"
 *   gen.generate('EVIL.XSS')        // "<script>alert('xss')</script>"
 *   gen.generate('PERSON.FULL')     // "Tessia Haltija-7f3a"
 *
 * In test files via ${GEN.TYPE} template variables:
 *   { "action": "type", "selector": "#email", "text": "${GEN.EMAIL}" }
 */

// ============================================
// Seeded PRNG (xorshift32)
// ============================================

function xorshift32(state: number): [number, number] {
  let s = state | 0
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  return [s >>> 0, s >>> 0]
}

class SeededRandom {
  private state: number

  constructor(seed: number) {
    // Ensure non-zero initial state
    this.state = (seed === 0 ? 1 : seed) >>> 0
  }

  /** Returns float in [0, 1) */
  next(): number {
    const [value, newState] = xorshift32(this.state)
    this.state = newState
    return value / 0x100000000
  }

  /** Returns integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** Pick random element from array */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]
  }

  /** Generate hex string of given length */
  hex(len: number): string {
    let s = ''
    for (let i = 0; i < len; i++) {
      s += this.int(0, 15).toString(16)
    }
    return s
  }
}

// ============================================
// Name pools (clearly test-like)
// ============================================

const FIRST_NAMES = [
  'Tessia', 'Testopher', 'Testina', 'Qadir', 'Qaleen',
  'Checkov', 'Validia', 'Assertia', 'Debugson', 'Mockwell',
  'Fixturia', 'Stubson', 'Spectra', 'Suitewell', 'Runley',
  'Passandra', 'Failsworth', 'Edgeworth', 'Boundara', 'Flaxton',
] as const

const WORDS = [
  'quick', 'brown', 'fox', 'lazy', 'dog', 'test', 'data',
  'jumps', 'over', 'fence', 'under', 'bridge', 'through',
  'forest', 'around', 'mountain', 'beside', 'river', 'across',
  'valley', 'between', 'clouds', 'above', 'ocean', 'below',
] as const

const COMPANIES = [
  'Haltija Test Corp', 'QA Industries', 'Assertion Labs',
  'Testify Inc', 'Validate Co', 'Fixture Holdings',
  'Mock & Sons', 'Spec Systems', 'Check Group', 'Edge Corp',
] as const

const STREETS = [
  'Test Avenue', 'QA Boulevard', 'Assertion Lane', 'Validate Street',
  'Debug Drive', 'Fixture Road', 'Mock Court', 'Spec Way',
  'Check Circle', 'Edge Parkway', 'Suite Plaza', 'Run Terrace',
] as const

const CITIES = [
  'Testville', 'QA City', 'Assertonia', 'Validateburg',
  'Debugton', 'Mockford', 'Specburgh', 'Fixtureopolis',
] as const

// ============================================
// Evil / Adversarial test strings
// ============================================

const EVIL_XSS = [
  `<script>alert('xss')</script>`,
  `"><img src=x onerror=alert('xss')>`,
  `'><svg/onload=alert('xss')>`,
  `javascript:alert('xss')`,
  `<img src="x" onerror="alert(document.cookie)">`,
  `<div onmouseover="alert('xss')">hover me</div>`,
  `\x3cscript\x3ealert('xss')\x3c/script\x3e`,
  `<iframe src="javascript:alert('xss')"></iframe>`,
  `<body onload=alert('xss')>`,
  `<input onfocus=alert('xss') autofocus>`,
] as const

const EVIL_SQL = [
  `'; DROP TABLE users; --`,
  `1 OR 1=1`,
  `' UNION SELECT * FROM users --`,
  `1; UPDATE users SET role='admin' WHERE 1=1; --`,
  `' OR '1'='1`,
  `'; EXEC xp_cmdshell('whoami'); --`,
  `1' AND (SELECT COUNT(*) FROM users) > 0 --`,
  `admin'--`,
  `' OR 1=1 LIMIT 1 --`,
  `'; INSERT INTO log VALUES('pwned'); --`,
] as const

const EVIL_UNICODE = [
  '\u200B\u200C\u200D\uFEFF',                    // Zero-width chars + BOM
  '\u202E\u0052\u0065\u0076\u0065\u0072\u0073\u0065', // RTL override + "Reverse"
  '\u0410\u0412\u0421',                            // Cyrillic lookalikes of ABC
  'A\u0300\u0301\u0302\u0303\u0304',               // Combining diacritical overload
  '\uFFFD\uFFFD\uFFFD',                            // Replacement characters
  '\u2028\u2029',                                   // Line/paragraph separators
  '\u0000\u0001\u0002',                             // Null and control chars
  '\uD800',                                         // Lone surrogate (invalid)
  'a\u034F\u0061',                                  // Combining grapheme joiner
  '\u200F\u200E',                                   // RTL and LTR marks
] as const

const EVIL_EMOJI = [
  '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}', // Family ZWJ
  '\u{1F44B}\u{1F3FD}',                             // Waving hand medium skin
  '\u{1F1FA}\u{1F1F8}',                             // Flag: US (regional indicators)
  '\u{1F468}\u{200D}\u{1F4BB}',                     // Man technologist ZWJ
  '\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}',             // Rainbow flag
  '\u{1F9D1}\u{200D}\u{1F9D1}\u{200D}\u{1F9D2}',   // People holding hands + child
  '\u{1F600}\u{1F601}\u{1F602}\u{1F603}\u{1F604}',  // Emoji spam
  '\u{0023}\u{FE0F}\u{20E3}',                       // Keycap number sign
  '\u{1FAE0}',                                       // Melting face (newer emoji)
  '😀😁😂🤣😃😄😅😆😇🥰',                            // Dense emoji string
] as const

const EVIL_WHITESPACE = [
  ' \t\n\r\x0B\x0C',                               // All ASCII whitespace
  '\u00A0\u2000\u2001\u2002\u2003\u2004',           // NBSP + various em/en spaces
  '\u2005\u2006\u2007\u2008\u2009\u200A',           // More Unicode spaces
  '\u3000',                                          // Ideographic space
  '\r\n\r\n\n\r',                                    // Mixed line endings
  '\t\t\t\t\t\t\t\t',                               // Tabs
  ' \u00A0 \u00A0 ',                                 // Alternating space/NBSP
  '\u205F\u202F',                                    // Medium math space + narrow NBSP
  '   \u200B   ',                                    // Spaces with zero-width between
  '\u180E\u2060',                                    // Mongolian vowel separator + word joiner
] as const

const EVIL_NULL = [
  'null', 'undefined', 'NaN', 'Infinity', '-Infinity',
  'true', 'false', '0', '-0', '',
  'None', 'nil', 'NULL', 'void', '[object Object]',
] as const

const EVIL_PATH = [
  '../../etc/passwd',
  'C:\\windows\\system32\\config\\sam',
  '/dev/null',
  '..\\..\\..\\windows\\system32',
  'file:///etc/passwd',
  '\\\\server\\share\\file',
  '/proc/self/environ',
  'CON', 'PRN', 'AUX', 'NUL',                       // Windows reserved names
] as const

const EVIL_FORMAT = [
  '%s%s%s%s%s%s%s%s%s%s',                           // printf format string
  '${7*7}',                                          // Template injection
  '{{constructor.constructor("return this")()}}',    // Prototype pollution
  '#{7*7}',                                          // Ruby ERB
  '<%= 7*7 %>',                                      // ERB/EJS
  '{{7*7}}',                                         // Handlebars/Angular
  '${toString}',                                     // JS template literal
  '$(whoami)',                                        // Shell injection
  '`whoami`',                                         // Backtick injection
  '{${<%[%\'"}}%\\.',                                 // Mixed delimiter chaos
] as const

// ============================================
// Generator
// ============================================

export interface TestDataGenerator {
  /** Generate a value for the given type key */
  generate(type: string): string
  /** The seed used (for reproduction) */
  seed: number
}

export function createTestDataGenerator(seed?: number): TestDataGenerator {
  const actualSeed = seed ?? (Date.now() ^ (Math.random() * 0x100000000)) >>> 0
  const rng = new SeededRandom(actualSeed)
  const tag = rng.hex(4)  // Short hex tag for recognizability (e.g., "7f3a")

  // Memoization cache — same key always returns same value within this generator
  const cache = new Map<string, string>()

  // Alias map: alternative names → canonical names
  const ALIASES: Record<string, string> = {
    'NAME.FIRST': 'PERSON.FIRST',
    'NAME.LAST': 'PERSON.LAST',
    'NAME.FULL': 'PERSON.FULL',
    'NAME': 'PERSON.FULL',
    'TEXT.SENTENCE': 'TEXT',
    'WORD': 'TEXT.SHORT',
    'INT': 'NUMBER',
    'ADDRESS.POSTAL': 'ADDRESS.ZIP',
  }

  /** Normalize a type key: uppercase + resolve aliases */
  function canonicalize(type: string): string {
    const upper = type.toUpperCase()
    return ALIASES[upper] ?? upper
  }

  function generate(type: string): string {
    const key = canonicalize(type)
    // Check cache first — ${GEN.EMAIL} returns same value every time
    if (cache.has(key)) return cache.get(key)!

    const value = generateFresh(key)
    cache.set(key, value)
    return value
  }

  function generateFresh(type: string): string {
    const upper = type  // Already uppercased by canonicalize()

    // Person
    if (upper === 'PERSON.FIRST') {
      return rng.pick(FIRST_NAMES)
    }
    if (upper === 'PERSON.LAST') {
      return `Haltija-${tag}`
    }
    if (upper === 'PERSON.FULL') {
      const first = generate('PERSON.FIRST')
      const last = generate('PERSON.LAST')
      return `${first} ${last}`
    }

    // Email
    if (upper === 'EMAIL') {
      const first = generate('PERSON.FIRST').toLowerCase()
      return `${first}.${tag}@haltija-test.example`
    }

    // Phone (555 prefix = fictional in North America)
    if (upper === 'PHONE') {
      return `+1-555-0${rng.int(100, 199)}`
    }

    // Username
    if (upper === 'USERNAME') {
      const first = generate('PERSON.FIRST').toLowerCase()
      return `test_${first}_${tag}`
    }

    // Password (meets typical complexity: upper, lower, number, special, 12+ chars)
    if (upper === 'PASSWORD') {
      return `Test!Pass#${tag}${rng.hex(2)}`
    }

    // Text
    if (upper === 'TEXT') {
      const len = rng.int(5, 10)
      const words = Array.from({ length: len }, () => rng.pick(WORDS))
      words[0] = words[0][0].toUpperCase() + words[0].slice(1)
      return words.join(' ') + '.'
    }
    if (upper === 'TEXT.SHORT') {
      return rng.pick(WORDS)
    }
    if (upper === 'TEXT.PARAGRAPH') {
      const sentences = Array.from({ length: rng.int(3, 6) }, () => generateFresh('TEXT'))
      return sentences.join(' ')
    }

    // Number
    if (upper === 'NUMBER') {
      return String(rng.int(1, 9999))
    }
    // NUMBER.RANGE(min,max)
    const rangeMatch = upper.match(/^NUMBER\.RANGE\((\d+),\s*(\d+)\)$/)
    if (rangeMatch) {
      return String(rng.int(parseInt(rangeMatch[1]), parseInt(rangeMatch[2])))
    }

    // UUID (hj- prefixed for identification)
    if (upper === 'UUID') {
      return `hj-${rng.hex(8)}-${rng.hex(4)}-${rng.hex(4)}-${rng.hex(4)}-${rng.hex(12)}`
    }

    // Date
    if (upper === 'DATE') {
      const y = rng.int(2024, 2026)
      const m = rng.int(1, 12)
      const d = rng.int(1, 28)
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    if (upper === 'DATE.FUTURE') {
      const now = Date.now()
      const future = now + rng.int(1, 365) * 86400000
      return new Date(future).toISOString().slice(0, 10)
    }
    if (upper === 'DATE.PAST') {
      const now = Date.now()
      const past = now - rng.int(1, 365) * 86400000
      return new Date(past).toISOString().slice(0, 10)
    }

    // URL
    if (upper === 'URL') {
      return `https://haltija-test.example/${tag}`
    }

    // Company
    if (upper === 'COMPANY') {
      return `${rng.pick(COMPANIES)} ${tag}`
    }

    // Address
    if (upper === 'ADDRESS.STREET') {
      return `${rng.int(1, 9999)} ${rng.pick(STREETS)}`
    }
    if (upper === 'ADDRESS.CITY') {
      return rng.pick(CITIES)
    }
    if (upper === 'ADDRESS.ZIP') {
      return `555${String(rng.int(0, 99)).padStart(2, '0')}`
    }
    if (upper === 'ADDRESS.FULL') {
      return `${generateFresh('ADDRESS.STREET')}, ${generateFresh('ADDRESS.CITY')} ${generateFresh('ADDRESS.ZIP')}`
    }

    // Evil / Adversarial
    if (upper === 'EVIL.XSS') return rng.pick(EVIL_XSS)
    if (upper === 'EVIL.SQL') return rng.pick(EVIL_SQL)
    if (upper === 'EVIL.UNICODE') return rng.pick(EVIL_UNICODE)
    if (upper === 'EVIL.EMOJI') return rng.pick(EVIL_EMOJI)
    if (upper === 'EVIL.WHITESPACE') return rng.pick(EVIL_WHITESPACE)
    if (upper === 'EVIL.LONG') return 'A'.repeat(10000)
    if (upper === 'EVIL.EMPTY') return ''
    if (upper === 'EVIL.NULL') return rng.pick(EVIL_NULL)
    if (upper === 'EVIL.PATH') return rng.pick(EVIL_PATH)
    if (upper === 'EVIL.FORMAT') return rng.pick(EVIL_FORMAT)

    // Catch-all for EVIL (random category)
    if (upper === 'EVIL') {
      const categories = ['XSS', 'SQL', 'UNICODE', 'EMOJI', 'WHITESPACE', 'NULL', 'PATH', 'FORMAT']
      return generateFresh(`EVIL.${rng.pick(categories)}`)
    }

    // Unknown type
    return `[unknown:${type}]`
  }

  return { generate, seed: actualSeed }
}

/**
 * Process a string, replacing all ${GEN.TYPE} patterns with generated values.
 * Same GEN key produces the same value (memoized). Use .2, .3 etc. for distinct instances.
 *
 * @param text - String with ${GEN.TYPE} placeholders
 * @param seed - Optional seed for reproducibility
 * @returns { result: string, seed: number, generated: Record<string, string> }
 */
export function substituteGeneratedVars(
  text: string,
  seed?: number
): { result: string; seed: number; generated: Record<string, string> } {
  const gen = createTestDataGenerator(seed)
  const generated: Record<string, string> = {}

  const result = text.replace(/\$\{GEN\.([^}]+)\}/g, (_match, type: string) => {
    const value = gen.generate(type.trim())
    generated[`GEN.${type.trim()}`] = value
    return value
  })

  return { result, seed: gen.seed, generated }
}

/** List all supported generator types */
export const GENERATOR_TYPES = [
  'PERSON.FIRST', 'PERSON.LAST', 'PERSON.FULL',
  'NAME.FIRST', 'NAME.LAST', 'NAME.FULL', 'NAME',
  'EMAIL', 'PHONE', 'USERNAME', 'PASSWORD',
  'TEXT', 'TEXT.SHORT', 'TEXT.SENTENCE', 'TEXT.PARAGRAPH', 'WORD',
  'NUMBER', 'INT', 'NUMBER.RANGE(min,max)',
  'UUID', 'DATE', 'DATE.FUTURE', 'DATE.PAST',
  'URL', 'COMPANY',
  'ADDRESS.STREET', 'ADDRESS.CITY', 'ADDRESS.ZIP', 'ADDRESS.FULL',
  'EVIL', 'EVIL.XSS', 'EVIL.SQL', 'EVIL.UNICODE', 'EVIL.EMOJI',
  'EVIL.WHITESPACE', 'EVIL.LONG', 'EVIL.EMPTY', 'EVIL.NULL',
  'EVIL.PATH', 'EVIL.FORMAT',
] as const
