#!/usr/bin/env bun
/**
 * tosijs-dev CLI (Bun version)
 * 
 * Usage:
 *   bunx tosijs-dev              # Start HTTP server on port 8700
 *   bunx tosijs-dev --https      # Start HTTPS server (auto-generates certs)
 *   bunx tosijs-dev --both       # Start both HTTP and HTTPS
 *   bunx tosijs-dev --help       # Show help
 */

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
tosijs-dev - Browser control for AI agents

Usage:
  tosijs-dev [options]

Options:
  --http          HTTP only on port 8700 (degrades the shared channel — see #32)
  --https         HTTPS only on port 8701 (auto-generates certs)
  --both          Both HTTP (8700) and HTTPS (8701) — this is the DEFAULT
  --port <n>      Set HTTP port (default: 8700)
  --https-port <n> Set HTTPS port (default: 8701)
  --help, -h      Show this help

Environment Variables:
  DEV_CHANNEL_PORT       HTTP port (default: 8700)
  DEV_CHANNEL_HTTPS_PORT HTTPS port (default: 8701)
  DEV_CHANNEL_MODE       'http', 'https', or 'both' (default: 'both')

Examples:
  tosijs-dev                    # HTTP on 8700 + HTTPS on 8701 (both, by default)
  tosijs-dev --https            # HTTPS on 8701 (generates certs with mkcert or openssl)
  tosijs-dev --both             # HTTP on 8700 + HTTPS on 8701
  tosijs-dev --port 3000        # HTTP on 3000

Once running, curl the /docs endpoint for full API documentation.
`)
  process.exit(0)
}

// Parse args
// See bin/tosijs-dev.mjs for why the `else` sets nothing: the server defaults to `both` (#32a),
// and pinning 'http' here would both override that and read as a deliberate opt-out.
if (args.includes('--https')) {
  process.env.DEV_CHANNEL_MODE = 'https'
} else if (args.includes('--both')) {
  process.env.DEV_CHANNEL_MODE = 'both'
} else if (args.includes('--http')) {
  process.env.DEV_CHANNEL_MODE = 'http'
}

const portIdx = args.indexOf('--port')
if (portIdx !== -1 && args[portIdx + 1]) {
  process.env.DEV_CHANNEL_PORT = args[portIdx + 1]
}

const httpsPortIdx = args.indexOf('--https-port')
if (httpsPortIdx !== -1 && args[httpsPortIdx + 1]) {
  process.env.DEV_CHANNEL_HTTPS_PORT = args[httpsPortIdx + 1]
}

// Legacy: first positional arg as port
const firstArg = args.find(a => !a.startsWith('-'))
if (firstArg && !isNaN(parseInt(firstArg))) {
  process.env.DEV_CHANNEL_PORT = firstArg
}

// Import and start server (the server prints its own startup message)
import('../dist/server.js').catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
