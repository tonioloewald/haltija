/**
 * API Schema Canary Test
 * 
 * This test ensures that schema changes are intentional and documented.
 * When the schema changes, this test will fail and show you the new fingerprint.
 * Update SCHEMA_FINGERPRINT in api-schema.ts with the new checksum.
 */

import { describe, it, expect } from 'bun:test'
import { SCHEMA_FINGERPRINT, computeSchemaFingerprint } from './api-schema'

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
