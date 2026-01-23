/**
 * Agent Terminal — Status Registry, Push Buffer, Command Dispatch
 *
 * Tools register status updates and push notifications.
 * The status line is a token-efficient summary injected into agent context.
 * Tool names are command namespaces: "tests failures" dispatches to tools.tests.failures.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'

// ============================================
// Types
// ============================================

export interface ToolStatus {
  tool: string
  state: string
  updatedAt: number
}

export interface PushMessage {
  tool: string
  text: string
  timestamp: number
}

export interface HaltijaConfig {
  name?: string
  tools: Record<string, ToolConfig>
}

export interface ToolConfig {
  /** Shell commands keyed by verb name */
  [verb: string]: string | boolean | undefined
  /** If true, tool is built-in (tasks, etc.) */
  builtin?: boolean
  /** REST endpoint for live tools (e.g., haltija browser) */
  endpoint?: string
}

export interface TerminalState {
  statuses: Map<string, ToolStatus>
  pushBuffer: PushMessage[]
  maxPushBuffer: number
}

// ============================================
// State Management
// ============================================

export function createTerminalState(maxPushBuffer = 100): TerminalState {
  return {
    statuses: new Map(),
    pushBuffer: [],
    maxPushBuffer,
  }
}

/**
 * Update a tool's status. Creates the tool entry if it doesn't exist.
 */
export function updateStatus(state: TerminalState, tool: string, statusText: string): void {
  state.statuses.set(tool, {
    tool,
    state: statusText,
    updatedAt: Date.now(),
  })
}

/**
 * Remove a tool from the status line.
 */
export function removeStatus(state: TerminalState, tool: string): void {
  state.statuses.delete(tool)
}

/**
 * Get the status line as a compact string.
 * Format: [tool1 state] [tool2 state] [tool3 state]
 */
export function getStatusLine(state: TerminalState): string {
  if (state.statuses.size === 0) return ''
  const parts: string[] = []
  for (const status of state.statuses.values()) {
    if (status.state) {
      parts.push(`[${status.tool} ${status.state}]`)
    }
  }
  return parts.join(' ')
}

// ============================================
// Push Notifications
// ============================================

/**
 * Push a notification message. Trims buffer if over max.
 */
export function pushMessage(state: TerminalState, tool: string, text: string): void {
  state.pushBuffer.push({
    tool,
    text,
    timestamp: Date.now(),
  })
  // Trim oldest if over limit
  while (state.pushBuffer.length > state.maxPushBuffer) {
    state.pushBuffer.shift()
  }
}

/**
 * Get push messages since a timestamp.
 */
export function getPushMessages(state: TerminalState, since = 0): PushMessage[] {
  return state.pushBuffer.filter(m => m.timestamp > since)
}

/**
 * Clear the push buffer.
 */
export function clearPushBuffer(state: TerminalState): void {
  state.pushBuffer = []
}

// ============================================
// Config Loading
// ============================================

const CONFIG_FILENAME = 'haltija.json'

/**
 * Load haltija.json from the given directory (or parents).
 * Returns null if not found.
 */
export function loadConfig(dir: string): HaltijaConfig | null {
  let current = dir
  for (let i = 0; i < 10; i++) {
    const configPath = join(current, CONFIG_FILENAME)
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && parsed.tools) {
          return parsed as HaltijaConfig
        }
      } catch {
        return null
      }
    }
    const parent = join(current, '..')
    if (parent === current) break
    current = parent
  }
  return null
}

// ============================================
// Command Dispatch
// ============================================

/**
 * Dispatch a command string to the appropriate tool verb.
 * Format: "tool verb [args...]"
 *
 * Returns the command output (stdout) or an error message.
 */
export async function dispatchCommand(
  config: HaltijaConfig,
  command: string,
): Promise<string> {
  const parts = command.trim().split(/\s+/)
  const toolName = parts[0]
  const verb = parts[1] || 'run'
  const args = parts.slice(2)

  if (!toolName) return 'error: empty command'

  const toolConfig = config.tools[toolName]
  if (!toolConfig) {
    const available = Object.keys(config.tools).join(', ')
    return `error: unknown tool "${toolName}". available: ${available}`
  }

  if (toolConfig.builtin) {
    return `error: "${toolName}" is a built-in tool (not yet implemented)`
  }

  const shellCommand = toolConfig[verb]
  if (!shellCommand || typeof shellCommand !== 'string') {
    const verbs = Object.keys(toolConfig).filter(k => typeof toolConfig[k] === 'string')
    return `error: unknown verb "${verb}" for ${toolName}. available: ${verbs.join(', ')}`
  }

  // Execute the shell command
  return executeShell(shellCommand, args)
}

/**
 * Execute a shell command and return its output.
 */
function executeShell(command: string, args: string[] = []): Promise<string> {
  return new Promise((resolve) => {
    const fullCommand = args.length > 0
      ? `${command} ${args.join(' ')}`
      : command

    const child = spawn('sh', ['-c', fullCommand], {
      timeout: 30000,
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (err) => {
      resolve(`error: ${err.message}`)
    })

    child.on('close', (code) => {
      if (code !== 0 && stderr) {
        resolve(stderr.trim() || `error: exit code ${code}`)
      } else {
        resolve(stdout.trim())
      }
    })
  })
}
