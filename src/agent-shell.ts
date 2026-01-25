/**
 * Agent Shell — Claude Code subprocess management
 *
 * Spawns `claude -p` subprocesses, parses stream-json output,
 * and emits typed events for the terminal UI.
 */

import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'

// ============================================
// Types
// ============================================

export interface AgentConfig {
  provider?: string       // display label (default: "claude")
  command?: string        // base command (default: "claude -p")
  names?: string[]        // name rotation for auto-naming
  systemPrompt?: string   // system prompt for agent context
  allowedTools?: string   // comma-separated tool whitelist (default: safe read-only tools)
}

export interface AgentSession {
  id: string              // matches shellId
  name: string
  process: ChildProcess | null
  status: 'idle' | 'thinking' | 'done' | 'error'
  transcript: TranscriptEntry[]
  sessionId?: string      // claude session ID for --continue
  promptQueue: string[]   // queued prompts when agent is busy
}

export interface TranscriptEntry {
  type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
  content: string
  timestamp: number
  toolName?: string
  toolInput?: string
  toolOutput?: string
  toolId?: string
}

/** Events emitted during agent execution */
export type AgentEvent =
  | { type: 'agent-text'; shellId: string; text: string }
  | { type: 'agent-tool'; shellId: string; tool: string; input: string; id: string }
  | { type: 'agent-tool-result'; shellId: string; id: string; output: string }
  | { type: 'agent-done'; shellId: string; cost?: number; duration?: number }
  | { type: 'agent-error'; shellId: string; error: string }
  | { type: 'agent-status'; shellId: string; status: AgentSession['status'] }

// ============================================
// Session Registry
// ============================================

const sessions = new Map<string, AgentSession>()

export function createAgentSession(shellId: string, name: string): AgentSession {
  const session: AgentSession = {
    id: shellId,
    name,
    process: null,
    status: 'idle',
    transcript: [],
  }
  sessions.set(shellId, session)
  return session
}

export function getAgentSession(shellId: string): AgentSession | undefined {
  return sessions.get(shellId)
}

export function removeAgentSession(shellId: string): void {
  const session = sessions.get(shellId)
  if (session?.process) {
    session.process.kill()
  }
  sessions.delete(shellId)
}

export function getTranscript(shellId: string): TranscriptEntry[] {
  return sessions.get(shellId)?.transcript || []
}

// ============================================
// Command Building
// ============================================

export function buildAgentCommand(config: AgentConfig, prompt: string, cwd?: string, systemPrompt?: string): string[] {
  // Build: claude -p <prompt> [options...]
  // The prompt must come right after -p
  const args = ['claude', '-p', prompt]
  
  // Add system prompt if provided
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt)
  }
  
  // Restrict agent to working directory (Zed-style scoping)
  if (cwd) {
    args.push('--add-dir', cwd)
  }
  
  // Connect to Haltija MCP server for browser control tools
  // This gives the agent direct access to hj commands as MCP tools
  const mcpConfig = JSON.stringify({
    mcpServers: {
      haltija: {
        command: 'node',
        args: [join(process.cwd(), 'apps/mcp/build/index.js')],
      }
    }
  })
  args.push('--mcp-config', mcpConfig)
  
  // Allow MCP tools plus basic read tools
  // The haltija MCP server provides all the browser control tools
  const allowedTools = config.allowedTools || 'Read,Grep,Glob,mcp__haltija__*'
  args.push('--allowedTools', allowedTools)
  
  // dontAsk mode + restricted allowedTools = execute permitted tools without prompting
  args.push('--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk')
  
  return args
}

// ============================================
// Stream-JSON Parser
// ============================================

/**
 * Parse a single line of claude stream-json output.
 * Returns AgentEvents to emit, or null if the line is not actionable.
 */
export function parseStreamLine(shellId: string, line: string): AgentEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  let parsed: any
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Non-JSON output (unlikely in stream-json mode, but handle gracefully)
    return [{ type: 'agent-text', shellId, text: trimmed }]
  }

  const events: AgentEvent[] = []

  switch (parsed.type) {
    case 'system':
      // Init message — no visible output needed
      break

    case 'assistant': {
      const message = parsed.message
      if (message?.content && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            events.push({ type: 'agent-text', shellId, text: block.text })
          } else if (block.type === 'tool_use') {
            const inputStr = typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input, null, 2)
            events.push({
              type: 'agent-tool',
              shellId,
              tool: block.name || 'unknown',
              input: inputStr,
              id: block.id || `tc-${Date.now()}`,
            })
          } else if (block.type === 'tool_result') {
            const output = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('\n')
                : JSON.stringify(block.content)
            events.push({
              type: 'agent-tool-result',
              shellId,
              id: block.tool_use_id || '',
              output,
            })
          }
        }
      }
      break
    }

    case 'tool': {
      // Tool result messages from claude stream-json
      const message = parsed.message
      if (message?.content && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'tool_result') {
            const output = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('\n')
                : JSON.stringify(block.content)
            events.push({
              type: 'agent-tool-result',
              shellId,
              id: block.tool_use_id || '',
              output,
            })
          }
        }
      }
      break
    }

    case 'result': {
      events.push({
        type: 'agent-done',
        shellId,
        cost: parsed.total_cost_usd,
        duration: parsed.duration_ms,
      })
      break
    }
  }

  return events
}

// ============================================
// Agent Execution
// ============================================

/**
 * Run a prompt through the Claude CLI subprocess.
 * Calls `onEvent` for each parsed event as output streams in.
 * Returns a promise that resolves when the process exits.
 */
export function runAgentPrompt(
  shellId: string,
  prompt: string,
  config: AgentConfig,
  cwd: string,
  onEvent: (event: AgentEvent) => void,
  systemPrompt?: string,
): Promise<void> {
  const session = sessions.get(shellId)
  if (!session) {
    onEvent({ type: 'agent-error', shellId, error: 'No agent session found' })
    return Promise.resolve()
  }

  if (session.status === 'thinking') {
    onEvent({ type: 'agent-error', shellId, error: 'Agent is already processing a prompt' })
    return Promise.resolve()
  }

  // Add user message to transcript
  session.transcript.push({
    type: 'user',
    content: prompt,
    timestamp: Date.now(),
  })

  session.status = 'thinking'
  onEvent({ type: 'agent-status', shellId, status: 'thinking' })

  const args = buildAgentCommand(config, prompt, cwd, systemPrompt)
  const cmd = args[0]
  const cmdArgs = args.slice(1)

  return new Promise<void>((resolve) => {
    // Add haltija bin to PATH so agent can use 'hj' command
    const haltijaBin = join(process.cwd(), 'bin')
    const env = {
      ...process.env,
      PATH: `${haltijaBin}:${process.env.PATH || ''}`,
    }
    
    const child = spawn(cmd, cmdArgs, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    session.process = child

    let stdoutBuffer = ''
    let stderrBuffer = ''

    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString()
      // Process complete lines
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() || '' // Keep incomplete last line in buffer
      for (const line of lines) {
        const events = parseStreamLine(shellId, line)
        for (const event of events) {
          // Store in transcript
          if (event.type === 'agent-text') {
            session.transcript.push({
              type: 'assistant',
              content: event.text,
              timestamp: Date.now(),
            })
          } else if (event.type === 'agent-tool') {
            session.transcript.push({
              type: 'tool_call',
              content: `${event.tool}`,
              toolName: event.tool,
              toolInput: event.input,
              toolId: event.id,
              timestamp: Date.now(),
            })
          } else if (event.type === 'agent-tool-result') {
            session.transcript.push({
              type: 'tool_result',
              content: event.output,
              toolOutput: event.output,
              toolId: event.id,
              timestamp: Date.now(),
            })
          } else if (event.type === 'agent-done' && (event as any).cost) {
            // Store session ID for potential continuation
            // (parsed from the result event)
          }
          onEvent(event)
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString()
    })

    child.on('error', (err) => {
      session.status = 'error'
      session.process = null
      onEvent({ type: 'agent-error', shellId, error: err.message })
      onEvent({ type: 'agent-status', shellId, status: 'error' })
      resolve()
    })

    child.on('close', (code) => {
      // Process any remaining buffer
      if (stdoutBuffer.trim()) {
        const events = parseStreamLine(shellId, stdoutBuffer)
        for (const event of events) {
          onEvent(event)
        }
      }

      session.process = null
      if (code !== 0 && stderrBuffer.trim()) {
        session.status = 'error'
        onEvent({ type: 'agent-error', shellId, error: stderrBuffer.trim() })
      } else {
        session.status = 'idle'
      }
      onEvent({ type: 'agent-status', shellId, status: session.status })
      resolve()
    })

    // Close stdin immediately (we pass prompt via args, not stdin)
    child.stdin?.end()
  })
}

/**
 * Kill a running agent process.
 */
export function killAgent(shellId: string): boolean {
  const session = sessions.get(shellId)
  if (session?.process) {
    session.process.kill('SIGTERM')
    session.status = 'idle'
    session.process = null
    return true
  }
  return false
}
