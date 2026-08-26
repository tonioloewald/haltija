/**
 * The mirror must be opt-in, must refuse a target that does not exist, and must never write.
 *
 * Each of those is a security property rather than a nicety: mirroring exposes everything the agent
 * prints, attaching to a non-existent target would report success for a mirror showing nothing, and
 * `send-keys` would let a page answer a permission prompt.
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import {
  listSessions, attachSession, detachSession, readSession, sessionState, newTailOnly,
  type RunTmux,
} from './tmux-session'

/** A fake tmux that records every argv it was handed. */
function fakeTmux(sessions: string[], paneText = 'agent output') {
  const calls: string[][] = []
  const run: RunTmux = async (args) => {
    calls.push(args)
    if (args[0] === 'list-sessions') return { ok: true, stdout: sessions.join('\n'), stderr: '' }
    if (args[0] === 'capture-pane') {
      const t = args[args.indexOf('-t') + 1]
      return sessions.includes(t)
        ? { ok: true, stdout: paneText, stderr: '' }
        : { ok: false, stdout: '', stderr: `can't find session: ${t}` }
    }
    return { ok: false, stdout: '', stderr: 'unexpected' }
  }
  return { run, calls }
}

beforeEach(() => detachSession())

describe('opt-in', () => {
  it('reads nothing until something attaches', async () => {
    const { run } = fakeTmux(['agent'])
    const r = await readSession(run)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('no session attached')
    // The reason is stated, because the feature exposes everything the agent prints.
    expect(r.error).toContain('opt-in')
  })

  it('starts detached', () => {
    expect(sessionState().target).toBeNull()
  })
})

describe('attach validates against reality', () => {
  it('refuses a session that does not exist, and says what does', async () => {
    const { run } = fakeTmux(['agent', 'build'])
    const r = await attachSession(run, 'nope')
    expect(r.ok).toBe(false)
    expect(r.available).toEqual(['agent', 'build'])
    expect(sessionState().target).toBeNull()
  })

  it('refuses a PREFIX — a typo must not silently mirror the wrong session', async () => {
    const { run } = fakeTmux(['agent-prod', 'agent-dev'])
    expect((await attachSession(run, 'agent')).ok).toBe(false)
  })

  it('explains how to start one when tmux has no sessions at all', async () => {
    const { run } = fakeTmux([])
    const r = await attachSession(run, 'agent')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('tmux new')
  })

  it('attaches to an exact match and then reads', async () => {
    const { run } = fakeTmux(['agent'], 'hello from the agent')
    expect((await attachSession(run, 'agent')).ok).toBe(true)
    const r = await readSession(run)
    expect(r.ok).toBe(true)
    expect(r.text).toBe('hello from the agent')
  })
})

describe('it never writes', () => {
  it('no tmux invocation is send-keys or anything mutating', async () => {
    const { run, calls } = fakeTmux(['agent'])
    await attachSession(run, 'agent')
    await readSession(run)
    await listSessions(run)
    const verbs = calls.map((c) => c[0])
    expect(verbs).toEqual(['list-sessions', 'capture-pane', 'list-sessions'])
    for (const v of verbs) {
      expect(['send-keys', 'kill-session', 'new-session', 'respawn-pane']).not.toContain(v)
    }
  })

  it('passes arguments as an ARRAY, so a hostile session name cannot reach a shell', async () => {
    // Belt and braces: the name is also validated against list-sessions, but argv-not-shell is what
    // makes the whole class impossible rather than merely unlikely.
    const nasty = 'a"; rm -rf /; echo "'
    const { run, calls } = fakeTmux([nasty])
    await attachSession(run, nasty)
    await readSession(run)
    const capture = calls.find((c) => c[0] === 'capture-pane')!
    expect(capture).toContain(nasty)
    expect(capture.some((a) => a.includes('rm -rf') && a !== nasty)).toBe(false)
  })
})

describe('reading a session that vanished', () => {
  it('reports the failure rather than an empty mirror', async () => {
    const { run } = fakeTmux(['agent'])
    await attachSession(run, 'agent')
    const gone = fakeTmux([]) // the session died
    const r = await readSession(gone.run)
    expect(r.ok).toBe(false)
    // "empty" would read as "the agent is idle", which is the wrong conclusion.
    expect(r.error).toContain('could not read')
    expect(r.error).toContain('agent')
  })
})

describe('newTailOnly — --follow must not re-send the scrollback', () => {
  it('returns only what is new', () => {
    expect(newTailOnly('one\ntwo\n', 'one\ntwo\nthree\n')).toBe('three\n')
  })

  it('returns everything on the first read', () => {
    expect(newTailOnly('', 'one\ntwo\n')).toBe('one\ntwo\n')
  })

  it('re-syncs on the last seen line when the pane has scrolled', () => {
    expect(newTailOnly('a\nb\nc\n', 'b\nc\nd\n')).toBe('\nd\n')
  })

  it('sends everything rather than silently dropping output when it cannot re-sync', () => {
    expect(newTailOnly('xxx\n', 'totally different\n')).toBe('totally different\n')
  })
})

describe('mirroring an unauthenticated server warns', () => {
  /**
   * Before the mirror, reaching this server let you drive a browser. With it, reaching this server
   * also lets you read everything the agent prints. That escalation lands exactly where the feature
   * is most useful — a tunnel — so attaching says so when no token is set.
   */
  it('warns when there is no token, and names the remedy', async () => {
    const { run } = fakeTmux(['agent'])
    const r = await attachSession(run, 'agent', false)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('no token')
    expect(r.warning).toContain('--token')
    expect(r.warning).toContain('tunnel')
  })

  it('is silent when a token is required', async () => {
    const { run } = fakeTmux(['agent'])
    expect((await attachSession(run, 'agent', true)).warning).toBeUndefined()
  })

  it('warns rather than refuses — a feature that blocks the common case gets worked around', async () => {
    const { run } = fakeTmux(['agent'])
    const r = await attachSession(run, 'agent', false)
    expect(r.ok).toBe(true)
    expect(r.target).toBe('agent')
  })
})
