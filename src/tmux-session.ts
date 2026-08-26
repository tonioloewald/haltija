/**
 * Mirror an agent's terminal session into the browser channel — the READ half of issue #37.
 *
 * The case that motivates it: tosijs-ui's tunnel bridge lets an agent drive a page running on a VR
 * headset, but the human in the headset has no way to see what the agent is doing. You cannot look
 * at a terminal, cannot type comfortably, and cannot take the headset off, because the bug is
 * usually *about* being in it. Mirroring the session into the page closes the half that is missing.
 *
 * **tmux rather than a pty wrapper**, for two reasons validated against tmux 3.7c before this was
 * written:
 *   - `capture-pane -p` returns ALREADY-RENDERED text with no ANSI, so the page view is a `<pre>`
 *     rather than a terminal emulator — which matters when the keyboard is floating in space.
 *   - tmux can attach to a session that is ALREADY RUNNING. A wrapper cannot, and nobody restarts
 *     their agent to gain a mirror.
 *
 * **READ ONLY, deliberately.** `tmux send-keys` would let a page answer a permission prompt —
 * `send-keys "yes" Enter` is indistinguishable from the operator typing it. The proposal argued a
 * channel to an agent the user already supervises "grants nothing new", which is true of a mailbox
 * and NOT of input injection. Nothing here writes; the write half is a separate, separately
 * grantable decision (see TODO.md → Session mirror).
 *
 * **Opt-in by construction.** There is no default target: until something calls `attachSession`,
 * every read reports "not attached". A mirror carries everything the agent prints, including
 * whatever it echoes from a file it just read, so it must never be something a config flag turns on
 * by accident.
 */

/** How we run tmux. Injected so the logic is testable without a terminal multiplexer. */
export type RunTmux = (args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>

export interface SessionState {
  /** The tmux target being mirrored, or null when nothing is attached. */
  target: string | null
  attachedAt: number | null
}

const state: SessionState = { target: null, attachedAt: null }

export function sessionState(): SessionState {
  return { ...state }
}

/**
 * tmux target names, as tmux itself reports them.
 *
 * Used to VALIDATE an attach request against reality rather than trusting the caller's string. That
 * is also the injection defence: a target is only ever accepted if it appears in this list, and
 * every tmux call passes arguments as an array — never a shell string — so a name containing `;`
 * or backticks is inert either way.
 */
export async function listSessions(run: RunTmux): Promise<string[]> {
  const res = await run(['list-sessions', '-F', '#{session_name}'])
  if (!res.ok) return []
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export interface AttachResult {
  ok: boolean
  target?: string
  error?: string
  available?: string[]
  /** Advisory: attached, but this server is unauthenticated. */
  warning?: string
}

/**
 * Mirroring raises the stakes on an unauthenticated server, so say so when attaching.
 *
 * Before the mirror, reaching this server let you drive a browser. With it, reaching this server
 * also lets you read everything the agent prints — source it has opened, output it has echoed,
 * anything in its scrollback. That is a genuine escalation, and it lands exactly where the feature
 * is most useful: a tunnel, which by definition is reachable from somewhere other than this machine.
 *
 * A warning rather than a refusal: on a laptop with no tunnel this is fine, and a feature that
 * refuses to work in the common case gets worked around rather than heeded. But it must be SAID,
 * because the person attaching is the only one who knows whether the port is exposed.
 */
export function tokenAdvisory(hasToken: boolean): string | undefined {
  if (hasToken) return undefined
  return (
    'this server has no token, so anything that can reach its port can now read the agent\'s ' +
    'terminal — not just drive the browser. Fine on a laptop; NOT fine over a tunnel. Start the ' +
    'server with `--token <secret>` (and set HALTIJA_TOKEN for clients) if the port is reachable ' +
    'from anywhere else.'
  )
}

/**
 * Point the mirror at a tmux session.
 *
 * Fails loudly with the list of what IS available rather than attaching to nothing and reporting
 * success — "attached" and "attached to something that exists" are different claims, and this
 * product has spent a lot of effort on not conflating those.
 */
export async function attachSession(
  run: RunTmux,
  target: string,
  hasToken = false,
): Promise<AttachResult> {
  const available = await listSessions(run)
  if (!available.length) {
    return {
      ok: false,
      error:
        'no tmux sessions are running. Start your agent inside one — `tmux new -s agent` then run ' +
        'it there — or attach to an existing session by name.',
      available: [],
    }
  }
  // Exact match only. A prefix or fuzzy match would let a typo silently mirror the wrong session,
  // and the whole point of this feature is that someone reads it and believes it.
  if (!available.includes(target)) {
    return {
      ok: false,
      error: `no tmux session named "${target}"`,
      available,
    }
  }
  state.target = target
  state.attachedAt = Date.now()
  return { ok: true, target, available, warning: tokenAdvisory(hasToken) }
}

export function detachSession(): void {
  state.target = null
  state.attachedAt = null
}

export interface ReadResult {
  ok: boolean
  target?: string
  text?: string
  error?: string
}

/**
 * The current rendered contents of the mirrored pane.
 *
 * `-p` prints to stdout, `-S -<lines>` starts that many lines back in the scrollback. No ANSI, so a
 * page can render it directly.
 */
export async function readSession(run: RunTmux, lines = 200): Promise<ReadResult> {
  if (!state.target) {
    return {
      ok: false,
      error:
        'no session attached. `hj session attach <tmux-session>` first — mirroring is opt-in because ' +
        'it exposes everything the agent prints.',
    }
  }
  const safeLines = Math.max(1, Math.min(10_000, Math.floor(lines) || 200))
  const res = await run(['capture-pane', '-t', state.target, '-p', '-S', `-${safeLines}`])
  if (!res.ok) {
    // The session can disappear under us — the agent exits, someone kills the window. Say which
    // target failed rather than reporting an empty mirror, which reads as "the agent is idle".
    return {
      ok: false,
      target: state.target,
      error: `could not read tmux session "${state.target}": ${res.stderr.trim() || 'unknown error'}`,
    }
  }
  return { ok: true, target: state.target, text: res.stdout.replace(/\s+$/, '') }
}

/** Everything after `since` in a previous read, for `--follow` without re-sending the scrollback. */
export function newTailOnly(previous: string, current: string): string {
  if (!previous) return current
  if (current.startsWith(previous)) return current.slice(previous.length)
  // The pane scrolled, so the old text is no longer a prefix. Overlap on the last line we saw;
  // failing that, send everything and let the reader re-sync rather than silently dropping output.
  const lastLine = previous.trimEnd().split('\n').pop() || ''
  if (lastLine) {
    const idx = current.lastIndexOf(lastLine)
    if (idx !== -1) return current.slice(idx + lastLine.length)
  }
  return current
}
