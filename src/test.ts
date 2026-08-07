/**
 * Haltija Test Helper
 *
 * Ergonomic test API for use in .test.ts files with any test runner.
 *
 * Usage:
 *   import { hj } from 'haltija/test'
 *
 *   test('login works', async () => {
 *     await hj.waitForServer()
 *     await hj.navigate('http://localhost:3000/login')
 *     await hj.type('#email', 'user@test.com')
 *     await hj.click('button[type=submit]')
 *     const loc = await hj.getLocation()
 *     expect(loc.pathname).toBe('/dashboard')
 *   })
 *
 *   test('all JSON tests pass', async () => {
 *     await hj.suite('./tests')
 *   })
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { DevChannelClient } from './client'
import type { DevChannelTest } from './types'
import type { TestRunResult, SuiteRunResult } from './test-formatters'
import { formatTestHuman, formatSuiteHuman } from './test-formatters'

// ============================================
// Error Types
// ============================================

/** Rich error thrown when tests fail — carries structured results */
export class HaltijaTestError extends Error {
  results: TestRunResult | SuiteRunResult
  summary: { total: number; passed: number; failed: number }

  constructor(message: string, results: TestRunResult | SuiteRunResult, summary: { total: number; passed: number; failed: number }) {
    super(message)
    this.name = 'HaltijaTestError'
    this.results = results
    this.summary = summary
  }
}

// ============================================
// Options
// ============================================

export interface RunOptions {
  vars?: Record<string, string>
  patience?: number
  patienceStreak?: number
  timeout?: number
  stepDelay?: number
  stopOnFailure?: boolean
  timeoutBonusMs?: number
}

export interface SuiteOptions extends RunOptions {
  testDelay?: number
}

export interface ScreenshotOptions {
  selector?: string
  ref?: string
  format?: 'png' | 'webp' | 'jpeg'
  quality?: number
  scale?: number
  maxWidth?: number
  maxHeight?: number
  file?: boolean
  window?: string
}

// ============================================
// Template Variable Substitution
// ============================================

function substituteVars(text: string, vars: Record<string, string> = {}): string {
  return text.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const trimmed = varName.trim()
    // Skip GEN.* patterns — those are for the CLI's test data generator
    if (trimmed.startsWith('GEN.')) return match
    if (trimmed in vars) return vars[trimmed]
    if (trimmed in process.env) return process.env[trimmed]!
    return match
  })
}

/** Load a test file — handles both single tests (has `steps`) and suite files (has `tests` array) */
function loadTestFile(filePath: string, vars?: Record<string, string>): DevChannelTest[] {
  const content = readFileSync(filePath, 'utf-8')
  const processed = vars ? substituteVars(content, vars) : content
  const parsed = JSON.parse(processed)
  // Suite file: { name, tests: [...] }
  if (Array.isArray(parsed.tests)) {
    return parsed.tests as DevChannelTest[]
  }
  // Single test: { name, steps: [...] }
  return [parsed as DevChannelTest]
}

function expandTestDir(dir: string): string[] {
  const absDir = resolve(dir)
  const stat = statSync(absDir)
  if (!stat.isDirectory()) {
    // Single file
    return [absDir]
  }
  return readdirSync(absDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => join(absDir, f))
}

// ============================================
// Test Client
// ============================================

/**
 * Which server a test client talks to when it isn't told.
 *
 * The default was a hardcoded `http://localhost:8700` with NO env override — in the SHIPPED
 * `haltija/test` helper, so every adopter inherited it. On any machine running more than one
 * project, 8700 is a shared interactive server, and the client's only gate is "does /status answer
 * 200?", which is true of somebody else's server too. `hj.navigate()` then posts with no `window`
 * param, so it routes to whatever tab is focused: an integration suite silently drives a
 * developer's live browser, and the damage lands on the machine where it is least expected.
 *
 * `hj` has resolved this correctly for releases (--port > HALTIJA_PORT > cwd match > default). The
 * test helper simply never learned the ladder. It does now, minus the cwd step — a library has no
 * business inferring intent from the working directory.
 */
export function resolveTestServerUrl(env: Record<string, string | undefined> = process.env): {
  url: string
  source: 'HALTIJA_URL' | 'HALTIJA_PORT' | 'DEV_CHANNEL_PORT' | 'default'
} {
  if (env.HALTIJA_URL) return { url: env.HALTIJA_URL, source: 'HALTIJA_URL' }
  if (env.HALTIJA_PORT) return { url: `http://localhost:${env.HALTIJA_PORT}`, source: 'HALTIJA_PORT' }
  if (env.DEV_CHANNEL_PORT) return { url: `http://localhost:${env.DEV_CHANNEL_PORT}`, source: 'DEV_CHANNEL_PORT' }
  return { url: 'http://localhost:8700', source: 'default' }
}

export class HaltijaTestClient {
  private client: DevChannelClient
  readonly baseUrl: string

  constructor(serverUrl?: string) {
    const resolved = serverUrl ? { url: serverUrl, source: 'explicit' as const } : resolveTestServerUrl()
    this.baseUrl = resolved.url
    this.usingSharedDefault = resolved.source === 'default'
    this.client = new DevChannelClient(this.baseUrl)
  }

  private readonly usingSharedDefault: boolean
  private warned = false

  /**
   * Warn once, on first USE, that we are about to drive the shared default server.
   *
   * Deliberately not in the constructor: `export const hj = new HaltijaTestClient()` is a
   * module-scope singleton, so warning there fires on merely IMPORTING this module — including for
   * someone who imports `createClient` and passes an explicit URL, i.e. who did exactly the right
   * thing. A warning that fires when you are not making the mistake is how warnings get ignored,
   * and this one has to still be believed on the day it matters.
   *
   * On first request it is precisely accurate: we are about to send a command to a server we did
   * not choose, whose focused tab may belong to another project.
   */
  private warnIfSharedDefault(): void {
    if (this.warned || !this.usingSharedDefault || process.env.HALTIJA_TEST_QUIET) return
    this.warned = true
    process.stderr.write(
      '[haltija/test] no HALTIJA_URL or HALTIJA_PORT set — driving the shared default ' +
        'http://localhost:8700. Commands target whatever tab is focused there, which may belong ' +
        'to another project. Set HALTIJA_PORT to target your own instance ' +
        '(`haltija --private --headless` prints one).\n',
    )
  }

  // --- Lifecycle ---

  /** Poll until the haltija server responds. Throws after timeout. */
  async waitForServer(timeoutMs = 15000): Promise<void> {
    // Every documented flow starts here, and it is the last moment before this client starts
    // sending commands to a server nobody named.
    this.warnIfSharedDefault()
    const start = Date.now()
    const pollInterval = 500
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${this.baseUrl}/status`)
        if (res.ok) return
      } catch {}
      await new Promise(r => setTimeout(r, pollInterval))
    }
    throw new Error(`Haltija server not reachable at ${this.baseUrl} after ${timeoutMs}ms`)
  }

  /** Get server status */
  async status() {
    return this.client.status()
  }

  /** Get connected windows */
  async windows(): Promise<{ windows: any[]; focused: string | null; count: number }> {
    this.warnIfSharedDefault()
    const res = await fetch(`${this.baseUrl}/windows`)
    return res.json()
  }

  // --- DOM Queries ---

  async query(selector: string) { return this.client.query(selector) }
  async queryAll(selector: string) { return this.client.queryAll(selector) }

  // --- Interactions ---

  async click(selector: string, options?: { x?: number; y?: number }) {
    return this.client.click(selector, options)
  }

  async type(selector: string, text: string) {
    return this.client.type(selector, text)
  }

  async press(key: string, modifiers?: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean }) {
    return this.client.press(key, modifiers)
  }

  async focus(selector: string) { return this.client.focus(selector) }
  async blur(selector: string) { return this.client.blur(selector) }

  // --- Navigation ---

  async navigate(url: string) { return this.client.navigate(url) }
  async refresh(hard = false) { return this.client.refresh(hard) }
  async getLocation() { return this.client.getLocation() }

  // --- Eval ---

  async eval(code: string) { return this.client.eval(code) }

  // --- Console ---

  async getConsole(since = 0) { return this.client.getConsole(since) }

  // --- Screenshot ---

  async screenshot(options: ScreenshotOptions = {}): Promise<{ path?: string; image?: string; width: number; height: number; format: string; source: string }> {
    const res = await fetch(`${this.baseUrl}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: true, ...options }),
    })
    const response = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Screenshot failed')
    }
    return response.data
  }

  // --- Tree ---

  async tree(options: { selector?: string; depth?: number; compact?: boolean } = {}): Promise<any> {
    const res = await fetch(`${this.baseUrl}/tree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    })
    const response = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Tree failed')
    }
    return response.data
  }

  // --- JSON Test File Runner ---

  /** Run a single JSON test file. Throws HaltijaTestError on failure. */
  async runFile(filePath: string, options: RunOptions = {}): Promise<TestRunResult> {
    const tests = loadTestFile(resolve(filePath), options.vars)
    const { vars, ...serverOptions } = options

    // If file contains multiple tests (suite file), run as suite
    if (tests.length > 1) {
      const res = await fetch(`${this.baseUrl}/test/suite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tests, ...serverOptions }),
      })
      const text = await res.text()
      let suiteResult: SuiteRunResult
      try {
        suiteResult = JSON.parse(text)
      } catch {
        throw new Error(`Suite endpoint returned invalid JSON (status ${res.status}): ${text.slice(0, 200)}`)
      }
      // Convert to TestRunResult-like shape for consistent API
      const combined: TestRunResult = {
        test: tests[0]?.name || filePath,
        passed: suiteResult.summary.failed === 0,
        duration: suiteResult.duration,
        steps: suiteResult.results.flatMap(r => r.steps || []),
        summary: {
          total: suiteResult.summary.total,
          executed: suiteResult.summary.executed ?? suiteResult.summary.total,
          passed: suiteResult.summary.passed,
          failed: suiteResult.summary.failed,
        },
      }
      if (!combined.passed) {
        const formatted = formatSuiteHuman(suiteResult, tests)
        throw new HaltijaTestError(
          `Suite file "${filePath}" failed: ${suiteResult.summary.failed}/${suiteResult.summary.total} tests failed\n\n${formatted}`,
          suiteResult,
          suiteResult.summary,
        )
      }
      return combined
    }

    const test = tests[0]
    const res = await fetch(`${this.baseUrl}/test/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test, ...serverOptions }),
    })
    const text = await res.text()
    let result: TestRunResult
    try {
      result = JSON.parse(text)
    } catch {
      throw new Error(`Test run endpoint returned invalid JSON (status ${res.status}): ${text.slice(0, 200)}`)
    }

    if (!result.passed) {
      const formatted = formatTestHuman(result, test)
      throw new HaltijaTestError(
        `Test "${test.name}" failed: ${result.summary.failed}/${result.summary.total} steps failed\n\n${formatted}`,
        result,
        result.summary,
      )
    }

    return result
  }

  /** Run all JSON test files in a directory. Throws HaltijaTestError on failure. */
  async suite(dir: string, options: SuiteOptions = {}): Promise<SuiteRunResult> {
    const files = expandTestDir(resolve(dir))
    if (files.length === 0) {
      throw new Error(`No .json test files found in ${dir}`)
    }

    const tests = files.flatMap(f => loadTestFile(f, options.vars))
    const { vars, ...serverOptions } = options

    const res = await fetch(`${this.baseUrl}/test/suite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tests, ...serverOptions }),
    })
    const text = await res.text()
    let result: SuiteRunResult
    try {
      result = JSON.parse(text)
    } catch {
      throw new Error(`Suite endpoint returned invalid JSON (status ${res.status}): ${text.slice(0, 200)}`)
    }

    if (result.summary.failed > 0) {
      const formatted = formatSuiteHuman(result, tests)
      throw new HaltijaTestError(
        `Suite failed: ${result.summary.failed}/${result.summary.total} tests failed\n\n${formatted}`,
        result,
        result.summary,
      )
    }

    return result
  }

  // --- Mutation Watching ---

  async watchMutations(options?: Parameters<DevChannelClient['watchMutations']>[0]) {
    return this.client.watchMutations(options)
  }
  async unwatchMutations() { return this.client.unwatchMutations() }

  // --- Semantic Event Watching ---

  async watchEvents(options: { preset?: string; categories?: string[] } = {}): Promise<void> {
    const res = await fetch(`${this.baseUrl}/events/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    })
    const response = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Watch events failed')
    }
  }

  async unwatchEvents(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/events/unwatch`, {
      method: 'POST',
    })
    const response = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Unwatch events failed')
    }
  }

  async getEvents(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/events`)
    const response = await res.json()
    return response.success ? response.data : []
  }
}

// ============================================
// Default Instance & Factory
// ============================================

/** Pre-configured test client pointing at localhost:8700 */
export const hj = new HaltijaTestClient()

/** Create a test client for a custom server URL */
export function createTestClient(serverUrl: string): HaltijaTestClient {
  return new HaltijaTestClient(serverUrl)
}

// Re-export useful types
export type { DevChannelTest, TestRunResult, SuiteRunResult }
