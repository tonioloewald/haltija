import { describe, it, expect } from 'bun:test'
import { semanticEventsToTest, suggestAssertions } from './test-generator'
import type { SemanticEvent } from './types'

describe('semanticEventsToTest', () => {
  it('converts input:typed to TypeStep with assertion', () => {
    const events: SemanticEvent[] = [
      {
        type: 'input:typed',
        timestamp: 1000,
        category: 'input',
        target: { selector: '#email', tag: 'input', label: 'Email' },
        payload: { 
          text: 'user@example.com', 
          field: '#email', 
          fieldType: 'email', 
          finalValue: 'user@example.com',
          duration: 500 
        }
      }
    ]
    
    const test = semanticEventsToTest(events, {
      name: 'Test',
      url: 'http://localhost:3000',
      addAssertions: true,
    })
    
    expect(test.steps).toHaveLength(2)
    expect(test.steps[0].action).toBe('type')
    expect((test.steps[0] as any).text).toBe('user@example.com')
    expect(test.steps[1].action).toBe('assert')
    expect((test.steps[1] as any).assertion.type).toBe('value')
  })
  
  it('converts interaction:click to ClickStep', () => {
    const events: SemanticEvent[] = [
      {
        type: 'interaction:click',
        timestamp: 1000,
        category: 'interaction',
        target: { selector: '#submit', tag: 'button', text: 'Submit' },
        payload: { text: 'Submit', position: { x: 100, y: 200 } }
      }
    ]
    
    const test = semanticEventsToTest(events, {
      name: 'Test',
      url: 'http://localhost:3000',
      addAssertions: false,
    })
    
    expect(test.steps).toHaveLength(1)
    expect(test.steps[0].action).toBe('click')
    expect((test.steps[0] as any).selector).toBe('#submit')
    expect(test.steps[0].description).toContain('Submit')
  })
  
  it('adds URL assertion when click triggers navigation', () => {
    const events: SemanticEvent[] = [
      {
        type: 'interaction:click',
        timestamp: 1000,
        category: 'interaction',
        target: { selector: '#login', tag: 'button', text: 'Login' },
        payload: { text: 'Login', position: { x: 100, y: 200 } }
      },
      {
        type: 'navigation:navigate',
        timestamp: 1500,
        category: 'navigation',
        payload: { from: '/login', to: '/dashboard', trigger: 'click' }
      }
    ]
    
    const test = semanticEventsToTest(events, {
      name: 'Test',
      url: 'http://localhost:3000',
      addAssertions: true,
    })
    
    expect(test.steps).toHaveLength(2)
    expect(test.steps[0].action).toBe('click')
    expect(test.steps[1].action).toBe('assert')
    expect((test.steps[1] as any).assertion.type).toBe('url')
    expect((test.steps[1] as any).assertion.pattern).toBe('/dashboard')
  })
  
  it('converts initial navigation to NavigateStep', () => {
    const events: SemanticEvent[] = [
      {
        type: 'navigation:navigate',
        timestamp: 1000,
        category: 'navigation',
        payload: { from: '', to: '/home', trigger: 'initial' }
      }
    ]
    
    const test = semanticEventsToTest(events, {
      name: 'Test',
      url: 'http://localhost:3000',
    })
    
    expect(test.steps).toHaveLength(1)
    expect(test.steps[0].action).toBe('navigate')
    expect((test.steps[0] as any).url).toBe('/home')
  })
  
  it('calculates delays between steps', () => {
    const events: SemanticEvent[] = [
      {
        type: 'interaction:click',
        timestamp: 1000,
        category: 'interaction',
        target: { selector: '#a', tag: 'button' },
        payload: { position: { x: 0, y: 0 } }
      },
      {
        type: 'interaction:click',
        timestamp: 3000,
        category: 'interaction',
        target: { selector: '#b', tag: 'button' },
        payload: { position: { x: 0, y: 0 } }
      }
    ]
    
    const test = semanticEventsToTest(events, {
      name: 'Test',
      url: 'http://localhost:3000',
      addAssertions: false,
    })
    
    expect(test.steps).toHaveLength(2)
    expect((test.steps[1] as any).delay).toBe(2000)
  })
  
  it('skips focus and scroll events', () => {
    const events: SemanticEvent[] = [
      {
        type: 'focus:in',
        timestamp: 1000,
        category: 'focus',
        target: { selector: '#input', tag: 'input' },
        payload: { fieldType: 'text', hasValue: false }
      },
      {
        type: 'scroll:stop',
        timestamp: 2000,
        category: 'scroll',
        payload: { to: '#section', direction: 'down', distance: 500, duration: 200 }
      }
    ]
    
    const test = semanticEventsToTest(events, {
      name: 'Test',
      url: 'http://localhost:3000',
    })
    
    expect(test.steps).toHaveLength(0)
  })
  
  it('sets test metadata correctly', () => {
    const test = semanticEventsToTest([], {
      name: 'Login Flow',
      description: 'Test the login process',
      url: 'http://localhost:3000/login',
      createdBy: 'ai',
      tags: ['auth', 'smoke'],
    })
    
    expect(test.version).toBe(1)
    expect(test.name).toBe('Login Flow')
    expect(test.description).toBe('Test the login process')
    expect(test.url).toBe('http://localhost:3000/login')
    expect(test.createdBy).toBe('ai')
    expect(test.tags).toEqual(['auth', 'smoke'])
    expect(test.createdAt).toBeGreaterThan(0)
  })
})

describe('suggestAssertions', () => {
  it('suggests URL assertion for last navigation', () => {
    const events: SemanticEvent[] = [
      {
        type: 'navigation:navigate',
        timestamp: 1000,
        category: 'navigation',
        payload: { from: '/a', to: '/b', trigger: 'click' }
      }
    ]
    
    const suggestions = suggestAssertions(events)
    
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].action).toBe('assert')
    expect((suggestions[0] as any).assertion.type).toBe('url')
    expect((suggestions[0] as any).assertion.pattern).toBe('/b')
  })
})
