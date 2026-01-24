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

export interface ShellIdentity {
  id: string
  name?: string
  connectedAt: number
  ws: any
}

export interface TerminalState {
  statuses: Map<string, ToolStatus>
  pushBuffer: PushMessage[]
  maxPushBuffer: number
  shells: Map<string, ShellIdentity>
  nextShellId: number
}

// ============================================
// State Management
// ============================================

export function createTerminalState(maxPushBuffer = 100): TerminalState {
  return {
    statuses: new Map(),
    pushBuffer: [],
    maxPushBuffer,
    shells: new Map(),
    nextShellId: 1,
  }
}

// ============================================
// Shell Identity
// ============================================

/**
 * Register a new shell connection. Returns the assigned identity.
 */
export function registerShell(state: TerminalState, ws: any): ShellIdentity {
  const shell: ShellIdentity = {
    id: `shell-${state.nextShellId++}`,
    connectedAt: Date.now(),
    ws,
  }
  state.shells.set(shell.id, shell)
  return shell
}

/**
 * Unregister a shell connection.
 */
export function unregisterShell(state: TerminalState, shellId: string): void {
  state.shells.delete(shellId)
}

/**
 * Set a shell's display name.
 */
export function setShellName(state: TerminalState, shellId: string, name: string): void {
  const shell = state.shells.get(shellId)
  if (shell) shell.name = name
}

/**
 * Find a shell by name (case-insensitive).
 */
export function getShellByName(state: TerminalState, name: string): ShellIdentity | null {
  const lower = name.toLowerCase()
  for (const shell of state.shells.values()) {
    if (shell.name?.toLowerCase() === lower) return shell
    if (shell.id.toLowerCase() === lower) return shell
  }
  return null
}

/**
 * Find a shell by its WebSocket reference.
 */
export function getShellByWs(state: TerminalState, ws: any): ShellIdentity | null {
  for (const shell of state.shells.values()) {
    if (shell.ws === ws) return shell
  }
  return null
}

/**
 * List all connected shells.
 */
export function listShells(state: TerminalState): string {
  if (state.shells.size === 0) return '(no shells connected)'
  const lines: string[] = []
  for (const shell of state.shells.values()) {
    const name = shell.name ? ` (${shell.name})` : ''
    lines.push(`${shell.id}${name}`)
  }
  return lines.join('\n')
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
 * List available verbs for a tool.
 * Format: "tool > verb1 verb2 verb3"
 */
export function listVerbs(config: HaltijaConfig, toolName: string): string | null {
  const toolConfig = config.tools[toolName]
  if (!toolConfig) return null
  const verbs = Object.keys(toolConfig).filter(k => typeof toolConfig[k] === 'string')
  if (verbs.length === 0) return `${toolName} > (no commands)`
  return `${toolName} > ${verbs.join(' ')}`
}

/**
 * List all tools with their verbs.
 * One line per tool in "tool > verb1 verb2" format.
 */
export function listTools(config: HaltijaConfig): string {
  const lines: string[] = []
  for (const toolName of Object.keys(config.tools)) {
    const line = listVerbs(config, toolName)
    if (line) lines.push(line)
  }
  return lines.join('\n')
}

export async function dispatchCommand(
  config: HaltijaConfig,
  command: string,
): Promise<string> {
  const parts = command.trim().split(/\s+/)
  const toolName = parts[0]
  const verb = parts[1]
  const args = parts.slice(2)

  if (!toolName) return listTools(config)

  const toolConfig = config.tools[toolName]
  if (!toolConfig) {
    const available = Object.keys(config.tools).join(', ')
    return `error: unknown tool "${toolName}". available: ${available}`
  }

  // No verb → show available verbs (menu mode)
  if (!verb) {
    return listVerbs(config, toolName) || `${toolName} > (no commands)`
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
