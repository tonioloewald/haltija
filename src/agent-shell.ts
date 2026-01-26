/**
 * Agent Shell — Claude Code subprocess management
 *
 * Spawns `claude -p` subprocesses, parses stream-json output,
 * and emits typed events for the terminal UI.
 */

import { spawn, type ChildProcess } from 'child_process'
import { join, dirname } from 'path'
import { mkdir, writeFile, readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'

// Get the directory where this module lives (for finding MCP server)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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
  cwd?: string            // working directory (for transcript persistence)
  createdAt: number       // session creation timestamp
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

export function createAgentSession(shellId: string, name: string, cwd?: string): AgentSession {
  const session: AgentSession = {
    id: shellId,
    name,
    process: null,
    status: 'idle',
    transcript: [],
    promptQueue: [],
    cwd,
    createdAt: Date.now(),
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
// Transcript Persistence
// ============================================

const TRANSCRIPT_DIR = '.haltija/transcripts'

/** Get the transcript directory for a working directory */
function getTranscriptDir(cwd: string): string {
  return join(cwd, TRANSCRIPT_DIR)
}

/** Generate a filename for a transcript */
function getTranscriptFilename(session: AgentSession): string {
  const date = new Date(session.createdAt)
  const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safeName = session.name.replace(/[^a-zA-Z0-9-_]/g, '_')
  return `${timestamp}_${safeName}_${session.id}.json`
}

/** Transcript file format */
interface TranscriptFile {
  version: 1
  shellId: string
  name: string
  createdAt: number
  updatedAt: number
  cwd: string
  transcript: TranscriptEntry[]
}

/**
 * Save a session's transcript to disk.
 * Called automatically after user prompts and agent completion.
 */
export async function saveTranscript(shellId: string): Promise<void> {
  const session = sessions.get(shellId)
  if (!session || !session.cwd || session.transcript.length === 0) {
    return
  }

  const transcriptDir = getTranscriptDir(session.cwd)
  
  try {
    // Ensure directory exists
    if (!existsSync(transcriptDir)) {
      await mkdir(transcriptDir, { recursive: true })
    }

    const filename = getTranscriptFilename(session)
    const filepath = join(transcriptDir, filename)

    const data: TranscriptFile = {
      version: 1,
      shellId: session.id,
      name: session.name,
      createdAt: session.createdAt,
      updatedAt: Date.now(),
      cwd: session.cwd,
      transcript: session.transcript,
    }

    await writeFile(filepath, JSON.stringify(data, null, 2))
  } catch (err) {
    // Silent failure — persistence is best-effort
    console.error(`[agent-shell] Failed to save transcript: ${err}`)
  }
}

/**
 * List saved transcripts for a working directory.
 */
export async function listTranscripts(cwd: string): Promise<Array<{
  filename: string
  shellId: string
  name: string
  createdAt: number
  updatedAt: number
  entryCount: number
}>> {
  const transcriptDir = getTranscriptDir(cwd)
  
  if (!existsSync(transcriptDir)) {
    return []
  }

  try {
    const files = await readdir(transcriptDir)
    const transcripts: Array<{
      filename: string
      shellId: string
      name: string
      createdAt: number
      updatedAt: number
      entryCount: number
    }> = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      
      try {
        const content = await readFile(join(transcriptDir, file), 'utf-8')
        const data = JSON.parse(content) as TranscriptFile
        transcripts.push({
          filename: file,
          shellId: data.shellId,
          name: data.name,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          entryCount: data.transcript.length,
        })
      } catch {
        // Skip malformed files
      }
    }

    // Sort by most recent first
    transcripts.sort((a, b) => b.updatedAt - a.updatedAt)
    return transcripts
  } catch {
    return []
  }
}

/**
 * Load a transcript from disk by filename.
 */
export async function loadTranscript(cwd: string, filename: string): Promise<TranscriptFile | null> {
  const filepath = join(getTranscriptDir(cwd), filename)
  
  if (!existsSync(filepath)) {
    return null
  }

  try {
    const content = await readFile(filepath, 'utf-8')
    return JSON.parse(content) as TranscriptFile
  } catch {
    return null
  }
}

/**
 * Restore a session from a saved transcript.
 * Creates a new session with the loaded transcript history.
 */
export function restoreSession(shellId: string, transcriptFile: TranscriptFile): AgentSession {
  const session: AgentSession = {
    id: shellId,
    name: transcriptFile.name,
    process: null,
    status: 'idle',
    transcript: transcriptFile.transcript,
    promptQueue: [],
    cwd: transcriptFile.cwd,
    createdAt: transcriptFile.createdAt,
  }
  sessions.set(shellId, session)
  return session
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
  
  // Allow standard tools - the agent can use 'hj' CLI via Bash for browser control
  // hj is added to PATH in the spawn env below
  const allowedTools = config.allowedTools || 'Bash,Read,Grep,Glob,Edit,Write,Task,WebFetch,WebSearch'
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
          if (block.type === 'text' && block.text?.trim()) {
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

  // Store cwd for transcript persistence
  if (cwd && !session.cwd) {
    session.cwd = cwd
  }

  // Add user message to transcript
  session.transcript.push({
    type: 'user',
    content: prompt,
    timestamp: Date.now(),
  })

  // Auto-save transcript after user prompt
  saveTranscript(shellId).catch(() => {})

  session.status = 'thinking'
  onEvent({ type: 'agent-status', shellId, status: 'thinking' })

  const args = buildAgentCommand(config, prompt, cwd, systemPrompt)
  const cmd = args[0]
  const cmdArgs = args.slice(1)

  return new Promise<void>((resolve) => {
    // Add haltija bin to PATH so agent can use 'hj' command
    // Use __dirname to find bin relative to this module (works in bundled dist too)
    const haltijaBin = join(__dirname, '..', 'bin')
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
      
      // Auto-save transcript after agent completes
      saveTranscript(shellId).catch(() => {})
      
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
