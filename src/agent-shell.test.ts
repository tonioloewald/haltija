import { describe, test, expect } from 'bun:test'
import {
  createAgentSession,
  getAgentSession,
  removeAgentSession,
  getTranscript,
  buildAgentCommand,
  parseStreamLine,
  killAgent,
  type AgentConfig,
} from './agent-shell'
import {
  createCommandCache,
  getCachedResult,
  cacheResult,
  clearCache,
} from './terminal'

describe('agent-shell', () => {
  describe('session management', () => {
    test('createAgentSession creates and stores a session', () => {
      const session = createAgentSession('test-1', 'TestAgent')
      expect(session.id).toBe('test-1')
      expect(session.name).toBe('TestAgent')
      expect(session.status).toBe('idle')
      expect(session.transcript).toEqual([])
      expect(session.process).toBeNull()
      removeAgentSession('test-1')
    })

    test('getAgentSession retrieves existing session', () => {
      createAgentSession('test-2', 'Agent2')
      const session = getAgentSession('test-2')
      expect(session).toBeDefined()
      expect(session!.name).toBe('Agent2')
      removeAgentSession('test-2')
    })

    test('getAgentSession returns undefined for unknown session', () => {
      expect(getAgentSession('nonexistent')).toBeUndefined()
    })

    test('removeAgentSession removes the session', () => {
      createAgentSession('test-3', 'Agent3')
      removeAgentSession('test-3')
      expect(getAgentSession('test-3')).toBeUndefined()
    })

    test('getTranscript returns empty array for unknown session', () => {
      expect(getTranscript('nonexistent')).toEqual([])
    })

    test('getTranscript returns session transcript', () => {
      const session = createAgentSession('test-4', 'Agent4')
      session.transcript.push({
        type: 'user',
        content: 'hello',
        timestamp: 1000,
      })
      expect(getTranscript('test-4')).toHaveLength(1)
      expect(getTranscript('test-4')[0].content).toBe('hello')
      removeAgentSession('test-4')
    })

    test('killAgent returns false for idle session', () => {
      createAgentSession('test-5', 'Agent5')
      expect(killAgent('test-5')).toBe(false)
      removeAgentSession('test-5')
    })

    test('killAgent returns false for unknown session', () => {
      expect(killAgent('nonexistent')).toBe(false)
    })
  })

  describe('buildAgentCommand', () => {
    test('default config builds claude -p command with standard tools', () => {
      const config: AgentConfig = {}
      const args = buildAgentCommand(config, 'hello world')
      // Should include standard tools (agent uses hj CLI via Bash for browser control)
      expect(args).toContain('claude')
      expect(args).toContain('-p')
      expect(args).toContain('hello world')
      expect(args).toContain('--allowedTools')
      expect(args[args.indexOf('--allowedTools') + 1]).toBe('Bash,Read,Grep,Glob,Edit,Write,Task,WebFetch,WebSearch')
      expect(args).toContain('--output-format')
      expect(args).toContain('stream-json')
    })

    test('custom allowedTools overrides default', () => {
      const config: AgentConfig = { allowedTools: 'Read,Write' }
      const args = buildAgentCommand(config, 'do stuff')
      expect(args).toContain('--allowedTools')
      expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Write')
    })

    test('uses stream-json input format for bidirectional communication', () => {
      const config: AgentConfig = {}
      const args = buildAgentCommand(config, '/some/cwd')
      // stream-json enables real-time bidirectional communication (prompts via stdin)
      expect(args).toContain('--input-format')
      expect(args[args.indexOf('--input-format') + 1]).toBe('stream-json')
      expect(args).toContain('--output-format')
      expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json')
    })
  })

  describe('parseStreamLine', () => {
    test('empty line returns no events', () => {
      expect(parseStreamLine('s1', '')).toEqual([])
      expect(parseStreamLine('s1', '  ')).toEqual([])
    })

    test('non-JSON line returns text event', () => {
      const events = parseStreamLine('s1', 'some random output')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('agent-text')
      expect((events[0] as any).text).toBe('some random output')
    })

    test('system init message returns no events', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'init',
        tools: ['Bash', 'Read'],
        session_id: 'abc-123',
      })
      expect(parseStreamLine('s1', line)).toEqual([])
    })

    test('assistant text message returns text event', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello there!' }],
        },
      })
      const events = parseStreamLine('s1', line)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('agent-text')
      expect((events[0] as any).text).toBe('Hello there!')
    })

    test('assistant tool_use message returns tool event', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tc-123',
            name: 'Read',
            input: { file_path: '/src/server.ts' },
          }],
        },
      })
      const events = parseStreamLine('s1', line)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('agent-tool')
      const ev = events[0] as any
      expect(ev.tool).toBe('Read')
      expect(ev.id).toBe('tc-123')
      expect(ev.input).toContain('/src/server.ts')
    })

    test('assistant with mixed content returns multiple events', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me read that file.' },
            { type: 'tool_use', id: 'tc-1', name: 'Read', input: { file_path: 'foo.ts' } },
          ],
        },
      })
      const events = parseStreamLine('s1', line)
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('agent-text')
      expect(events[1].type).toBe('agent-tool')
    })

    test('tool result message returns tool-result event', () => {
      // Note: Claude CLI sends tool results with type: 'user', not 'tool'
      const line = JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'tc-123',
            content: 'file contents here',
          }],
        },
      })
      const events = parseStreamLine('s1', line)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('agent-tool-result')
      const ev = events[0] as any
      expect(ev.id).toBe('tc-123')
      expect(ev.output).toBe('file contents here')
    })

    test('tool result with array content joins text', () => {
      // Note: Claude CLI sends tool results with type: 'user', not 'tool'
      const line = JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'tc-456',
            content: [
              { type: 'text', text: 'line 1' },
              { type: 'text', text: 'line 2' },
            ],
          }],
        },
      })
      const events = parseStreamLine('s1', line)
      expect(events).toHaveLength(1)
      expect((events[0] as any).output).toBe('line 1\nline 2')
    })

    test('result message returns done event with cost', () => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.025,
        duration_ms: 3400,
        session_id: 'sess-abc',
      })
      const events = parseStreamLine('s1', line)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('agent-done')
      const ev = events[0] as any
      expect(ev.cost).toBe(0.025)
      expect(ev.duration).toBe(3400)
    })

    test('empty text blocks are ignored', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '' }],
        },
      })
      const events = parseStreamLine('s1', line)
      expect(events).toEqual([])
    })

    test('tool_use with string input keeps as-is', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tc-str',
            name: 'Bash',
            input: 'ls -la',
          }],
        },
      })
      const events = parseStreamLine('s1', line)
      expect((events[0] as any).input).toBe('ls -la')
    })

    test('shellId is passed through all events', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] },
      })
      const events = parseStreamLine('my-shell', line)
      expect((events[0] as any).shellId).toBe('my-shell')
    })
  })
})

describe('command-cache', () => {
  test('getCachedResult returns null for empty cache', () => {
    const cache = createCommandCache(30000)
    expect(getCachedResult(cache, 'tests run')).toBeNull()
  })

  test('cacheResult stores and getCachedResult retrieves', () => {
    const cache = createCommandCache(30000)
    cacheResult(cache, 'tests summary', '5 pass 0 fail')
    expect(getCachedResult(cache, 'tests summary')).toBe('5 pass 0 fail')
  })

  test('cached result expires after TTL', () => {
    const cache = createCommandCache(10) // 10ms TTL
    cacheResult(cache, 'tests run', 'output')
    // Manually expire
    cache.entries.get('tests run')!.timestamp = Date.now() - 20
    expect(getCachedResult(cache, 'tests run')).toBeNull()
  })

  test('mutating commands are not cached', () => {
    const cache = createCommandCache(30000)
    cacheResult(cache, 'rm -rf dist', 'deleted')
    expect(getCachedResult(cache, 'rm -rf dist')).toBeNull()
  })

  test('commands with mv are not cached', () => {
    const cache = createCommandCache(30000)
    cacheResult(cache, 'mv foo bar', '')
    expect(getCachedResult(cache, 'mv foo bar')).toBeNull()
  })

  test('commands with delete are not cached', () => {
    const cache = createCommandCache(30000)
    cacheResult(cache, 'git branch --delete feature', '')
    expect(getCachedResult(cache, 'git branch --delete feature')).toBeNull()
  })

  test('clearCache removes all entries', () => {
    const cache = createCommandCache(30000)
    cacheResult(cache, 'tests run', 'output1')
    cacheResult(cache, 'tests summary', 'output2')
    clearCache(cache)
    expect(getCachedResult(cache, 'tests run')).toBeNull()
    expect(getCachedResult(cache, 'tests summary')).toBeNull()
  })

  test('different commands have separate cache entries', () => {
    const cache = createCommandCache(30000)
    cacheResult(cache, 'tests run', 'all pass')
    cacheResult(cache, 'tests failures', 'none')
    expect(getCachedResult(cache, 'tests run')).toBe('all pass')
    expect(getCachedResult(cache, 'tests failures')).toBe('none')
  })
})
