/**
 * Haltija integration tests using haltija/test helper.
 *
 * Requires a running haltija server with a connected browser.
 * Run: bunx haltija -f   (in another terminal)
 * Then: bun test tests/haltija.test.ts
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import { HaltijaTestClient } from '../src/test'
import { existsSync } from 'fs'

const hj = new HaltijaTestClient()

// Check if server is available before running tests
let serverAvailable = false

beforeAll(async () => {
  try {
    await hj.waitForServer(3000)
    serverAvailable = true
  } catch {
    console.log('Haltija server not available — skipping integration tests')
    console.log('Run: bunx haltija -f')
  }
})

function skipUnlessServer() {
  if (!serverAvailable) {
    console.log('  SKIP: no server')
    return true
  }
  return false
}

describe('haltija/test helper', () => {
  test('waitForServer resolves when server is running', async () => {
    if (skipUnlessServer()) return
    // Already confirmed in beforeAll — just verify status works
    const status = await hj.status()
    expect(status).toBeDefined()
  })

  test('windows() returns connected browsers', async () => {
    if (skipUnlessServer()) return
    const w = await hj.windows()
    expect(w.count).toBeGreaterThan(0)
    expect(w.windows.length).toBeGreaterThan(0)
  })

  test('navigate and getLocation', async () => {
    if (skipUnlessServer()) return
    await hj.navigate('http://localhost:8700/test')
    // Small delay for navigation
    await new Promise(r => setTimeout(r, 500))
    const loc = await hj.getLocation()
    expect(loc.url).toContain('localhost:8700')
  })

  test('eval runs JavaScript in browser', async () => {
    if (skipUnlessServer()) return
    const result = await hj.eval('1 + 1')
    expect(result).toBe(2)
  })

  test('query finds DOM elements', async () => {
    if (skipUnlessServer()) return
    await hj.navigate('http://localhost:8700/test')
    await new Promise(r => setTimeout(r, 500))
    const el = await hj.query('h1')
    expect(el).not.toBeNull()
    expect(el?.tagName?.toLowerCase()).toBe('h1')
  })

  test('click interacts with elements', async () => {
    if (skipUnlessServer()) return
    // Click a tab on the playground
    await hj.click('[data-tab="playground"]')
    await new Promise(r => setTimeout(r, 300))
    const result = await hj.eval('document.querySelector("[data-tab=playground]")?.classList.contains("active")')
    expect(result).toBe(true)
  })

  test('screenshot returns file path', async () => {
    if (skipUnlessServer()) return
    const shot = await hj.screenshot()
    expect(shot.path).toMatch(/\/tmp\/haltija-screenshots\/hj-.*\.png$/)
    expect(shot.width).toBeGreaterThan(0)
    expect(shot.height).toBeGreaterThan(0)
    // Verify file exists
    if (shot.path) {
      expect(existsSync(shot.path)).toBe(true)
    }
  })

  test('tree returns DOM structure', async () => {
    if (skipUnlessServer()) return
    const tree = await hj.tree({ depth: 2 })
    expect(tree).toBeDefined()
  })
})

describe('JSON test suite runner', () => {
  test('runFile executes a single test', async () => {
    if (skipUnlessServer()) return
    const result = await hj.runFile('tests/playground.json')
    expect(result.passed).toBe(true)
    expect(result.summary.failed).toBe(0)
  }, 60_000)

  test('runFile throws HaltijaTestError on failure', async () => {
    if (skipUnlessServer()) return
    const { HaltijaTestError } = await import('../src/test')
    try {
      await hj.runFile('tests/fixtures/will-fail.json')
      throw new Error('Expected HaltijaTestError')
    } catch (err) {
      if (err instanceof HaltijaTestError) {
        expect(err.summary).toBeDefined()
        expect(err.results).toBeDefined()
        expect(err.summary.failed).toBeGreaterThan(0)
        expect(err.message).toContain('failed')
      } else {
        throw err
      }
    }
  }, 30_000)

  test('suite runs all tests in a directory', async () => {
    if (skipUnlessServer()) return
    const { HaltijaTestError } = await import('../src/test')
    try {
      const result = await hj.suite('tests', {
        stopOnFailure: false,
        patience: 3,
      })
      // If no failures, just verify results
      expect(result.summary.total).toBeGreaterThan(0)
      expect(result.summary.passed).toBeGreaterThan(0)
    } catch (err) {
      // Some tests reference elements not on the current page — that's expected
      if (err instanceof HaltijaTestError) {
        expect(err.summary.total).toBeGreaterThan(0)
        expect(err.summary.passed).toBeGreaterThan(0)
      } else {
        throw err
      }
    }
  }, 120_000)
})
