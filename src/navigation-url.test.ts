import { describe, it, expect } from 'bun:test'
import { isSameDocument, needsHandoff, readHandoff, resolveNavigationUrl, withHandoff } from './navigation-url'

const here = 'http://localhost:3000/app/page?q=1'
const href = (raw: string) => resolveNavigationUrl(raw, here).href

describe('resolveNavigationUrl — what actually loads', () => {
  it('parses absolute URLs, so comparisons see a normalised form', () => {
    expect(href('http://LOCALHOST:4000/x')).toBe('http://localhost:4000/x')
    expect(href('http://localhost:3000')).toBe('http://localhost:3000/')
    expect(href('about:blank')).toBe('about:blank')
  })
  it('resolves paths, fragments and queries against the current page (was https:///docs)', () => {
    expect(href('/docs')).toBe('http://localhost:3000/docs')
    expect(href('#x')).toBe('http://localhost:3000/app/page?q=1#x')
    expect(href('?q=2')).toBe('http://localhost:3000/app/page?q=2')
    expect(href('../up')).toBe('http://localhost:3000/up')
  })
  it('marks a bare host, so the desktop app gets it raw and keeps its https→http fallback', () => {
    expect(resolveNavigationUrl('localhost:3000', here)).toEqual({ href: 'https://localhost:3000/', bare: true })
    expect(resolveNavigationUrl('example.com/x', here)).toEqual({ href: 'https://example.com/x', bare: true })
    expect(resolveNavigationUrl('http://example.com/x', here).bare).toBe(false)
  })
  it('rejects an empty URL instead of throwing later in the page', () => {
    expect(() => resolveNavigationUrl('   ', here)).toThrow('url is required')
  })
})

describe('isSameDocument', () => {
  it('a fragment change of this page, including an empty fragment', () => {
    expect(isSameDocument(href('#x'), here)).toBe(true)
    expect(isSameDocument('http://localhost:3000/app/page?q=1#', here)).toBe(true)
  })
  it('matches non-canonical spellings of the same page (the string compare missed these)', () => {
    expect(isSameDocument(href('http://localhost:3000#x'), 'http://localhost:3000/')).toBe(true)
    expect(isSameDocument(href('http://LOCALHOST:3000/app/page?q=1#y'), here)).toBe(true)
  })
  it('not a reload of the same URL, and not another host', () => {
    expect(isSameDocument(here, here)).toBe(false)
    expect(isSameDocument('https://start/#x', 'http://localhost:3000/start')).toBe(false)
  })
})

describe('needsHandoff — only a move to ANOTHER http(s) origin', () => {
  it('cross-origin http(s): yes', () => {
    expect(needsHandoff('http://localhost:4000/x', here)).toBe(true)
  })
  it('same origin, mailto:, javascript:, data:: no (nothing to carry, or no page is left)', () => {
    expect(needsHandoff('http://localhost:3000/other', here)).toBe(false)
    expect(needsHandoff('mailto:a@b.c', here)).toBe(false)
    expect(needsHandoff('javascript:void(0)', here)).toBe(false)
    expect(needsHandoff('data:text/plain,x', here)).toBe(false)
  })
})

describe('window.name handoff', () => {
  it('round-trips the id and keeps the page’s own name', () => {
    expect(readHandoff(withHandoff('app-window', 'abc123xyz'))).toEqual({ windowId: 'abc123xyz', original: 'app-window' })
  })
  it('replaces an earlier handoff instead of nesting', () => {
    expect(readHandoff(withHandoff(withHandoff('n', 'first12'), 'second12'))).toEqual({ windowId: 'second12', original: 'n' })
  })
  it('ignores ordinary names, and ids that are not shaped like ours', () => {
    expect(readHandoff('whatever')).toEqual({ windowId: null, original: 'whatever' })
    expect(readHandoff('haltija-handoff:<script>|x').windowId).toBeNull()
  })
})
