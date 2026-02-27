import { describe, test, expect } from 'bun:test'
import { createTestDataGenerator, substituteGeneratedVars, GENERATOR_TYPES } from './test-data'

describe('Test Data Generator', () => {
  describe('deterministic with seed', () => {
    test('same seed produces same output', () => {
      const gen1 = createTestDataGenerator(42)
      const gen2 = createTestDataGenerator(42)

      for (const type of ['EMAIL', 'PERSON.FIRST', 'PERSON.FULL', 'PHONE', 'UUID']) {
        expect(gen1.generate(type)).toBe(gen2.generate(type))
      }
    })

    test('different seeds produce different output', () => {
      const gen1 = createTestDataGenerator(42)
      const gen2 = createTestDataGenerator(99)

      // At least some values should differ
      const types = ['EMAIL', 'PERSON.FIRST', 'PHONE', 'UUID']
      const different = types.filter(t => gen1.generate(t) !== gen2.generate(t))
      expect(different.length).toBeGreaterThan(0)
    })

    test('auto-generates seed when none provided', () => {
      const gen = createTestDataGenerator()
      expect(gen.seed).toBeGreaterThan(0)
      expect(gen.generate('EMAIL')).toBeTruthy()
    })
  })

  describe('memoization', () => {
    test('same key returns same value within one generator', () => {
      const gen = createTestDataGenerator(42)
      const email1 = gen.generate('EMAIL')
      const email2 = gen.generate('EMAIL')
      expect(email1).toBe(email2)
    })

    test('numbered variants produce different values', () => {
      const gen = createTestDataGenerator(42)
      const email1 = gen.generate('EMAIL')
      const email2 = gen.generate('EMAIL.2')
      expect(email1).not.toBe(email2)
    })
  })

  describe('person generators', () => {
    test('PERSON.FIRST returns a name from the pool', () => {
      const gen = createTestDataGenerator(42)
      const name = gen.generate('PERSON.FIRST')
      expect(name.length).toBeGreaterThan(0)
      expect(typeof name).toBe('string')
    })

    test('PERSON.LAST contains haltija tag', () => {
      const gen = createTestDataGenerator(42)
      const last = gen.generate('PERSON.LAST')
      expect(last).toMatch(/^Haltija-[0-9a-f]{4}$/)
    })

    test('PERSON.FULL combines first and last', () => {
      const gen = createTestDataGenerator(42)
      const full = gen.generate('PERSON.FULL')
      const first = gen.generate('PERSON.FIRST')
      const last = gen.generate('PERSON.LAST')
      expect(full).toBe(`${first} ${last}`)
    })

    test('NAME aliases work', () => {
      const gen = createTestDataGenerator(42)
      expect(gen.generate('NAME.FIRST')).toBe(gen.generate('PERSON.FIRST'))
      expect(gen.generate('NAME')).toBe(gen.generate('PERSON.FULL'))
    })
  })

  describe('email', () => {
    test('uses .example TLD', () => {
      const gen = createTestDataGenerator(42)
      const email = gen.generate('EMAIL')
      expect(email).toMatch(/@haltija-test\.example$/)
    })

    test('contains person first name', () => {
      const gen = createTestDataGenerator(42)
      const email = gen.generate('EMAIL')
      const first = gen.generate('PERSON.FIRST').toLowerCase()
      expect(email.startsWith(first + '.')).toBe(true)
    })
  })

  describe('phone', () => {
    test('uses 555 prefix', () => {
      const gen = createTestDataGenerator(42)
      const phone = gen.generate('PHONE')
      expect(phone).toMatch(/^\+1-555-0\d{3}$/)
    })
  })

  describe('username', () => {
    test('starts with test_', () => {
      const gen = createTestDataGenerator(42)
      const username = gen.generate('USERNAME')
      expect(username).toMatch(/^test_/)
      expect(username).toContain('_')
    })
  })

  describe('password', () => {
    test('meets complexity requirements', () => {
      const gen = createTestDataGenerator(42)
      const pw = gen.generate('PASSWORD')
      expect(pw.length).toBeGreaterThanOrEqual(12)
      expect(pw).toMatch(/[A-Z]/) // uppercase
      expect(pw).toMatch(/[a-z]/) // lowercase
      expect(pw).toMatch(/[0-9]/) // digit
      expect(pw).toMatch(/[!#]/)  // special
    })
  })

  describe('text', () => {
    test('TEXT returns a sentence', () => {
      const gen = createTestDataGenerator(42)
      const text = gen.generate('TEXT')
      expect(text.endsWith('.')).toBe(true)
      expect(text.split(' ').length).toBeGreaterThanOrEqual(5)
    })

    test('TEXT.SHORT returns a single word', () => {
      const gen = createTestDataGenerator(42)
      const text = gen.generate('TEXT.SHORT')
      expect(text.split(' ').length).toBe(1)
    })

    test('TEXT.PARAGRAPH returns multiple sentences', () => {
      const gen = createTestDataGenerator(42)
      const para = gen.generate('TEXT.PARAGRAPH')
      // Multiple sentences separated by '. '
      expect(para.split('. ').length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('number', () => {
    test('NUMBER returns a numeric string', () => {
      const gen = createTestDataGenerator(42)
      const num = gen.generate('NUMBER')
      expect(Number.isFinite(parseInt(num))).toBe(true)
    })

    test('NUMBER.RANGE respects bounds', () => {
      const gen = createTestDataGenerator(42)
      const num = parseInt(gen.generate('NUMBER.RANGE(10,20)'))
      expect(num).toBeGreaterThanOrEqual(10)
      expect(num).toBeLessThanOrEqual(20)
    })
  })

  describe('UUID', () => {
    test('starts with hj- prefix', () => {
      const gen = createTestDataGenerator(42)
      const uuid = gen.generate('UUID')
      expect(uuid).toMatch(/^hj-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })
  })

  describe('date', () => {
    test('DATE returns ISO format', () => {
      const gen = createTestDataGenerator(42)
      const date = gen.generate('DATE')
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    test('DATE.FUTURE is after today', () => {
      const gen = createTestDataGenerator(42)
      const date = new Date(gen.generate('DATE.FUTURE'))
      expect(date.getTime()).toBeGreaterThan(Date.now() - 86400000) // today - 1 day buffer
    })

    test('DATE.PAST is before today', () => {
      const gen = createTestDataGenerator(42)
      const date = new Date(gen.generate('DATE.PAST'))
      expect(date.getTime()).toBeLessThan(Date.now() + 86400000) // today + 1 day buffer
    })
  })

  describe('URL', () => {
    test('uses .example TLD', () => {
      const gen = createTestDataGenerator(42)
      expect(gen.generate('URL')).toMatch(/^https:\/\/haltija-test\.example\//)
    })
  })

  describe('company', () => {
    test('includes hex tag', () => {
      const gen = createTestDataGenerator(42)
      const company = gen.generate('COMPANY')
      expect(company).toMatch(/[0-9a-f]{4}$/)
    })
  })

  describe('address', () => {
    test('ADDRESS.STREET has a number prefix', () => {
      const gen = createTestDataGenerator(42)
      expect(gen.generate('ADDRESS.STREET')).toMatch(/^\d+ /)
    })

    test('ADDRESS.ZIP is 5 digits starting with 555', () => {
      const gen = createTestDataGenerator(42)
      expect(gen.generate('ADDRESS.ZIP')).toMatch(/^555\d{2}$/)
    })

    test('ADDRESS.FULL combines street, city, zip', () => {
      const gen = createTestDataGenerator(42)
      const full = gen.generate('ADDRESS.FULL')
      expect(full).toContain(',')
    })
  })

  describe('evil / adversarial strings', () => {
    test('EVIL.XSS contains script-like content', () => {
      const gen = createTestDataGenerator(42)
      const xss = gen.generate('EVIL.XSS')
      expect(xss.length).toBeGreaterThan(0)
      // Should contain some kind of injection attempt
      expect(xss).toMatch(/script|onerror|onload|javascript|alert|iframe/i)
    })

    test('EVIL.SQL contains SQL keywords', () => {
      const gen = createTestDataGenerator(42)
      const sql = gen.generate('EVIL.SQL')
      expect(sql).toMatch(/DROP|UNION|OR|UPDATE|SELECT|INSERT|EXEC|'/i)
    })

    test('EVIL.UNICODE returns non-empty string with special chars', () => {
      const gen = createTestDataGenerator(42)
      const unicode = gen.generate('EVIL.UNICODE')
      expect(unicode.length).toBeGreaterThan(0)
    })

    test('EVIL.EMOJI returns emoji content', () => {
      const gen = createTestDataGenerator(42)
      const emoji = gen.generate('EVIL.EMOJI')
      expect(emoji.length).toBeGreaterThan(0)
    })

    test('EVIL.WHITESPACE returns whitespace variants', () => {
      const gen = createTestDataGenerator(42)
      const ws = gen.generate('EVIL.WHITESPACE')
      expect(ws.length).toBeGreaterThan(0)
    })

    test('EVIL.LONG returns 10k chars', () => {
      const gen = createTestDataGenerator(42)
      expect(gen.generate('EVIL.LONG').length).toBe(10000)
    })

    test('EVIL.EMPTY returns empty string', () => {
      const gen = createTestDataGenerator(42)
      expect(gen.generate('EVIL.EMPTY')).toBe('')
    })

    test('EVIL.NULL returns falsy-looking string', () => {
      const gen = createTestDataGenerator(42)
      const val = gen.generate('EVIL.NULL')
      expect(['null', 'undefined', 'NaN', 'Infinity', '-Infinity', 'true', 'false',
        '0', '-0', '', 'None', 'nil', 'NULL', 'void', '[object Object]']).toContain(val)
    })

    test('EVIL.PATH returns path traversal attempt', () => {
      const gen = createTestDataGenerator(42)
      const path = gen.generate('EVIL.PATH')
      expect(path.length).toBeGreaterThan(0)
    })

    test('EVIL.FORMAT returns format string injection', () => {
      const gen = createTestDataGenerator(42)
      const fmt = gen.generate('EVIL.FORMAT')
      expect(fmt.length).toBeGreaterThan(0)
    })

    test('EVIL (generic) returns something from a random category', () => {
      const gen = createTestDataGenerator(42)
      const evil = gen.generate('EVIL')
      expect(evil.length).toBeGreaterThanOrEqual(0) // EVIL.EMPTY can be ''
    })
  })

  describe('unknown types', () => {
    test('returns [unknown:TYPE] for unrecognized types', () => {
      const gen = createTestDataGenerator(42)
      expect(gen.generate('NONEXISTENT')).toBe('[unknown:NONEXISTENT]')
    })
  })

  describe('case insensitivity', () => {
    test('generators are case-insensitive', () => {
      const gen1 = createTestDataGenerator(42)
      const gen2 = createTestDataGenerator(42)
      expect(gen1.generate('email')).toBe(gen2.generate('EMAIL'))
      expect(gen1.generate('Person.First')).toBe(gen2.generate('PERSON.FIRST'))
    })
  })
})

describe('substituteGeneratedVars', () => {
  test('replaces ${GEN.TYPE} patterns', () => {
    const { result } = substituteGeneratedVars(
      'Hello ${GEN.PERSON.FIRST}, your email is ${GEN.EMAIL}',
      42
    )
    expect(result).not.toContain('${GEN.')
    expect(result).toContain('@haltija-test.example')
  })

  test('same key produces same value in one pass', () => {
    const { result } = substituteGeneratedVars(
      '${GEN.EMAIL} and again ${GEN.EMAIL}',
      42
    )
    const parts = result.split(' and again ')
    expect(parts[0]).toBe(parts[1])
  })

  test('.N suffix produces distinct values', () => {
    const { result } = substituteGeneratedVars(
      '${GEN.EMAIL} vs ${GEN.EMAIL.2}',
      42
    )
    const parts = result.split(' vs ')
    expect(parts[0]).not.toBe(parts[1])
  })

  test('returns seed and generated map', () => {
    const { seed, generated } = substituteGeneratedVars('${GEN.EMAIL}', 42)
    expect(seed).toBe(42)
    expect(generated['GEN.EMAIL']).toMatch(/@haltija-test\.example$/)
  })

  test('leaves non-GEN variables alone', () => {
    const { result } = substituteGeneratedVars('${APP_URL} and ${GEN.EMAIL}', 42)
    expect(result).toContain('${APP_URL}')
    expect(result).not.toContain('${GEN.EMAIL}')
  })

  test('deterministic with same seed', () => {
    const r1 = substituteGeneratedVars('${GEN.EMAIL} ${GEN.PERSON.FULL}', 42)
    const r2 = substituteGeneratedVars('${GEN.EMAIL} ${GEN.PERSON.FULL}', 42)
    expect(r1.result).toBe(r2.result)
  })
})

describe('GENERATOR_TYPES', () => {
  test('all listed types produce output', () => {
    const gen = createTestDataGenerator(42)
    for (const type of GENERATOR_TYPES) {
      if (type === 'NUMBER.RANGE(min,max)') continue // Template, not invocable directly
      const value = gen.generate(type)
      // EVIL.EMPTY is the only type that returns ''
      if (type !== 'EVIL.EMPTY') {
        expect(value.length).toBeGreaterThan(0)
      }
    }
  })
})
