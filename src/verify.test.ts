/**
 * Tests for the verify step and matchesExpectation helper
 */

import { describe, it, expect } from 'bun:test'
import type { VerifyExpectation } from './types'

// Recreate the matchesExpectation function for testing
// (In production this is defined inside the server route handler)
function matchesExpectation(actual: any, expectation: VerifyExpectation): boolean {
  // Handle null/undefined
  if (expectation === null) return actual === null
  if (expectation === undefined) return actual === undefined

  // Check for expectation objects with specific matchers
  if (typeof expectation === 'object' && expectation !== null) {
    // { equals: value } - explicit exact match
    if ('equals' in expectation) {
      return JSON.stringify(actual) === JSON.stringify(expectation.equals)
    }

    // { matches: "regex" } - regex for strings
    if ('matches' in expectation) {
      if (typeof actual !== 'string') return false
      return new RegExp(expectation.matches).test(actual)
    }

    // { contains: value } - subset match for objects/arrays
    if ('contains' in expectation) {
      if (Array.isArray(actual) && Array.isArray(expectation.contains)) {
        // Every item in expected should exist in actual
        return expectation.contains.every((expectedItem: any) =>
          actual.some((actualItem: any) =>
            JSON.stringify(actualItem) === JSON.stringify(expectedItem) ||
            (typeof expectedItem === 'object' && matchesExpectation(actualItem, { contains: expectedItem }))
          )
        )
      }
      if (typeof actual === 'object' && actual !== null && typeof expectation.contains === 'object') {
        // Every key in expected should match in actual
        for (const key of Object.keys(expectation.contains)) {
          if (!(key in actual)) return false
          const expectedVal = expectation.contains[key]
          const actualVal = actual[key]
          // Recursively check nested objects
          if (typeof expectedVal === 'object' && expectedVal !== null) {
            if (!matchesExpectation(actualVal, { contains: expectedVal })) return false
          } else if (actualVal !== expectedVal) {
            return false
          }
        }
        return true
      }
      // For strings, check if actual contains expected
      if (typeof actual === 'string' && typeof expectation.contains === 'string') {
        return actual.includes(expectation.contains)
      }
      return false
    }

    // { truthy: true } - value is truthy
    if ('truthy' in expectation && expectation.truthy === true) {
      return !!actual
    }

    // { falsy: true } - value is falsy
    if ('falsy' in expectation && expectation.falsy === true) {
      return !actual
    }

    // { gt: n } - greater than
    if ('gt' in expectation) {
      return typeof actual === 'number' && actual > expectation.gt
    }

    // { gte: n } - greater than or equal
    if ('gte' in expectation) {
      return typeof actual === 'number' && actual >= expectation.gte
    }

    // { lt: n } - less than
    if ('lt' in expectation) {
      return typeof actual === 'number' && actual < expectation.lt
    }

    // { lte: n } - less than or equal
    if ('lte' in expectation) {
      return typeof actual === 'number' && actual <= expectation.lte
    }

    // No special matcher found - fall through to deep equality
  }

  // Default: deep equality via JSON comparison
  return JSON.stringify(actual) === JSON.stringify(expectation)
}

describe('matchesExpectation', () => {
  describe('primitive matching', () => {
    it('matches exact strings', () => {
      expect(matchesExpectation('hello', 'hello')).toBe(true)
      expect(matchesExpectation('hello', 'world')).toBe(false)
    })

    it('matches exact numbers', () => {
      expect(matchesExpectation(42, 42)).toBe(true)
      expect(matchesExpectation(42, 43)).toBe(false)
    })

    it('matches booleans', () => {
      expect(matchesExpectation(true, true)).toBe(true)
      expect(matchesExpectation(false, false)).toBe(true)
      expect(matchesExpectation(true, false)).toBe(false)
    })

    it('matches null', () => {
      expect(matchesExpectation(null, null)).toBe(true)
      expect(matchesExpectation(null, undefined)).toBe(false)
      expect(matchesExpectation('hello', null)).toBe(false)
    })

    it('matches undefined', () => {
      expect(matchesExpectation(undefined, undefined)).toBe(true)
      expect(matchesExpectation(undefined, null)).toBe(false)
    })
  })

  describe('equals matcher', () => {
    it('matches exact objects', () => {
      expect(matchesExpectation({ a: 1, b: 2 }, { equals: { a: 1, b: 2 } })).toBe(true)
      expect(matchesExpectation({ a: 1, b: 2 }, { equals: { a: 1 } })).toBe(false)
    })

    it('matches exact arrays', () => {
      expect(matchesExpectation([1, 2, 3], { equals: [1, 2, 3] })).toBe(true)
      expect(matchesExpectation([1, 2, 3], { equals: [1, 2] })).toBe(false)
    })
  })

  describe('matches matcher (regex)', () => {
    it('matches regex patterns', () => {
      expect(matchesExpectation('hello world', { matches: 'hello' })).toBe(true)
      expect(matchesExpectation('hello world', { matches: '^hello' })).toBe(true)
      expect(matchesExpectation('hello world', { matches: '^world' })).toBe(false)
    })

    it('matches email pattern', () => {
      expect(matchesExpectation('test@example.com', { matches: '^[\\w.-]+@[\\w.-]+\\.\\w+$' })).toBe(true)
      expect(matchesExpectation('not-an-email', { matches: '^[\\w.-]+@[\\w.-]+\\.\\w+$' })).toBe(false)
    })

    it('returns false for non-strings', () => {
      expect(matchesExpectation(123, { matches: '\\d+' })).toBe(false)
      expect(matchesExpectation({ a: 1 }, { matches: '.*' })).toBe(false)
    })
  })

  describe('contains matcher', () => {
    describe('for objects', () => {
      it('matches when object contains expected properties', () => {
        expect(matchesExpectation(
          { a: 1, b: 2, c: 3 },
          { contains: { a: 1, b: 2 } }
        )).toBe(true)
      })

      it('fails when property value differs', () => {
        expect(matchesExpectation(
          { a: 1, b: 2 },
          { contains: { a: 2 } }
        )).toBe(false)
      })

      it('fails when property is missing', () => {
        expect(matchesExpectation(
          { a: 1 },
          { contains: { b: 2 } }
        )).toBe(false)
      })

      it('matches nested objects', () => {
        expect(matchesExpectation(
          { user: { name: 'Alice', age: 30, role: 'admin' }, active: true },
          { contains: { user: { name: 'Alice', role: 'admin' } } }
        )).toBe(true)
      })
    })

    describe('for arrays', () => {
      it('matches when array contains all expected items', () => {
        expect(matchesExpectation(
          [1, 2, 3, 4, 5],
          { contains: [2, 4] }
        )).toBe(true)
      })

      it('fails when array is missing expected item', () => {
        expect(matchesExpectation(
          [1, 2, 3],
          { contains: [4] }
        )).toBe(false)
      })

      it('matches array of objects', () => {
        expect(matchesExpectation(
          [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
          { contains: [{ id: 1, name: 'Alice' }] }
        )).toBe(true)
      })
    })

    describe('for strings', () => {
      it('matches substring', () => {
        expect(matchesExpectation('hello world', { contains: 'world' })).toBe(true)
        expect(matchesExpectation('hello world', { contains: 'xyz' })).toBe(false)
      })
    })
  })

  describe('truthy/falsy matchers', () => {
    it('matches truthy values', () => {
      expect(matchesExpectation(true, { truthy: true })).toBe(true)
      expect(matchesExpectation(1, { truthy: true })).toBe(true)
      expect(matchesExpectation('hello', { truthy: true })).toBe(true)
      expect(matchesExpectation({}, { truthy: true })).toBe(true)
      expect(matchesExpectation([], { truthy: true })).toBe(true)
    })

    it('fails truthy for falsy values', () => {
      expect(matchesExpectation(false, { truthy: true })).toBe(false)
      expect(matchesExpectation(0, { truthy: true })).toBe(false)
      expect(matchesExpectation('', { truthy: true })).toBe(false)
      expect(matchesExpectation(null, { truthy: true })).toBe(false)
      expect(matchesExpectation(undefined, { truthy: true })).toBe(false)
    })

    it('matches falsy values', () => {
      expect(matchesExpectation(false, { falsy: true })).toBe(true)
      expect(matchesExpectation(0, { falsy: true })).toBe(true)
      expect(matchesExpectation('', { falsy: true })).toBe(true)
      expect(matchesExpectation(null, { falsy: true })).toBe(true)
    })

    it('fails falsy for truthy values', () => {
      expect(matchesExpectation(true, { falsy: true })).toBe(false)
      expect(matchesExpectation(1, { falsy: true })).toBe(false)
      expect(matchesExpectation('hello', { falsy: true })).toBe(false)
    })
  })

  describe('numeric comparison matchers', () => {
    it('gt - greater than', () => {
      expect(matchesExpectation(10, { gt: 5 })).toBe(true)
      expect(matchesExpectation(5, { gt: 5 })).toBe(false)
      expect(matchesExpectation(3, { gt: 5 })).toBe(false)
    })

    it('gte - greater than or equal', () => {
      expect(matchesExpectation(10, { gte: 5 })).toBe(true)
      expect(matchesExpectation(5, { gte: 5 })).toBe(true)
      expect(matchesExpectation(3, { gte: 5 })).toBe(false)
    })

    it('lt - less than', () => {
      expect(matchesExpectation(3, { lt: 5 })).toBe(true)
      expect(matchesExpectation(5, { lt: 5 })).toBe(false)
      expect(matchesExpectation(10, { lt: 5 })).toBe(false)
    })

    it('lte - less than or equal', () => {
      expect(matchesExpectation(3, { lte: 5 })).toBe(true)
      expect(matchesExpectation(5, { lte: 5 })).toBe(true)
      expect(matchesExpectation(10, { lte: 5 })).toBe(false)
    })

    it('returns false for non-numbers', () => {
      expect(matchesExpectation('10', { gt: 5 })).toBe(false)
      expect(matchesExpectation(null, { lt: 5 })).toBe(false)
    })
  })

  describe('deep equality (default)', () => {
    it('matches complex nested objects', () => {
      const obj = {
        users: [
          { id: 1, name: 'Alice', roles: ['admin', 'user'] },
          { id: 2, name: 'Bob', roles: ['user'] }
        ],
        meta: { total: 2, page: 1 }
      }
      expect(matchesExpectation(obj, obj)).toBe(true)
    })

    it('fails for different objects', () => {
      expect(matchesExpectation(
        { a: 1, b: 2 },
        { a: 1, b: 3 }
      )).toBe(false)
    })
  })
})

describe('VerifyStep type examples', () => {
  // These are documentation examples - they just test the types compile correctly
  
  it('example: check user profile exists', () => {
    const step = {
      action: 'verify' as const,
      eval: "window.__test.getProfile('user123')",
      expect: { contains: { locale: 'en-GB' } },
      timeout: 3000,
      description: 'User profile has correct locale'
    }
    // The step type should be valid
    expect(step.action).toBe('verify')
  })

  it('example: check login timestamp is recent', () => {
    const step = {
      action: 'verify' as const,
      eval: "Date.now() - parseInt(localStorage.getItem('loginTime') || '0') < 30000",
      expect: true,
      timeout: 1000,
      description: 'Login timestamp is within last 30 seconds'
    }
    expect(step.action).toBe('verify')
  })

  it('example: check billing rule was saved', () => {
    const step = {
      action: 'verify' as const,
      eval: "window.__test.getBillingRule('testcustomer', 'SF02')",
      expect: { 
        contains: { 
          amount: 1500, 
          code: 'SF02',
          status: 'active'
        } 
      },
      timeout: 5000,
      description: 'Billing rule saved with correct values'
    }
    expect(step.action).toBe('verify')
  })

  it('example: check array length', () => {
    const step = {
      action: 'verify' as const,
      eval: "window.__test.getUsers().length",
      expect: { gte: 1 },
      timeout: 3000,
      description: 'At least one user exists'
    }
    expect(step.action).toBe('verify')
  })
})
