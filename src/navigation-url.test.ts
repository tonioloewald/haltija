import { describe, it, expect } from 'bun:test'
import { isSameDocument, readHandoff, resolveNavigationUrl, withHandoff } from './navigation-url'

const here = 'http://localhost:3000/app/page?q=1'

describe('resolveNavigationUrl — what actually loads', () => {
  it('keeps absolute URLs', () => {
    expect(resolveNavigationUrl('http://localhost:4000/x', here)).toBe('http://localhost:4000/x')
    expect(resolveNavigationUrl('about:blank', here)).toBe('about:blank')
  })
  it('resolves paths, fragments and queries against the current page (was https:///docs)', () => {
    expect(resolveNavigationUrl('/docs', here)).toBe('http://localhost:3000/docs')
    expect(resolveNavigationUrl('#x', here)).toBe('http://localhost:3000/app/page?q=1#x')
    expect(resolveNavigationUrl('?q=2', here)).toBe('http://localhost:3000/app/page?q=2')
    expect(resolveNavigationUrl('../up', here)).toBe('http://localhost:3000/up')
  })
  it('treats a bare host as https, as before', () => {
    expect(resolveNavigationUrl('example.com/x', here)).toBe('https://example.com/x')
  })
})

describe('isSameDocument', () => {
  it('a fragment change of this page, including an empty fragment', () => {
    expect(isSameDocument('http://localhost:3000/app/page?q=1#x', here)).toBe(true)
    expect(isSameDocument('http://localhost:3000/app/page?q=1#', here)).toBe(true)
  })
  it('not a reload of the same URL, and not the prefixed host the old check missed', () => {
    expect(isSameDocument(here, here)).toBe(false)
    expect(isSameDocument('https://start/#x', 'http://localhost:3000/start')).toBe(false)
  })
})

describe('window.name handoff', () => {
  it('round-trips the id and keeps the page’s own name', () => {
    const name = withHandoff('app-window', 'abc123xyz')
    expect(readHandoff(name)).toEqual({ windowId: 'abc123xyz', original: 'app-window' })
  })
  it('replaces an earlier handoff instead of nesting', () => {
    expect(readHandoff(withHandoff(withHandoff('n', 'first12'), 'second12'))).toEqual({ windowId: 'second12', original: 'n' })
  })
  it('ignores ordinary names, and ids that are not shaped like ours', () => {
    expect(readHandoff('whatever')).toEqual({ windowId: null, original: 'whatever' })
    expect(readHandoff('haltija-handoff:<script>|x').windowId).toBeNull()
  })
})
