/**
 * Text formatter for Haltija test results
 *
 * Flat step list, agent-scannable and human-readable.
 *
 *   ok Login flow 2340ms 7/7
 *     1 ok navigate /login 120ms
 *     2 ok type #email "user@example.com" 85ms
 *     3 ok click button[type=submit] 200ms
 *     4 FAIL wait .dashboard 5000ms timeout
 *       > element not found, page shows: [.error-message]
 *     5 skip assert url /dashboard
 *   patience 4/5 remaining streak=1 timeout=7000ms
 *   ---
 *   hj test-run --json
 */

/**
 * Format a single test result
 * @param {object} result - TestRunResult from POST /test/run
 * @returns {string} formatted text output with footer
 */
export function formatTestResult(result) {
  if (!result) return '(no result)\n---\nhj test-run --json'

  const lines = []
  const status = result.passed ? 'ok' : 'FAIL'
  const name = result.test || 'unnamed'
  const duration = result.duration ? `${result.duration}ms` : ''
  const counts = result.summary
    ? `${result.summary.passed}/${result.summary.total}`
    : ''

  // Header
  lines.push([status, name, duration, counts].filter(Boolean).join(' '))

  // Steps
  if (result.steps) {
    for (const step of result.steps) {
      const stepStatus = step.passed ? 'ok' : (step.error === 'skipped' ? 'skip' : 'FAIL')
      const desc = formatStepDescription(step)
      const dur = step.duration ? `${step.duration}ms` : ''
      const err = (!step.passed && step.error && step.error !== 'skipped')
        ? step.error
        : ''

      lines.push(`  ${step.index + 1} ${[stepStatus, desc, dur, err].filter(Boolean).join(' ')}`)

      // Failure context detail
      if (!step.passed && step.context) {
        const detail = formatFailureContext(step.context)
        if (detail) lines.push(`    > ${detail}`)
      }
    }
  }

  // Patience stats
  if (result.patience) {
    const p = result.patience
    lines.push(`  patience ${p.remaining}/${p.allowed} remaining streak=${p.consecutiveFailures}/${p.streak} timeout=${p.finalTimeoutMs}ms`)
  }

  // Footer
  lines.push('---')
  lines.push('hj test-run --json')

  return lines.join('\n')
}

/**
 * Format a suite result
 * @param {object} result - SuiteRunResult from POST /test/suite
 * @returns {string} formatted text output with footer
 */
export function formatSuiteResult(result) {
  if (!result) return '(no result)\n---\nhj test-run --json'

  const lines = []
  const status = result.summary?.failed === 0 ? 'ok' : 'FAIL'
  const duration = result.duration ? `${result.duration}ms` : ''
  const counts = result.summary
    ? `${result.summary.passed}/${result.summary.total} tests`
    : ''

  // Header
  lines.push([status, 'suite', duration, counts].filter(Boolean).join(' '))

  // Per-test summary lines
  if (result.results) {
    for (const testResult of result.results) {
      const tStatus = testResult.passed ? 'ok' : 'FAIL'
      const name = testResult.test || 'unnamed'
      const dur = testResult.duration ? `${testResult.duration}ms` : ''
      const tCounts = testResult.summary
        ? `${testResult.summary.passed}/${testResult.summary.total}`
        : ''
      lines.push(`  ${[tStatus, name, dur, tCounts].filter(Boolean).join(' ')}`)

      // Show first failure for failed tests
      if (!testResult.passed && testResult.steps) {
        const failed = testResult.steps.find(s => !s.passed)
        if (failed) {
          const desc = formatStepDescription(failed)
          const err = failed.error || ''
          lines.push(`    step ${failed.index + 1}: ${[desc, err].filter(Boolean).join(' ')}`)
          if (failed.context) {
            const detail = formatFailureContext(failed.context)
            if (detail) lines.push(`    > ${detail}`)
          }
        }
      }
    }
  }

  // Footer
  lines.push('---')
  lines.push('hj test-run --json')

  return lines.join('\n')
}

/**
 * Extract action + key identifier from a step
 */
function formatStepDescription(step) {
  const s = step.step || step
  const action = s.action || step.description || ''

  switch (action) {
    case 'navigate':
      return `navigate ${s.url || ''}`
    case 'click':
      return `click ${s.selector || s.ref || ''}`
    case 'type':
      return `type ${s.selector || s.ref || ''} "${truncate(s.text || '', 30)}"`
    case 'key':
      return `key ${s.key || ''}`
    case 'wait':
      return `wait ${s.selector || s.url || (s.duration != null ? s.duration + 'ms' : '') || ''}`
    case 'assert': {
      const a = s.assertion || {}
      const sel = a.selector || ''
      const val = a.text || a.value || a.pattern || ''
      return `assert ${a.type || ''} ${sel} ${val ? '"' + truncate(val, 30) + '"' : ''}`.trim()
    }
    case 'check':
      return `check ${s.selector || ''}`
    case 'eval':
      return `eval ${truncate(s.code || '', 40)}`
    case 'verify':
      return `verify ${truncate(s.eval || '', 40)}`
    case 'tabs-open':
      return `tabs-open ${s.url || ''}`
    case 'tabs-close':
      return `tabs-close ${s.window || ''}`
    case 'tabs-focus':
      return `tabs-focus ${s.window || ''}`
    default:
      return step.description || action || 'unknown'
  }
}

/**
 * Format failure context into a single line
 */
function formatFailureContext(context) {
  const parts = []

  if (context.reason) {
    parts.push(context.reason)
  }

  if (context.buttonsOnPage?.length) {
    parts.push(`page shows: [${context.buttonsOnPage.join(', ')}]`)
  }

  if (context.actual !== undefined && context.expected !== undefined) {
    parts.push(`expected "${context.expected}" got "${context.actual}"`)
  }

  if (context.suggestion) {
    parts.push(context.suggestion)
  }

  return parts.join(', ')
}

function truncate(str, max) {
  if (!str || str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}
