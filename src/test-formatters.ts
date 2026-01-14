/**
 * Test Result Formatters
 *
 * Formats test results for different consumers:
 * - json: Structured data (default, for programmatic use)
 * - github: Annotations + markdown summary (for GitHub Actions)
 * - human: Readable terminal output
 */

import type { StepResult, DevChannelTest } from './types'

export type OutputFormat = 'json' | 'github' | 'human'

export interface TestRunResult {
  test: string
  passed: boolean
  duration: number
  snapshotId?: string
  steps: StepResult[]
  summary: {
    total: number
    executed: number
    passed: number
    failed: number
  }
}

export interface SuiteRunResult {
  duration: number
  results: TestRunResult[]
  summary: {
    total: number
    executed: number
    passed: number
    failed: number
  }
}

// ============================================
// GitHub Format
// ============================================

/**
 * Format a single test result for GitHub Actions.
 * Returns annotations + markdown summary separated by ---SUMMARY---
 */
export function formatTestGitHub(result: TestRunResult, test: DevChannelTest, testFile?: string): string {
  const lines: string[] = []

  // Annotations for failed steps
  for (const step of result.steps.filter(s => !s.passed)) {
    const annotation = buildAnnotation(step, test, testFile)
    lines.push(annotation)
  }

  // Separator and summary
  lines.push('')
  lines.push('---SUMMARY---')
  lines.push(buildTestSummary(result, test))

  return lines.join('\n')
}

/**
 * Format a test suite result for GitHub Actions.
 */
export function formatSuiteGitHub(result: SuiteRunResult, tests: DevChannelTest[], testFiles?: string[]): string {
  const lines: string[] = []

  // Annotations for all failed steps across all tests
  result.results.forEach((testResult, i) => {
    const test = tests[i]
    const testFile = testFiles?.[i]
    for (const step of testResult.steps.filter(s => !s.passed)) {
      lines.push(buildAnnotation(step, test, testFile))
    }
  })

  // Summary
  lines.push('')
  lines.push('---SUMMARY---')
  lines.push(buildSuiteSummary(result, tests))

  return lines.join('\n')
}

function buildAnnotation(step: StepResult, test: DevChannelTest, testFile?: string): string {
  const title = buildFailureTitle(step, test)
  const message = buildFailureMessage(step)

  // File reference for clickable links in GitHub UI
  const file = testFile ? `file=${testFile},` : ''

  return `::error ${file}title=${escapeAnnotation(title)}::${escapeAnnotation(message)}`
}

function buildFailureTitle(step: StepResult, test: DevChannelTest): string {
  const stepDesc = step.description || `Step ${step.index + 1}`
  const purpose = step.purpose ? ` (${step.purpose})` : ''
  return `${stepDesc}${purpose}`
}

function buildFailureMessage(step: StepResult): string {
  const parts: string[] = []

  // What went wrong
  const reason = step.context?.reason || step.error || 'Unknown error'
  parts.push(reason)

  // What we found instead
  if (step.context?.buttonsOnPage?.length) {
    parts.push(`Page shows: ${step.context.buttonsOnPage.join(', ')}`)
  }
  if (step.context?.actual !== undefined && step.context?.expected !== undefined) {
    parts.push(`Expected "${step.context.expected}", got "${step.context.actual}"`)
  }

  // Suggestion
  if (step.context?.suggestion) {
    parts.push(step.context.suggestion)
  }

  return parts.join('. ')
}

function buildTestSummary(result: TestRunResult, test: DevChannelTest): string {
  const icon = result.passed ? '✅' : '❌'
  const lines: string[] = []

  lines.push(`## ${icon} ${test.name}`)
  lines.push('')

  if (test.description) {
    lines.push(`> ${test.description}`)
    lines.push('')
  }

  if (!result.passed) {
    const failed = result.steps.filter(s => !s.passed)
    for (const step of failed) {
      lines.push(`### Step ${step.index + 1}: ${step.description || 'Unknown step'}`)
      lines.push('')

      if (step.purpose) {
        lines.push(`**Tried to:** ${step.purpose}`)
      }

      lines.push(`**What happened:** ${step.context?.reason || step.error || 'Unknown error'}`)

      if (step.context?.buttonsOnPage?.length) {
        lines.push(`**What's on the page:** ${step.context.buttonsOnPage.join(', ')}`)
      }

      if (step.context?.actual !== undefined) {
        lines.push(`**Expected:** ${step.context.expected}`)
        lines.push(`**Actual:** ${step.context.actual}`)
      }

      if (step.context?.suggestion) {
        lines.push(`**Likely cause:** ${step.context.suggestion}`)
      }

      if (step.step.planRef) {
        lines.push(`**Plan:** ${step.step.planRef}`)
      }

      lines.push('')
    }
  }

  // Stats table
  lines.push('| Metric | Value |')
  lines.push('|--------|-------|')
  lines.push(`| Duration | ${result.duration}ms |`)
  lines.push(`| Steps | ${result.summary.passed}/${result.summary.total} passed |`)

  if (result.snapshotId) {
    lines.push(`| Snapshot | ${result.snapshotId} |`)
  }

  return lines.join('\n')
}

function buildSuiteSummary(result: SuiteRunResult, tests: DevChannelTest[]): string {
  const icon = result.summary.failed === 0 ? '✅' : '❌'
  const lines: string[] = []

  lines.push(`## ${icon} Test Suite Results`)
  lines.push('')
  lines.push(`**${result.summary.passed}/${result.summary.total} tests passed** in ${result.duration}ms`)
  lines.push('')

  // Results table
  lines.push('| Test | Status | Duration | Issue |')
  lines.push('|------|--------|----------|-------|')

  result.results.forEach((testResult, i) => {
    const test = tests[i]
    const status = testResult.passed ? '✅' : '❌'
    const issue = testResult.passed
      ? ''
      : (testResult.steps.find(s => !s.passed)?.description || 'Unknown')
    lines.push(`| ${test.name} | ${status} | ${testResult.duration}ms | ${issue} |`)
  })

  lines.push('')

  // Details for failed tests
  const failedResults = result.results.filter(r => !r.passed)
  if (failedResults.length > 0) {
    lines.push('---')
    lines.push('')
    for (let i = 0; i < result.results.length; i++) {
      if (!result.results[i].passed) {
        lines.push(buildTestSummary(result.results[i], tests[i]))
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

// ============================================
// Human-Readable Format
// ============================================

/**
 * Format a single test result for human reading in terminal.
 */
export function formatTestHuman(result: TestRunResult, test: DevChannelTest): string {
  const lines: string[] = []
  const icon = result.passed ? '✓' : '✗'
  const color = result.passed ? '\x1b[32m' : '\x1b[31m'
  const reset = '\x1b[0m'

  lines.push(`${color}${icon} ${test.name}${reset} (${result.duration}ms)`)

  if (!result.passed) {
    const failed = result.steps.filter(s => !s.passed)
    for (const step of failed) {
      lines.push('')
      lines.push(`  ${color}Step ${step.index + 1}:${reset} ${step.description || 'Unknown step'}`)

      if (step.purpose) {
        lines.push(`  Tried to: ${step.purpose}`)
      }

      lines.push(`  ${color}Error:${reset} ${step.context?.reason || step.error || 'Unknown error'}`)

      if (step.context?.buttonsOnPage?.length) {
        lines.push(`  Page shows: ${step.context.buttonsOnPage.join(', ')}`)
      }

      if (step.context?.actual !== undefined) {
        lines.push(`  Expected: ${step.context.expected}`)
        lines.push(`  Actual: ${step.context.actual}`)
      }

      if (step.context?.suggestion) {
        lines.push(`  ${color}Likely:${reset} ${step.context.suggestion}`)
      }
    }
  }

  lines.push('')
  lines.push(`  ${result.summary.passed}/${result.summary.total} steps passed`)

  return lines.join('\n')
}

/**
 * Format a test suite result for human reading.
 */
export function formatSuiteHuman(result: SuiteRunResult, tests: DevChannelTest[]): string {
  const lines: string[] = []
  const icon = result.summary.failed === 0 ? '✓' : '✗'
  const color = result.summary.failed === 0 ? '\x1b[32m' : '\x1b[31m'
  const reset = '\x1b[0m'

  lines.push(`${color}${icon} Test Suite${reset} (${result.duration}ms)`)
  lines.push(`  ${result.summary.passed}/${result.summary.total} tests passed`)
  lines.push('')

  result.results.forEach((testResult, i) => {
    lines.push(formatTestHuman(testResult, tests[i]))
    lines.push('')
  })

  return lines.join('\n')
}

// ============================================
// Helpers
// ============================================

/**
 * Escape special characters for GitHub annotation format.
 * Newlines, %, :, and , need escaping.
 */
function escapeAnnotation(str: string): string {
  return str
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C')
}

/**
 * Infer a likely cause from the failure context.
 */
export function inferSuggestion(
  step: { selector?: string; description?: string },
  pageContext: { buttonsOnPage?: string[]; inputsOnPage?: string[] }
): string | undefined {
  const desc = step.description?.toLowerCase() || ''
  const buttons = pageContext.buttonsOnPage || []

  // Check for possible locale issue
  const englishWords = ['submit', 'cancel', 'ok', 'save', 'delete', 'confirm', 'next', 'back', 'continue']
  const hasEnglishInDesc = englishWords.some(w => desc.includes(w))
  const hasNonEnglishButtons = buttons.some(b => {
    const lower = b.toLowerCase()
    return !englishWords.includes(lower) && /[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(lower)
  })

  if (hasEnglishInDesc && hasNonEnglishButtons) {
    return 'Page may be in a different locale than expected'
  }

  // Check if element might be conditional
  if (buttons.length === 0) {
    return 'No interactive elements found - page may not have loaded or element is conditionally rendered'
  }

  // Check for similar button names (typo or rename)
  const selectorText = step.description?.match(/["']([^"']+)["']/)?.[1]?.toLowerCase()
  if (selectorText && buttons.length > 0) {
    const similar = buttons.find(b => {
      const lower = b.toLowerCase()
      return lower.includes(selectorText.slice(0, 3)) || selectorText.includes(lower.slice(0, 3))
    })
    if (similar) {
      return `Button may have been renamed - found "${similar}" which looks similar`
    }
  }

  return undefined
}
