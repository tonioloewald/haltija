/**
 * API Schema Canary Test
 * 
 * This test ensures that schema changes are intentional and documented.
 * When the schema changes, this test will fail and show you the new fingerprint.
 * Update SCHEMA_FINGERPRINT in api-schema.ts with the new checksum.
 */

import { describe, it, expect } from 'bun:test'
import { SCHEMA_FINGERPRINT, computeSchemaFingerprint, ALL_ENDPOINTS, endpoints } from './api-schema'

describe('API Schema Fingerprint', () => {
  it('schema fingerprint matches (update SCHEMA_FINGERPRINT if schema changed intentionally)', () => {
    const computed = computeSchemaFingerprint()
    
    if (SCHEMA_FINGERPRINT.checksum !== computed) {
      console.error('\n' + '='.repeat(70))
      console.error('SCHEMA CHANGE DETECTED!')
      console.error('='.repeat(70))
      console.error('\nThe API schema has changed. If this was intentional, update:')
      console.error('\n  src/api-schema.ts -> SCHEMA_FINGERPRINT')
      console.error('\nWith:')
      console.error(`\n  checksum: '${computed}'`)
      console.error(`  updated: '${new Date().toISOString()}'`)
      console.error('\n' + '='.repeat(70) + '\n')
    }
    
    expect(SCHEMA_FINGERPRINT.checksum).toBe(computed)
  })
})

describe('Endpoint Visibility', () => {
  it('internal endpoints have visibility set', () => {
    const internalEndpoints = ALL_ENDPOINTS.filter(ep => (ep as any).visibility === 'internal')
    expect(internalEndpoints.length).toBeGreaterThan(0)
    
    // Verify send endpoints are internal
    expect((endpoints.sendMessage as any).visibility).toBe('internal')
    expect((endpoints.sendSelection as any).visibility).toBe('internal')
    expect((endpoints.sendRecording as any).visibility).toBe('internal')
  })
  
  it('public endpoints do not have internal visibility', () => {
    // Core endpoints should be public (no visibility or visibility: public)
    const tree = endpoints.tree as any
    expect(tree.visibility).not.toBe('internal')
    
    const click = endpoints.click as any
    expect(click.visibility).not.toBe('internal')
  })
})

describe('CLI Config', () => {
  it('send endpoints have cli config', () => {
    const sendMessage = endpoints.sendMessage as any
    expect(sendMessage.cli).toBeDefined()
    expect(sendMessage.cli.name).toBe('send')
    expect(sendMessage.cli.args).toContain('agent')
    expect(sendMessage.cli.args).toContain('message')
    expect(sendMessage.cli.flags).toContain('--no-submit')
  })
})
