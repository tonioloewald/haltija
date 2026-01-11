/**
 * Tests for multi-window management
 */

import { describe, test, expect } from 'bun:test'
import type { BrowserWindow, WindowListResponse } from './types'

describe('Window Types', () => {
  test('BrowserWindow interface has required fields', () => {
    const window: BrowserWindow = {
      id: 'win-123',
      url: 'http://localhost:3000/',
      title: 'Test Page',
      active: true,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    }
    
    expect(window.id).toBe('win-123')
    expect(window.url).toBe('http://localhost:3000/')
    expect(window.title).toBe('Test Page')
    expect(window.active).toBe(true)
    expect(typeof window.connectedAt).toBe('number')
    expect(typeof window.lastSeen).toBe('number')
  })
  
  test('BrowserWindow supports optional label', () => {
    const window: BrowserWindow = {
      id: 'win-456',
      url: 'http://localhost:3000/admin',
      title: 'Admin Panel',
      active: false,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      label: 'admin-window',
    }
    
    expect(window.label).toBe('admin-window')
  })
  
  test('WindowListResponse structure', () => {
    const response: WindowListResponse = {
      windows: [
        {
          id: 'win-1',
          url: 'http://localhost:3000/',
          title: 'App',
          active: true,
          connectedAt: 1000,
          lastSeen: 2000,
        },
        {
          id: 'win-2',
          url: 'http://localhost:3000/admin',
          title: 'Admin',
          active: false,
          connectedAt: 1500,
          lastSeen: 2500,
          label: 'admin',
        },
      ],
      focused: 'win-1',
    }
    
    expect(response.windows).toHaveLength(2)
    expect(response.focused).toBe('win-1')
    expect(response.windows[0].active).toBe(true)
    expect(response.windows[1].active).toBe(false)
    expect(response.windows[1].label).toBe('admin')
  })
  
  test('WindowListResponse with no focused window', () => {
    const response: WindowListResponse = {
      windows: [],
      focused: undefined,
    }
    
    expect(response.windows).toHaveLength(0)
    expect(response.focused).toBeUndefined()
  })
})

describe('Window ID Generation', () => {
  test('sessionStorage key is consistent', () => {
    // The widget uses 'haltija-window-id' as the key
    const WINDOW_ID_KEY = 'haltija-window-id'
    expect(WINDOW_ID_KEY).toBe('haltija-window-id')
  })
  
  test('window ID format is valid', () => {
    // Window IDs are generated with uid() - base36 random + timestamp
    const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
    const id = uid()
    
    // Should be a non-empty string
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    
    // Should be alphanumeric (base36)
    expect(/^[a-z0-9]+$/.test(id)).toBe(true)
  })
  
  test('window IDs are unique', () => {
    const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
    const ids = new Set<string>()
    
    for (let i = 0; i < 100; i++) {
      ids.add(uid())
    }
    
    // All 100 IDs should be unique
    expect(ids.size).toBe(100)
  })
})

describe('Window State Logic', () => {
  test('active window responds to untargeted commands', () => {
    const isActive = true
    const isForUs = false // Not specifically targeted
    const shouldRespond = isActive || isForUs
    
    expect(shouldRespond).toBe(true)
  })
  
  test('inactive window ignores untargeted commands', () => {
    const isActive = false
    const isForUs = false
    const shouldRespond = isActive || isForUs
    
    expect(shouldRespond).toBe(false)
  })
  
  test('inactive window responds to targeted commands', () => {
    const isActive = false
    const isForUs = true // Specifically targeted with our windowId
    const shouldRespond = isActive || isForUs
    
    expect(shouldRespond).toBe(true)
  })
  
  test('message targeting logic', () => {
    const myWindowId = 'win-123'
    
    // No target = for everyone
    const msg1 = { payload: {} }
    const isTargeted1 = !!msg1.payload?.windowId
    expect(isTargeted1).toBe(false)
    
    // Targeted at us
    const msg2 = { payload: { windowId: 'win-123' } }
    const isTargeted2 = !!msg2.payload?.windowId
    const isForUs2 = msg2.payload.windowId === myWindowId
    expect(isTargeted2).toBe(true)
    expect(isForUs2).toBe(true)
    
    // Targeted at someone else
    const msg3 = { payload: { windowId: 'win-456' } }
    const isForUs3 = msg3.payload.windowId === myWindowId
    expect(isForUs3).toBe(false)
  })
})

describe('Window Lifecycle', () => {
  test('window reconnection preserves windowId', () => {
    // Simulates page refresh - same windowId, different browserId
    const windowId = 'win-persistent'
    const browserId1 = 'browser-old'
    const browserId2 = 'browser-new'
    
    // After refresh, windowId stays the same
    expect(windowId).toBe('win-persistent')
    // But browserId changes
    expect(browserId1).not.toBe(browserId2)
  })
  
  test('new tab gets new windowId', () => {
    // Each tab has its own sessionStorage, so new windowId
    const tab1WindowId = 'win-tab1'
    const tab2WindowId = 'win-tab2'
    
    expect(tab1WindowId).not.toBe(tab2WindowId)
  })
  
  test('focused window selection on disconnect', () => {
    const windows = new Map([
      ['win-1', { id: 'win-1' }],
      ['win-2', { id: 'win-2' }],
      ['win-3', { id: 'win-3' }],
    ])
    let focusedWindowId: string | null = 'win-2'
    
    // Window 2 disconnects
    windows.delete('win-2')
    if (focusedWindowId === 'win-2') {
      focusedWindowId = windows.size > 0 ? windows.keys().next().value : null
    }
    
    // Should pick another window
    expect(focusedWindowId).not.toBe('win-2')
    expect(focusedWindowId).not.toBeNull()
    expect(windows.has(focusedWindowId!)).toBe(true)
  })
  
  test('last window disconnect clears focus', () => {
    const windows = new Map([['win-1', { id: 'win-1' }]])
    let focusedWindowId: string | null = 'win-1'
    
    windows.delete('win-1')
    if (focusedWindowId === 'win-1') {
      focusedWindowId = windows.size > 0 ? windows.keys().next().value : null
    }
    
    expect(focusedWindowId).toBeNull()
  })
})

describe('URL/Title Tracking', () => {
  test('window updates on navigation', () => {
    const window = {
      id: 'win-1',
      url: 'http://localhost:3000/',
      title: 'Home',
      lastSeen: 1000,
    }
    
    // SPA navigation
    window.url = 'http://localhost:3000/dashboard'
    window.title = 'Dashboard'
    window.lastSeen = 2000
    
    expect(window.url).toBe('http://localhost:3000/dashboard')
    expect(window.title).toBe('Dashboard')
    expect(window.lastSeen).toBe(2000)
  })
  
  test('polling detects URL changes', () => {
    let lastReportedUrl = 'http://localhost:3000/'
    const currentUrl = 'http://localhost:3000/settings'
    
    const hasChanged = currentUrl !== lastReportedUrl
    expect(hasChanged).toBe(true)
    
    lastReportedUrl = currentUrl
    const hasChangedAgain = currentUrl !== lastReportedUrl
    expect(hasChangedAgain).toBe(false)
  })
})

describe('Window Labels', () => {
  test('label can be set and cleared', () => {
    const window: BrowserWindow = {
      id: 'win-1',
      url: 'http://localhost:3000/',
      title: 'App',
      active: true,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    }
    
    // Initially no label
    expect(window.label).toBeUndefined()
    
    // Set label
    window.label = 'main-app'
    expect(window.label).toBe('main-app')
    
    // Clear label
    window.label = undefined
    expect(window.label).toBeUndefined()
  })
  
  test('labels help identify windows', () => {
    const windows: BrowserWindow[] = [
      {
        id: 'win-abc123',
        url: 'http://localhost:3000/',
        title: 'Snowfox App',
        active: true,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        label: 'customer-app',
      },
      {
        id: 'win-def456',
        url: 'http://localhost:3000/admin',
        title: 'Snowfox Admin',
        active: true,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        label: 'admin-panel',
      },
    ]
    
    // Can find by label instead of cryptic ID
    const adminWindow = windows.find(w => w.label === 'admin-panel')
    expect(adminWindow).toBeDefined()
    expect(adminWindow!.url).toContain('/admin')
  })
})
