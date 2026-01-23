#!/usr/bin/env node
/**
 * Haltija CLI
 * 
 * Usage:
 *   npx haltija                 # Launch desktop app (or server if electron unavailable)
 *   npx haltija --server        # Server only (for CI, headless, bookmarklet usage)
 *   npx haltija --app           # Explicitly launch desktop app
 *   npx haltija --https         # Start HTTPS server (auto-generates certs)
 *   npx haltija --headless      # Start with headless Chromium (for CI)
 *   npx haltija --setup-mcp     # Configure Claude Desktop integration
 *   npx haltija --help          # Show help
 */

import { spawn, execSync as execSyncImported } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir, platform } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverPath = join(__dirname, '../dist/server.js')

const args = process.argv.slice(2)

// Colors for terminal output
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${bold('haltija')} - Browser control for AI agents

Usage:
  haltija [options]

Modes:
  ${dim('(default)')}       Launch desktop app if electron available, otherwise server
  --app           Explicitly launch desktop app (Electron)
  --server        Server only (for CI, headless, or bookmarklet usage)
  --headless      Start with headless Chromium browser (for CI)

Options:
  --http          HTTP only on port 8700 (default protocol)
  --https         HTTPS only on port 8701 (auto-generates certs)
  --both          Both HTTP (8700) and HTTPS (8701)
  --headless-url <url>  URL to open in headless browser (default: none)
  --snapshots-dir <path>  Save snapshots to disk (for CI artifacts)
  --docs-dir <path>       Directory with custom docs (*.md files)
  --port <n>      Set HTTP port (default: 8700)
  --https-port <n> Set HTTPS port (default: 8701)
  --setup-mcp     Configure Claude Desktop MCP integration
  --setup-mcp-check  Check MCP configuration status
  --setup-mcp-remove Remove Haltija from Claude Desktop config
  --help, -h      Show this help

Environment Variables:
  DEV_CHANNEL_PORT         HTTP port (default: 8700)
  DEV_CHANNEL_HTTPS_PORT   HTTPS port (default: 8701)
  DEV_CHANNEL_MODE         'http', 'https', or 'both' (default: 'http')
  DEV_CHANNEL_SNAPSHOTS_DIR  Directory to save snapshots (default: memory only)
  DEV_CHANNEL_DOCS_DIR       Directory with custom docs (default: built-in only)

Subcommands:
  haltija <command> [args]         Run API commands directly (see hj --help)
  haltija tree                     DOM tree with ref IDs
  haltija click @42                Click element by ref
  haltija type @10 Hello           Type text into element
  haltija eval document.title      Run JS in browser
  haltija status                   Server status

  Use 'hj' as a short alias: hj tree, hj click @42, etc.

Examples:
  haltija                          # Desktop app (or server fallback)
  haltija --app                    # Desktop app explicitly
  haltija --server                 # Server only
  haltija --server --https         # HTTPS server only
  haltija --headless               # Headless browser for CI
  haltija --setup-mcp              # Configure Claude Desktop integration
`)
  process.exit(0)
}

// ============================================
// MCP Setup Functions
// ============================================

/** Get Claude Desktop config path based on platform */
function getClaudeDesktopConfigPath() {
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

/** Find the Haltija MCP server entry point */
function findMcpServerPath() {
  const candidates = [
    join(__dirname, '../apps/mcp/build/index.js'),
    join(__dirname, 'mcp/build/index.js'),
    join(process.cwd(), 'node_modules/haltija/apps/mcp/build/index.js'),
  ]
  
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

/** Check MCP configuration status */
function checkMcpConfig() {
  console.log(bold('\nHaltija MCP Configuration Status\n'))
  
  const configPath = getClaudeDesktopConfigPath()
  const mcpPath = findMcpServerPath()
  
  // Check Claude Desktop
  if (existsSync(dirname(configPath))) {
    console.log(green('✓') + ' Claude Desktop detected')
    console.log(dim(`  Config: ${configPath}`))
    
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'))
        if (config.mcpServers?.haltija) {
          console.log(green('✓') + ' Haltija is configured in Claude Desktop')
          console.log(dim(`  Command: ${config.mcpServers.haltija.command} ${config.mcpServers.haltija.args?.join(' ') || ''}`))
        } else {
          console.log(yellow('○') + ' Haltija is not configured')
          console.log(dim(`  Run: haltija --setup-mcp`))
        }
      } catch {
        console.log(yellow('○') + ' Config exists but could not be parsed')
      }
    } else {
      console.log(yellow('○') + ' Config file does not exist yet')
      console.log(dim(`  Run: haltija --setup-mcp`))
    }
  } else {
    console.log(yellow('○') + ' Claude Desktop not detected')
    console.log(dim(`  Install from: https://claude.ai/download`))
  }
  
  // Check MCP server
  if (mcpPath) {
    console.log(green('✓') + ' MCP server found')
    console.log(dim(`  Path: ${mcpPath}`))
  } else {
    console.log(red('✗') + ' MCP server not found')
    console.log(dim(`  Run from haltija directory or rebuild`))
  }
  
  // Check if server is running
  fetch('http://localhost:8700/status', { signal: AbortSignal.timeout(1000) })
    .then(r => {
      if (r.ok) console.log(green('✓') + ' Haltija server is running on port 8700')
      else console.log(yellow('○') + ' Haltija server not running')
    })
    .catch(() => {
      console.log(yellow('○') + ' Haltija server not running')
      console.log(dim(`  Start with: haltija`))
    })
    .finally(() => {
      console.log('')
    })
}

/** Setup Claude Desktop MCP integration */
function setupMcp() {
  const mcpPath = findMcpServerPath()
  if (!mcpPath) {
    console.log(red('Error:') + ' Could not find Haltija MCP server.')
    console.log('Make sure you run this from the haltija directory or have it installed.')
    process.exit(1)
  }
  
  const configPath = getClaudeDesktopConfigPath()
  const configDir = dirname(configPath)
  
  // Create config directory if needed
  if (!existsSync(configDir)) {
    console.log(dim(`Creating config directory: ${configDir}`))
    mkdirSync(configDir, { recursive: true })
  }
  
  // Read or create config
  let config = { mcpServers: {} }
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'))
      if (!config.mcpServers) config.mcpServers = {}
    } catch {
      // Backup invalid config
      const backupPath = configPath + '.backup'
      console.log(yellow('Warning:') + ` Existing config invalid, backing up to ${backupPath}`)
      writeFileSync(backupPath, readFileSync(configPath))
      config = { mcpServers: {} }
    }
  }
  
  // Check if already configured
  if (config.mcpServers.haltija) {
    console.log(green('✓') + ' Haltija is already configured in Claude Desktop')
    console.log(dim(`  Config: ${configPath}`))
    console.log('')
    console.log('To reconfigure, first run: ' + bold('haltija --setup-mcp-remove'))
    process.exit(0)
  }
  
  // Add Haltija
  config.mcpServers.haltija = {
    command: 'node',
    args: [mcpPath]
  }
  
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    console.log(green('✓') + ' Haltija configured successfully!')
    console.log(dim(`  Config: ${configPath}`))
    console.log('')
    console.log(bold('Next steps:'))
    console.log('  1. ' + yellow('Restart Claude Desktop') + ' to load the MCP server')
    console.log('  2. Start Haltija server: ' + dim('haltija'))
    console.log('  3. Connect browser and chat with Claude!')
    console.log('')
  } catch (err) {
    console.log(red('Error:') + ` Failed to write config: ${err.message}`)
    process.exit(1)
  }
}

/** Remove Haltija from Claude Desktop config */
function removeMcp() {
  const configPath = getClaudeDesktopConfigPath()
  
  if (!existsSync(configPath)) {
    console.log('Claude Desktop config does not exist.')
    process.exit(0)
  }
  
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    if (!config.mcpServers?.haltija) {
      console.log('Haltija is not configured in Claude Desktop.')
      process.exit(0)
    }
    
    delete config.mcpServers.haltija
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    
    console.log(green('✓') + ' Removed Haltija from Claude Desktop config')
    console.log(dim(`  Config: ${configPath}`))
    console.log('')
    console.log(yellow('Restart Claude Desktop') + ' to apply changes.')
    console.log('')
  } catch (err) {
    console.log(red('Error:') + ` Failed to update config: ${err.message}`)
    process.exit(1)
  }
}

// ============================================
// CLI Subcommand Detection
// ============================================

import { isSubcommand, runSubcommand } from './cli-subcommand.mjs'

// Check if first positional arg is a subcommand (not a flag, not a port number)
const firstNonFlag = args.find(a => !a.startsWith('-'))
if (firstNonFlag && isSubcommand(firstNonFlag)) {
  // Parse --port for subcommand mode
  let subPort = process.env.DEV_CHANNEL_PORT || '8700'
  const subPortIdx = args.indexOf('--port')
  if (subPortIdx !== -1 && args[subPortIdx + 1]) {
    subPort = args[subPortIdx + 1]
  }
  // Collect args after the subcommand, removing --port <n>
  const subIdx = args.indexOf(firstNonFlag)
  const rawSubArgs = args.slice(subIdx + 1)
  const cleanSubArgs = []
  for (let i = 0; i < rawSubArgs.length; i++) {
    if (rawSubArgs[i] === '--port') { i++; continue }
    cleanSubArgs.push(rawSubArgs[i])
  }
  await runSubcommand(firstNonFlag, cleanSubArgs, subPort)
  process.exit(0)
}

// Handle MCP setup commands
if (args.includes('--setup-mcp')) {
  setupMcp()
  process.exit(0)
}

if (args.includes('--setup-mcp-check')) {
  checkMcpConfig()
  // Don't exit immediately - let the async fetch complete
  setTimeout(() => process.exit(0), 2000)
}

if (args.includes('--setup-mcp-remove')) {
  removeMcp()
  process.exit(0)
}

// Set up environment from args
const env = { ...process.env }

if (args.includes('--https')) {
  env.DEV_CHANNEL_MODE = 'https'
} else if (args.includes('--both')) {
  env.DEV_CHANNEL_MODE = 'both'
} else {
  env.DEV_CHANNEL_MODE = env.DEV_CHANNEL_MODE || 'http'
}

const portIdx = args.indexOf('--port')
if (portIdx !== -1 && args[portIdx + 1]) {
  env.DEV_CHANNEL_PORT = args[portIdx + 1]
}

const httpsPortIdx = args.indexOf('--https-port')
if (httpsPortIdx !== -1 && args[httpsPortIdx + 1]) {
  env.DEV_CHANNEL_HTTPS_PORT = args[httpsPortIdx + 1]
}

// Legacy: first positional arg as port
const firstArg = args.find(a => !a.startsWith('-'))
if (firstArg && !isNaN(parseInt(firstArg))) {
  env.DEV_CHANNEL_PORT = firstArg
}

// Snapshots directory for CI artifact upload
const snapshotsDirIdx = args.indexOf('--snapshots-dir')
if (snapshotsDirIdx !== -1 && args[snapshotsDirIdx + 1]) {
  env.DEV_CHANNEL_SNAPSHOTS_DIR = args[snapshotsDirIdx + 1]
}

// Custom docs directory
const docsDirIdx = args.indexOf('--docs-dir')
if (docsDirIdx !== -1 && args[docsDirIdx + 1]) {
  env.DEV_CHANNEL_DOCS_DIR = args[docsDirIdx + 1]
}

// ============================================
// Mode Detection
// ============================================

const headlessMode = args.includes('--headless')
const headlessUrlIdx = args.indexOf('--headless-url')
const headlessUrl = headlessUrlIdx !== -1 ? args[headlessUrlIdx + 1] : null
const explicitServer = args.includes('--server')
const explicitApp = args.includes('--app')

/** Detect if Electron desktop app is available */
function detectElectron() {
  const desktopDir = join(__dirname, '../apps/desktop')
  if (!existsSync(desktopDir)) return null

  // Check for electron in desktop app's node_modules
  const electronBin = join(desktopDir, 'node_modules/.bin/electron')
  if (existsSync(electronBin)) return { electronBin, desktopDir }

  // Check if electron is available globally
  try {
    execSyncImported('electron --version', { stdio: 'ignore', timeout: 5000 })
    return { electronBin: 'electron', desktopDir }
  } catch {}

  return null
}

/** Read version from package.json */
function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Print startup banner */
function printBanner(mode, port) {
  const version = getVersion()
  const url = `http://localhost:${port}`
  console.log('')
  console.log(dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(`  ${bold('Haltija')} v${version} ${dim('—')} ${green(url)}`)
  console.log(`  Mode: ${mode === 'app' ? 'Desktop App' : mode === 'headless' ? 'Headless' : 'Server'}`)
  console.log('')
  console.log(dim('  Agent setup:'))
  console.log(`    MCP:   ${dim('bunx haltija --setup-mcp')}`)
  console.log(`    Curl:  ${dim(`curl ${url}/tree`)}`)
  console.log(`    Docs:  ${dim(`curl ${url}/docs`)}`)
  console.log(dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log('')
}

/** Launch the Electron desktop app */
function launchApp(electronInfo, port) {
  printBanner('app', port)

  const child = spawn(electronInfo.electronBin, [electronInfo.desktopDir], {
    env: { ...env, DEV_CHANNEL_PORT: String(port) },
    stdio: 'inherit'
  })

  child.on('error', (err) => {
    console.error(red('Error:') + ` Failed to launch desktop app: ${err.message}`)
    console.log(dim('Falling back to server mode...'))
    console.log('')
    startServer(port)
  })

  child.on('exit', code => {
    process.exit(code || 0)
  })
}

/** Start the server (current behavior) */
function startServer(port) {
  printBanner('server', port)
  tryBun()
}

// Start headless browser after server is ready
const startHeadlessBrowser = async (port) => {
  console.log('[tosijs-dev] Starting headless Chromium browser...')
  
  try {
    // Dynamic import to avoid requiring playwright if not using headless mode
    const { chromium } = await import('playwright')
    
    const browser = await chromium.launch({
      headless: true,
    })
    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    })
    
    const page = await context.newPage()
    
    // Inject tosijs-dev widget into every page
    await context.addInitScript({
      content: `
        // Auto-inject tosijs-dev widget
        (function() {
          if (document.querySelector('tosijs-dev')) return;
          
          console.log(
            '%c🦉 tosijs-dev%c headless mode',
            'background:#6366f1;color:white;padding:2px 8px;border-radius:3px 0 0 3px;font-weight:bold',
            'background:#22c55e;color:white;padding:2px 8px;border-radius:0 3px 3px 0'
          );
          
          fetch('http://localhost:${port}/inject.js')
            .then(r => r.text())
            .then(eval)
            .catch(e => console.error('[tosijs-dev] Failed to inject:', e));
        })();
      `
    })
    
    // Navigate to URL if specified
    if (headlessUrl) {
      console.log(`[tosijs-dev] Opening ${headlessUrl}...`)
      await page.goto(headlessUrl, { waitUntil: 'domcontentloaded' })
    } else {
      // Navigate to test page by default
      await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
    }
    
    console.log('[tosijs-dev] Headless browser ready. Widget auto-injected.')
    console.log('[tosijs-dev] Use POST /navigate to change pages.')
    
    // Keep browser alive
    process.on('SIGINT', async () => {
      console.log('\\n[tosijs-dev] Closing browser...')
      await browser.close()
      process.exit(0)
    })
    
    process.on('SIGTERM', async () => {
      await browser.close()
      process.exit(0)
    })
    
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('[tosijs-dev] Playwright not installed. Run: npm install playwright')
      console.error('[tosijs-dev] Then: npx playwright install chromium')
    } else {
      console.error('[tosijs-dev] Failed to start headless browser:', err.message)
    }
    process.exit(1)
  }
}

// Try bun first, fall back to node
const tryBun = () => {
  const bun = spawn('bun', ['run', serverPath], {
    env,
    stdio: 'inherit'
  })
  
  bun.on('error', () => {
    // Bun not available, try node
    tryNode()
  })
  
  bun.on('exit', code => {
    process.exit(code || 0)
  })
  
  // Start headless browser after a short delay for server to start
  if (headlessMode) {
    setTimeout(() => {
      startHeadlessBrowser(env.DEV_CHANNEL_PORT || 8700)
    }, 2000)
  }
}

const tryNode = () => {
  console.log('[tosijs-dev] Bun not found, using Node.js (some features may be limited)')
  
  const node = spawn('node', [serverPath], {
    env,
    stdio: 'inherit'
  })
  
  node.on('error', (err) => {
    console.error('Failed to start server:', err.message)
    process.exit(1)
  })
  
  node.on('exit', code => {
    process.exit(code || 0)
  })
  
  // Start headless browser after a short delay for server to start
  if (headlessMode) {
    setTimeout(() => {
      startHeadlessBrowser(env.DEV_CHANNEL_PORT || 8700)
    }, 2000)
  }
}

// ============================================
// Launch Mode Selection
// ============================================

const port = env.DEV_CHANNEL_PORT || '8700'

if (headlessMode) {
  // Headless mode: start server + headless browser
  printBanner('headless', port)
  tryBun()
} else if (explicitServer) {
  // Explicit server-only mode
  startServer(port)
} else if (explicitApp) {
  // Explicit app mode - fail if electron not available
  const electronInfo = detectElectron()
  if (!electronInfo) {
    console.error(red('Error:') + ' Desktop app not available.')
    console.log(dim('Electron not found. Install it in apps/desktop/ or use --server mode.'))
    process.exit(1)
  }
  launchApp(electronInfo, port)
} else {
  // Default: try app, fall back to server
  const electronInfo = detectElectron()
  if (electronInfo) {
    launchApp(electronInfo, port)
  } else {
    startServer(port)
  }
}
