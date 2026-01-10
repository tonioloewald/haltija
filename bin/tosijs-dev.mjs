#!/usr/bin/env node
/**
 * tosijs-dev CLI (Node version)
 * 
 * Note: This is a Node-compatible wrapper. For best performance, use Bun:
 *   bunx tosijs-dev
 * 
 * Usage:
 *   npx tosijs-dev              # Start HTTP server on port 8700
 *   npx tosijs-dev --https      # Start HTTPS server (auto-generates certs)
 *   npx tosijs-dev --both       # Start both HTTP and HTTPS
 *   npx tosijs-dev --help       # Show help
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverPath = join(__dirname, '../dist/server.js')

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
tosijs-dev - Browser control for AI agents

Usage:
  tosijs-dev [options]

Options:
  --http          HTTP only on port 8700 (default)
  --https         HTTPS only on port 8701 (auto-generates certs)
  --both          Both HTTP (8700) and HTTPS (8701)
  --port <n>      Set HTTP port (default: 8700)
  --https-port <n> Set HTTPS port (default: 8701)
  --help, -h      Show this help

Environment Variables:
  DEV_CHANNEL_PORT       HTTP port (default: 8700)
  DEV_CHANNEL_HTTPS_PORT HTTPS port (default: 8701)
  DEV_CHANNEL_MODE       'http', 'https', or 'both' (default: 'http')

Examples:
  npx tosijs-dev                # HTTP on 8700
  npx tosijs-dev --https        # HTTPS on 8701
  npx tosijs-dev --both         # HTTP on 8700 + HTTPS on 8701

Note: For best performance, use Bun: bunx tosijs-dev

Once running, curl the /docs endpoint for full API documentation.
`)
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
}

tryBun()
