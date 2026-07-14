/**
 * Unit tests for src/sessions.ts (named-instance registry).
 * Uses a temp dir to avoid touching the real ~/.haltija/servers/.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { autoNameFor, isAncestorOf, isProcessAlive, isTooBroadForCwdMatch, isValidName, list, lookup, register, resolveByCwd, unregister } from './sessions'
import { homedir } from 'os'

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

describe('autoNameFor', () => {
  it('derives a valid registry name from a port', () => {
    expect(autoNameFor(9123)).toBe('auto-9123')
    expect(isValidName(autoNameFor(9123))).toBe(true)
  })
})

describe('isAncestorOf', () => {
  it('treats a directory as an ancestor of itself', () => {
    expect(isAncestorOf('/a/b', '/a/b')).toBe(true)
  })

  it('matches real ancestors', () => {
    expect(isAncestorOf('/a', '/a/b/c')).toBe(true)
    expect(isAncestorOf('/a/b', '/a/b/c')).toBe(true)
  })

  it('does not match on a raw string prefix', () => {
    // the bug this guards: /a/foo must not "own" /a/foobar
    expect(isAncestorOf('/a/foo', '/a/foobar')).toBe(false)
  })

  it('does not match unrelated or reversed paths', () => {
    expect(isAncestorOf('/a/b/c', '/a/b')).toBe(false)
    expect(isAncestorOf('/x', '/a')).toBe(false)
    expect(isAncestorOf('', '/a')).toBe(false)
  })
})

describe('isTooBroadForCwdMatch', () => {
  it('rejects roots that would capture every project on the box', () => {
    expect(isTooBroadForCwdMatch('/')).toBe(true)
    expect(isTooBroadForCwdMatch(homedir())).toBe(true)
  })

  it('accepts a normal project directory', () => {
    expect(isTooBroadForCwdMatch(join(homedir(), 'my-project'))).toBe(false)
  })
})

describe('resolveByCwd', () => {
  it('finds the server whose cwd contains this one', () => {
    register('proj', 9123, { cwd: '/work/proj', dir })
    const found = resolveByCwd('/work/proj/src/deep', { dir })
    expect(found?.port).toBe(9123)
    expect(found?.name).toBe('proj')
  })

  it('returns null when no server owns this directory', () => {
    register('proj', 9123, { cwd: '/work/proj', dir })
    expect(resolveByCwd('/work/other', { dir })).toBeNull()
  })

  it('picks the nearest ancestor when servers nest', () => {
    register('outer', 9000, { cwd: '/work', dir })
    register('inner', 9001, { cwd: '/work/proj', dir })
    expect(resolveByCwd('/work/proj/src', { dir })?.port).toBe(9001)
    expect(resolveByCwd('/work/elsewhere', { dir })?.port).toBe(9000)
  })

  it('never matches a server started at / or in the home directory', () => {
    register('root', 9000, { cwd: '/', dir })
    register('home', 9001, { cwd: homedir(), dir })
    expect(resolveByCwd('/work/proj', { dir })).toBeNull()
    expect(resolveByCwd(join(homedir(), 'anything'), { dir })).toBeNull()
  })

  it('ignores dead servers', () => {
    // pid 1 is alive but not ours; use an implausible pid instead
    register('ghost', 9123, { cwd: '/work/proj', pid: 2 ** 30, dir })
    expect(resolveByCwd('/work/proj', { dir })).toBeNull()
  })

  it('does not confuse sibling directories with a shared prefix', () => {
    register('foo', 9000, { cwd: '/work/foo', dir })
    expect(resolveByCwd('/work/foobar', { dir })).toBeNull()
  })
})
