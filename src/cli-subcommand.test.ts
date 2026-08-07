import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import {
  isSubcommand,
  getSuggestion,
  normalizeEqualsFlags,
  warnUnknownFlags,
  KNOWN_FLAGS,
  GLOBAL_FLAGS,
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
  resolveServerPath,
  substituteVars,
  parseTestArgs,
  normalizeEqualsFlags,
  warnUnknownFlags,
  KNOWN_FLAGS,
  GLOBAL_FLAGS,
  COMMAND_HINTS,
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

  test('parses frames flags', () => {
    expect(parseTreeArgs(['--frames'])).toEqual({ pierceFrames: true })
    expect(parseTreeArgs(['--no-frames'])).toEqual({ pierceFrames: false })
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

  test('sends forElement — the field /wait actually reads', () => {
    // These two tests used to assert `{ selector }`, which the endpoint ignores. `hj wait ".modal"`
    // therefore hit /wait's no-argument path and returned `{ success: true, waited: 0 }` in ~50ms:
    // a wait that never waited, reported as success, so every assertion after it raced the page.
    // The tests were added in the same cycle as the bug and pinned the wrong field, which is
    // exactly why the suite stayed green. Assert the wire field, not the parser's convenience name.
    expect(parseWaitArgs(['.modal'])).toEqual({ forElement: '.modal' })
  })

  test('--timeout is parsed as a FLAG, not read positionally', () => {
    // `args[1]` meant `Number('--timeout')` → NaN went out on the wire.
    expect(parseWaitArgs(['.modal', '--timeout', '10000'])).toEqual({ forElement: '.modal', timeout: 10000 })
    expect(parseWaitArgs(normalizeEqualsFlags(['.modal', '--timeout=10000'])))
      .toEqual({ forElement: '.modal', timeout: 10000 })
  })

  test('--selector names the target instead of being taken AS the target', () => {
    // `hj wait --selector "#foo"` used to send forElement: "--selector".
    expect(parseWaitArgs(['--selector', '#foo'])).toEqual({ forElement: '#foo' })
  })

  test('the documented positional timeout is honoured, not silently dropped', () => {
    // `hj wait .loading 10000` is the form docs/agent-prompt.md:110 shows. My first cut of the
    // flag parser dropped it — accepting an argument and ignoring it, which is the exact class of
    // bug this fix exists to remove. An explicit --timeout still wins.
    expect(parseWaitArgs(['.loading', '10000'])).toEqual({ forElement: '.loading', timeout: 10000 })
    expect(parseWaitArgs(['.loading', '10000', '--timeout', '250']))
      .toEqual({ forElement: '.loading', timeout: 250 })
  })

  test('--hidden and a bare delay still work', () => {
    expect(parseWaitArgs(['.modal', '--hidden'])).toEqual({ forElement: '.modal', hidden: true })
    expect(parseWaitArgs(['500'])).toEqual({ ms: 500 })
    expect(parseWaitArgs([])).toEqual({ ms: 1000 })
  })
})

describe('parseModifiers', () => {
  test('parses --ctrl', () => {
    expect(parseModifiers(['--ctrl'])).toEqual({ ctrlKey: true })
  })

  test('parses short flags', () => {
    expect(parseModifiers(['-c'])).toEqual({ ctrlKey: true })
    expect(parseModifiers(['-s'])).toEqual({ shiftKey: true })
    expect(parseModifiers(['-a'])).toEqual({ altKey: true })
    expect(parseModifiers(['-m'])).toEqual({ metaKey: true })
  })

  test('parses multiple modifiers', () => {
    expect(parseModifiers(['--ctrl', '--shift'])).toEqual({ ctrlKey: true, shiftKey: true })
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

    test('maps --diff flag', () => {
      expect(ARG_MAPS.click(['42', '--diff'])).toEqual({ ref: '42', diff: true })
      expect(ARG_MAPS.click(['#btn', '--diff'])).toEqual({ selector: '#btn', diff: true })
    })

    test('maps --diff with --delay', () => {
      expect(ARG_MAPS.click(['42', '--diff', '--delay', '500'])).toEqual({ ref: '42', diff: true, diffDelay: 500 })
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

    test('maps key with modifiers, using the field names /key reads', () => {
      // These asserted `ctrl`/`shift`, which the endpoint ignores — so `hj key s --ctrl` sent a
      // keystroke with NO modifier and reported success. A third test in this file pinning a
      // CLI/endpoint field-name mismatch; the e2e lane now checks a real keydown event, which is
      // the only tier that can catch this class.
      expect(ARG_MAPS.key(['a', '--ctrl'])).toEqual({ key: 'a', ctrlKey: true })
      expect(ARG_MAPS.key(['s', '--ctrl', '--shift'])).toEqual({ key: 's', ctrlKey: true, shiftKey: true })
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

    test('--soft flag', () => {
      expect(ARG_MAPS.refresh(['--soft'])).toEqual({ soft: true })
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
      expect(ARG_MAPS.screenshot(['10'])).toEqual({ ref: '10', file: true })
    })

    test('maps selector', () => {
      expect(ARG_MAPS.screenshot(['#chart'])).toEqual({ selector: '#chart', file: true })
    })

    test('no args for full page', () => {
      expect(ARG_MAPS.screenshot([])).toEqual({ file: true })
    })

    test('--scale flag', () => {
      expect(ARG_MAPS.screenshot(['--scale', '0.5'])).toEqual({ scale: 0.5, file: true })
    })

    test('--scale with selector', () => {
      expect(ARG_MAPS.screenshot(['#chart', '--scale', '0.5'])).toEqual({ selector: '#chart', scale: 0.5, file: true })
    })

    test('--maxWidth and --maxHeight', () => {
      expect(ARG_MAPS.screenshot(['--maxWidth', '800', '--maxHeight', '600'])).toEqual({ maxWidth: 800, maxHeight: 600, file: true })
    })

    test('--max-width kebab-case', () => {
      expect(ARG_MAPS.screenshot(['--max-width', '400'])).toEqual({ maxWidth: 400, file: true })
    })

    test('--delay flag', () => {
      expect(ARG_MAPS.screenshot(['--delay', '1000'])).toEqual({ delay: 1000, file: true })
    })

    test('--no-chyron flag', () => {
      expect(ARG_MAPS.screenshot(['--no-chyron'])).toEqual({ chyron: false, file: true })
    })

    test('--data-url flag', () => {
      expect(ARG_MAPS.screenshot(['--data-url'])).toEqual({ file: false })
    })

    test('--format flag', () => {
      expect(ARG_MAPS.screenshot(['--format', 'webp'])).toEqual({ format: 'webp', file: true })
    })

    test('--format with selector', () => {
      expect(ARG_MAPS.screenshot(['#chart', '--format', 'jpeg'])).toEqual({ selector: '#chart', format: 'jpeg', file: true })
    })

    test('--quality in 0-1 range is passed through', () => {
      expect(ARG_MAPS.screenshot(['--format', 'webp', '--quality', '0.9'])).toEqual({ format: 'webp', quality: 0.9, file: true })
    })

    test('--quality in 0-100 range is normalized to 0-1', () => {
      expect(ARG_MAPS.screenshot(['--quality', '90'])).toEqual({ quality: 0.9, file: true })
      expect(ARG_MAPS.screenshot(['--quality', '100'])).toEqual({ quality: 1, file: true })
    })

    test('all flags combined', () => {
      expect(ARG_MAPS.screenshot(['#chart', '--format', 'webp', '--scale', '0.5', '--maxWidth', '400', '--delay', '500', '--no-chyron'])).toEqual({
        selector: '#chart', format: 'webp', scale: 0.5, maxWidth: 400, delay: 500, chyron: false, file: true
      })
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

  describe('inspect', () => {
    test('maps selector', () => {
      expect(ARG_MAPS.inspect(['#btn'])).toEqual({ selector: '#btn' })
    })

    test('maps ref', () => {
      expect(ARG_MAPS.inspect(['42'])).toEqual({ ref: '42' })
      expect(ARG_MAPS.inspect(['@42'])).toEqual({ ref: '42' })
    })

    test('maps --matched-rules flag', () => {
      expect(ARG_MAPS.inspect(['#btn', '--matched-rules'])).toEqual({ selector: '#btn', matchedRules: true })
      expect(ARG_MAPS.inspect(['#btn', '--rules'])).toEqual({ selector: '#btn', matchedRules: true })
    })

    test('maps --full-styles flag', () => {
      expect(ARG_MAPS.inspect(['#btn', '--full-styles'])).toEqual({ selector: '#btn', fullStyles: true })
      expect(ARG_MAPS.inspect(['#btn', '--styles'])).toEqual({ selector: '#btn', fullStyles: true })
    })

    test('does NOT map --ancestors — /inspect has never accepted it', () => {
      // This test used to assert the OPPOSITE, pinning a field that no endpoint declares and the
      // widget implements only in its `tree` branch. So `hj inspect 5 --ancestors` set a key
      // nothing read, returned 200, and gave you the same payload as the flagless call — with a
      // green test certifying it. A test can pin a bug as firmly as it pins a fix.
      expect(ARG_MAPS.inspect(['#btn', '--ancestors'])).toEqual({ selector: '#btn' })
    })

    test('`--ancestors` works on tree, where it is declared and implemented', () => {
      expect(parseTreeArgs(['--ancestors'])).toEqual({ ancestors: true })
    })

    test('combines multiple flags', () => {
      expect(ARG_MAPS.inspect(['#btn', '--matched-rules', '--full-styles'])).toEqual({
        selector: '#btn',
        matchedRules: true,
        fullStyles: true,
      })
    })

    test('empty args', () => {
      expect(ARG_MAPS.inspect([])).toBeUndefined()
    })
  })

  describe('styles', () => {
    test('maps selector with matchedRules', () => {
      expect(ARG_MAPS.styles(['#btn'])).toEqual({ selector: '#btn', matchedRules: true })
    })

    test('maps ref with matchedRules', () => {
      expect(ARG_MAPS.styles(['42'])).toEqual({ ref: '42', matchedRules: true })
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

  test('styles alias routes to /inspect', () => {
    expect(COMPOUND_PATHS['styles']).toBe('/inspect')
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

describe('resolveServerPath', () => {
  test('finds dev server when built', () => {
    // In dev environment with built dist, should find dist/server.js
    const resolved = resolveServerPath()
    expect(resolved).not.toBeNull()
    // Should be 'dev' type since we're running tests from source, not from compiled binary
    expect(resolved?.type).toBe('dev')
    expect(resolved?.path).toContain('dist/server.js')
  })

  test('returns path based on architecture', () => {
    const resolved = resolveServerPath()
    expect(resolved).not.toBeNull()
    // The path should exist
    const { existsSync } = require('fs')
    expect(existsSync(resolved?.path)).toBe(true)
  })
})

describe('substituteVars', () => {
  // Save original env vars
  let originalEnv: Record<string, string | undefined>
  
  beforeAll(() => {
    originalEnv = { ...process.env }
    // Set up test env vars
    process.env.TEST_PORT = '3000'
    process.env.TEST_HOST = 'localhost'
  })
  
  afterAll(() => {
    // Restore original env
    delete process.env.TEST_PORT
    delete process.env.TEST_HOST
  })

  test('substitutes from vars object', () => {
    const { text } = substituteVars('http://${HOST}:${PORT}/app', { HOST: 'example.com', PORT: '8080' })
    expect(text).toBe('http://example.com:8080/app')
  })

  test('falls back to env vars', () => {
    const { text } = substituteVars('http://${TEST_HOST}:${TEST_PORT}/app', {})
    expect(text).toBe('http://localhost:3000/app')
  })

  test('vars object takes precedence over env vars', () => {
    const { text } = substituteVars('http://${TEST_HOST}:${TEST_PORT}/app', { TEST_PORT: '5050' })
    expect(text).toBe('http://localhost:5050/app')
  })

  test('leaves unresolved variables as-is', () => {
    const { text } = substituteVars('http://${UNKNOWN_VAR}/app', {})
    expect(text).toBe('http://${UNKNOWN_VAR}/app')
  })

  test('handles multiple occurrences of same variable', () => {
    const { text } = substituteVars('${X} and ${X} again', { X: 'foo' })
    expect(text).toBe('foo and foo again')
  })

  test('handles whitespace in variable names', () => {
    const { text } = substituteVars('${ SPACED }', { SPACED: 'works' })
    expect(text).toBe('works')
  })

  test('handles no variables', () => {
    const { text } = substituteVars('plain text', {})
    expect(text).toBe('plain text')
  })

  test('works with JSON content', () => {
    const json = '{"url": "http://${HOST}:${PORT}", "name": "${TEST_NAME}"}'
    const { text } = substituteVars(json, { HOST: 'localhost', PORT: '5050', TEST_NAME: 'my-test' })
    expect(text).toBe('{"url": "http://localhost:5050", "name": "my-test"}')
    // Verify it's valid JSON
    const parsed = JSON.parse(text)
    expect(parsed.url).toBe('http://localhost:5050')
    expect(parsed.name).toBe('my-test')
  })

  test('substitutes ${GEN.*} patterns with generated data', () => {
    const { text, genInfo } = substituteVars('email: ${GEN.EMAIL}', {}, 42)
    expect(text).not.toContain('${GEN.')
    expect(text).toContain('@haltija-test.example')
    expect(genInfo).not.toBeNull()
    expect(genInfo.seed).toBe(42)
  })

  test('same GEN key produces same value', () => {
    const { text } = substituteVars('${GEN.EMAIL} and ${GEN.EMAIL}', {}, 42)
    const parts = text.split(' and ')
    expect(parts[0]).toBe(parts[1])
  })

  test('GEN and explicit vars coexist', () => {
    const { text } = substituteVars('${APP_URL} ${GEN.EMAIL}', { APP_URL: 'http://localhost' }, 42)
    expect(text).toMatch(/^http:\/\/localhost .+@haltija-test\.example$/)
  })
})

describe('parseTestArgs', () => {
  test('extracts files', () => {
    const { files, options, vars } = parseTestArgs(['test1.json', 'test2.json'])
    expect(files).toEqual(['test1.json', 'test2.json'])
    expect(options).toEqual({})
    expect(vars).toEqual({})
  })

  test('extracts --timeoutMs', () => {
    const { files, options } = parseTestArgs(['test.json', '--timeoutMs', '10000'])
    expect(files).toEqual(['test.json'])
    expect(options.timeout).toBe(10000)
  })

  test('extracts --allow-failures', () => {
    const { options } = parseTestArgs(['test.json', '--allow-failures', '5'])
    expect(options.patience).toBe(5)
  })

  test('extracts --allow-failures-streak', () => {
    const { options } = parseTestArgs(['test.json', '--allow-failures-streak', '3'])
    expect(options.patienceStreak).toBe(3)
  })

  test('extracts --step-delay', () => {
    const { options } = parseTestArgs(['test.json', '--step-delay', '200'])
    expect(options.stepDelay).toBe(200)
  })

  test('extracts --vars JSON', () => {
    const { vars } = parseTestArgs(['test.json', '--vars', '{"APP_URL": "http://localhost:5050", "USER": "test"}'])
    expect(vars).toEqual({ APP_URL: 'http://localhost:5050', USER: 'test' })
  })

  test('combines multiple --vars', () => {
    const { vars } = parseTestArgs([
      'test.json',
      '--vars', '{"A": "1"}',
      '--vars', '{"B": "2"}',
    ])
    expect(vars).toEqual({ A: '1', B: '2' })
  })

  test('later --vars override earlier ones', () => {
    const { vars } = parseTestArgs([
      'test.json',
      '--vars', '{"X": "first"}',
      '--vars', '{"X": "second"}',
    ])
    expect(vars).toEqual({ X: 'second' })
  })

  test('handles all options together', () => {
    const { files, options, vars } = parseTestArgs([
      'tests/',
      '--timeoutMs', '8000',
      '--allow-failures', '3',
      '--vars', '{"PORT": "5050"}',
      '--step-delay', '150',
    ])
    expect(files).toEqual(['tests/'])
    expect(options).toEqual({
      timeout: 8000,
      patience: 3,
      stepDelay: 150,
    })
    expect(vars).toEqual({ PORT: '5050' })
  })

  test('skips unknown flags', () => {
    const { files, options } = parseTestArgs(['test.json', '--unknown-flag', '--another'])
    expect(files).toEqual(['test.json'])
    expect(options).toEqual({})
  })
})

// ============================================================================
// Standalone hj bundle (dist/hj.js)
// ============================================================================

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { isolateTestMachineState, uniqueTestPort } from './test-support'

// Spawned servers register themselves in the instance registry. Point them at a
// throwaway dir: otherwise a transient test server lands in the developer's real
// ~/.haltija/servers/ and — same cwd, newer startedAt — out-ranks their actual dev
// server on a cwd match, so `hj` in this repo silently drives a browserless test
// server. Set before any spawn; sessions.ts resolves the dir per call.
isolateTestMachineState()


describe('standalone hj bundle', () => {
  const hjPath = join(import.meta.dir, '..', 'dist', 'hj.js')

  test('dist/hj.js exists', () => {
    expect(existsSync(hjPath)).toBe(true)
  })

  test('has bun shebang', () => {
    const content = readFileSync(hjPath, 'utf-8')
    expect(content.startsWith('#!/usr/bin/env bun\n')).toBe(true)
  })

  test('runs --help from isolated directory', () => {
    const result = spawnSync('bun', [hjPath, '--help'], {
      cwd: '/tmp',
      timeout: 10000,
      encoding: 'utf-8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('hj')
    expect(result.stdout).toContain('Usage:')
  })

  test('contains inlined subcommand logic', () => {
    const content = readFileSync(hjPath, 'utf-8')
    // Should contain key functions from cli-subcommand.mjs
    expect(content).toContain('isSubcommand')
    expect(content).toContain('runSubcommand')
    // Should NOT have relative imports to sibling files
    expect(content).not.toContain("from './cli-subcommand.mjs'")
    expect(content).not.toContain("from './format-tree.mjs'")
  })
})

describe('normalizeEqualsFlags', () => {
  test('splits --flag=value into two tokens', () => {
    expect(normalizeEqualsFlags(['--format=webp'])).toEqual(['--format', 'webp'])
  })

  test('leaves --flag value untouched', () => {
    expect(normalizeEqualsFlags(['--format', 'webp'])).toEqual(['--format', 'webp'])
  })

  test('leaves positionals untouched', () => {
    expect(normalizeEqualsFlags(['#chart', '--scale=0.5'])).toEqual(['#chart', '--scale', '0.5'])
  })

  test('splits on the first = only', () => {
    expect(normalizeEqualsFlags(['--vars={"A":"B=C"}'])).toEqual(['--vars', '{"A":"B=C"}'])
  })

  test('does not split a bare = inside a positional (non---)', () => {
    expect(normalizeEqualsFlags(['[data-x=y]'])).toEqual(['[data-x=y]'])
  })

  test('feeds directly into the screenshot mapper', () => {
    expect(ARG_MAPS.screenshot(normalizeEqualsFlags(['--format=webp', '--quality=80']))).toEqual({
      format: 'webp', quality: 0.8, file: true,
    })
  })
})

describe('warnUnknownFlags', () => {
  let warnings: string[]
  let origWrite: typeof process.stderr.write
  beforeAll(() => {
    origWrite = process.stderr.write.bind(process.stderr)
  })
  function capture(fn: () => void): string[] {
    warnings = []
    // @ts-expect-error - test stub
    process.stderr.write = (chunk: string) => { warnings.push(String(chunk)); return true }
    try { fn() } finally { process.stderr.write = origWrite }
    return warnings
  }

  test('warns on an unknown flag for a flag-oriented command', () => {
    const out = capture(() => warnUnknownFlags('screenshot', ['--frmat', 'webp']))
    expect(out.length).toBe(1)
    expect(out[0]).toContain('--frmat')
    expect(out[0]).toContain('did you mean --format?')
  })

  test('stays silent for known flags', () => {
    expect(capture(() => warnUnknownFlags('screenshot', ['--format', 'webp', '--scale', '0.5']))).toEqual([])
  })

  test('stays silent for a free-text command (not in KNOWN_FLAGS)', () => {
    expect(capture(() => warnUnknownFlags('eval', ['--anything', 'goes']))).toEqual([])
  })

  test('does not flag negative numbers as unknown flags', () => {
    expect(capture(() => warnUnknownFlags('screenshot', ['--scale', '-0.5']))).toEqual([])
  })

  test('allows global flags anywhere', () => {
    expect(capture(() => warnUnknownFlags('screenshot', ['--json', '--window', '3']))).toEqual([])
  })
})

describe('flags: every command that takes flags is registered (class invariant)', () => {
  // Three attempts at this check, and the failures are the interesting part.
  //
  // v1 scraped `'--flag'` literals out of each parser's source. It inspected 7 of 42 parsers and
  // skipped all three commands it was written for: extracting `presetArg()` moved the literal out
  // of the parser body, and `if (!literals.length) continue` hid the gap.
  //
  // v2 probed behaviour — does passing the flag change the parsed body? That produced FALSE
  // POSITIVES: `presetArg` accepts `--preset x` AND a bare `x`, so both forms yield the same body
  // and the probe concluded the parser "ignores" a flag it plainly reads. A check that cries wolf
  // is worse than none.
  //
  // v3 asserts the thing that actually matters and cannot be wrong about it: **a command whose
  // parser takes flags must have a `KNOWN_FLAGS` entry.** Both `normalizeEqualsFlags` (so
  // `--flag=value` splits) and `warnUnknownFlags` (so a typo is reported) are gated on that entry
  // existing — with no entry, `hj map --scale=3` parses to `{}` and warns about nothing. The
  // exemption list below is the documented carve-out for commands whose arguments are free-form
  // text, where a leading dash is content rather than a flag.

  /** Commands whose arguments are free-form text — a leading dash there is content, not a flag. */
  const FREE_FORM = new Set([
    'type', 'eval', 'find', 'snapshot', 'send', 'send-message', 'send-selection', 'send-recording',
    'highlight', 'navigate', 'select', 'tabs-open', 'tabs-close', 'tabs-focus', 'agent-start',
    'agent-send', 'agent-stop', 'terminal-run', 'task-add', 'task-move', 'task-remove',
  ])

  /** Does this parser's source — or a helper it calls — mention any `--flag`? */
  const SOURCE = readFileSync(join(import.meta.dir, '../bin/cli-subcommand.mjs'), 'utf-8')

  test('the invariant has something to check — not a vacuous empty set', () => {
    expect(Object.keys(ARG_MAPS).length).toBeGreaterThan(35)
    expect(Object.keys(KNOWN_FLAGS).length).toBeGreaterThan(10)
    // And the derived helper detection must actually find the helper that motivated all this.
    const helpers = [...SOURCE.matchAll(/export function (\w+)\(([\s\S]*?)\n\}/g)]
      .filter(([, , body]) => /['"]--[a-z]/i.test(body))
      .map(([, name]) => name)
    expect(helpers).toContain('presetArg')
    expect(helpers).not.toContain('parseTargetArgs') // resolves targets, handles no flags
  })

  test('every flag named in a command hint is registered in KNOWN_FLAGS', () => {
    // Purely declarative, so it cannot false-positive — and it is the direction that would have
    // caught B1: `bin/hints.json` advertised `--text` for `hj wait`, which no parser ever read.
    // An advertised flag that does nothing is the same silent lie as an unadvertised one that does.
    const gaps: string[] = []
    for (const [cmd, hint] of Object.entries(COMMAND_HINTS || {})) {
      const text = typeof hint === 'string' ? hint : (hint as any)?.hints
      if (typeof text !== 'string') continue
      const named = [...new Set(text.match(/--[a-z][\w-]*/gi) || [])]
      if (!named.length) continue
      const known = new Set([...((KNOWN_FLAGS as any)[cmd] || []), ...GLOBAL_FLAGS])
      const missing = named.filter((f) => !known.has(f))
      if (missing.length) gaps.push(`${cmd}: hint advertises ${missing.join(', ')}, KNOWN_FLAGS.${cmd} has neither`)
    }
    expect(gaps).toEqual([])
  })

  test('every command whose parser handles flags has a KNOWN_FLAGS entry', () => {
    // Catches the helper-extraction case v1 missed: a parser counts as flag-handling if its own
    // source names a `--flag` OR it calls a helper that does. The helper set is DERIVED, not
    // hand-listed — my hand-list included `parseTargetArgs`, which only resolves `@42`/selector and
    // handles no flags, and that produced three false alarms (drag, styles, call) in the same
    // breath as I was arguing that a check which cries wolf is worse than none.
    const FLAG_HELPERS = [...SOURCE.matchAll(/export function (\w+)\(([\s\S]*?)\n\}/g)]
      .filter(([, , body]) => /['"]--[a-z]/i.test(body))
      .map(([, name]) => name)
    const gaps: string[] = []
    for (const [cmd, fn] of Object.entries(ARG_MAPS)) {
      if (FREE_FORM.has(cmd)) continue
      const src = String(fn)
      const mentionsFlag = /['"]--[a-z]/i.test(src)
      const usesFlagHelper = FLAG_HELPERS.some((h) => src.includes(h))
      if (!mentionsFlag && !usesFlagHelper) continue
      if (!(KNOWN_FLAGS as any)[cmd]) {
        gaps.push(
          `${cmd}: parser handles flags but KNOWN_FLAGS.${cmd} does not exist — so --flag=value ` +
            `normalization AND the unknown-flag warning are both disabled for it`,
        )
      }
    }
    expect(gaps).toEqual([])
  })

  test('the flags that were silently dropped now parse', () => {
    expect(ARG_MAPS.map(['--scale', '3'])).toEqual({ scale: 3 })
    expect(normalizeEqualsFlags(['--scale=3'])).toEqual(['--scale', '3'])
    expect(ARG_MAPS.map(normalizeEqualsFlags(['--scale=3']))).toEqual({ scale: 3 })
    expect(ARG_MAPS.map(normalizeEqualsFlags(['--max-nodes=200']))).toEqual({ maxNodes: 200 })
  })

  test('--preset takes its VALUE, not the flag name, for all three watchers', () => {
    expect(ARG_MAPS['mutations-watch'](['--preset', 'smart'])).toEqual({ preset: 'smart' })
    expect(ARG_MAPS['network-watch'](['--preset', 'standard'])).toEqual({ preset: 'standard' })
    expect(ARG_MAPS['events-watch'](['--preset', 'detailed'])).toEqual({ preset: 'detailed' })
    expect(ARG_MAPS['mutations-watch'](['smart'])).toEqual({ preset: 'smart' })
    expect(ARG_MAPS['mutations-watch']([])).toEqual({ preset: 'smart' })
    expect(ARG_MAPS['events-watch'](['--preset'])).toEqual({ preset: 'interactive' })
  })

  test('the =form and the space form agree wherever KNOWN_FLAGS registers the flag', () => {
    // The user-visible harm of a missing entry, asserted directly.
    for (const [cmd, flags] of Object.entries(KNOWN_FLAGS)) {
      const fn = (ARG_MAPS as any)[cmd]
      // test-* parsers call process.exit() on unusable input, which would kill the test runner.
      if (typeof fn !== 'function' || FREE_FORM.has(cmd) || cmd.startsWith('test-')) continue
      for (const flag of flags as string[]) {
        if (!flag.startsWith('--')) continue
        let spaced: unknown, equalled: unknown
        try {
          spaced = fn([flag, '7'])
          equalled = fn(normalizeEqualsFlags([`${flag}=7`]))
        } catch { continue }
        expect(`${cmd} ${flag}: ${JSON.stringify(equalled)}`).toBe(`${cmd} ${flag}: ${JSON.stringify(spaced)}`)
      }
    }
  })

  test('an unknown flag now warns instead of vanishing', () => {
    let out = ''
    const orig = process.stderr.write.bind(process.stderr)
    ;(process.stderr as any).write = (chunk: string) => { out += chunk; return true }
    try {
      warnUnknownFlags('map', ['--imge'])
    } finally {
      ;(process.stderr as any).write = orig
    }
    expect(out).toContain('--imge')
    expect(out).toContain('--image')
  })
})

describe('the eight flags that were advertised and never read', () => {
  // `hj <cmd> --help` promised each of these and every endpoint accepted them; only the CLI
  // dropped them. Registration alone is not proof — assert the parsed body.

  test('type: --clear stops being typed as literal text', () => {
    // The worst of the eight. `text` is `args.slice(1).join(' ')`, so `hj type 10 "hello" --clear`
    // typed the characters "hello --clear" into the field.
    expect(ARG_MAPS.type(['10', 'hello', '--clear'])).toEqual({ ref: '10', text: 'hello', clear: true })
    expect(ARG_MAPS.type(['10', 'hello world'])).toEqual({ ref: '10', text: 'hello world' })
  })

  test('type: --humanlike takes the documented explicit boolean', () => {
    expect(ARG_MAPS.type(['10', 'hi', '--humanlike', 'false'])).toEqual({ ref: '10', text: 'hi', humanlike: false })
    expect(ARG_MAPS.type(['10', 'hi', '--humanlike'])).toEqual({ ref: '10', text: 'hi', humanlike: true })
  })

  test('query: --all', () => {
    expect(ARG_MAPS.query(['.item', '--all'])).toEqual({ selector: '.item', all: true })
    expect(ARG_MAPS.query(['.item'])).toEqual({ selector: '.item' })
  })

  test('key: --repeat, without disturbing the modifiers', () => {
    expect(ARG_MAPS.key(['Tab', '--repeat', '3'])).toEqual({ key: 'Tab', repeat: 3 })
    expect(ARG_MAPS.key(['s', '--ctrl'])).toEqual({ key: 's', ctrlKey: true })
    expect(ARG_MAPS.key(['s', '--ctrl', '--repeat', '2'])).toEqual({ key: 's', ctrlKey: true, repeat: 2 })
  })

  test('drag and scroll: --duration', () => {
    expect(ARG_MAPS.drag(['5', '10', '20', '--duration', '500']))
      .toEqual({ ref: '5', deltaX: 10, deltaY: 20, duration: 500 })
    expect(ARG_MAPS.scroll(['200', '--duration', '500'])).toEqual({ deltaY: 200, duration: 500 })
  })

  test('highlight: --label/--color/--duration, and the positional label still works', () => {
    expect(ARG_MAPS.highlight(['5', 'Problem here'])).toEqual({ ref: '5', label: 'Problem here' })
    expect(ARG_MAPS.highlight(['5', '--label', 'Bug', '--color', '#f00', '--duration', '3000']))
      .toEqual({ ref: '5', label: 'Bug', color: '#f00', duration: 3000 })
  })

  test('call: --args JSON, with trailing positionals still supported', () => {
    expect(ARG_MAPS.call(['5', 'focus'])).toEqual({ ref: '5', method: 'focus', args: [] })
    expect(ARG_MAPS.call(['5', 'scrollTo', '0', '100']))
      .toEqual({ ref: '5', method: 'scrollTo', args: [0, 100] })
    expect(ARG_MAPS.call(['5', 'setAttribute', '--args', '["id","x"]']))
      .toEqual({ ref: '5', method: 'setAttribute', args: ['id', 'x'] })
  })

  test('hj wait no longer advertises --text, which /wait never accepted', () => {
    // The hint promised a parameter absent from the endpoint schema — the same shape as B1, where
    // the CLI and the endpoint disagreed about a field name and nothing noticed.
    const hint = (COMMAND_HINTS as any).wait
    const text = typeof hint === 'string' ? hint : hint?.hints
    expect(text).not.toContain('--text')
    expect(text).toContain('--timeout')
  })
})

describe('free-text commands: a leading dash is CONTENT, not a flag', () => {
  // Registering `type`/`highlight`/`call`/`send-*` in KNOWN_FLAGS — done to fix ten
  // advertised-but-ignored flags — turned on `normalizeEqualsFlags` and `warnUnknownFlags` for
  // commands whose payload is arbitrary text. Three regressions against v1.11.3 followed, and the
  // invariant test that was supposed to police this had these exact commands in its FREE_FORM
  // skip-list, so it `continue`d past every one of them.
  const norm = (cmd: string, a: string[]) =>
    normalizeEqualsFlags(a, [...(KNOWN_FLAGS[cmd] || []), ...GLOBAL_FLAGS])
  const parse = (cmd: string, a: string[]) => ARG_MAPS[cmd](norm(cmd, a))

  test('an unknown --x=y is typed verbatim, not split into "--x y"', () => {
    // Was `{text: "--foo bar"}` — the `=` silently replaced by a space in a string the user asked
    // to be typed literally. A normaliser must not rewrite a token it cannot identify.
    expect(parse('type', ['10', '--foo=bar'])).toEqual({ ref: '10', text: '--foo=bar' })
    expect(parse('highlight', ['5', '--x=y'])).toEqual({ ref: '5', label: '--x=y' })
  })

  test('a dash-led string is typed, not swallowed', () => {
    expect(parse('type', ['10', '--- divider'])).toEqual({ ref: '10', text: '--- divider' })
  })

  test('`--` ends flag parsing, so the literal is expressible at all', () => {
    // Without an escape there is NO way to type the characters "--clear": the flag wins and the
    // command types an empty string while reporting success.
    expect(parse('type', ['10', '--', '--clear'])).toEqual({ ref: '10', text: '--clear' })
  })

  test('real flags still work — the discriminating half', () => {
    // If the fix were "never parse flags for these commands", the ten flags fixed earlier this
    // cycle would break again. Both properties must hold at once.
    expect(parse('type', ['10', 'hello', '--clear'])).toEqual({ ref: '10', text: 'hello', clear: true })
    expect(parse('type', ['10', 'hi', '--humanlike=false'])).toEqual({ ref: '10', text: 'hi', humanlike: false })
  })

  test('flag-oriented commands still get =-form normalisation', () => {
    // The other direction: this fix must not disable `--depth=3` for commands that are all flags.
    expect(parse('tree', ['--depth=3'])).toEqual({ depth: 3 })
  })

  test('no unknown-flag warning is emitted for free-text commands', () => {
    const warnings: string[] = []
    const orig = process.stderr.write
    // @ts-ignore
    process.stderr.write = (s: string) => { warnings.push(String(s)); return true }
    try {
      warnUnknownFlags('type', ['10', '--- divider'])
      warnUnknownFlags('highlight', ['5', '--x=y'])
    } finally {
      process.stderr.write = orig
    }
    // The warning said "ignored" while the CLI went on to type the token — a diagnostic asserting
    // the opposite of what happened.
    expect(warnings).toEqual([])
  })

  test('flag-oriented commands DO still warn — otherwise the fix silences everything', () => {
    const warnings: string[] = []
    const orig = process.stderr.write
    // @ts-ignore
    process.stderr.write = (s: string) => { warnings.push(String(s)); return true }
    try {
      warnUnknownFlags('tree', ['--nonsense'])
    } finally {
      process.stderr.write = orig
    }
    expect(warnings.join('')).toContain('--nonsense')
  })
})

describe('piped stdout carries no ANSI — the documented "bare path"', () => {
  // SKILL.md and the CHANGELOG promise `hj map --image` prints "a bare path you can hand straight
  // to a file read". `console.log(bold(path))` made it 8 bytes of escape codes wrapped around one,
  // so `p=$(hj map --image); cat "$p"` failed with "No such file or directory" — and the
  // CHANGELOG's "103 characters" was a 94-char path plus the escapes. `hj screenshot` and
  // `hj video-stop` had it too; one definition each meant one fix covered all three.
  const hjPath = join(import.meta.dir, '..', 'dist', 'hj.js')

  test('--help output has no escape sequences when piped', () => {
    // A cheap, server-free proxy for "did the TTY gate get applied at all". spawnSync gives pipes,
    // never a TTY, which is exactly the case that was broken.
    const { spawnSync } = require('child_process')
    const r = spawnSync('node', [hjPath, '--help'], { encoding: 'utf-8' })
    expect(r.stdout.length).toBeGreaterThan(100)
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(r.stdout)).toBe(false)
  })

  test('NO_COLOR is honoured even on a TTY', () => {
    const { spawnSync } = require('child_process')
    const r = spawnSync('node', [hjPath, '--help'], {
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
    })
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(r.stdout)).toBe(false)
  })
})

describe('a weak guess is not a licence to run a different command', () => {
  // hj AUTO-EXECUTES a single fuzzy match, so the bar for "single match" is the bar for running
  // something the user did not type. It used to be "shares its first 3 characters with a command",
  // which made `hj constructor` silently run `hj console`. Sharing a 3-character stem is not
  // evidence; being a whole command with more typed after it is.
  test('nonsense that merely shares a stem is NOT a match', () => {
    expect(getSuggestion('constructor')).toBeNull() // was 'console' — con…
    expect(getSuggestion('conference')).toBeNull()
    expect(getSuggestion('xyzzy')).toBeNull()
  })

  test('prototype member names resolve to nothing', () => {
    // These also used to crash: `LOCAL_HANDLERS['toString']` is a function returning
    // '[object Object]', which went into `process.exit()` and threw from node's own bootstrap.
    for (const k of ['toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
      expect([k, getSuggestion(k)]).toEqual([k, null])
    }
  })

  test('the documented fuzzy matches still work — the discriminating half', () => {
    // If the fix were "never guess", these would break and the help text would start lying.
    expect(getSuggestion('screensho')).toBe('screenshot') // typo -> prefix match
    expect(getSuggestion('evaluate')).toBe('eval') // command is a prefix of the input
    expect(getSuggestion('shot')).toBe('screenshot') // explicit alias
    expect(getSuggestion('treeish')).toBe('tree')
  })

  test('the longest command wins when several are prefixes', () => {
    expect(getSuggestion('clickety')).toBe('click')
  })
})
