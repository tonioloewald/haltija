#!/usr/bin/env bun
/**
 * tosijs-dev CLI
 * 
 * Usage:
 *   bunx tosijs-dev          # Start server on default port 8700
 *   bunx tosijs-dev 3000     # Start server on port 3000
 *   bunx tosijs-dev --help   # Show help
 */

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
tosijs-dev - Real-time browser↔agent communication

Usage:
  tosijs-dev [port]     Start server (default: 8700)
  tosijs-dev --help     Show this help

Example:
  tosijs-dev            # Start on port 8700
  tosijs-dev 3000       # Start on port 3000

Once running:
  1. Open http://localhost:<port> for test page
  2. Drag bookmarklet to your bookmarks bar
  3. Click bookmarklet on any page to inject the widget
  4. Use REST API or client to interact with the page
`)
  process.exit(0)
}

const port = parseInt(args[0]) || parseInt(process.env.DEV_CHANNEL_PORT || '8700')

// Set port for server
process.env.DEV_CHANNEL_PORT = String(port)

// Import and start server
import('../dist/server.js').then(() => {
  const bookmarklet = `javascript:(function(){fetch('http://localhost:${port}/inject.js').then(r=>r.text()).then(eval).catch(e=>alert('Dev Channel: Cannot reach server'))})()`
  
  // Find docs path relative to this script
  const docsPath = new URL('../README.md', import.meta.url).pathname
  const roadmapPath = new URL('../ROADMAP.md', import.meta.url).pathname
  
  console.log(`
┌─────────────────────────────────────────────────────────────────────┐
│  tosijs-dev ready on port ${port}                                       │
└─────────────────────────────────────────────────────────────────────┘

Test page:   http://localhost:${port}/

Bookmarklet (create bookmark, paste this as URL):
${bookmarklet}

REST API:
  GET  /status     - Connection status
  POST /query      - DOM query { selector }
  POST /click      - Click element { selector }
  POST /type       - Type text { selector, text }
  POST /eval       - Run JS { code }
  GET  /console    - Get console output

Docs:
  ${docsPath}
  ${roadmapPath}
`)
}).catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
