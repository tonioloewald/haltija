/**
 * Haltija - Browser Control for AI Agents
 * https://github.com/anthropics/claude-code
 * 
 * Copyright 2025 Tonio Loewald
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Dev Channel Client
 * 
 * REST client for agents/CLI to communicate with the tosijs-dev server.
 * This is what Claude Code or other agents would use.
 */

import type {
  DevResponse,
  DomElement,
  ConsoleEntry,
  RecordingSession,
  SyntheticEventRequest,
  DevChannelTest,
  TestStep,
  TestResult,
  StepResult,
  TestAssertion,
} from './types'

export class DevChannelClient {
  private baseUrl: string
  
  constructor(serverUrl = 'http://localhost:8700') {
    this.baseUrl = serverUrl
  }
  
  // ==========================================
  // Low-level API
  // ==========================================
  
  async status(): Promise<{ browsers: number; agents: number; bufferedMessages: number }> {
    const res = await fetch(`${this.baseUrl}/status`)
    return res.json()
  }
  
  async send(channel: string, action: string, payload: any): Promise<{ success: boolean; id: string }> {
    const res = await fetch(`${this.baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, action, payload }),
    })
    return res.json()
  }
  
  async request(channel: string, action: string, payload: any, timeout = 5000): Promise<DevResponse> {
    const res = await fetch(`${this.baseUrl}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, action, payload, timeout }),
    })
    return res.json()
  }
  
  // ==========================================
  // DOM Queries
  // ==========================================
  
  async query(selector: string): Promise<DomElement | null> {
    const res = await fetch(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector, all: false }),
    })
    const response: DevResponse = await res.json()
    return response.success ? response.data : null
  }
  
  async queryAll(selector: string): Promise<DomElement[]> {
    const res = await fetch(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector, all: true }),
    })
    const response: DevResponse = await res.json()
    return response.success ? response.data : []
  }
  
  // ==========================================
  // Console
  // ==========================================
  
  async getConsole(since = 0): Promise<ConsoleEntry[]> {
    const res = await fetch(`${this.baseUrl}/console?since=${since}`)
    const response: DevResponse = await res.json()
    return response.success ? response.data : []
  }
  
  async clearConsole(): Promise<void> {
    await this.request('console', 'clear', {})
  }
  
  // ==========================================
  // Eval
  // ==========================================
  
  async eval(code: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Eval failed')
    }
    return response.data
  }
  
  // ==========================================
  // Interactions
  // ==========================================
  
  async click(selector: string, options?: { x?: number; y?: number }): Promise<void> {
    const res = await fetch(`${this.baseUrl}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector, options }),
    })
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || `Click failed on ${selector}`)
    }
  }
  
  async type(selector: string, text: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector, text }),
    })
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || `Type failed on ${selector}`)
    }
  }
  
  async dispatch(event: SyntheticEventRequest): Promise<void> {
    const response = await this.request('events', 'dispatch', event)
    if (!response.success) {
      throw new Error(response.error || 'Dispatch failed')
    }
  }
  
  async focus(selector: string): Promise<void> {
    await this.dispatch({ selector, event: 'focus' })
  }
  
  async blur(selector: string): Promise<void> {
    await this.dispatch({ selector, event: 'blur' })
  }
  
  async press(key: string, modifiers?: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean }): Promise<void> {
    await this.dispatch({
      selector: 'body',
      event: 'keydown',
      options: {
        key,
        altKey: modifiers?.alt,
        ctrlKey: modifiers?.ctrl,
        metaKey: modifiers?.meta,
        shiftKey: modifiers?.shift,
      },
    })
  }
  
  // ==========================================
  // Navigation
  // ==========================================
  
  async refresh(hard = false): Promise<void> {
    const res = await fetch(`${this.baseUrl}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hard }),
    })
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Refresh failed')
    }
  }
  
  async navigate(url: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Navigate failed')
    }
  }
  
  async getLocation(): Promise<{ url: string; title: string; pathname: string; search: string; hash: string }> {
    const res = await fetch(`${this.baseUrl}/location`)
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Get location failed')
    }
    return response.data
  }
  
  // ==========================================
  // Recording
  // ==========================================
  
  async startRecording(name: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/recording/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Start recording failed')
    }
    return response.data.sessionId
  }
  
  async stopRecording(): Promise<RecordingSession> {
    const res = await fetch(`${this.baseUrl}/recording/stop`, {
      method: 'POST',
    })
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Stop recording failed')
    }
    return response.data
  }
  
  async replayRecording(session: RecordingSession, speed = 1): Promise<void> {
    const response = await this.request('recording', 'replay', { session, speed })
    if (!response.success) {
      throw new Error(response.error || 'Replay failed')
    }
  }
  
  // ==========================================
  // Build Events
  // ==========================================
  
  async publishBuild(event: { type: 'start' | 'complete' | 'error' | 'warning'; message?: string; file?: string; line?: number }): Promise<void> {
    await fetch(`${this.baseUrl}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  }
  
  // ==========================================
  // Event Watching
  // ==========================================
  
  async watchEvents(options: { selector?: string; events: string[] }): Promise<string> {
    const response = await this.request('events', 'watch', options)
    if (!response.success) {
      throw new Error(response.error || 'Watch failed')
    }
    return response.data.watchId
  }
  
  async unwatchEvents(watchId: string): Promise<void> {
    const response = await this.request('events', 'unwatch', { watchId })
    if (!response.success) {
      throw new Error(response.error || 'Unwatch failed')
    }
  }
  
  // ==========================================
  // Mutation Watching
  // ==========================================
  
  async watchMutations(options?: {
    root?: string
    childList?: boolean
    attributes?: boolean
    characterData?: boolean
    subtree?: boolean
    debounce?: number
  }): Promise<void> {
    const res = await fetch(`${this.baseUrl}/mutations/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    })
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Watch mutations failed')
    }
  }
  
  async unwatchMutations(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/mutations/unwatch`, {
      method: 'POST',
    })
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Unwatch mutations failed')
    }
  }
  
  async getMutationStatus(): Promise<{ watching: boolean; config: any }> {
    const res = await fetch(`${this.baseUrl}/mutations/status`)
    const response: DevResponse = await res.json()
    if (!response.success) {
      throw new Error(response.error || 'Get mutation status failed')
    }
    return response.data
  }
  
  async getMessages(since = 0): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/messages?since=${since}`)
    return res.json()
  }
  
  // ==========================================
  // High-level helpers for agents
  // ==========================================
  
  /**
   * Get a summary of interactive elements on the page
   */
  async getInteractiveElements(): Promise<{
    buttons: Array<{ selector: string; text: string }>
    links: Array<{ selector: string; text: string; href: string }>
    inputs: Array<{ selector: string; type?: string; name?: string; placeholder?: string }>
  }> {
    const [buttons, links, inputs] = await Promise.all([
      this.queryAll('button'),
      this.queryAll('a[href]'),
      this.queryAll('input, textarea, select'),
    ])
    
    return {
      buttons: buttons.map(el => ({
        selector: el.id ? `#${el.id}` : `button`,
        text: el.innerText?.slice(0, 50) || '',
      })),
      links: links.map(el => ({
        selector: el.id ? `#${el.id}` : `a[href="${el.attributes?.href}"]`,
        text: el.innerText?.slice(0, 50) || '',
        href: el.attributes?.href || '',
      })),
      inputs: inputs.map(el => ({
        selector: el.id ? `#${el.id}` : `${el.tagName}[name="${el.attributes?.name}"]`,
        type: el.attributes?.type,
        name: el.attributes?.name,
        placeholder: el.attributes?.placeholder,
      })),
    }
  }
  
  /**
   * Get custom elements (web components) on the page
   */
  async getCustomElements(): Promise<Record<string, { count: number; examples: any[] }>> {
    return this.eval(`
      Array.from(document.querySelectorAll('*'))
        .filter(el => el.tagName.includes('-'))
        .reduce((acc, el) => {
          const tag = el.tagName.toLowerCase()
          if (!acc[tag]) acc[tag] = { count: 0, examples: [] }
          acc[tag].count++
          if (acc[tag].examples.length < 3) {
            acc[tag].examples.push({
              id: el.id || null,
              classes: el.className?.split?.(' ')?.slice(0, 3) || [],
              text: el.textContent?.slice(0, 50)
            })
          }
          return acc
        }, {})
    `)
  }
  
  /**
   * Perform an action and wait for DOM to settle
   */
  async doAndWait(
    action: () => Promise<void>,
    options?: { timeout?: number; debounce?: number }
  ): Promise<{ mutations: any[]; duration: number }> {
    const timeout = options?.timeout || 2000
    const debounce = options?.debounce || 100
    
    // Start watching
    await this.watchMutations({ debounce })
    const startTime = Date.now()
    
    // Perform action
    await action()
    
    // Wait for mutations to settle
    let mutations: any[] = []
    let lastMutationTime = Date.now()
    
    while (Date.now() - startTime < timeout) {
      const messages = await this.getMessages(startTime)
      const newMutations = messages.filter(m => m.channel === 'mutations' && m.action === 'batch')
      
      if (newMutations.length > mutations.length) {
        mutations = newMutations
        lastMutationTime = Date.now()
      } else if (mutations.length > 0 && Date.now() - lastMutationTime > debounce * 2) {
        // Mutations have settled
        break
      }
      
      await new Promise(r => setTimeout(r, 50))
    }
    
    // Stop watching
    await this.unwatchMutations()
    
    return {
      mutations,
      duration: Date.now() - startTime,
    }
  }
  
  // ==========================================
  // Test Runner
  // ==========================================
  
  /**
   * Validate a test without executing it
   * Checks that all selectors in the test exist
   */
  async validateTest(test: DevChannelTest): Promise<{
    valid: boolean
    issues: Array<{ step: number; selector: string; error: string }>
    stepCount: number
  }> {
    const res = await fetch(`${this.baseUrl}/test/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(test),
    })
    return res.json()
  }
  
  /**
   * Run a test and return results
   */
  async runTest(test: DevChannelTest, options?: {
    stepDelay?: number
    timeout?: number
    stopOnFailure?: boolean
  }): Promise<TestResult> {
    const res = await fetch(`${this.baseUrl}/test/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test, ...options }),
    })
    const result = await res.json()
    
    // Map to TestResult format
    return {
      test,
      passed: result.passed,
      startTime: Date.now() - result.duration,
      endTime: Date.now(),
      steps: result.steps,
      error: result.steps.find((s: StepResult) => !s.passed)?.error,
    }
  }
  
  /**
   * Run multiple tests as a suite
   */
  async runTestSuite(tests: DevChannelTest[], options?: {
    testDelay?: number
    stepDelay?: number
    timeout?: number
    stopOnFailure?: boolean
  }): Promise<{
    duration: number
    results: TestResult[]
    summary: { total: number; executed: number; passed: number; failed: number }
  }> {
    const res = await fetch(`${this.baseUrl}/test/suite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tests, ...options }),
    })
    return res.json()
  }
  
  /**
   * Load a test from a JSON file or URL
   */
  async loadTest(source: string): Promise<DevChannelTest> {
    // If it looks like a URL, fetch it
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const res = await fetch(source)
      return res.json()
    }
    
    // Otherwise try to parse as JSON
    return JSON.parse(source)
  }
  
  /**
   * Print test results to console in a readable format
   */
  formatTestResult(result: TestResult): string {
    const lines: string[] = []
    const icon = result.passed ? '✓' : '✗'
    const status = result.passed ? 'PASSED' : 'FAILED'
    
    lines.push(`${icon} ${result.test.name} - ${status}`)
    lines.push(`  Duration: ${result.endTime - result.startTime}ms`)
    lines.push('')
    
    for (const step of result.steps) {
      const stepIcon = step.passed ? '  ✓' : '  ✗'
      const desc = step.description || `Step ${step.index + 1}`
      lines.push(`${stepIcon} ${desc}`)
      
      if (!step.passed && step.error) {
        lines.push(`      Error: ${step.error}`)
        if (step.purpose) {
          lines.push(`      Purpose: ${step.purpose}`)
        }
        if (step.context) {
          lines.push(`      Context: ${JSON.stringify(step.context)}`)
        }
      }
    }
    
    return lines.join('\n')
  }
}

// Default export for easy usage
export const devChannel = new DevChannelClient()
