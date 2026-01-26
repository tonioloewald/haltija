import { describe, test, expect } from 'bun:test'
import {
  isSubcommand,
  parseTargetArgs,
  parseTreeArgs,
  parseScrollArgs,
  parseWaitArgs,
  parseModifiers,
  clean,
  GET_ENDPOINTS,
  GET_COMPOUND,
  COMPOUND_PATHS,
  ARG_MAPS,
} from '../bin/cli-subcommand.mjs'

describe('isSubcommand', () => {
  test('recognizes valid subcommands', () => {
    expect(isSubcommand('tree')).toBe(true)
    expect(isSubcommand('click')).toBe(true)
    expect(isSubcommand('status')).toBe(true)
    expect(isSubcommand('events-watch')).toBe(true)
    expect(isSubcommand('navigate')).toBe(true)
  })

  test('rejects flags', () => {
    expect(isSubcommand('--server')).toBe(false)
    expect(isSubcommand('--app')).toBe(false)
    expect(isSubcommand('-h')).toBe(false)
  })

  test('rejects numeric port numbers', () => {
    expect(isSubcommand('8700')).toBe(false)
    expect(isSubcommand('3000')).toBe(false)
    expect(isSubcommand('9000')).toBe(false)
  })

  test('rejects null/undefined/empty', () => {
    expect(isSubcommand('')).toBe(false)
    expect(isSubcommand(null)).toBe(false)
    expect(isSubcommand(undefined)).toBe(false)
  })
})

describe('parseTargetArgs', () => {
  test('parses bare numbers as refs', () => {
    expect(parseTargetArgs(['42'])).toEqual({ ref: '42' })
    expect(parseTargetArgs(['1'])).toEqual({ ref: '1' })
    expect(parseTargetArgs(['999'])).toEqual({ ref: '999' })
  })

  test('treats @N as a ref (strips @ prefix)', () => {
    expect(parseTargetArgs(['@42'])).toEqual({ ref: '42' })
    expect(parseTargetArgs(['@1'])).toEqual({ ref: '1' })
  })

  test('parses CSS selectors', () => {
    expect(parseTargetArgs(['#submit'])).toEqual({ selector: '#submit' })
    expect(parseTargetArgs(['.btn-primary'])).toEqual({ selector: '.btn-primary' })
    expect(parseTargetArgs(['button[type=submit]'])).toEqual({ selector: 'button[type=submit]' })
  })

  test('returns empty for no args', () => {
    expect(parseTargetArgs([])).toEqual({})
    expect(parseTargetArgs([''])).toEqual({})
  })
})

describe('parseTreeArgs', () => {
  test('parses depth flag', () => {
    expect(parseTreeArgs(['-d', '5'])).toEqual({ depth: 5 })
    expect(parseTreeArgs(['--depth', '3'])).toEqual({ depth: 3 })
  })

  test('parses compact flag', () => {
    expect(parseTreeArgs(['-c'])).toEqual({ compact: true })
    expect(parseTreeArgs(['--compact'])).toEqual({ compact: true })
  })

  test('parses selector flag', () => {
    expect(parseTreeArgs(['-s', 'form'])).toEqual({ selector: 'form' })
    expect(parseTreeArgs(['--selector', '#main'])).toEqual({ selector: '#main' })
  })

  test('parses positional selector', () => {
    expect(parseTreeArgs(['body'])).toEqual({ selector: 'body' })
  })

  test('parses visible-only flag', () => {
    expect(parseTreeArgs(['--visible'])).toEqual({ visibleOnly: true })
  })

  test('parses text flags', () => {
    expect(parseTreeArgs(['--text'])).toEqual({ includeText: true })
    expect(parseTreeArgs(['--no-text'])).toEqual({ includeText: false })
  })

  test('parses shadow flag', () => {
    expect(parseTreeArgs(['--shadow'])).toEqual({ pierceShadow: true })
  })

  test('combines multiple flags', () => {
    expect(parseTreeArgs(['-d', '4', '--visible', '--compact'])).toEqual({
      depth: 4,
      visibleOnly: true,
      compact: true,
    })
  })

  test('returns undefined for no args', () => {
    expect(parseTreeArgs([])).toBeUndefined()
  })
})

describe('parseScrollArgs', () => {
  test('parses selector targets', () => {
    expect(parseScrollArgs(['#section'])).toEqual({ selector: '#section' })
    expect(parseScrollArgs(['.footer'])).toEqual({ selector: '.footer' })
    expect(parseScrollArgs(['[data-id]'])).toEqual({ selector: '[data-id]' })
  })

  test('parses deltaY only', () => {
    expect(parseScrollArgs(['500'])).toEqual({ deltaY: 500 })
  })

  test('parses deltaX and deltaY', () => {
    expect(parseScrollArgs(['100', '200'])).toEqual({ deltaX: 100, deltaY: 200 })
  })

  test('returns empty for no args', () => {
    expect(parseScrollArgs([])).toEqual({})
  })
})

describe('parseWaitArgs', () => {
  test('defaults to 1000ms', () => {
    expect(parseWaitArgs([])).toEqual({ ms: 1000 })
  })

  test('parses milliseconds', () => {
    expect(parseWaitArgs(['500'])).toEqual({ ms: 500 })
    expect(parseWaitArgs(['3000'])).toEqual({ ms: 3000 })
  })

  test('parses selector target', () => {
    expect(parseWaitArgs(['.modal'])).toEqual({ selector: '.modal' })
  })

  test('parses selector with timeout', () => {
    expect(parseWaitArgs(['.modal', '10000'])).toEqual({ selector: '.modal', timeout: 10000 })
  })
})

describe('parseModifiers', () => {
  test('parses --ctrl', () => {
    expect(parseModifiers(['--ctrl'])).toEqual({ ctrl: true })
  })

  test('parses short flags', () => {
    expect(parseModifiers(['-c'])).toEqual({ ctrl: true })
    expect(parseModifiers(['-s'])).toEqual({ shift: true })
    expect(parseModifiers(['-a'])).toEqual({ alt: true })
    expect(parseModifiers(['-m'])).toEqual({ meta: true })
  })

  test('parses multiple modifiers', () => {
    expect(parseModifiers(['--ctrl', '--shift'])).toEqual({ ctrl: true, shift: true })
  })

  test('returns empty for no modifiers', () => {
    expect(parseModifiers([])).toEqual({})
    expect(parseModifiers(['Enter'])).toEqual({})
  })
})

describe('clean', () => {
  test('removes undefined values', () => {
    expect(clean({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' })
  })

  test('returns undefined for empty result', () => {
    expect(clean({ a: undefined })).toBeUndefined()
  })

  test('returns undefined for null/undefined input', () => {
    expect(clean(null)).toBeUndefined()
    expect(clean(undefined)).toBeUndefined()
  })

  test('keeps falsy non-undefined values', () => {
    expect(clean({ a: 0, b: false, c: '' })).toEqual({ a: 0, b: false, c: '' })
  })
})

describe('ARG_MAPS', () => {
  describe('click', () => {
    test('maps bare number as ref', () => {
      expect(ARG_MAPS.click(['42'])).toEqual({ ref: '42' })
    })

    test('maps selector', () => {
      expect(ARG_MAPS.click(['#btn'])).toEqual({ selector: '#btn' })
    })

    test('empty args', () => {
      expect(ARG_MAPS.click([])).toEqual({})
    })
  })

  describe('type', () => {
    test('maps bare number ref + text', () => {
      expect(ARG_MAPS.type(['10', 'hello', 'world'])).toEqual({
        ref: '10',
        text: 'hello world',
      })
    })

    test('maps selector + text', () => {
      expect(ARG_MAPS.type(['#email', 'user@example.com'])).toEqual({
        selector: '#email',
        text: 'user@example.com',
      })
    })

    test('single word text', () => {
      expect(ARG_MAPS.type(['5', 'hello'])).toEqual({ ref: '5', text: 'hello' })
    })
  })

  describe('key', () => {
    test('maps key name', () => {
      expect(ARG_MAPS.key(['Enter'])).toEqual({ key: 'Enter' })
    })

    test('maps key with modifiers', () => {
      expect(ARG_MAPS.key(['a', '--ctrl'])).toEqual({ key: 'a', ctrl: true })
      expect(ARG_MAPS.key(['s', '--ctrl', '--shift'])).toEqual({ key: 's', ctrl: true, shift: true })
    })
  })

  describe('drag', () => {
    test('maps ref + deltas', () => {
      expect(ARG_MAPS.drag(['5', '100', '200'])).toEqual({
        ref: '5',
        deltaX: 100,
        deltaY: 200,
      })
    })

    test('maps selector + deltas', () => {
      expect(ARG_MAPS.drag(['.handle', '50', '-30'])).toEqual({
        selector: '.handle',
        deltaX: 50,
        deltaY: -30,
      })
    })
  })

  describe('navigate', () => {
    test('maps url', () => {
      expect(ARG_MAPS.navigate(['https://example.com'])).toEqual({ url: 'https://example.com' })
    })
  })

  describe('eval', () => {
    test('joins all args as code', () => {
      expect(ARG_MAPS.eval(['document.title'])).toEqual({ code: 'document.title' })
      expect(ARG_MAPS.eval(['1', '+', '1'])).toEqual({ code: '1 + 1' })
    })
  })

  describe('find', () => {
    test('joins all args as text', () => {
      expect(ARG_MAPS.find(['Submit', 'Order'])).toEqual({ text: 'Submit Order' })
    })
  })

  describe('highlight', () => {
    test('maps target + label', () => {
      expect(ARG_MAPS.highlight(['3', 'Click here'])).toEqual({ ref: '3', label: 'Click here' })
    })

    test('maps target without label', () => {
      expect(ARG_MAPS.highlight(['#btn'])).toEqual({ selector: '#btn', label: undefined })
    })
  })

  describe('refresh', () => {
    test('no args', () => {
      expect(ARG_MAPS.refresh([])).toEqual({})
    })

    test('--hard flag', () => {
      expect(ARG_MAPS.refresh(['--hard'])).toEqual({ hard: true })
    })
  })

  describe('call', () => {
    test('maps target + method', () => {
      expect(ARG_MAPS.call(['5', 'value'])).toEqual({ ref: '5', method: 'value', args: [] })
    })

    test('maps target + method + args', () => {
      expect(ARG_MAPS.call(['#el', 'setAttribute', '"class"', '"active"'])).toEqual({
        selector: '#el',
        method: 'setAttribute',
        args: ['class', 'active'],
      })
    })
  })

  describe('events-watch', () => {
    test('defaults to interactive preset', () => {
      expect(ARG_MAPS['events-watch']([])).toEqual({ preset: 'interactive' })
    })

    test('accepts custom preset', () => {
      expect(ARG_MAPS['events-watch'](['detailed'])).toEqual({ preset: 'detailed' })
    })
  })

  describe('mutations-watch', () => {
    test('defaults to smart preset', () => {
      expect(ARG_MAPS['mutations-watch']([])).toEqual({ preset: 'smart' })
    })
  })

  describe('tabs-open', () => {
    test('maps url', () => {
      expect(ARG_MAPS['tabs-open'](['https://example.com'])).toEqual({ url: 'https://example.com' })
    })
  })

  describe('tabs-close', () => {
    test('maps window id', () => {
      expect(ARG_MAPS['tabs-close'](['abc123'])).toEqual({ window: 'abc123' })
    })
  })

  describe('screenshot', () => {
    test('maps ref', () => {
      expect(ARG_MAPS.screenshot(['10'])).toEqual({ ref: '10' })
    })

    test('maps selector', () => {
      expect(ARG_MAPS.screenshot(['#chart'])).toEqual({ selector: '#chart' })
    })

    test('no args for full page', () => {
      expect(ARG_MAPS.screenshot([])).toEqual({})
    })
  })

  describe('snapshot', () => {
    test('maps context string', () => {
      expect(ARG_MAPS.snapshot(['after', 'login'])).toEqual({ context: 'after login' })
    })

    test('no context', () => {
      expect(ARG_MAPS.snapshot([])).toEqual({ context: undefined })
    })
  })
})

describe('GET vs POST routing', () => {
  test('GET endpoints are correct', () => {
    const getEndpoints = ['location', 'events', 'console', 'windows', 'recordings', 'status', 'version', 'docs', 'api', 'stats']
    for (const ep of getEndpoints) {
      expect(GET_ENDPOINTS.has(ep)).toBe(true)
    }
  })

  test('POST endpoints are not in GET set', () => {
    const postEndpoints = ['click', 'type', 'key', 'tree', 'navigate', 'eval', 'screenshot']
    for (const ep of postEndpoints) {
      expect(GET_ENDPOINTS.has(ep)).toBe(false)
    }
  })

  test('compound GET endpoints', () => {
    expect(GET_COMPOUND.has('mutations-status')).toBe(true)
    expect(GET_COMPOUND.has('events-stats')).toBe(true)
    expect(GET_COMPOUND.has('select-status')).toBe(true)
    expect(GET_COMPOUND.has('select-result')).toBe(true)
  })

  test('compound POST endpoints are not GET', () => {
    expect(GET_COMPOUND.has('mutations-watch')).toBe(false)
    expect(GET_COMPOUND.has('events-watch')).toBe(false)
    expect(GET_COMPOUND.has('select-start')).toBe(false)
  })
})

describe('COMPOUND_PATHS', () => {
  test('maps hyphenated to slashed paths', () => {
    expect(COMPOUND_PATHS['mutations-watch']).toBe('/mutations/watch')
    expect(COMPOUND_PATHS['events-watch']).toBe('/events/watch')
    expect(COMPOUND_PATHS['select-start']).toBe('/select/start')
    expect(COMPOUND_PATHS['tabs-open']).toBe('/tabs/open')
    expect(COMPOUND_PATHS['recording-start']).toBe('/recording/start')
    expect(COMPOUND_PATHS['test-run']).toBe('/test/run')
  })
  
  test('send endpoints are mapped', () => {
    expect(COMPOUND_PATHS['send-message']).toBe('/send/message')
    expect(COMPOUND_PATHS['send-selection']).toBe('/send/selection')
    expect(COMPOUND_PATHS['send-recording']).toBe('/send/recording')
  })
})

describe('ARG_MAPS send commands', () => {
  describe('send-message', () => {
    test('maps agent and message', () => {
      expect(ARG_MAPS['send-message'](['claude', 'hello', 'world'])).toEqual({
        agent: 'claude',
        message: 'hello world',
        submit: true,
      })
    })
    
    test('--no-submit flag sets submit to false', () => {
      expect(ARG_MAPS['send-message'](['claude', '--no-submit', 'check', 'this'])).toEqual({
        agent: 'claude',
        message: 'check this',
        submit: false,
      })
    })
    
    test('--no-submit can be at end', () => {
      expect(ARG_MAPS['send-message'](['claude', 'hello', '--no-submit'])).toEqual({
        agent: 'claude',
        message: 'hello',
        submit: false,
      })
    })
  })
  
  describe('send-selection', () => {
    test('maps agent', () => {
      expect(ARG_MAPS['send-selection'](['claude'])).toEqual({
        agent: 'claude',
        submit: true,
      })
    })
    
    test('no agent defaults submit to true', () => {
      expect(ARG_MAPS['send-selection']([])).toEqual({
        agent: undefined,
        submit: true,
      })
    })
    
    test('--no-submit flag', () => {
      expect(ARG_MAPS['send-selection'](['claude', '--no-submit'])).toEqual({
        agent: 'claude',
        submit: false,
      })
    })
  })
  
  describe('send-recording', () => {
    test('maps agent and description', () => {
      expect(ARG_MAPS['send-recording'](['claude', 'this', 'shows', 'the', 'bug'])).toEqual({
        agent: 'claude',
        description: 'this shows the bug',
        submit: true,
      })
    })
    
    test('no description', () => {
      expect(ARG_MAPS['send-recording'](['claude'])).toEqual({
        agent: 'claude',
        description: undefined,
        submit: true,
      })
    })
    
    test('--no-submit flag', () => {
      expect(ARG_MAPS['send-recording'](['--no-submit', 'claude'])).toEqual({
        agent: 'claude',
        description: undefined,
        submit: false,
      })
    })
  })
})
