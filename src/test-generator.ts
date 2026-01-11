/**
 * Haltija - Browser Control for AI Agents
 * https://github.com/anthropics/claude-code
 * 
 * Copyright 2025 Tonio Loewald
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Test Generator
 * 
 * Converts semantic events from the Context History Stream into
 * executable test steps in the DevChannelTest format.
 */

import type {
  SemanticEvent,
  DevChannelTest,
  TestStep,
  ClickStep,
  TypeStep,
  NavigateStep,
  AssertStep,
  WaitStep,
} from './types'

export interface TestGeneratorOptions {
  /** Test name */
  name: string
  /** Test description */
  description?: string
  /** URL the test was recorded on */
  url: string
  /** Add assertions after key actions */
  addAssertions?: boolean
  /** Minimum delay between steps (ms) */
  minDelay?: number
  /** Who created the test */
  createdBy?: 'human' | 'ai'
  /** Tags for categorization */
  tags?: string[]
}

/**
 * Convert semantic events to a test definition
 */
export function semanticEventsToTest(
  events: SemanticEvent[],
  options: TestGeneratorOptions
): DevChannelTest {
  const steps: TestStep[] = []
  let lastTimestamp = 0
  
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const nextEvent = events[i + 1]
    
    // Calculate delay from previous action
    const delay = lastTimestamp > 0 
      ? Math.max(0, event.timestamp - lastTimestamp)
      : 0
    
    const step = eventToStep(event, {
      delay: options.minDelay ? Math.max(delay, options.minDelay) : delay,
      addAssertions: options.addAssertions,
      nextEvent,
    })
    
    if (step) {
      if (Array.isArray(step)) {
        steps.push(...step)
      } else {
        steps.push(step)
      }
      lastTimestamp = event.timestamp
    }
  }
  
  return {
    version: 1,
    name: options.name,
    description: options.description,
    url: options.url,
    createdAt: Date.now(),
    createdBy: options.createdBy || 'human',
    tags: options.tags,
    steps,
  }
}

interface StepConversionOptions {
  delay: number
  addAssertions?: boolean
  nextEvent?: SemanticEvent
}

/**
 * Convert a single semantic event to one or more test steps
 */
function eventToStep(
  event: SemanticEvent, 
  options: StepConversionOptions
): TestStep | TestStep[] | null {
  const { delay, addAssertions, nextEvent } = options
  
  switch (event.type) {
    case 'interaction:click': {
      const step: ClickStep = {
        action: 'click',
        selector: event.target?.selector || '',
        description: describeClick(event),
        purpose: event.target?.text 
          ? `Click "${truncate(event.target.text, 30)}" button/link`
          : undefined,
      }
      if (delay > 100) step.delay = delay
      
      // If next event is navigation, add URL assertion
      if (addAssertions && nextEvent?.type === 'navigation:navigate') {
        const assertStep: AssertStep = {
          action: 'assert',
          assertion: {
            type: 'url',
            pattern: (nextEvent.payload as any).to,
          },
          description: `Verify navigation to ${(nextEvent.payload as any).to}`,
          purpose: 'Confirm the click triggered expected navigation',
        }
        return [step, assertStep]
      }
      
      return step
    }
    
    case 'input:typed': {
      const payload = event.payload as {
        text: string
        field: string
        fieldType?: string
        finalValue: string
      }
      
      const step: TypeStep = {
        action: 'type',
        selector: payload.field || event.target?.selector || '',
        text: payload.text,
        description: describeType(event),
        purpose: payload.fieldType 
          ? `Enter ${payload.fieldType} value`
          : 'Fill in form field',
      }
      if (delay > 100) step.delay = delay
      
      // Add value assertion if requested
      if (addAssertions) {
        const assertStep: AssertStep = {
          action: 'assert',
          assertion: {
            type: 'value',
            selector: step.selector,
            expected: payload.finalValue,
          },
          description: `Verify field contains "${truncate(payload.finalValue, 20)}"`,
          purpose: 'Confirm input was accepted',
        }
        return [step, assertStep]
      }
      
      return step
    }
    
    case 'interaction:submit': {
      const payload = event.payload as {
        formId?: string
        formAction?: string
      }
      
      // Submit is usually triggered by click or Enter key
      // Add a wait for navigation/response
      const waitStep: WaitStep = {
        action: 'wait',
        wait: { type: 'network', timeout: 5000 },
        description: 'Wait for form submission to complete',
        purpose: 'Allow server to process the form',
      }
      
      return waitStep
    }
    
    case 'navigation:navigate': {
      const payload = event.payload as {
        from: string
        to: string
        trigger: string
      }
      
      // If triggered by script or initial load, it's a navigate step
      if (payload.trigger === 'initial' || payload.trigger === 'script') {
        const step: NavigateStep = {
          action: 'navigate',
          url: payload.to,
          description: `Navigate to ${payload.to}`,
          purpose: 'Go to the target page',
        }
        return step
      }
      
      // For click/submit triggered navigations, skip - the click handler adds the assertion
      return null
    }
    
    case 'interaction:drag': {
      // Drag events - could be converted to drag step if we add one
      // For now, skip or add as comment
      return null
    }
    
    case 'scroll:stop': {
      // Scrolling is usually not needed in tests
      // Could add a scroll step if the element needs to be in view
      return null
    }
    
    case 'hover:dwell': {
      // Long hovers might indicate tooltip/menu interaction
      // Skip for now
      return null
    }
    
    case 'focus:in':
    case 'focus:out': {
      // Focus events are implicit in click/type
      return null
    }
    
    case 'mutation:change': {
      // Mutations could become assertions
      if (addAssertions) {
        const payload = event.payload as {
          changeType: string
          element: string
          text?: string
        }
        
        if (payload.changeType === 'text' && payload.text) {
          const step: AssertStep = {
            action: 'assert',
            assertion: {
              type: 'text',
              selector: payload.element,
              expected: truncate(payload.text, 100),
            },
            description: `Verify text changed to "${truncate(payload.text, 30)}"`,
            purpose: 'Confirm UI updated correctly',
          }
          return step
        }
        
        if (payload.changeType === 'added') {
          const step: AssertStep = {
            action: 'assert',
            assertion: {
              type: 'exists',
              selector: payload.element,
            },
            description: `Verify element ${payload.element} appears`,
            purpose: 'Confirm element was added to DOM',
          }
          return step
        }
      }
      return null
    }
    
    case 'console:error': {
      // Console errors could be assertions (expect no errors, or expect specific error)
      return null
    }
    
    default:
      return null
  }
}

/**
 * Generate a human-readable description for a click event
 */
function describeClick(event: SemanticEvent): string {
  const target = event.target
  if (!target) return 'Click element'
  
  if (target.text) {
    return `Click "${truncate(target.text, 30)}"`
  }
  if (target.label) {
    return `Click ${target.label}`
  }
  if (target.role) {
    return `Click ${target.role}`
  }
  return `Click ${target.tag}${target.id ? '#' + target.id : ''}`
}

/**
 * Generate a human-readable description for a type event
 */
function describeType(event: SemanticEvent): string {
  const payload = event.payload as { text: string; fieldType?: string }
  const target = event.target
  
  const fieldName = target?.label || target?.id || payload.fieldType || 'field'
  const textPreview = payload.text.length > 20 
    ? payload.text.slice(0, 20) + '...'
    : payload.text
  
  return `Type "${textPreview}" in ${fieldName}`
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

/**
 * Suggest assertions based on the current page state
 */
export function suggestAssertions(
  events: SemanticEvent[]
): AssertStep[] {
  const suggestions: AssertStep[] = []
  
  // Find the last navigation
  const lastNav = [...events].reverse().find(e => e.type === 'navigation:navigate')
  if (lastNav) {
    suggestions.push({
      action: 'assert',
      assertion: {
        type: 'url',
        pattern: (lastNav.payload as any).to,
      },
      description: 'Verify final URL',
      purpose: 'Confirm user ended up on the expected page',
    })
  }
  
  // Find any error mutations (elements with .error class or [aria-invalid])
  const errorMutations = events.filter(e => 
    e.type === 'mutation:change' && 
    (e.target?.selector?.includes('error') || e.target?.selector?.includes('invalid'))
  )
  
  if (errorMutations.length > 0) {
    suggestions.push({
      action: 'assert',
      assertion: {
        type: 'not-exists',
        selector: '.error, [aria-invalid="true"]',
      },
      description: 'Verify no error messages',
      purpose: 'Confirm form submission succeeded without errors',
    })
  }
  
  // Find console errors
  const consoleErrors = events.filter(e => e.type === 'console:error')
  if (consoleErrors.length > 0) {
    suggestions.push({
      action: 'assert',
      assertion: {
        type: 'console-empty',
        level: 'error',
      },
      description: 'Verify no console errors',
      purpose: 'Confirm page loaded without JavaScript errors',
    })
  }
  
  return suggestions
}
