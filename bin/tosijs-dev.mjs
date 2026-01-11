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
 *   npx tosijs-dev --headless   # Start with headless Chromium (for CI)
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
  --headless      Start headless Chromium browser (for CI)
  --headless-url <url>  URL to open in headless browser (default: none)
  --port <n>      Set HTTP port (default: 8700)
  --https-port <n> Set HTTPS port (default: 8701)
  --help, -h      Show this help

Environment Variables:
  DEV_CHANNEL_PORT       HTTP port (default: 8700)
  DEV_CHANNEL_HTTPS_PORT HTTPS port (default: 8701)
  DEV_CHANNEL_MODE       'http', 'https', or 'both' (default: 'http')

Examples:
  npx tosijs-dev                          # HTTP on 8700
  npx tosijs-dev --https                  # HTTPS on 8701
  npx tosijs-dev --both                   # HTTP on 8700 + HTTPS on 8701
  npx tosijs-dev --headless               # Start with headless browser for CI
  npx tosijs-dev --headless --headless-url http://localhost:3000  # Open URL

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

// Headless mode options
const headlessMode = args.includes('--headless')
const headlessUrlIdx = args.indexOf('--headless-url')
const headlessUrl = headlessUrlIdx !== -1 ? args[headlessUrlIdx + 1] : null

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
      console.log(\`[tosijs-dev] Opening \${headlessUrl}...\`)
      await page.goto(headlessUrl, { waitUntil: 'domcontentloaded' })
    } else {
      // Navigate to test page by default
      await page.goto(\`http://localhost:\${port}/\`, { waitUntil: 'domcontentloaded' })
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

tryBun()
