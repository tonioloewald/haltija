/**
 * Unit tests for src/sessions.ts (named-instance registry).
 * Uses a temp dir to avoid touching the real ~/.haltija/servers/.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isProcessAlive, isValidName, list, lookup, register, unregister } from './sessions'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'haltija-sessions-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('isValidName', () => {
  it('accepts simple names', () => {
    expect(isValidName('dashboard')).toBe(true)
    expect(isValidName('my-app')).toBe(true)
    expect(isValidName('my_app.v2')).toBe(true)
    expect(isValidName('A1')).toBe(true)
  })

  it('rejects path traversal and separators', () => {
    expect(isValidName('../etc')).toBe(false)
    expect(isValidName('foo/bar')).toBe(false)
    expect(isValidName('foo\\bar')).toBe(false)
    expect(isValidName('foo bar')).toBe(false)
  })

  it('rejects empty and oversized names', () => {
    expect(isValidName('')).toBe(false)
    expect(isValidName('a'.repeat(65))).toBe(false)
    expect(isValidName('a'.repeat(64))).toBe(true)
  })
})

describe('register / lookup / unregister', () => {
  it('round-trips a registration', () => {
    const entry = register('dashboard', 8847, { dir })
    expect(entry.name).toBe('dashboard')
    expect(entry.port).toBe(8847)
    expect(entry.pid).toBe(process.pid)
    expect(entry.cwd).toBe(process.cwd())
    expect(entry.startedAt).toBeLessThanOrEqual(Date.now())

    const found = lookup('dashboard', { dir })
    expect(found?.port).toBe(8847)
    expect(found?.name).toBe('dashboard')
  })

  it('overwrites an existing entry', () => {
    register('foo', 8000, { dir })
    register('foo', 9000, { dir })
    expect(lookup('foo', { dir })?.port).toBe(9000)
  })

  it('unregister removes the file', () => {
    register('foo', 8000, { dir })
    unregister('foo', { dir })
    expect(lookup('foo', { dir })).toBeNull()
  })

  it('unregister is a no-op when the entry is missing', () => {
    expect(() => unregister('nope', { dir })).not.toThrow()
  })

  it('lookup returns null for a missing name', () => {
    expect(lookup('nope', { dir })).toBeNull()
  })

  it('rejects invalid names', () => {
    expect(() => register('../escape', 8000, { dir })).toThrow(/Invalid haltija instance name/)
  })
})

describe('stale entry cleanup', () => {
  it('lookup removes entries whose pid is dead', () => {
    // PID 999999 is overwhelmingly likely to not exist.
    const fakePid = 999999
    register('ghost', 8001, { dir, pid: fakePid })
    // Sanity: the file is there.
    expect(existsSync(join(dir, 'ghost.json'))).toBe(true)
    // And the pid is in fact dead.
    expect(isProcessAlive(fakePid)).toBe(false)

    expect(lookup('ghost', { dir })).toBeNull()
    // Cleanup happened as a side effect.
    expect(existsSync(join(dir, 'ghost.json'))).toBe(false)
  })

  it('lookup removes malformed entries', () => {
    register('busted', 8002, { dir })
    // Stomp the file with garbage.
    const path = join(dir, 'busted.json')
    require('fs').writeFileSync(path, '{not json')
    expect(lookup('busted', { dir })).toBeNull()
    expect(existsSync(path)).toBe(false)
  })
})

describe('list', () => {
  it('returns all live entries sorted by name', () => {
    register('charlie', 8003, { dir })
    register('alpha', 8001, { dir })
    register('bravo', 8002, { dir })
    const entries = list({ dir })
    expect(entries.map(e => e.name)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(entries.map(e => e.port)).toEqual([8001, 8002, 8003])
  })

  it('skips and cleans up stale entries', () => {
    register('alive', 8001, { dir })
    register('dead', 8002, { dir, pid: 999999 })
    const entries = list({ dir })
    expect(entries.map(e => e.name)).toEqual(['alive'])
    expect(existsSync(join(dir, 'dead.json'))).toBe(false)
  })

  it('returns empty array when registry dir is missing', () => {
    rmSync(dir, { recursive: true, force: true })
    expect(list({ dir })).toEqual([])
  })

  it('ignores non-.json files in the registry dir', () => {
    register('real', 8001, { dir })
    require('fs').writeFileSync(join(dir, 'README'), 'human note')
    require('fs').writeFileSync(join(dir, 'debug.log'), 'logs')
    const entries = list({ dir })
    expect(entries.map(e => e.name)).toEqual(['real'])
  })
})

describe('persisted format', () => {
  it('writes pretty JSON readable by other tools', () => {
    register('foo', 8000, { dir })
    const raw = readFileSync(join(dir, 'foo.json'), 'utf-8')
    // pretty-printed (has newlines)
    expect(raw).toContain('\n')
    const parsed = JSON.parse(raw)
    expect(parsed).toMatchObject({ name: 'foo', port: 8000 })
  })
})
