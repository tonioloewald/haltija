#!/usr/bin/env node
/**
 * haltija-mcp-setup - Configure Claude Code to use Haltija
 *
 * Usage:
 *   npx haltija-mcp-setup          # Create .mcp.json in current directory
 *   npx haltija-mcp-setup --global # Add to user's Claude Code config
 *   npx haltija-mcp-setup --check  # Check if Haltija MCP is configured
 *   npx haltija-mcp-setup --help   # Show help
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

// Colors for terminal output
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${bold('haltija-mcp-setup')} - Configure Claude Code to use Haltija

${bold('Usage:')}
  npx haltija-mcp-setup          Create .mcp.json in current directory (recommended)
  npx haltija-mcp-setup --global Add to user's global Claude Code config
  npx haltija-mcp-setup --check  Check current MCP configuration status
  npx haltija-mcp-setup --remove Remove Haltija from MCP configuration
  npx haltija-mcp-setup --help   Show this help

${bold('What this does:')}
  Configures Claude Code to connect to the Haltija server, giving Claude
  native tools for browser control: click, type, query DOM, take screenshots, etc.

${bold('Prerequisites:')}
  1. Haltija server running: ${dim('bunx haltija')}
  2. Claude Code installed

${bold('After setup:')}
  Restart Claude Code to load the new MCP server.
`)
  process.exit(0)
}

// Find the MCP server path
function findMcpServerPath() {
  // Check if we're in the haltija package
  const localPath = join(__dirname, '../apps/mcp/build/index.js')
  if (existsSync(localPath)) {
    return localPath
  }

  // Check for globally installed package
  try {
    const result = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' })
    if (result.status === 0) {
      const globalPath = join(result.stdout.trim(), 'tosijs-dev/apps/mcp/build/index.js')
      if (existsSync(globalPath)) {
        return globalPath
      }
    }
  } catch {}

  // Check node_modules in current directory
  const nodeModulesPath = join(process.cwd(), 'node_modules/tosijs-dev/apps/mcp/build/index.js')
  if (existsSync(nodeModulesPath)) {
    return nodeModulesPath
  }

  return null
}

// Check if Claude Code is installed
function isClaudeCodeInstalled() {
  const claudeJsonPath = join(homedir(), '.claude.json')
  return existsSync(claudeJsonPath)
}

// Get project-level .mcp.json path
function getProjectMcpPath() {
  return join(process.cwd(), '.mcp.json')
}

// Get user-level claude.json path
function getClaudeJsonPath() {
  return join(homedir(), '.claude.json')
}

// Check current configuration
function checkConfig() {
  console.log(bold('\nHaltija MCP Configuration Status\n'))

  // Check Claude Code installation
  if (isClaudeCodeInstalled()) {
    console.log(green('✓') + ' Claude Code is installed')
  } else {
    console.log(red('✗') + ' Claude Code not detected (~/.claude.json missing)')
    console.log(dim('  Install Claude Code from: https://claude.ai/code'))
  }

  // Check project-level config
  const projectMcpPath = getProjectMcpPath()
  if (existsSync(projectMcpPath)) {
    try {
      const config = JSON.parse(readFileSync(projectMcpPath, 'utf8'))
      if (config.mcpServers?.haltija) {
        console.log(green('✓') + ` Project .mcp.json has Haltija configured`)
        console.log(dim(`  Path: ${projectMcpPath}`))
      } else {
        console.log(yellow('○') + ' Project .mcp.json exists but Haltija not configured')
      }
    } catch {
      console.log(red('✗') + ' Project .mcp.json exists but is invalid JSON')
    }
  } else {
    console.log(dim('○') + ' No project-level .mcp.json')
  }

  // Check MCP server build
  const mcpPath = findMcpServerPath()
  if (mcpPath) {
    console.log(green('✓') + ' MCP server found')
    console.log(dim(`  Path: ${mcpPath}`))
  } else {
    console.log(red('✗') + ' MCP server not found')
    console.log(dim('  Run from haltija directory or install globally'))
  }

  // Check if Haltija server is running
  try {
    execSync('curl -s http://localhost:8700/status', { encoding: 'utf8', timeout: 2000 })
    console.log(green('✓') + ' Haltija server is running on port 8700')
  } catch {
    console.log(yellow('○') + ' Haltija server not running')
    console.log(dim('  Start with: bunx haltija'))
  }

  console.log('')
}

// Create or update .mcp.json
function setupProjectConfig() {
  const mcpPath = findMcpServerPath()
  if (!mcpPath) {
    console.log(red('Error:') + ' Could not find Haltija MCP server.')
    console.log('Make sure you run this from the haltija directory or have it installed.')
    process.exit(1)
  }

  const projectMcpPath = getProjectMcpPath()
  let config = { mcpServers: {} }

  // Read existing config if present
  if (existsSync(projectMcpPath)) {
    try {
      config = JSON.parse(readFileSync(projectMcpPath, 'utf8'))
      if (!config.mcpServers) {
        config.mcpServers = {}
      }
    } catch {
      console.log(yellow('Warning:') + ' Existing .mcp.json is invalid, creating new one')
      config = { mcpServers: {} }
    }
  }

  // Check if already configured
  if (config.mcpServers.haltija) {
    console.log(yellow('Haltija is already configured in .mcp.json'))
    console.log(dim('Use --remove to remove it, or delete .mcp.json manually'))
    process.exit(0)
  }

  // Add Haltija configuration
  config.mcpServers.haltija = {
    command: 'node',
    args: [mcpPath]
  }

  writeFileSync(projectMcpPath, JSON.stringify(config, null, 2) + '\n')

  console.log(green('✓') + ' Created .mcp.json with Haltija configuration')
  console.log(dim(`  Path: ${projectMcpPath}`))
  console.log('')
  console.log(bold('Next steps:'))
  console.log('  1. Restart Claude Code to load the MCP server')
  console.log('  2. Start Haltija if not running: ' + dim('bunx haltija'))
  console.log('  3. Haltija tools (click, type, query, etc.) will be available in Claude')
  console.log('')
}

// Add to global Claude Code config
function setupGlobalConfig() {
  const mcpPath = findMcpServerPath()
  if (!mcpPath) {
    console.log(red('Error:') + ' Could not find Haltija MCP server.')
    process.exit(1)
  }

  // Try using claude CLI first
  try {
    execSync(`claude mcp add haltija node "${mcpPath}" --scope user`, {
      encoding: 'utf8',
      stdio: 'inherit'
    })
    console.log('')
    console.log(green('✓') + ' Added Haltija to global Claude Code configuration')
    console.log('')
    console.log(bold('Next steps:'))
    console.log('  1. Restart Claude Code to load the MCP server')
    console.log('  2. Start Haltija if not running: ' + dim('bunx haltija'))
    console.log('')
    return
  } catch {
    // Fall back to manual config
  }

  // Manual fallback
  const claudeJsonPath = getClaudeJsonPath()
  if (!existsSync(claudeJsonPath)) {
    console.log(red('Error:') + ' Claude Code config not found at ~/.claude.json')
    console.log('Make sure Claude Code is installed.')
    process.exit(1)
  }

  console.log(yellow('Note:') + ' Could not use claude CLI, please add manually:')
  console.log('')
  console.log('Run: ' + bold(`claude mcp add haltija node "${mcpPath}" --scope user`))
  console.log('')
  console.log('Or add to ~/.claude.json under your project\'s mcpServers:')
  console.log(dim(JSON.stringify({ haltija: { command: 'node', args: [mcpPath] } }, null, 2)))
  console.log('')
}

// Remove Haltija configuration
function removeConfig() {
  const projectMcpPath = getProjectMcpPath()

  if (!existsSync(projectMcpPath)) {
    console.log('No .mcp.json found in current directory')
    process.exit(0)
  }

  try {
    const config = JSON.parse(readFileSync(projectMcpPath, 'utf8'))
    if (config.mcpServers?.haltija) {
      delete config.mcpServers.haltija

      // Remove file if no other servers, otherwise update
      if (Object.keys(config.mcpServers).length === 0) {
        unlinkSync(projectMcpPath)
        console.log(green('✓') + ' Removed .mcp.json (no other MCP servers configured)')
      } else {
        writeFileSync(projectMcpPath, JSON.stringify(config, null, 2) + '\n')
        console.log(green('✓') + ' Removed Haltija from .mcp.json')
      }
    } else {
      console.log('Haltija is not configured in .mcp.json')
    }
  } catch (err) {
    console.log(red('Error:') + ' Failed to parse .mcp.json')
    process.exit(1)
  }
}

// Main
if (args.includes('--check')) {
  checkConfig()
} else if (args.includes('--global')) {
  setupGlobalConfig()
} else if (args.includes('--remove')) {
  removeConfig()
} else {
  // Default: project-level setup
  if (!isClaudeCodeInstalled()) {
    console.log(yellow('Warning:') + ' Claude Code not detected (~/.claude.json missing)')
    console.log('This setup configures Haltija for Claude Code.')
    console.log('')
  }
  setupProjectConfig()
}
