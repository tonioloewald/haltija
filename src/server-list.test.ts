import { describe, it, expect } from 'bun:test'
import { collectCandidates, describeServer, sortRows, labelFor } from './server-list'

describe('collectCandidates', () => {
  it('includes the well-known defaults even when the registry is empty', () => {
    // An unregistered or legacy server on 8700/8701 is invisible to the registry, and finding it is
    // the point of `hj servers`.
    const ports = collectCandidates([], 9000).map((c) => c.port).sort()
    expect(ports).toEqual(['8700', '8701', '9000'])
  })

  it('keeps the registry entry when it collides with a default — not "(unnamed)" twice', () => {
    const got = collectCandidates([{ name: 'desktop', port: 8700, cwd: '' }], 8700)
    expect(got).toHaveLength(2) // 8700 (named) + 8701 default
    expect(got.find((c) => c.port === '8700')?.name).toBe('desktop')
  })

  it('always includes the resolved port, so "what am I driving?" is answerable', () => {
    const got = collectCandidates([{ name: 'proj', port: 5000 }], 61234)
    expect(got.map((c) => c.port)).toContain('61234')
  })

  it('does not duplicate the resolved port when it is already registered', () => {
    const got = collectCandidates([{ name: 'proj', port: 5000, cwd: '/p' }], 5000)
    expect(got.filter((c) => c.port === '5000')).toHaveLength(1)
    expect(got.find((c) => c.port === '5000')?.cwd).toBe('/p')
  })
})

describe('describeServer', () => {
  const cand = { port: '8700', name: 'proj', cwd: '/p' }

  it('marks a failed probe as down', () => {
    expect(describeServer(cand, null)).toMatchObject({ up: false })
  })

  it('prefers `windows` over the legacy `browsers` count', () => {
    const row = describeServer(cand, { serverVersion: '1.2.3', windows: [{}, {}], browsers: 9 })
    expect(row.tabs).toBe(2)
  })

  it('treats ZERO windows as zero, not as "fall back to browsers"', () => {
    // The distinction matters: a server with no tabs is exactly the #11 case, and reporting the
    // legacy browsers count there would hide it.
    const row = describeServer(cand, { serverVersion: '1.2.3', windows: [], browsers: 4 })
    expect(row.tabs).toBe(0)
  })

  it('falls back to browsers only when windows is absent (older servers)', () => {
    expect(describeServer(cand, { serverVersion: '1.0.0', browsers: 3 }).tabs).toBe(3)
  })

  it('carries ready through when present, and leaves it undefined on older servers', () => {
    expect(describeServer(cand, { ready: false, windows: [] }).ready).toBe(false)
    expect(describeServer(cand, { windows: [] }).ready).toBeUndefined()
  })

  it('reports a missing version as "?" rather than blank', () => {
    expect(describeServer(cand, {}).version).toBe('?')
  })
})

describe('sortRows / labelFor', () => {
  it('drops unreachable servers and orders by port for a stable, diffable list', () => {
    const rows = [
      describeServer({ port: '9000', name: null, cwd: null }, { serverVersion: '1' }),
      describeServer({ port: '8700', name: 'a', cwd: null }, null),
      describeServer({ port: '8701', name: 'b', cwd: null }, { serverVersion: '1' }),
    ]
    expect(sortRows(rows).map((r) => r.port)).toEqual(['8701', '9000'])
  })

  it('labels the desktop app as "desktop" regardless of its registry name', () => {
    expect(labelFor({ port: '8700', name: 'auto-8700', cwd: null, up: true, desktopApp: true })).toBe('desktop')
    expect(labelFor({ port: '9000', name: 'proj', cwd: null, up: true, desktopApp: false })).toBe('proj')
    expect(labelFor({ port: '9000', name: null, cwd: null, up: true, desktopApp: false })).toBe('(unnamed)')
  })
})
