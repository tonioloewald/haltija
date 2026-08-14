/**
 * Haltija integration tests using haltija/test helper.
 *
 * Requires a running haltija server with a connected browser.
 * Run: bunx haltija -f   (in another terminal)
 * Then: bun test tests/haltija.test.ts
 */

import { describe, test, expect } from 'bun:test'
import { HaltijaTestClient } from '../src/test'
import { existsSync } from 'fs'

const hj = new HaltijaTestClient()

/**
 * Probed at MODULE LOAD, not in `beforeAll`, so `describe.skipIf` can see it.
 *
 * These tests used to early-return out of each body when no server was reachable, and bun records
 * an early return as PASSED — so a clean checkout printed "Haltija server not available" and then
 * "11 pass", exit 0. A suite that reports success for work it did not do is the exact defect this
 * product exists to eliminate, sitting in our own tests. `beforeAll` cannot fix it: it runs after
 * registration, so a flag it sets is always false when `skipIf` is evaluated.
 *
 * Skipped now reports as SKIPPED, which is a third state and not a pass.
 */
const serverAvailable = await hj
  .waitForServer(3000)
  .then(() => true)
  .catch(() => {
    console.log('Haltija server not available — these integration tests will report as SKIPPED')
    console.log('Run: bunx haltija --private --headless   (or `bunx haltija -f`)')
    return false
  })

describe.skipIf(!serverAvailable)('haltija/test helper', () => {
  test('waitForServer resolves when server is running', async () => {
    // Already confirmed in beforeAll — just verify status works
    const status = await hj.status()
    expect(status).toBeDefined()
  })

  test('windows() returns connected browsers', async () => {
    const w = await hj.windows()
    expect(w.count).toBeGreaterThan(0)
    expect(w.windows.length).toBeGreaterThan(0)
  })

  test('navigate and getLocation', async () => {
    await hj.navigate('http://localhost:8700/test')
    // Small delay for navigation
    await new Promise(r => setTimeout(r, 500))
    const loc = await hj.getLocation()
    expect(loc.url).toContain('localhost:8700')
  })

  test('eval runs JavaScript in browser', async () => {
    const result = await hj.eval('1 + 1')
    expect(result).toBe(2)
  })

  test('query finds DOM elements', async () => {
    await hj.navigate('http://localhost:8700/test')
    await new Promise(r => setTimeout(r, 500))
    const el = await hj.query('h1')
    expect(el).not.toBeNull()
    expect(el?.tagName?.toLowerCase()).toBe('h1')
  })

  test('click interacts with elements', async () => {
    // Click a tab on the playground
    await hj.click('[data-tab="playground"]')
    await new Promise(r => setTimeout(r, 300))
    const result = await hj.eval('document.querySelector("[data-tab=playground]")?.classList.contains("active")')
    expect(result).toBe(true)
  })

  test('screenshot returns file path', async () => {
    const shot = await hj.screenshot()
    // Deliberately NOT anchored at `/tmp` (nor at this process's `tmpdir()`): the path is chosen by
    // the *server*, which is a separate process and may have a different TMPDIR — on macOS it is
    // `/var/folders/…`, so the old `/tmp/…` anchor could never pass here. What IS a contract is the
    // directory name, the `hj-` prefix, and the extension; the `existsSync` below then pins that the
    // file is really there, on this machine, at that path.
    expect(shot.path).toMatch(/^\/.*\/haltija-screenshots\/hj-[^/]*\.png$/)
    expect(shot.width).toBeGreaterThan(0)
    expect(shot.height).toBeGreaterThan(0)
    // Verify file exists
    if (shot.path) {
      expect(existsSync(shot.path)).toBe(true)
    }
  })

  test('tree returns DOM structure', async () => {
    const tree = await hj.tree({ depth: 2 })
    expect(tree).toBeDefined()
  })
})

describe.skipIf(!serverAvailable)('JSON test suite runner', () => {
  test('runFile executes a single test', async () => {
    const result = await hj.runFile('tests/playground.json')
    expect(result.passed).toBe(true)
    expect(result.summary.failed).toBe(0)
  }, 60_000)

  test('runFile throws HaltijaTestError on failure', async () => {
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
