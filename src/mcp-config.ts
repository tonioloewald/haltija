/**
 * MCP Configuration Detection and Setup
 * 
 * Shared logic for detecting and configuring MCP integration with:
 * - Claude Desktop (Electron app)
 * - Claude Code (CLI)
 * 
 * Used by:
 * - CLI: `bunx haltija --setup-mcp`
 * - Electron: First-run prompt
 * - API: `/status` endpoint
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir, platform } from 'os'
import { join, dirname } from 'path'

// ============================================
// Types
// ============================================

export interface McpServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface ClaudeDesktopConfig {
  mcpServers?: Record<string, McpServerConfig>
  [key: string]: unknown
}

export interface McpStatus {
  claudeDesktop: {
    installed: boolean
    configPath: string
    haltijaconfigured: boolean
  }
  claudeCode: {
    installed: boolean
    configPath: string
    haltijaconfigured: boolean
  }
  haltija: {
    mcpServerPath: string | null
    serverRunning: boolean
  }
}

// ============================================
// Path Detection
// ============================================

/** Get Claude Desktop config path based on platform */
export function getClaudeDesktopConfigPath(): string {
  const home = homedir()
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    case 'win32':
      return join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
    case 'linux':
      return join(home, '.config', 'claude', 'claude_desktop_config.json')
    default:
      return join(home, '.config', 'claude', 'claude_desktop_config.json')
  }
}

/** Get Claude Code config path */
export function getClaudeCodeConfigPath(): string {
  return join(homedir(), '.claude.json')
}

/** Find the Haltija MCP server entry point */
export function findMcpServerPath(): string | null {
  // Check relative to this file (when running from source)
  const fromSrc = join(dirname(import.meta.path.replace('file://', '')), '..', 'apps', 'mcp', 'build', 'index.js')
  if (existsSync(fromSrc)) return fromSrc

  // Check from dist (when running from built package)
  const fromDist = join(dirname(import.meta.path.replace('file://', '')), '..', 'apps', 'mcp', 'build', 'index.js')
  if (existsSync(fromDist)) return fromDist

  // Check in node_modules (when installed as dependency)
  const cwd = process.cwd()
  const fromNodeModules = join(cwd, 'node_modules', 'haltija', 'apps', 'mcp', 'build', 'index.js')
  if (existsSync(fromNodeModules)) return fromNodeModules

  // Check global npm installation
  try {
    const { execSync } = require('child_process')
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim()
    const fromGlobal = join(globalRoot, 'haltija', 'apps', 'mcp', 'build', 'index.js')
    if (existsSync(fromGlobal)) return fromGlobal
  } catch {}

  return null
}

// ============================================
// Config Reading
// ============================================

/** Read Claude Desktop config */
export function readClaudeDesktopConfig(): ClaudeDesktopConfig | null {
  const configPath = getClaudeDesktopConfigPath()
  if (!existsSync(configPath)) return null
  
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

/** Read Claude Code config */
export function readClaudeCodeConfig(): any | null {
  const configPath = getClaudeCodeConfigPath()
  if (!existsSync(configPath)) return null
  
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

/** Check if Haltija is configured in Claude Desktop */
export function isHaltijaInClaudeDesktop(): boolean {
  const config = readClaudeDesktopConfig()
  return !!config?.mcpServers?.haltija
}

/** Check if Haltija is configured in Claude Code */
export function isHaltijaInClaudeCode(): boolean {
  const config = readClaudeCodeConfig()
  // Claude Code uses different config structure - check mcpServers at root or in projects
  return !!config?.mcpServers?.haltija
}

// ============================================
// Config Writing
// ============================================

export interface SetupResult {
  success: boolean
  message: string
  configPath?: string
  needsRestart?: boolean
}

/** Add Haltija to Claude Desktop config */
export function setupClaudeDesktop(): SetupResult {
  const mcpPath = findMcpServerPath()
  if (!mcpPath) {
    return {
      success: false,
      message: 'Could not find Haltija MCP server. Make sure haltija is properly installed.'
    }
  }

  const configPath = getClaudeDesktopConfigPath()
  let config: ClaudeDesktopConfig = { mcpServers: {} }

  // Read existing config
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'))
      if (!config.mcpServers) config.mcpServers = {}
    } catch {
      // Invalid JSON, start fresh but preserve as backup
      const backupPath = configPath + '.backup'
      try {
        writeFileSync(backupPath, readFileSync(configPath))
      } catch {}
    }
  } else {
    // Create directory if needed
    const configDir = dirname(configPath)
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
  }

  // Check if already configured
  if (config.mcpServers?.haltija) {
    return {
      success: true,
      message: 'Haltija is already configured in Claude Desktop',
      configPath,
      needsRestart: false
    }
  }

  // Add Haltija
  config.mcpServers!.haltija = {
    command: 'node',
    args: [mcpPath]
  }

  // Write config
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    return {
      success: true,
      message: 'Haltija configured successfully. Restart Claude Desktop to activate.',
      configPath,
      needsRestart: true
    }
  } catch (err) {
    return {
      success: false,
      message: `Failed to write config: ${err}`
    }
  }
}

/** Remove Haltija from Claude Desktop config */
export function removeFromClaudeDesktop(): SetupResult {
  const configPath = getClaudeDesktopConfigPath()
  
  if (!existsSync(configPath)) {
    return {
      success: true,
      message: 'Claude Desktop config does not exist'
    }
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    if (!config.mcpServers?.haltija) {
      return {
        success: true,
        message: 'Haltija is not configured in Claude Desktop'
      }
    }

    delete config.mcpServers.haltija
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    
    return {
      success: true,
      message: 'Haltija removed from Claude Desktop config',
      configPath,
      needsRestart: true
    }
  } catch (err) {
    return {
      success: false,
      message: `Failed to update config: ${err}`
    }
  }
}

// ============================================
// Full Status Check
// ============================================

/** Get complete MCP configuration status */
export async function getMcpStatus(): Promise<McpStatus> {
  const claudeDesktopPath = getClaudeDesktopConfigPath()
  const claudeCodePath = getClaudeCodeConfigPath()
  const mcpServerPath = findMcpServerPath()
  
  // Check if Haltija server is running
  let serverRunning = false
  try {
    const response = await fetch('http://localhost:8700/status', { 
      signal: AbortSignal.timeout(1000) 
    })
    serverRunning = response.ok
  } catch {}

  return {
    claudeDesktop: {
      installed: existsSync(dirname(claudeDesktopPath)),
      configPath: claudeDesktopPath,
      haltijaconfigured: isHaltijaInClaudeDesktop()
    },
    claudeCode: {
      installed: existsSync(claudeCodePath),
      configPath: claudeCodePath,
      haltijaconfigured: isHaltijaInClaudeCode()
    },
    haltija: {
      mcpServerPath,
      serverRunning
    }
  }
}

/** Get setup instructions for agents */
export function getSetupInstructions(): {
  cli: string
  manual: { configPath: string; config: McpServerConfig } | null
} {
  const mcpPath = findMcpServerPath()
  
  return {
    cli: 'bunx haltija --setup-mcp',
    manual: mcpPath ? {
      configPath: getClaudeDesktopConfigPath(),
      config: {
        command: 'node',
        args: [mcpPath]
      }
    } : null
  }
}
