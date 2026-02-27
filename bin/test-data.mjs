/**
 * Test Data Generators (Node.js / CLI version)
 *
 * Lightweight port of src/test-data.ts for use in bin/cli-subcommand.mjs.
 * Produces deterministic, recognizable test data from a seed.
 *
 * Usage:
 *   import { createTestDataGenerator, substituteGeneratedVars } from './test-data.mjs'
 *   const gen = createTestDataGenerator(42)
 *   gen.generate('EMAIL')  // "tessia.7f3a@haltija-test.example"
 */

// ============================================
// Seeded PRNG (xorshift32)
// ============================================

function xorshift32(state) {
  let s = state | 0
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  return [s >>> 0, s >>> 0]
}

class SeededRandom {
  constructor(seed) {
    this.state = (seed === 0 ? 1 : seed) >>> 0
  }
  next() {
    const [value, newState] = xorshift32(this.state)
    this.state = newState
    return value / 0x100000000
  }
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  pick(arr) {
    return arr[this.int(0, arr.length - 1)]
  }
  hex(len) {
    let s = ''
    for (let i = 0; i < len; i++) s += this.int(0, 15).toString(16)
    return s
  }
}

// ============================================
// Data pools
// ============================================

const FIRST_NAMES = [
  'Tessia', 'Testopher', 'Testina', 'Qadir', 'Qaleen',
  'Checkov', 'Validia', 'Assertia', 'Debugson', 'Mockwell',
  'Fixturia', 'Stubson', 'Spectra', 'Suitewell', 'Runley',
  'Passandra', 'Failsworth', 'Edgeworth', 'Boundara', 'Flaxton',
]

const WORDS = [
  'quick', 'brown', 'fox', 'lazy', 'dog', 'test', 'data',
  'jumps', 'over', 'fence', 'under', 'bridge', 'through',
  'forest', 'around', 'mountain', 'beside', 'river', 'across',
  'valley', 'between', 'clouds', 'above', 'ocean', 'below',
]

const COMPANIES = [
  'Haltija Test Corp', 'QA Industries', 'Assertion Labs',
  'Testify Inc', 'Validate Co', 'Fixture Holdings',
  'Mock & Sons', 'Spec Systems', 'Check Group', 'Edge Corp',
]

const STREETS = [
  'Test Avenue', 'QA Boulevard', 'Assertion Lane', 'Validate Street',
  'Debug Drive', 'Fixture Road', 'Mock Court', 'Spec Way',
  'Check Circle', 'Edge Parkway', 'Suite Plaza', 'Run Terrace',
]

const CITIES = [
  'Testville', 'QA City', 'Assertonia', 'Validateburg',
  'Debugton', 'Mockford', 'Specburgh', 'Fixtureopolis',
]

// ============================================
// Evil / Adversarial strings
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
]

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
]

const EVIL_UNICODE = [
  '\u200B\u200C\u200D\uFEFF',
  '\u202E\u0052\u0065\u0076\u0065\u0072\u0073\u0065',
  '\u0410\u0412\u0421',
  'A\u0300\u0301\u0302\u0303\u0304',
  '\uFFFD\uFFFD\uFFFD',
  '\u2028\u2029',
  '\u0000\u0001\u0002',
  '\uD800',
  'a\u034F\u0061',
  '\u200F\u200E',
]

const EVIL_EMOJI = [
  '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}',
  '\u{1F44B}\u{1F3FD}',
  '\u{1F1FA}\u{1F1F8}',
  '\u{1F468}\u{200D}\u{1F4BB}',
  '\u{1F3F3}\uFE0F\u{200D}\u{1F308}',
  '\u{1F9D1}\u{200D}\u{1F9D1}\u{200D}\u{1F9D2}',
  '\u{1F600}\u{1F601}\u{1F602}\u{1F603}\u{1F604}',
  '\u0023\uFE0F\u{20E3}',
  '\u{1FAE0}',
  '\u{1F600}\u{1F601}\u{1F602}\u{1F923}\u{1F603}\u{1F604}\u{1F605}\u{1F606}\u{1F607}\u{1F970}',
]

const EVIL_WHITESPACE = [
  ' \t\n\r\x0B\x0C',
  '\u00A0\u2000\u2001\u2002\u2003\u2004',
  '\u2005\u2006\u2007\u2008\u2009\u200A',
  '\u3000',
  '\r\n\r\n\n\r',
  '\t\t\t\t\t\t\t\t',
  ' \u00A0 \u00A0 ',
  '\u205F\u202F',
  '   \u200B   ',
  '\u180E\u2060',
]

const EVIL_NULL = [
  'null', 'undefined', 'NaN', 'Infinity', '-Infinity',
  'true', 'false', '0', '-0', '',
  'None', 'nil', 'NULL', 'void', '[object Object]',
]

const EVIL_PATH = [
  '../../etc/passwd',
  'C:\\windows\\system32\\config\\sam',
  '/dev/null',
  '..\\..\\..\\windows\\system32',
  'file:///etc/passwd',
  '\\\\server\\share\\file',
  '/proc/self/environ',
  'CON', 'PRN', 'AUX', 'NUL',
]

const EVIL_FORMAT = [
  '%s%s%s%s%s%s%s%s%s%s',
  '${7*7}',
  '{{constructor.constructor("return this")()}}',
  '#{7*7}',
  '<%= 7*7 %>',
  '{{7*7}}',
  '${toString}',
  '$(whoami)',
  '`whoami`',
  '{${<%[%\'"}}%\\.',
]

// ============================================
// Generator
// ============================================

const ALIASES = {
  'NAME.FIRST': 'PERSON.FIRST',
  'NAME.LAST': 'PERSON.LAST',
  'NAME.FULL': 'PERSON.FULL',
  'NAME': 'PERSON.FULL',
  'TEXT.SENTENCE': 'TEXT',
  'WORD': 'TEXT.SHORT',
  'INT': 'NUMBER',
  'ADDRESS.POSTAL': 'ADDRESS.ZIP',
}

export function createTestDataGenerator(seed) {
  const actualSeed = seed ?? (Date.now() ^ (Math.random() * 0x100000000)) >>> 0
  const rng = new SeededRandom(actualSeed)
  const tag = rng.hex(4)
  const cache = new Map()

  function canonicalize(type) {
    const upper = type.toUpperCase()
    return ALIASES[upper] ?? upper
  }

  function generate(type) {
    const key = canonicalize(type)
    if (cache.has(key)) return cache.get(key)
    const value = generateFresh(key)
    cache.set(key, value)
    return value
  }

  function generateFresh(upper) {
    if (upper === 'PERSON.FIRST') return rng.pick(FIRST_NAMES)
    if (upper === 'PERSON.LAST') return `Haltija-${tag}`
    if (upper === 'PERSON.FULL') return `${generate('PERSON.FIRST')} ${generate('PERSON.LAST')}`
    if (upper === 'EMAIL') return `${generate('PERSON.FIRST').toLowerCase()}.${tag}@haltija-test.example`
    if (upper === 'PHONE') return `+1-555-0${rng.int(100, 199)}`
    if (upper === 'USERNAME') return `test_${generate('PERSON.FIRST').toLowerCase()}_${tag}`
    if (upper === 'PASSWORD') return `Test!Pass#${tag}${rng.hex(2)}`

    if (upper === 'TEXT') {
      const len = rng.int(5, 10)
      const words = Array.from({ length: len }, () => rng.pick(WORDS))
      words[0] = words[0][0].toUpperCase() + words[0].slice(1)
      return words.join(' ') + '.'
    }
    if (upper === 'TEXT.SHORT') return rng.pick(WORDS)
    if (upper === 'TEXT.PARAGRAPH') {
      return Array.from({ length: rng.int(3, 6) }, () => generateFresh('TEXT')).join(' ')
    }

    if (upper === 'NUMBER') return String(rng.int(1, 9999))
    const rangeMatch = upper.match(/^NUMBER\.RANGE\((\d+),\s*(\d+)\)$/)
    if (rangeMatch) return String(rng.int(parseInt(rangeMatch[1]), parseInt(rangeMatch[2])))

    if (upper === 'UUID') return `hj-${rng.hex(8)}-${rng.hex(4)}-${rng.hex(4)}-${rng.hex(4)}-${rng.hex(12)}`

    if (upper === 'DATE') {
      const y = rng.int(2024, 2026), m = rng.int(1, 12), d = rng.int(1, 28)
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    if (upper === 'DATE.FUTURE') return new Date(Date.now() + rng.int(1, 365) * 86400000).toISOString().slice(0, 10)
    if (upper === 'DATE.PAST') return new Date(Date.now() - rng.int(1, 365) * 86400000).toISOString().slice(0, 10)

    if (upper === 'URL') return `https://haltija-test.example/${tag}`
    if (upper === 'COMPANY') return `${rng.pick(COMPANIES)} ${tag}`
    if (upper === 'ADDRESS.STREET') return `${rng.int(1, 9999)} ${rng.pick(STREETS)}`
    if (upper === 'ADDRESS.CITY') return rng.pick(CITIES)
    if (upper === 'ADDRESS.ZIP') return `555${String(rng.int(0, 99)).padStart(2, '0')}`
    if (upper === 'ADDRESS.FULL') return `${generateFresh('ADDRESS.STREET')}, ${generateFresh('ADDRESS.CITY')} ${generateFresh('ADDRESS.ZIP')}`

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
    if (upper === 'EVIL') {
      const cats = ['XSS', 'SQL', 'UNICODE', 'EMOJI', 'WHITESPACE', 'NULL', 'PATH', 'FORMAT']
      return generateFresh(`EVIL.${rng.pick(cats)}`)
    }

    return `[unknown:${upper}]`
  }

  return { generate, seed: actualSeed }
}

/**
 * Process a string, replacing all ${GEN.TYPE} patterns with generated values.
 * Same GEN key produces the same value (memoized). Use .2, .3 etc. for distinct instances.
 */
export function substituteGeneratedVars(text, seed) {
  const gen = createTestDataGenerator(seed)
  const generated = {}

  const result = text.replace(/\$\{GEN\.([^}]+)\}/g, (_match, type) => {
    const value = gen.generate(type.trim())
    generated[`GEN.${type.trim()}`] = value
    return value
  })

  return { result, seed: gen.seed, generated }
}
