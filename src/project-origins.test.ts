import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { normalizeOrigin, findProjectOrigins, routeByDeclaredOrigin } from './project-origins'

const temps: string[] = []
const makeProject = (config?: unknown, nested = false) => {
  const root = mkdtempSync(join(tmpdir(), 'haltija-proj-'))
  temps.push(root)
  if (config !== undefined) writeFileSync(join(root, '.haltija.json'), typeof config === 'string' ? config : JSON.stringify(config))
  if (nested) {
    const deep = join(root, 'src', 'components')
    mkdirSync(deep, { recursive: true })
    return { root, cwd: deep }
  }
  return { root, cwd: root }
}
afterAll(() => temps.forEach((d) => { try { rmSync(d, { recursive: true, force: true }) } catch {} }))

describe('normalizeOrigin', () => {
  it('reduces a URL to its origin', () => {
    expect(normalizeOrigin('https://localhost:8030/b3d/index.html')).toBe('https://localhost:8030')
  })
  it('accepts a bare host:port, because people write that', () => {
    expect(normalizeOrigin('localhost:8030')).toBe('http://localhost:8030')
  })
  it('treats different ports as different origins', () => {
    expect(normalizeOrigin('http://localhost:8030')).not.toBe(normalizeOrigin('http://localhost:8787'))
  })
  it('returns null for junk', () => {
    expect(normalizeOrigin('')).toBeNull()
    expect(normalizeOrigin('   ')).toBeNull()
  })
})

describe('findProjectOrigins', () => {
  it('returns null when nothing is declared — opt-in, so behaviour is unchanged', () => {
    const { cwd } = makeProject()
    expect(findProjectOrigins(cwd, {})).toBeNull()
  })

  it('reads .haltija.json from the project root', () => {
    const { cwd } = makeProject({ origins: ['https://localhost:8030'] })
    const found = findProjectOrigins(cwd, {})
    expect(found?.origins).toEqual(['https://localhost:8030'])
  })

  it('walks UP from a nested directory, like package.json discovery', () => {
    const { cwd } = makeProject({ origins: ['http://localhost:3000/app'] }, true)
    const found = findProjectOrigins(cwd, {})
    expect(found?.origins).toEqual(['http://localhost:3000']) // normalized
  })

  it('HALTIJA_ORIGINS overrides the file, for one-off shells and CI', () => {
    const { cwd } = makeProject({ origins: ['https://localhost:8030'] })
    const found = findProjectOrigins(cwd, { HALTIJA_ORIGINS: 'http://localhost:9000, localhost:9001' })
    expect(found?.origins).toEqual(['http://localhost:9000', 'http://localhost:9001'])
    expect(found?.source).toContain('env')
  })

  it('surfaces a malformed config instead of silently ignoring it', () => {
    const { cwd } = makeProject('{ not json')
    const found = findProjectOrigins(cwd, {})
    expect(found).not.toBeNull()
    expect(found!.origins).toEqual([])
    expect(found!.source).toContain('invalid JSON')
  })
})

describe('routeByDeclaredOrigin', () => {
  const tabs = [
    { id: 'a', url: 'https://localhost:8030/b3d/', active: true, windowType: 'tab' },
    { id: 'b', url: 'https://localhost:8787/rating/', active: true, windowType: 'tab' },
  ]

  it('does nothing without a declaration', () => {
    expect(routeByDeclaredOrigin([], tabs, 'b').kind).toBe('no-declaration')
  })

  it('routes to the declared project’s tab even when ANOTHER tab is focused', () => {
    // This is issue #1/#2 in one assertion: focus says 'b', the declaration says 8030.
    const r = routeByDeclaredOrigin(['https://localhost:8030'], tabs, 'b')
    expect(r.kind).toBe('matched')
    expect(r.kind === 'matched' && r.windowId).toBe('a')
  })

  it('reports no-match rather than silently falling back to focus', () => {
    const r = routeByDeclaredOrigin(['https://localhost:9999'], tabs, 'b')
    expect(r.kind).toBe('no-match')
    expect(r.kind === 'no-match' && r.sawOrigins).toContain('https://localhost:8787')
  })

  it('prefers a VISIBLE matching tab over a hidden one', () => {
    const withHidden = [
      { id: 'hidden', url: 'https://localhost:8030/x', active: false, windowType: 'tab' },
      { id: 'shown', url: 'https://localhost:8030/y', active: true, windowType: 'tab' },
    ]
    const r = routeByDeclaredOrigin(['https://localhost:8030'], withHidden, null)
    expect(r.kind === 'matched' && r.windowId).toBe('shown')
  })

  it('keeps the focused tab among equals, so repeated commands stay put', () => {
    const two = [
      { id: 'one', url: 'https://localhost:8030/a', active: true, windowType: 'tab' },
      { id: 'two', url: 'https://localhost:8030/b', active: true, windowType: 'tab' },
    ]
    expect(routeByDeclaredOrigin(['https://localhost:8030'], two, 'two')).toMatchObject({ windowId: 'two' })
  })

  it('ignores iframes and popups — they are part of a tab, not targets', () => {
    const framed = [
      { id: 'frame', url: 'https://localhost:8030/embed', active: true, windowType: 'iframe' },
      { id: 'tab', url: 'https://localhost:8030/page', active: true, windowType: 'tab' },
    ]
    expect(routeByDeclaredOrigin(['https://localhost:8030'], framed, null)).toMatchObject({ windowId: 'tab' })
  })
})
