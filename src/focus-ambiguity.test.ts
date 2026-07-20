import { describe, it, expect } from 'bun:test'
import { originOf, ambiguousFocusWarning } from './focus-ambiguity'

describe('originOf', () => {
  it('returns the origin for a normal URL', () => {
    expect(originOf('https://localhost:8787/rating/')).toBe('https://localhost:8787')
  })
  it('distinguishes ports as distinct origins', () => {
    expect(originOf('https://localhost:8030/b3d/')).not.toBe(originOf('https://localhost:8787/x/'))
  })
  it('falls back to the raw string for unparseable / opaque URLs', () => {
    expect(originOf('about:blank')).toBe('about:blank')
    expect(originOf('not a url')).toBe('not a url')
  })
  it('returns null for empty / missing', () => {
    expect(originOf('')).toBeNull()
    expect(originOf(undefined)).toBeNull()
    expect(originOf(null)).toBeNull()
  })
})

describe('ambiguousFocusWarning', () => {
  const twoProjects = [
    { id: 'w1', url: 'https://localhost:8787/rating/', title: 'rating — tosijs-ui' },
    { id: 'w2', url: 'https://localhost:8030/b3d-terrain/', title: 'b3d — tosijs-3d' },
  ]

  it('warns when an untargeted command hit the focused tab amid multiple origins', () => {
    const w = ambiguousFocusWarning({ windows: twoProjects, sentToId: 'w1', wasTargeted: false })
    expect(w).toContain('focus')
    expect(w).toContain('2 different origins')
    // names the tab that answered and offers the OTHER as a pin
    expect(w).toContain('rating — tosijs-ui')
    expect(w).toContain('--window w2')
    // does not offer the tab that already answered as an alternative
    expect(w).not.toContain('--window w1')
  })

  it('is silent when the caller pinned a window', () => {
    expect(
      ambiguousFocusWarning({ windows: twoProjects, sentToId: 'w1', wasTargeted: true }),
    ).toBeNull()
  })

  it('is silent when every tab shares one origin (same project, many pages)', () => {
    const oneProject = [
      { id: 'a', url: 'https://localhost:8787/one/', title: 'one' },
      { id: 'b', url: 'https://localhost:8787/two/', title: 'two' },
    ]
    expect(
      ambiguousFocusWarning({ windows: oneProject, sentToId: 'a', wasTargeted: false }),
    ).toBeNull()
  })

  it('is silent with a single window', () => {
    expect(
      ambiguousFocusWarning({
        windows: [{ id: 'solo', url: 'https://localhost:8787/', title: 'solo' }],
        sentToId: 'solo',
        wasTargeted: false,
      }),
    ).toBeNull()
  })

  it('is silent when we do not know which tab answered', () => {
    expect(
      ambiguousFocusWarning({ windows: twoProjects, sentToId: null, wasTargeted: false }),
    ).toBeNull()
  })

  it('still warns when the chosen tab has no readable origin but others differ', () => {
    const mixed = [
      { id: 'blank', url: 'about:blank', title: '' },
      { id: 'real', url: 'https://localhost:8787/x/', title: 'x' },
    ]
    const w = ambiguousFocusWarning({ windows: mixed, sentToId: 'blank', wasTargeted: false })
    expect(w).toContain('2 different origins')
    expect(w).toContain('--window real')
  })

  it('ignores a cross-origin iframe — one real page is not multi-project ambiguity', () => {
    const pageWithFrame = [
      { id: 'tab', url: 'https://localhost:8787/app/', title: 'app', windowType: 'tab' },
      { id: 'frame', url: 'https://ads.example.com/x', title: 'ad', windowType: 'iframe' },
    ]
    expect(
      ambiguousFocusWarning({ windows: pageWithFrame, sentToId: 'tab', wasTargeted: false }),
    ).toBeNull()
  })

  it('ignores a child popup (e.g. an OAuth window)', () => {
    const pageWithPopup = [
      { id: 'tab', url: 'https://localhost:8787/app/', title: 'app', windowType: 'tab' },
      { id: 'oauth', url: 'https://accounts.google.com/o', title: 'Sign in', windowType: 'popup' },
    ]
    expect(
      ambiguousFocusWarning({ windows: pageWithPopup, sentToId: 'tab', wasTargeted: false }),
    ).toBeNull()
  })

  it('still warns for two real tabs even when frames/popups are also present', () => {
    const mixed = [
      { id: 't1', url: 'https://localhost:8787/a/', title: 'a', windowType: 'tab' },
      { id: 'f', url: 'https://ads.example.com/x', title: 'ad', windowType: 'iframe' },
      { id: 't2', url: 'https://localhost:8030/b/', title: 'b', windowType: 'tab' },
    ]
    const w = ambiguousFocusWarning({ windows: mixed, sentToId: 't1', wasTargeted: false })!
    expect(w).toContain('2 different origins')
    expect(w).toContain('--window t2')
    expect(w).not.toContain('--window f') // the iframe is never offered as a pin
  })

  it('treats a window with no windowType as a tab (older widgets)', () => {
    // Two real tabs, neither reporting windowType → must still warn.
    const w = ambiguousFocusWarning({ windows: twoProjects, sentToId: 'w1', wasTargeted: false })
    expect(w).toContain('2 different origins')
  })

  it('caps the pin list and notes the remainder', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `w${i}`,
      url: `https://host${i}.test/`,
      title: `t${i}`,
    }))
    const w = ambiguousFocusWarning({ windows: many, sentToId: 'w0', wasTargeted: false })!
    expect(w).toContain('…and 2 more') // 6 others, cap 4 → 2 remain
  })
})
