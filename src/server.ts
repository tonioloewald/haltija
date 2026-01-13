/**
 * Haltija - Browser Control for AI Agents
 * https://github.com/anthropics/claude-code
 * 
 * Copyright 2025 Tonio Loewald
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Haltija Server
 * 
 * A Bun-based server that:
 * - Accepts WebSocket connections from browser components
 * - Provides REST API for agent/CLI communication
 * - Routes messages between browsers and agents
 * - Buffers recent messages for late joiners
 */

import type { DevMessage, DevResponse, ConsoleEntry, BuildEvent, DevChannelTest, StepResult, PageSnapshot, DomTreeNode, VerifyExpectation, VerifyStep } from './types'
import { injectorCode } from './bookmarklet'
import { VERSION } from './version'
import { generateTestPage } from './test-page'
import { ICON_SVG } from './embedded-assets'
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

// Product naming - single source of truth
const PRODUCT_NAME = 'Haltija'
const TAG_NAME = 'haltija-dev'
const LOG_PREFIX = '[haltija]'

const PORT = parseInt(process.env.DEV_CHANNEL_PORT || '8700')
const HTTPS_PORT = parseInt(process.env.DEV_CHANNEL_HTTPS_PORT || '8701')
const SNAPSHOTS_DIR = process.env.DEV_CHANNEL_SNAPSHOTS_DIR || null
const DOCS_DIR = process.env.DEV_CHANNEL_DOCS_DIR || null
const __dirname = dirname(fileURLToPath(import.meta.url))
const certsDir = join(__dirname, '../certs')

// Cert paths
const certPath = join(certsDir, 'localhost.pem')
const keyPath = join(certsDir, 'localhost-key.pem')

// Mode: 'http', 'https', or 'both'
const MODE = process.env.DEV_CHANNEL_MODE || 'http'
const WANT_HTTPS = MODE === 'https' || MODE === 'both'
const WANT_HTTP = MODE === 'http' || MODE === 'both'

// Generate self-signed certs if needed for HTTPS
let certsAvailable = existsSync(certPath) && existsSync(keyPath)
if (WANT_HTTPS && !certsAvailable) {
  // Try mkcert first (produces trusted certs), fall back to openssl
  try {
    mkdirSync(certsDir, { recursive: true })
    try {
      execSync(`mkcert -cert-file "${certPath}" -key-file "${keyPath}" localhost 127.0.0.1 ::1`, { stdio: 'pipe' })
      console.log(`${LOG_PREFIX} Generated trusted certificates with mkcert`)
    } catch {
      // Fall back to openssl self-signed cert
      execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`, { stdio: 'pipe' })
      console.log(`${LOG_PREFIX} Generated self-signed certificates with openssl`)
      console.log(`${LOG_PREFIX} For trusted certs, install mkcert: brew install mkcert && mkcert -install`)
    }
    certsAvailable = true
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to generate certificates:`, err)
    console.error(`${LOG_PREFIX} HTTPS will not be available`)
  }
}

const USE_HTTPS = WANT_HTTPS && certsAvailable
const USE_HTTP = WANT_HTTP

// Generate unique server session ID at startup
const SERVER_SESSION_ID = Math.random().toString(36).slice(2) + Date.now().toString(36)

// Component.js paths for dynamic loading (try multiple locations for compiled binary support)
const componentJsPaths = [
  join(__dirname, '../dist/component.js'),           // Dev mode: relative to src/
  join(__dirname, 'component.js'),                   // Compiled: same dir as binary
  join(process.cwd(), 'dist/component.js'),          // CWD fallback
  join(process.cwd(), 'component.js'),               // CWD direct
]

// Load component.js fresh on each request to always serve latest build
function getComponentJs(): string {
  for (const componentJsPath of componentJsPaths) {
    try {
      if (!existsSync(componentJsPath)) continue
      const componentJs = readFileSync(componentJsPath, 'utf-8')
      // Inject server session ID - replace the placeholder (bundler uses 'var' not 'const')
      return componentJs.replace(
        /var SERVER_SESSION_ID\s*=\s*["'][^"']*["']/,
        `var SERVER_SESSION_ID = "${SERVER_SESSION_ID}"`
      )
    } catch {
      continue
    }
  }
  return ''
}

// Connected browser clients (WebSocket -> browserId)
const browsers = new Map<WebSocket, string>()

// Window tracking for multi-window support
interface TrackedWindow {
  id: string           // windowId from sessionStorage
  browserId: string    // browserId (changes on page load)
  ws: WebSocket        // WebSocket connection
  url: string          // Current page URL
  title: string        // Current page title
  active: boolean      // Whether window is active (responding to commands)
  connectedAt: number  // When first connected
  lastSeen: number     // Last message time
  label?: string       // Optional agent-assigned label
  windowType?: string  // 'tab', 'popup', or 'iframe'
}
const windows = new Map<string, TrackedWindow>()

// Connected agent clients (could be multiple)
const agents = new Set<WebSocket>()

// Track the currently focused window ID (for routing untargeted commands)
let focusedWindowId: string | null = null

// Track the currently active browser ID (legacy, for backwards compatibility)
let activeBrowserId: string | null = null

// Message buffer for late joiners
const messageBuffer: DevMessage[] = []
const MAX_BUFFER = 100

// Snapshot storage (in-memory, keyed by ID)
const snapshots = new Map<string, PageSnapshot>()
const MAX_SNAPSHOTS = 50

// Recording storage (in-memory, keyed by ID)
interface StoredRecording {
  id: string
  url: string
  title: string
  startTime: number
  endTime: number
  events: unknown[]
  createdAt: number
}
const recordings = new Map<string, StoredRecording>()
const MAX_RECORDINGS = 20

// Create snapshots directory if configured
if (SNAPSHOTS_DIR) {
  try {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true })
    console.log(`${LOG_PREFIX} Snapshots will be saved to: ${SNAPSHOTS_DIR}`)
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to create snapshots directory:`, err)
  }
}

// Save snapshot to disk if directory is configured
function saveSnapshotToDisk(snapshot: PageSnapshot): void {
  if (!SNAPSHOTS_DIR) return
  try {
    const filePath = join(SNAPSHOTS_DIR, `${snapshot.id}.json`)
    writeFileSync(filePath, JSON.stringify(snapshot, null, 2))
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to save snapshot to disk:`, err)
  }
}

// Helper to capture a snapshot
async function captureSnapshot(trigger: PageSnapshot['trigger'], context?: PageSnapshot['context']): Promise<string | undefined> {
  try {
    const locationResponse = await requestFromBrowser('navigation', 'location', {})
    if (!locationResponse.success) return undefined
    
    const treeResponse = await requestFromBrowser('dom', 'tree', { 
      selector: 'body', 
      depth: 5,
      compact: true 
    })
    
    const consoleResponse = await requestFromBrowser('console', 'get', {})
    
    const viewportResponse = await requestFromBrowser('eval', 'exec', {
      code: 'JSON.stringify({width: window.innerWidth, height: window.innerHeight})'
    })
    
    const snapshotId = `snap_${Date.now()}_${uid()}`
    const snapshot: PageSnapshot = {
      id: snapshotId,
      timestamp: Date.now(),
      url: locationResponse.data?.url || '',
      title: locationResponse.data?.title || '',
      tree: treeResponse.data || { tag: 'body', text: '[unavailable]' },
      console: consoleResponse.data || [],
      viewport: viewportResponse.success ? JSON.parse(viewportResponse.data) : { width: 0, height: 0 },
      trigger,
      context,
    }
    
    if (snapshots.size >= MAX_SNAPSHOTS) {
      const oldest = snapshots.keys().next().value
      if (oldest) snapshots.delete(oldest)
    }
    snapshots.set(snapshotId, snapshot)
    saveSnapshotToDisk(snapshot)
    
    return snapshotId
  } catch {
    return undefined
  }
}

// Pending responses (request id -> resolver)
const pendingResponses = new Map<string, {
  resolve: (r: DevResponse) => void
  timeout: ReturnType<typeof setTimeout>
}>()

// Generate unique IDs
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

// Validation helper for POST endpoints
interface FieldSpec {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
}

function validateBody(
  body: Record<string, unknown>,
  fields: FieldSpec[],
  endpoint: string
): { valid: true } | { valid: false; error: string; hint?: string } {
  const errors: string[] = []
  const expectedFields: string[] = []
  
  for (const field of fields) {
    expectedFields.push(`${field.name}: ${field.type}${field.required ? '' : '?'}`)
    const value = body[field.name]
    
    if (field.required && (value === undefined || value === null)) {
      errors.push(`missing required field "${field.name}"`)
      continue
    }
    
    if (value !== undefined && value !== null) {
      const actualType = Array.isArray(value) ? 'array' : typeof value
      if (actualType !== field.type) {
        errors.push(`"${field.name}" should be ${field.type}, got ${actualType}`)
      }
    }
  }
  
  if (errors.length > 0) {
    return {
      valid: false,
      error: `${endpoint}: ${errors.join(', ')}`,
      hint: `Expected: { ${expectedFields.join(', ')} }`
    }
  }
  
  return { valid: true }
}

// Helper to return validation error response
function validationError(result: { error: string; hint?: string }, headers: Record<string, string>): Response {
  return Response.json({ 
    success: false, 
    error: result.error,
    hint: result.hint 
  }, { status: 400, headers })
}

// Helper for "wrong method" responses
function wrongMethod(endpoint: string, correctMethod: string, headers: Record<string, string>): Response {
  return Response.json({
    success: false,
    error: `${endpoint} requires ${correctMethod}`,
    hint: `Use: curl -X ${correctMethod} http://localhost:${PORT}${endpoint}` + 
          (correctMethod === 'POST' ? ' -H "Content-Type: application/json" -d \'{"..."}\'': '')
  }, { status: 405, headers })
}

function bufferMessage(msg: DevMessage) {
  messageBuffer.push(msg)
  if (messageBuffer.length > MAX_BUFFER) {
    messageBuffer.shift()
  }
}

// Clear only mutation-related messages from buffer
function clearMutationMessages() {
  for (let i = messageBuffer.length - 1; i >= 0; i--) {
    if (messageBuffer[i].channel === 'mutations') {
      messageBuffer.splice(i, 1)
    }
  }
}

function broadcast(msg: DevMessage, exclude?: WebSocket) {
  const data = JSON.stringify(msg)
  
  // Send to browsers (system messages only - for tab coordination)
  if (msg.channel === 'system') {
    for (const [ws] of browsers) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    }
  }
  
  // Send to agents (everything except system messages)
  if (msg.channel !== 'system') {
    for (const ws of agents) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    }
  }
}

function sendToBrowsers(msg: DevMessage) {
  const data = JSON.stringify(msg)
  for (const [ws] of browsers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  }
}

function sendToAgents(msg: DevMessage | DevResponse) {
  const data = JSON.stringify(msg)
  for (const ws of agents) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  }
}

// Send request to browser and wait for response
// If windowId is provided, send only to that window; otherwise send to focused window or all
async function requestFromBrowser(
  channel: string, 
  action: string, 
  payload: any,
  timeoutMs = 5000,
  windowId?: string
): Promise<DevResponse> {
  if (browsers.size === 0) {
    return { id: '', success: false, error: 'No browser connected', timestamp: Date.now() }
  }
  
  const id = uid()
  
  // Include windowId in payload if targeting specific window
  const targetPayload = windowId ? { ...payload, windowId } : payload
  
  const msg: DevMessage = {
    id,
    channel,
    action,
    payload: targetPayload,
    timestamp: Date.now(),
    source: 'agent',
  }
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingResponses.delete(id)
      resolve({ id, success: false, error: 'Timeout', timestamp: Date.now() })
    }, timeoutMs)
    
    pendingResponses.set(id, { resolve, timeout })
    
    // If windowId specified, send only to that window
    if (windowId) {
      const win = windows.get(windowId)
      if (win) {
        win.ws.send(JSON.stringify(msg))
      } else {
        clearTimeout(timeout)
        pendingResponses.delete(id)
        resolve({ id, success: false, error: `Window ${windowId} not found`, timestamp: Date.now() })
      }
    } else {
      // Send to all browsers (they will filter by active state)
      sendToBrowsers(msg)
    }
  })
}

// Handle incoming WebSocket message
function handleMessage(ws: WebSocket, raw: string, isBrowser: boolean) {
  try {
    const data = JSON.parse(raw)
    
    // Check if it's a response to a pending request
    if ('success' in data && pendingResponses.has(data.id)) {
      const pending = pendingResponses.get(data.id)!
      clearTimeout(pending.timeout)
      pendingResponses.delete(data.id)
      pending.resolve(data as DevResponse)
      
      // Also forward to agents
      sendToAgents(data)
      return
    }
    
    const msg = data as DevMessage
    
    // Handle recording save messages - store the recording server-side
    if (msg.channel === 'recording' && msg.action === 'save' && msg.payload) {
      const payload = msg.payload as { id: string; url: string; title: string; startTime: number; endTime: number; events: unknown[] }
      const recording: StoredRecording = {
        id: payload.id,
        url: payload.url,
        title: payload.title,
        startTime: payload.startTime,
        endTime: payload.endTime,
        events: payload.events,
        createdAt: Date.now(),
      }
      
      // Evict oldest if over limit
      if (recordings.size >= MAX_RECORDINGS) {
        const oldest = recordings.keys().next().value
        if (oldest) recordings.delete(oldest)
      }
      recordings.set(recording.id, recording)
      console.log(`${LOG_PREFIX} Saved recording: ${recording.id} (${recording.events.length} events)`)
    }
    
    // Don't buffer system messages, but do broadcast them
    if (msg.channel !== 'system') {
      bufferMessage(msg)
    }
    
    // Broadcast all messages
    broadcast(msg, ws)
    
  } catch (err) {
    console.error(`${LOG_PREFIX} Invalid message:`, err)
  }
}

// REST API handlers
async function handleRest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  
  // Window targeting: ?window=<windowId> routes command to specific window
  // If not specified, command goes to all active windows
  const targetWindowId = url.searchParams.get('window') || undefined
  
  // CORS headers (including Private Network Access for local server)
  // PNA allows HTTPS sites to access localhost
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Request-Private-Network',
    'Access-Control-Allow-Private-Network': 'true',
    'Content-Type': 'application/json',
  }
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers })
  }
  
  // Static files for bookmarklet injection
  // Replace placeholders with actual URLs based on request protocol
  if (path === '/inject.js') {
    const isSecure = req.url.startsWith('https:')
    const protocol = isSecure ? 'https' : 'http'
    const wsProtocol = isSecure ? 'wss' : 'ws'
    const port = isSecure ? HTTPS_PORT : PORT
    const serverUrl = `${protocol}://localhost:${port}`
    const wsUrl = `${wsProtocol}://localhost:${port}/ws/browser`
    
    const code = injectorCode
      .replace('__SERVER_URL__', serverUrl)
      .replace('__WS_URL__', wsUrl)
      .replace('__VERSION__', VERSION)
    
    return new Response(code, { 
      headers: { ...headers, 'Content-Type': 'application/javascript' } 
    })
  }
  
  if (path === '/component.js') {
    const componentJs = getComponentJs()
    if (!componentJs) {
      return new Response('// Component not built. Run: bun run build', { 
        status: 503,
        headers: { ...headers, 'Content-Type': 'application/javascript' } 
      })
    }
    return new Response(componentJs, { 
      headers: { ...headers, 'Content-Type': 'application/javascript' } 
    })
  }
  
  // Serve the icon SVG (embedded at build time)
  if (path === '/icon.svg') {
    return new Response(ICON_SVG, {
      headers: { ...headers, 'Content-Type': 'image/svg+xml' }
    })
  }
  
  // Dev mode one-liner endpoint - injects widget with localhost check and console badge
  if (path === '/dev.js') {
    const isSecure = req.url.startsWith('https:')
    const protocol = isSecure ? 'https' : 'http'
    const wsProtocol = isSecure ? 'wss' : 'ws'
    const port = isSecure ? HTTPS_PORT : PORT
    const serverUrl = `${protocol}://localhost:${port}`
    const wsUrl = `${wsProtocol}://localhost:${port}/ws/browser`
    
    const devCode = `
// ${PRODUCT_NAME}: Browser control for AI agents
// Remove this before deploying to production!
(function() {
  // Only run on localhost
  if (!/^localhost$|^127\\./.test(location.hostname)) {
    console.warn('%c${LOG_PREFIX}%c Skipped - not localhost', 
      'background:#ef4444;color:white;padding:2px 6px;border-radius:3px;font-weight:bold',
      'color:#ef4444');
    return;
  }
  
  // Don't inject twice
  if (document.querySelector('${TAG_NAME}')) return;
  
  // Announce ourselves
  console.log(
    '%c🧝 ${PRODUCT_NAME}%c connected %c⚠️ Remove before production!',
    'background:#6366f1;color:white;padding:2px 8px;border-radius:3px 0 0 3px;font-weight:bold',
    'background:#22c55e;color:white;padding:2px 8px',
    'background:#f97316;color:white;padding:2px 8px;border-radius:0 3px 3px 0'
  );
  
  // Fetch and inject the component (cache-bust with timestamp)
  fetch('${serverUrl}/inject.js?_=' + Date.now())
    .then(r => r.text())
    .then(eval)
    .catch(e => {
      console.error('%c${LOG_PREFIX}%c Failed to connect:', 
        'background:#ef4444;color:white;padding:2px 6px;border-radius:3px;font-weight:bold',
        'color:#ef4444', e.message);
    });
})();
`
    return new Response(devCode, { 
      headers: { ...headers, 'Content-Type': 'application/javascript' } 
    })
  }
  
  // Serve a simple test page
  if (path === '/' || path === '/test' || path === '/test.html') {
    const isSecure = req.url.startsWith('https:')
    const protocol = isSecure ? 'https' : 'http'
    const port = isSecure ? HTTPS_PORT : PORT
    // Check if request is from Electron app (via user agent or referrer)
    const userAgent = req.headers.get('user-agent') || ''
    const isElectronApp = userAgent.includes('Electron')
    const html = generateTestPage(protocol, port, isElectronApp)
    return new Response(html, { 
      headers: { ...headers, 'Content-Type': 'text/html' } 
    })
  }
  
  // Server version
  const SERVER_VERSION = '0.1.6'
  
  // Built-in docs (shipped with Haltija)
  const builtinDocs: Record<string, { path: string; description: string }> = {
    'ux-crimes': {
      path: join(__dirname, '../docs/UX-CRIMES.md'),
      description: 'The Haltija Criminal Code - 35 detectable UX anti-patterns'
    }
  }
  
  // Helper to get all available docs (built-in + custom)
  function getAvailableDocs(): Array<{ name: string; description: string; source: 'builtin' | 'custom' }> {
    const docs: Array<{ name: string; description: string; source: 'builtin' | 'custom' }> = []
    
    // Add built-in docs
    for (const [name, info] of Object.entries(builtinDocs)) {
      if (existsSync(info.path)) {
        docs.push({ name, description: info.description, source: 'builtin' })
      }
    }
    
    // Add custom docs from DOCS_DIR
    if (DOCS_DIR && existsSync(DOCS_DIR)) {
      try {
        const files = readdirSync(DOCS_DIR)
        for (const file of files) {
          if (file.endsWith('.md')) {
            const name = file.replace(/\.md$/, '')
            // Custom docs can override built-in
            const existing = docs.findIndex(d => d.name === name)
            if (existing >= 0) {
              docs[existing] = { name, description: `(custom override)`, source: 'custom' }
            } else {
              // Try to extract description from first line
              try {
                const content = readFileSync(join(DOCS_DIR, file), 'utf-8')
                const firstLine = content.split('\n')[0]?.replace(/^#\s*/, '').trim() || file
                docs.push({ name, description: firstLine, source: 'custom' })
              } catch {
                docs.push({ name, description: file, source: 'custom' })
              }
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
    
    return docs.sort((a, b) => a.name.localeCompare(b.name))
  }
  
  // Helper to get a specific doc by name
  function getDoc(name: string): { content: string; source: 'builtin' | 'custom' } | null {
    // Check custom docs first (allows override)
    if (DOCS_DIR && existsSync(DOCS_DIR)) {
      const customPath = join(DOCS_DIR, `${name}.md`)
      if (existsSync(customPath)) {
        try {
          return { content: readFileSync(customPath, 'utf-8'), source: 'custom' }
        } catch {
          // Fall through to builtin
        }
      }
    }
    
    // Check built-in docs
    const builtin = builtinDocs[name]
    if (builtin && existsSync(builtin.path)) {
      try {
        return { content: readFileSync(builtin.path, 'utf-8'), source: 'builtin' }
      } catch {
        return null
      }
    }
    
    return null
  }
  
  // List all available docs (discovery endpoint)
  if (path === '/docs/list' && req.method === 'GET') {
    const docs = getAvailableDocs()
    return Response.json({ 
      docs,
      customDocsDir: DOCS_DIR || null,
      hint: 'Use GET /docs/:name to fetch a specific doc'
    }, { headers })
  }
  
  // Get a specific doc by name
  // Match /docs/xyz where xyz is NOT 'list' (already handled above)
  const docMatch = path.match(/^\/docs\/([^/]+)$/)
  if (docMatch && docMatch[1] !== 'list' && req.method === 'GET') {
    const docName = docMatch[1]
    const doc = getDoc(docName)
    if (doc) {
      return new Response(doc.content, { 
        headers: { 
          ...headers, 
          'Content-Type': 'text/markdown',
          'X-Doc-Source': doc.source
        } 
      })
    } else {
      const available = getAvailableDocs().map(d => d.name)
      return Response.json({ 
        error: `Doc '${docName}' not found`,
        available,
        hint: DOCS_DIR ? `Add ${docName}.md to ${DOCS_DIR}` : 'Use --docs-dir to add custom docs'
      }, { status: 404, headers })
    }
  }
  
  // Agent documentation endpoint - everything an LLM needs to use this tool
  if (path === '/docs' && req.method === 'GET') {
    const baseUrl = USE_HTTPS ? `https://localhost:${PORT}` : `http://localhost:${PORT}`
    const wsProtocol = USE_HTTPS ? 'wss' : 'ws'
    
    const docs = `# ${PRODUCT_NAME}: Browser Control for AI Agents

You have access to a live browser tab. You can see the DOM, click elements, type text, 
run JavaScript, watch for changes, and control navigation. The human has injected a 
widget into their browser that connects to this server.

## Quick Start

Check connection:
  curl ${baseUrl}/status

Get current page:
  curl ${baseUrl}/location

See the DOM tree:
  curl -X POST ${baseUrl}/tree -H "Content-Type: application/json" -d '{"selector": "body", "depth": 3}'

## Core Endpoints

### Page Info
- GET  /status          - Server status, connected browsers/agents
- GET  /location        - Current URL, title, pathname
- GET  /version         - Server and component versions
- GET  /console         - Captured console output (logs, errors, warnings)

### DOM Exploration  
- POST /tree            - Get DOM tree: {"selector": "body", "depth": 4}
- POST /query           - Query single element: {"selector": "#login-btn"}
- POST /inspect         - Detailed element info: {"selector": ".header"}
- POST /inspectAll      - Inspect multiple elements: {"selector": "button"}

### Interaction
- POST /click           - Click element: {"selector": "#submit"}
- POST /type            - Type text (human-like): {"selector": "input", "text": "hello"}
- POST /drag            - Drag element: {"selector": ".item", "deltaX": 100, "deltaY": 0}
- POST /eval            - Run JavaScript: {"code": "document.title"}

### Visual Feedback
- POST /highlight       - Highlight element: {"selector": ".target", "color": "red"}
- POST /unhighlight     - Remove highlights

### Navigation
- POST /navigate        - Go to URL: {"url": "https://example.com"}
- POST /refresh         - Reload the page
- POST /reload          - Reload the ${PRODUCT_NAME} widget

### Mutation Watching
- POST /mutations/watch   - Start watching: {"selector": "body", "subtree": true}
- POST /mutations/unwatch - Stop watching
- GET  /mutations/status  - Get recorded mutations

### Session Recording
- POST /recording/start - Record user interactions
- POST /recording/stop  - Stop and get recorded events

### Selection Tool
- POST /select/start   - Start selection mode (user drags rectangle)
- POST /select/cancel  - Cancel selection mode
- GET  /select/status  - Check if selection is active or has result
- GET  /select/result  - Get the selected elements
- POST /select/clear   - Clear stored selection

### Test Runner
- POST /test/validate   - Validate test JSON format
- POST /test/run        - Run a single test: POST full test JSON
- POST /test/suite      - Run multiple tests: {"tests": [test1, test2, ...]}

### Snapshots (Time Travel Debugging)
- POST /snapshot        - Capture current page state (DOM tree, console, viewport)
- GET  /snapshot/:id    - Retrieve a snapshot by ID
- GET  /snapshots       - List all snapshots (metadata only)
- DELETE /snapshot/:id  - Delete a snapshot

Test failures automatically capture snapshots. The snapshotId is included in test results.

### Recordings (User-Created Test Sessions)
- GET  /recordings      - List all recordings (metadata: id, url, duration, eventCount)
- GET  /recording/:id   - Get a recording by ID (includes full semantic events)
- DELETE /recording/:id - Delete a recording

When the user clicks 🎬 to start and 💾 to stop, semantic events are saved server-side.
The agent sees recording:started and recording:stopped in the event stream, then can 
fetch the full recording. Perfect for "show me how you do X" workflows.

### Semantic Events (The Hindsight Buffer)
- POST /events/watch    - Start watching semantic events
- POST /events/unwatch  - Stop watching
- GET  /events?since=N  - Get event buffer since timestamp
- GET  /events/status   - Check if watching

Events are aggregated at source: "user typed 'hello'" not 5 keystrokes.
Categories: interaction, navigation, input, hover, scroll, mutation, focus, console.

### Reference Docs (Extensible Knowledge Base)
- GET  /docs/list       - List all available docs (built-in + custom)
- GET  /docs/:name      - Fetch a specific doc by name (e.g., /docs/ux-crimes)

Built-in docs: ux-crimes (The Haltija Criminal Code - 35 UX anti-patterns)

Custom docs: Add your own .md files to a directory and use --docs-dir <path>
Example: style-guide.md, api-reference.md, testing-conventions.md

Custom docs can override built-in docs by using the same filename.

## Tips

1. Use /tree first to understand page structure before querying specific elements
2. Selectors work like CSS: "#id", ".class", "tag", "[attr=value]", combinations
3. /inspectAll is great for finding all buttons, inputs, links on a page
4. /console shows what the page is logging - useful for debugging
5. /eval can run any JavaScript and return results
6. The widget shows a visual indicator when connected - the human can see activity

## Example: Explore a Page

# What page am I on?
curl ${baseUrl}/location

# What's the structure?
curl -X POST ${baseUrl}/tree -d '{"selector":"body","depth":3}' -H "Content-Type: application/json"

# Find all interactive elements
curl -X POST ${baseUrl}/inspectAll -d '{"selector":"button, a, input"}' -H "Content-Type: application/json"

# Click something
curl -X POST ${baseUrl}/click -d '{"selector":"#login-btn"}' -H "Content-Type: application/json"

## Example: Run a Test

Tests are JSON files with atomic actions. Run them via the API:

# Validate test format
curl -X POST ${baseUrl}/test/validate -H "Content-Type: application/json" -d @my-test.json

# Run a single test
curl -X POST ${baseUrl}/test/run -H "Content-Type: application/json" -d @my-test.json

# Run a test suite
curl -X POST ${baseUrl}/test/suite -H "Content-Type: application/json" -d '{"tests":[...]}'

Test format:
{
  "version": 1,
  "name": "Test name",
  "url": "http://localhost:3000",
  "steps": [
    {"action": "click", "selector": "#btn", "description": "Click button"},
    {"action": "type", "selector": "input", "text": "hello"},
    {"action": "assert", "type": "exists", "selector": ".result"}
  ]
}

## Developer Integration

Add this one-liner to your project to auto-inject the widget on localhost:

  /^localhost$|^127\\./.test(location.hostname)&&import('${baseUrl}/dev.js')

It's safe to leave in production - it only runs on localhost/127.x.x.x.
The console will show a colored badge when connected.

Server: ${baseUrl}
WebSocket: ${wsProtocol}://localhost:${PORT}/ws/browser (for browser widget)
WebSocket: ${wsProtocol}://localhost:${PORT}/ws/agent (for programmatic agents)

For complete API reference with all options and response formats:
  curl ${baseUrl}/api
`
    return new Response(docs, { 
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } 
    })
  }

  // Full API reference endpoint
  if (path === '/api' && req.method === 'GET') {
    const baseUrl = USE_HTTP ? `http://localhost:${PORT}` : `https://localhost:${HTTPS_PORT}`
    
    const api = `# ${PRODUCT_NAME} API Reference

Complete API documentation. For quick start, see: curl ${baseUrl}/docs

All endpoints support CORS and return JSON (except /docs and /api which return text).

## Status & Messages

| Endpoint | Method | Description |
|----------|--------|-------------|
| /status | GET | Server status (connected browsers/agents, buffered messages) |
| /version | GET | Version info for server and connected browser component |
| /messages?since=N | GET | Get buffered messages since timestamp N |
| /console?since=N | GET | Get console entries since timestamp N |
| /location | GET | Current page URL, title, pathname |

### /version Response
{
  "server": "0.1.7",
  "component": "0.1.7",
  "browser": {
    "id": "abc123",
    "url": "https://example.com",
    "title": "Example Page",
    "state": "connected"
  }
}

## DOM Queries

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| /query | POST | {selector, all?} | Query DOM elements (basic info) |
| /inspect | POST | {selector} | Deep inspect single element |
| /inspectAll | POST | {selector, limit?} | Deep inspect multiple elements |
| /tree | POST | {selector, depth?, ...} | Build filterable DOM tree |

### /query Response
{
  "success": true,
  "data": {
    "tagName": "button",
    "id": "submit",
    "className": "btn primary",
    "textContent": "Submit",
    "attributes": {"id": "submit", "class": "btn primary"}
  }
}

### /inspect Response (detailed)
{
  "selector": "body > form > button#submit",
  "tagName": "button",
  "classList": ["btn", "primary"],
  "box": { "x": 100, "y": 200, "width": 120, "height": 40, "visible": true },
  "offsets": { "offsetTop": 200, "offsetLeft": 100, "scrollTop": 0 },
  "text": { "innerText": "Submit", "value": null },
  "attributes": { "id": "submit", "class": "btn primary", "type": "submit" },
  "dataset": { "testId": "submit-btn" },
  "properties": { "disabled": false, "hidden": false, "isCustomElement": false },
  "hierarchy": { "parent": "form#login", "children": 1, "depth": 4 },
  "styles": { "display": "inline-block", "visibility": "visible" }
}

### /tree Options
| Option | Default | Description |
|--------|---------|-------------|
| selector | "body" | Root element |
| depth | 3 | Max depth (-1 for unlimited) |
| includeText | true | Include text content of leaf nodes |
| allAttributes | false | Include all attrs (vs only interesting) |
| includeBox | false | Include position/size info |
| compact | false | Minimal output |
| pierceShadow | false | Traverse into shadow DOM |
| interestingClasses | [...] | Class patterns to highlight |
| interestingAttributes | [...] | Attr patterns to include |
| ignoreSelectors | [...] | Elements to skip |

### /tree Response
{
  "tag": "div",
  "id": "app",
  "classes": ["-xin-data"],
  "attrs": { "role": "main" },
  "flags": { "hasData": true, "customElement": false },
  "children": [...],
  "shadowChildren": [...]  // when pierceShadow: true
}

Flags: hasEvents, hasData, interactive, customElement, shadowRoot, hidden, hasAria

## Interactions

All interaction endpoints automatically scroll the element into view first.

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| /click | POST | {selector} | Click element (full mouse lifecycle) |
| /type | POST | {selector, text, ...} | Type into an input (human-like by default) |
| /drag | POST | {selector, deltaX, deltaY, duration?} | Drag an element |
| /eval | POST | {code} | Execute JavaScript |
| /screenshot | POST | {selector?, format?, scale?, ...} | Capture page or element |

/click fires: mouseenter -> mouseover -> mousemove -> mousedown -> mouseup -> click

### /screenshot Options
| Option | Default | Description |
|--------|---------|-------------|
| selector | (none) | CSS selector for element capture (omit for full page) |
| format | png | Image format: png, webp (smaller), jpeg (smallest) |
| quality | 0.85 | Quality for webp/jpeg (0-1) |
| scale | 1 | Scale factor (0.5 = half size, reduces file size) |
| maxWidth | (none) | Max width in pixels (maintains aspect ratio) |
| maxHeight | (none) | Max height in pixels (maintains aspect ratio) |

Screenshot sources (automatic fallback):
1. **Electron native** - Best quality, works on any site (CSP doesn't matter)
2. **html2canvas** - Works in browser if script is loaded on page
3. **Viewport info only** - Falls back if no capture method available

Examples:
curl -X POST ${baseUrl}/screenshot -H "Content-Type: application/json" \\
  -d '{"format": "webp", "quality": 0.8}'

# Half-size screenshot for faster transfer:
curl -X POST ${baseUrl}/screenshot -d '{"scale": 0.5, "format": "webp"}'

# Fit within 800x600:
curl -X POST ${baseUrl}/screenshot -d '{"maxWidth": 800, "maxHeight": 600}'

# Returns: { success: true, image: "data:image/webp;base64,...", source: "electron", width: 640, height: 480 }

### /type Options
| Option | Default | Description |
|--------|---------|-------------|
| selector | required | CSS selector for input element |
| text | required | Text to type |
| humanlike | true | Enable human-like typing with variable timing |
| typoRate | 0.03 | Chance of typo per character (0-1) |
| minDelay | 50 | Minimum ms between keystrokes |
| maxDelay | 150 | Maximum ms between keystrokes |

Human-like mode types character by character with:
- Variable delays between keystrokes (50-150ms)
- Occasional typos using adjacent keys, immediately corrected
- Random hesitation pauses (5% chance of 200-500ms pause)

Use humanlike:false for fast mode (instant value set)

### /drag Example
curl -X POST ${baseUrl}/drag -H "Content-Type: application/json" \\
  -d '{"selector": ".draggable", "deltaX": 100, "deltaY": 50, "duration": 300}'

## Visual Highlighting

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| /highlight | POST | {selector, label?, color?, duration?} | Highlight element |
| /unhighlight | POST | - | Remove highlight |

### /highlight Example
curl -X POST ${baseUrl}/highlight -H "Content-Type: application/json" \\
  -d '{"selector": "#login-form", "label": "Bug here!", "color": "#ef4444", "duration": 3000}'

CSS variables for theming:
  --tosijs-highlight (border), --tosijs-highlight-bg, --tosijs-highlight-glow

## Navigation

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| /refresh | POST | {hard?} | Refresh the page |
| /navigate | POST | {url} | Navigate to URL |
| /location | GET | - | Get current location |
| /reload | POST | - | Reload the ${PRODUCT_NAME} widget |

## DOM Mutation Watching

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| /mutations/watch | POST | {preset?, filters?, debounce?} | Start watching |
| /mutations/unwatch | POST | - | Stop watching |
| /mutations/status | GET | - | Check if watching |

### Presets
- smart (default) - Auto-detects xinjs, b8r, React, Tailwind
- xinjs - Highlights -xin-event, -xin-data classes
- b8rjs - Highlights data-event, data-bind attributes
- tailwind - Filters out utility classes
- react - Filters React internals
- minimal - Only element add/remove
- none - No filtering

### Custom Filters
{
  "preset": "smart",
  "filters": {
    "ignoreClasses": ["^animate-", "^transition-"],
    "ignoreAttributes": ["style"],
    "ignoreElements": ["script", "style"],
    "interestingClasses": ["-xin-event", "active"],
    "interestingAttributes": ["aria-", "data-testid"],
    "onlySelectors": ["#app", ".main-content"]
  }
}

### Mutation Batch (in /messages)
{
  "channel": "mutations",
  "action": "batch",
  "payload": {
    "timestamp": 1234567890,
    "count": 5,
    "summary": { "added": 2, "removed": 0, "attributeChanges": 3 },
    "notable": [
      { "type": "added", "selector": "#new-item", "tagName": "div" },
      { "type": "attribute", "selector": "#btn", "attribute": "disabled" }
    ]
  }
}

## Session Recording

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| /recording/start | POST | {name} | Start recording session |
| /recording/stop | POST | - | Stop and return recorded events |
| /recording/generate | POST | {name, url, addAssertions, events?} | Generate test JSON from semantic events |

## Build Events

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| /build | POST | {type, message?, file?, line?} | Publish build event |

## WebSocket Endpoints

- /ws/browser - For browser widget connections
- /ws/agent - For programmatic agent connections

## Widget Controls

The widget appears in the bottom-right corner:
- Status indicator: Green=connected, Yellow=connecting, Orange=paused, Red=disconnected
- Pause button - Temporarily stop responding to commands
- Minimize button - Slide to corner (Option+Tab to toggle)
- Kill button - Disconnect and remove widget

Security: Widget always shows when agent sends commands (no silent snooping)
`
    return new Response(api, { 
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } 
    })
  }

  // Status endpoint
  if (path === '/status') {
    return Response.json({
      browsers: browsers.size,
      agents: agents.size,
      bufferedMessages: messageBuffer.length,
      serverVersion: SERVER_VERSION,
      serverSessionId: SERVER_SESSION_ID,
    }, { headers })
  }
  
  // Version endpoint - get component version from connected browser
  if (path === '/version' && req.method === 'GET') {
    const response = await requestFromBrowser('system', 'version', {})
    if (response.success) {
      return Response.json({
        server: SERVER_VERSION,
        component: response.data.version,
        browser: {
          id: response.data.browserId,
          url: response.data.url,
          title: response.data.title,
          state: response.data.state,
        }
      }, { headers })
    } else {
      return Response.json({
        server: SERVER_VERSION,
        component: null,
        error: response.error || 'No browser connected'
      }, { headers })
    }
  }
  
  // Reload widget with fresh code (no need to click bookmarklet again)
  if (path === '/reload' && req.method === 'POST') {
    const response = await requestFromBrowser('system', 'reload', {})
    return Response.json(response, { headers })
  }
  
  // Get recent messages
  if (path === '/messages' && req.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') || '0')
    const messages = messageBuffer.filter(m => m.timestamp > since)
    return Response.json(messages, { headers })
  }
  
  // Send message (for agents without WebSocket)
  if (path === '/send' && req.method === 'GET') {
    return wrongMethod('/send', 'POST', headers)
  }
  if (path === '/send' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'channel', type: 'string', required: true },
      { name: 'action', type: 'string', required: true },
      { name: 'payload', type: 'object' },
      { name: 'id', type: 'string' }
    ], '/send')
    if (!validation.valid) return validationError(validation, headers)
    
    const msg: DevMessage = {
      id: body.id || uid(),
      channel: body.channel,
      action: body.action,
      payload: body.payload,
      timestamp: Date.now(),
      source: 'agent',
    }
    bufferMessage(msg)
    sendToBrowsers(msg)
    return Response.json({ success: true, id: msg.id }, { headers })
  }
  
  // Request/response (for agents without WebSocket)
  if (path === '/request' && req.method === 'GET') {
    return wrongMethod('/request', 'POST', headers)
  }
  if (path === '/request' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'channel', type: 'string', required: true },
      { name: 'action', type: 'string', required: true },
      { name: 'payload', type: 'object' },
      { name: 'timeout', type: 'number' }
    ], '/request')
    if (!validation.valid) return validationError(validation, headers)
    
    const response = await requestFromBrowser(
      body.channel,
      body.action,
      body.payload,
      body.timeout || 5000
    )
    return Response.json(response, { headers })
  }
  
  // DOM query shorthand
  if (path === '/query' && req.method === 'GET') {
    return wrongMethod('/query', 'POST', headers)
  }
  if (path === '/query' && req.method === 'POST') {
    const body = await req.json() as { selector: string; all?: boolean; window?: string }
    const validation = validateBody(body, [
      { name: 'selector', type: 'string', required: true },
      { name: 'all', type: 'boolean' },
      { name: 'window', type: 'string' }
    ], '/query')
    if (!validation.valid) return validationError(validation, headers)
    
    const windowId = body.window || targetWindowId
    const response = await requestFromBrowser('dom', 'query', {
      selector: body.selector,
      all: body.all,
    }, 5000, windowId)
    return Response.json(response, { headers })
  }
  
  // Console get shorthand
  if (path === '/console' && req.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') || '0')
    const response = await requestFromBrowser('console', 'get', { since })
    return Response.json(response, { headers })
  }
  
  // Eval shorthand
  if (path === '/eval' && req.method === 'GET') {
    return wrongMethod('/eval', 'POST', headers)
  }
  if (path === '/eval' && req.method === 'POST') {
    const body = await req.json() as { code: string; window?: string }
    const validation = validateBody(body, [
      { name: 'code', type: 'string', required: true },
      { name: 'window', type: 'string' }
    ], '/eval')
    if (!validation.valid) return validationError(validation, headers)
    
    const windowId = body.window || targetWindowId
    const response = await requestFromBrowser('eval', 'exec', { code: body.code }, 5000, windowId)
    return Response.json(response, { headers })
  }
  
  // Click shorthand - fires full mouse event lifecycle
  if (path === '/click' && req.method === 'GET') {
    return wrongMethod('/click', 'POST', headers)
  }
  if (path === '/click' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'selector', type: 'string', required: true },
      { name: 'options', type: 'object' },
      { name: 'window', type: 'string' }
    ], '/click')
    if (!validation.valid) return validationError(validation, headers)
    
    const selector = body.selector
    const options = body.options || {}
    
    // Scroll element into view first
    await requestFromBrowser('eval', 'exec', {
      code: `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
    })
    await new Promise(r => setTimeout(r, 100)) // Wait for scroll
    
    // Full lifecycle: mouseenter → mouseover → mousemove → mousedown → mouseup → click
    for (const event of ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
      await requestFromBrowser('events', 'dispatch', {
        selector,
        event,
        options,
      })
    }
    
    return Response.json({ success: true }, { headers })
  }
  
  // Drag shorthand - simulates a drag operation
  // POST /drag { selector, deltaX, deltaY, duration? }
  if (path === '/drag' && req.method === 'GET') {
    return wrongMethod('/drag', 'POST', headers)
  }
  if (path === '/drag' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'selector', type: 'string', required: true },
      { name: 'deltaX', type: 'number' },
      { name: 'deltaY', type: 'number' },
      { name: 'duration', type: 'number' },
      { name: 'window', type: 'string' }
    ], '/drag')
    if (!validation.valid) return validationError(validation, headers)
    
    const selector = body.selector
    const deltaX = body.deltaX || 0
    const deltaY = body.deltaY || 0
    const duration = body.duration || 300 // ms
    const steps = Math.max(5, Math.floor(duration / 16)) // ~60fps
    
    // Scroll element into view first
    await requestFromBrowser('eval', 'exec', {
      code: `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
    })
    await new Promise(r => setTimeout(r, 100))
    
    // Get element center position
    const inspectResponse = await requestFromBrowser('dom', 'inspect', { selector })
    if (!inspectResponse.success || !inspectResponse.data) {
      return Response.json({ success: false, error: 'Element not found' }, { headers })
    }
    const box = inspectResponse.data.box
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    
    // mouseenter, mouseover, mousemove to start position
    for (const event of ['mouseenter', 'mouseover', 'mousemove']) {
      await requestFromBrowser('events', 'dispatch', {
        selector,
        event,
        options: { clientX: startX, clientY: startY },
      })
    }
    
    // mousedown
    await requestFromBrowser('events', 'dispatch', {
      selector,
      event: 'mousedown',
      options: { clientX: startX, clientY: startY },
    })
    
    // mousemove steps (dispatched on document)
    const stepDelay = duration / steps
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps
      const x = startX + deltaX * progress
      const y = startY + deltaY * progress
      await requestFromBrowser('eval', 'exec', {
        code: `document.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))`
      })
      await new Promise(r => setTimeout(r, stepDelay))
    }
    
    // mouseup
    await requestFromBrowser('eval', 'exec', {
      code: `document.dispatchEvent(new MouseEvent('mouseup', { clientX: ${startX + deltaX}, clientY: ${startY + deltaY}, bubbles: true }))`
    })
    
    return Response.json({ success: true, from: { x: startX, y: startY }, to: { x: startX + deltaX, y: startY + deltaY } }, { headers })
  }
  
  // Type shorthand - human-like typing with variable latency and occasional typos
  if (path === '/type' && req.method === 'GET') {
    return wrongMethod('/type', 'POST', headers)
  }
  if (path === '/type' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'selector', type: 'string', required: true },
      { name: 'text', type: 'string', required: true },
      { name: 'humanlike', type: 'boolean' },
      { name: 'typoRate', type: 'number' },
      { name: 'minDelay', type: 'number' },
      { name: 'maxDelay', type: 'number' },
      { name: 'window', type: 'string' }
    ], '/type')
    if (!validation.valid) return validationError(validation, headers)
    
    const text: string = body.text || ''
    const humanlike: boolean = body.humanlike !== false // default true
    const typoRate: number = body.typoRate ?? 0.03 // 3% chance of typo per character
    const minDelay: number = body.minDelay ?? 50 // ms between keystrokes
    const maxDelay: number = body.maxDelay ?? 150 // ms between keystrokes
    
    // Scroll element into view first
    await requestFromBrowser('eval', 'exec', {
      code: `document.querySelector(${JSON.stringify(body.selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
    })
    await new Promise(r => setTimeout(r, 100))
    
    // Focus the element
    await requestFromBrowser('eval', 'exec', {
      code: `document.querySelector(${JSON.stringify(body.selector)})?.focus()`
    })
    await new Promise(r => setTimeout(r, 50))
    
    if (!humanlike) {
      // Fast mode: just set the value directly
      const response = await requestFromBrowser('events', 'dispatch', {
        selector: body.selector,
        event: 'input',
        options: { value: text },
      })
      return Response.json(response, { headers })
    }
    
    // Human-like typing: character by character with variable timing and typos
    // Adjacent keys for realistic typos
    const adjacentKeys: Record<string, string[]> = {
      'a': ['s', 'q', 'w', 'z'],
      'b': ['v', 'g', 'h', 'n'],
      'c': ['x', 'd', 'f', 'v'],
      'd': ['s', 'e', 'r', 'f', 'c', 'x'],
      'e': ['w', 'r', 'd', 's'],
      'f': ['d', 'r', 't', 'g', 'v', 'c'],
      'g': ['f', 't', 'y', 'h', 'b', 'v'],
      'h': ['g', 'y', 'u', 'j', 'n', 'b'],
      'i': ['u', 'o', 'k', 'j'],
      'j': ['h', 'u', 'i', 'k', 'm', 'n'],
      'k': ['j', 'i', 'o', 'l', 'm'],
      'l': ['k', 'o', 'p', ';'],
      'm': ['n', 'j', 'k', ','],
      'n': ['b', 'h', 'j', 'm'],
      'o': ['i', 'p', 'l', 'k'],
      'p': ['o', 'l', '['],
      'q': ['w', 'a'],
      'r': ['e', 't', 'f', 'd'],
      's': ['a', 'w', 'e', 'd', 'x', 'z'],
      't': ['r', 'y', 'g', 'f'],
      'u': ['y', 'i', 'j', 'h'],
      'v': ['c', 'f', 'g', 'b'],
      'w': ['q', 'e', 's', 'a'],
      'x': ['z', 's', 'd', 'c'],
      'y': ['t', 'u', 'h', 'g'],
      'z': ['a', 's', 'x'],
      '0': ['9', '-'],
      '1': ['2', '`'],
      '2': ['1', '3'],
      '3': ['2', '4'],
      '4': ['3', '5'],
      '5': ['4', '6'],
      '6': ['5', '7'],
      '7': ['6', '8'],
      '8': ['7', '9'],
      '9': ['8', '0'],
    }
    
    let currentValue = ''
    let typoCount = 0
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      const delay = minDelay + Math.random() * (maxDelay - minDelay)
      
      // Occasionally make a typo
      if (Math.random() < typoRate && adjacentKeys[char.toLowerCase()]) {
        const wrongKeys = adjacentKeys[char.toLowerCase()]
        const wrongChar = wrongKeys[Math.floor(Math.random() * wrongKeys.length)]
        const typoChar = char === char.toUpperCase() ? wrongChar.toUpperCase() : wrongChar
        
        // Type the wrong character
        currentValue += typoChar
        await requestFromBrowser('eval', 'exec', {
          code: `(function(){
            const el = document.querySelector(${JSON.stringify(body.selector)});
            if (el) { el.value = ${JSON.stringify(currentValue)}; el.dispatchEvent(new InputEvent('input', {bubbles: true, data: ${JSON.stringify(typoChar)}})); }
          })()`
        })
        await new Promise(r => setTimeout(r, delay))
        
        // Pause slightly longer before noticing the mistake
        await new Promise(r => setTimeout(r, 100 + Math.random() * 200))
        
        // Backspace to fix it
        currentValue = currentValue.slice(0, -1)
        await requestFromBrowser('eval', 'exec', {
          code: `(function(){
            const el = document.querySelector(${JSON.stringify(body.selector)});
            if (el) { el.value = ${JSON.stringify(currentValue)}; el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'deleteContentBackward'})); }
          })()`
        })
        await new Promise(r => setTimeout(r, delay * 0.5))
        
        typoCount++
      }
      
      // Type the correct character
      currentValue += char
      await requestFromBrowser('eval', 'exec', {
        code: `(function(){
          const el = document.querySelector(${JSON.stringify(body.selector)});
          if (el) { el.value = ${JSON.stringify(currentValue)}; el.dispatchEvent(new InputEvent('input', {bubbles: true, data: ${JSON.stringify(char)}})); }
        })()`
      })
      await new Promise(r => setTimeout(r, delay))
      
      // Occasional longer pause (thinking/hesitation)
      if (Math.random() < 0.05) {
        await new Promise(r => setTimeout(r, 200 + Math.random() * 300))
      }
    }
    
    return Response.json({ 
      success: true, 
      typed: text, 
      typos: typoCount,
      humanlike: true 
    }, { headers })
  }
  
  // Start recording
  if (path === '/recording/start' && req.method === 'POST') {
    const body = await req.json()
    const response = await requestFromBrowser('recording', 'start', { name: body.name })
    return Response.json(response, { headers })
  }
  
  // Stop recording
  if (path === '/recording/stop' && req.method === 'POST') {
    const response = await requestFromBrowser('recording', 'stop', {})
    return Response.json(response, { headers })
  }
  
  // Generate test from semantic events
  if (path === '/recording/generate' && req.method === 'POST') {
    const body = await req.json()
    
    // Get semantic events from buffer or from request body
    let events = body.events
    if (!events) {
      // Get events from the semantic event buffer via browser
      const eventsResponse = await requestFromBrowser('semantic', 'get', { since: body.since || 0 })
      if (!eventsResponse.success) {
        return Response.json({ success: false, error: 'Failed to get events' }, { headers })
      }
      events = eventsResponse.data?.events || []
    }
    
    // Import the test generator
    const { semanticEventsToTest, suggestAssertions } = await import('./test-generator')
    
    // Generate the test
    const test = semanticEventsToTest(events, {
      name: body.name || 'Recorded Test',
      description: body.description,
      url: body.url || events[0]?.payload?.to || 'http://localhost:3000',
      addAssertions: body.addAssertions !== false,
      minDelay: body.minDelay,
      createdBy: body.createdBy || 'human',
      tags: body.tags,
    })
    
    // Optionally add suggested assertions at the end
    if (body.suggestAssertions) {
      const suggestions = suggestAssertions(events)
      test.steps.push(...suggestions)
    }
    
    return Response.json({ success: true, test }, { headers })
  }
  
  // Publish build event (for dev servers to call)
  if (path === '/build' && req.method === 'POST') {
    const body = await req.json() as BuildEvent
    const msg: DevMessage = {
      id: uid(),
      channel: 'build',
      action: body.type,
      payload: body,
      timestamp: Date.now(),
      source: 'server',
    }
    bufferMessage(msg)
    broadcast(msg)
    return Response.json({ success: true }, { headers })
  }
  
  // Force page refresh
  if (path === '/refresh' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const hard = body.hard ?? false  // hard refresh clears cache
    const response = await requestFromBrowser('navigation', 'refresh', { hard })
    return Response.json(response, { headers })
  }
  
  // Navigate to URL
  if (path === '/navigate' && req.method === 'GET') {
    return wrongMethod('/navigate', 'POST', headers)
  }
  if (path === '/navigate' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'url', type: 'string', required: true },
      { name: 'window', type: 'string' }
    ], '/navigate')
    if (!validation.valid) return validationError(validation, headers)
    
    const response = await requestFromBrowser('navigation', 'goto', { url: body.url })
    return Response.json(response, { headers })
  }
  
  // Get current URL and title
  if (path === '/location' && req.method === 'GET') {
    const response = await requestFromBrowser('navigation', 'location', {})
    return Response.json(response, { headers })
  }
  
  // Open a new tab (Electron app only)
  // POST /tabs/open { "url": "https://example.com" }
  if (path === '/tabs/open' && req.method === 'GET') {
    return wrongMethod('/tabs/open', 'POST', headers)
  }
  if (path === '/tabs/open' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'url', type: 'string', required: true }
    ], '/tabs/open')
    if (!validation.valid) return validationError(validation, headers)
    
    // Send to browser component which will relay to Electron
    const response = await requestFromBrowser('tabs', 'open', { url: body.url })
    return Response.json(response, { headers })
  }
  
  // Close a tab by window ID
  // POST /tabs/close { "window": "windowId" } or ?window=windowId
  if (path === '/tabs/close' && req.method === 'GET') {
    return wrongMethod('/tabs/close', 'POST', headers)
  }
  if (path === '/tabs/close' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const windowId = body.window || targetWindowId
    if (!windowId) {
      return Response.json({ 
        success: false, 
        error: '/tabs/close: window id is required',
        hint: 'Pass window ID in body or query string: ?window=<id>'
      }, { status: 400, headers })
    }
    const response = await requestFromBrowser('tabs', 'close', { windowId })
    return Response.json(response, { headers })
  }
  
  // Focus/activate a tab by window ID
  // POST /tabs/focus { "window": "windowId" } or ?window=windowId  
  if (path === '/tabs/focus' && req.method === 'GET') {
    return wrongMethod('/tabs/focus', 'POST', headers)
  }
  if (path === '/tabs/focus' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const windowId = body.window || targetWindowId
    if (!windowId) {
      return Response.json({ 
        success: false, 
        error: '/tabs/focus: window id is required',
        hint: 'Pass window ID in body or query string: ?window=<id>'
      }, { status: 400, headers })
    }
    const response = await requestFromBrowser('tabs', 'focus', { windowId })
    return Response.json(response, { headers })
  }
  
  // Restart the server
  if (path === '/restart' && req.method === 'POST') {
    console.log(`${LOG_PREFIX} Restart requested, exiting...`)
    setTimeout(() => process.exit(0), 100)
    return Response.json({ success: true, message: 'Server restarting...' }, { headers })
  }
  
  // Shutdown the server (for Electron app to kill external servers)
  if (path === '/shutdown' && req.method === 'POST') {
    console.log(`${LOG_PREFIX} Shutdown requested`)
    setTimeout(() => process.exit(0), 100)
    return Response.json({ success: true, message: 'Server shutting down...' }, { headers })
  }
  
  // Clear message buffer (useful for debugging)
  if (path === '/clear' && req.method === 'POST') {
    messageBuffer.length = 0
    console.log(`${LOG_PREFIX} Message buffer cleared`)
    return Response.json({ success: true }, { headers })
  }
  
  // Start watching DOM mutations
  if (path === '/mutations/watch' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    
    // Clear old mutation messages when starting a new watch
    // This prevents stale data from previous watch sessions
    clearMutationMessages()
    
    const response = await requestFromBrowser('mutations', 'watch', {
      root: body.root,
      childList: body.childList ?? true,
      attributes: body.attributes ?? true,
      characterData: body.characterData ?? false,
      subtree: body.subtree ?? true,
      debounce: body.debounce ?? 100,
      preset: body.preset,
      filters: body.filters,
      pierceShadow: body.pierceShadow,
    })
    return Response.json(response, { headers })
  }
  
  // Stop watching DOM mutations
  if (path === '/mutations/unwatch' && req.method === 'POST') {
    const response = await requestFromBrowser('mutations', 'unwatch', {})
    return Response.json(response, { headers })
  }
  
  // Get mutation watch status
  if (path === '/mutations/status' && req.method === 'GET') {
    const response = await requestFromBrowser('mutations', 'status', {})
    return Response.json(response, { headers })
  }
  
  // ============================================
  // Semantic Events (Phase 6)
  // ============================================
  
  // Start watching semantic events
  if (path === '/events/watch' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    // Accept preset or categories
    const response = await requestFromBrowser('semantic', 'watch', {
      preset: body.preset,        // 'minimal', 'interactive', 'detailed', 'debug'
      categories: body.categories, // or explicit array of categories
    })
    return Response.json(response, { headers })
  }
  
  // Stop watching semantic events
  if (path === '/events/unwatch' && req.method === 'POST') {
    const response = await requestFromBrowser('semantic', 'unwatch', {})
    return Response.json(response, { headers })
  }
  
  // Get semantic event buffer (hindsight)
  if (path === '/events' && req.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') || '0')
    const response = await requestFromBrowser('semantic', 'get', { since })
    return Response.json(response, { headers })
  }
  
  // Get semantic events status
  if (path === '/events/status' && req.method === 'GET') {
    const response = await requestFromBrowser('semantic', 'status', {})
    return Response.json(response, { headers })
  }
  
  // Get noise reduction statistics
  if (path === '/events/stats' && req.method === 'GET') {
    const response = await requestFromBrowser('semantic', 'stats', {})
    return Response.json(response, { headers })
  }
  
  // Inspect element (detailed view)
  if (path === '/inspect' && req.method === 'GET') {
    return wrongMethod('/inspect', 'POST', headers)
  }
  if (path === '/inspect' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'selector', type: 'string', required: true },
      { name: 'window', type: 'string' }
    ], '/inspect')
    if (!validation.valid) return validationError(validation, headers)
    
    const response = await requestFromBrowser('dom', 'inspect', { selector: body.selector })
    return Response.json(response, { headers })
  }
  
  // Inspect multiple elements
  if (path === '/inspectAll' && req.method === 'GET') {
    return wrongMethod('/inspectAll', 'POST', headers)
  }
  if (path === '/inspectAll' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'selector', type: 'string', required: true },
      { name: 'limit', type: 'number' },
      { name: 'window', type: 'string' }
    ], '/inspectAll')
    if (!validation.valid) return validationError(validation, headers)
    
    const response = await requestFromBrowser('dom', 'inspectAll', { 
      selector: body.selector, 
      limit: body.limit || 10 
    })
    return Response.json(response, { headers })
  }
  
  // Highlight element (visual pointer)
  if (path === '/highlight' && req.method === 'GET') {
    return wrongMethod('/highlight', 'POST', headers)
  }
  if (path === '/highlight' && req.method === 'POST') {
    const body = await req.json()
    const validation = validateBody(body, [
      { name: 'selector', type: 'string', required: true },
      { name: 'label', type: 'string' },
      { name: 'color', type: 'string' },
      { name: 'duration', type: 'number' },
      { name: 'window', type: 'string' }
    ], '/highlight')
    if (!validation.valid) return validationError(validation, headers)
    
    // Scroll element into view first
    await requestFromBrowser('eval', 'exec', {
      code: `document.querySelector(${JSON.stringify(body.selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
    })
    await new Promise(r => setTimeout(r, 100))
    
    const response = await requestFromBrowser('dom', 'highlight', {
      selector: body.selector,
      label: body.label,
      color: body.color,
      duration: body.duration,  // If set, will auto-hide after duration ms
    })
    return Response.json(response, { headers })
  }
  
  // Remove highlight
  if (path === '/unhighlight' && req.method === 'POST') {
    const response = await requestFromBrowser('dom', 'unhighlight', {})
    return Response.json(response, { headers })
  }
  
  // DOM tree inspector
  // POST /tree { selector, depth?, includeText?, allAttributes?, includeBox?, compact?, pierceShadow?, ... }
  if (path === '/tree' && req.method === 'GET') {
    return wrongMethod('/tree', 'POST', headers)
  }
  if (path === '/tree' && req.method === 'POST') {
    const body = await req.json()
    // /tree has many optional fields, just validate types if present
    const validation = validateBody(body, [
      { name: 'selector', type: 'string' },
      { name: 'depth', type: 'number' },
      { name: 'mode', type: 'string' },
      { name: 'window', type: 'string' }
    ], '/tree')
    if (!validation.valid) return validationError(validation, headers)
    
    const response = await requestFromBrowser('dom', 'tree', {
      selector: body.selector || 'body',
      depth: body.depth,
      includeText: body.includeText,
      allAttributes: body.allAttributes,
      includeStyles: body.includeStyles,
      includeBox: body.includeBox,
      interestingClasses: body.interestingClasses,
      interestingAttributes: body.interestingAttributes,
      ignoreSelectors: body.ignoreSelectors,
      compact: body.compact,
      pierceShadow: body.pierceShadow,
      visibleOnly: body.visibleOnly,
      mode: body.mode,
    })
    return Response.json(response, { headers })
  }
  
  // Screenshot - capture page as base64 image
  // In Electron: uses native capture (best quality, works on any page)
  // In browser: uses html2canvas if loaded, otherwise returns viewport info only
  if (path === '/screenshot' && req.method === 'GET') {
    return wrongMethod('/screenshot', 'POST', headers)
  }
  if (path === '/screenshot' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const response = await requestFromBrowser('dom', 'screenshot', {
      selector: body.selector,    // CSS selector for element capture (omit for full page)
      format: body.format,        // 'png' (default), 'webp' (smaller), 'jpeg' (smallest)
      quality: body.quality,      // 0-1, default 0.85 for webp/jpeg
      scale: body.scale,          // Scale factor (0.5 = half size)
      maxWidth: body.maxWidth,    // Max width constraint (maintains aspect ratio)
      maxHeight: body.maxHeight,  // Max height constraint (maintains aspect ratio)
    })
    return Response.json(response, { headers })
  }
  
  // ==========================================
  // Test Runner Endpoints
  // ==========================================
  
  // Validate a test (check all selectors exist without executing actions)
  if (path === '/test/validate' && req.method === 'POST') {
    const test = await req.json() as DevChannelTest
    const issues: Array<{ step: number; selector: string; error: string }> = []
    
    for (let i = 0; i < test.steps.length; i++) {
      const step = test.steps[i]
      let selector: string | undefined
      
      // Extract selector from step
      if ('selector' in step) {
        selector = step.selector
      } else if (step.action === 'assert' && 'selector' in step.assertion) {
        selector = step.assertion.selector
      }
      
      if (selector) {
        const response = await requestFromBrowser('dom', 'query', { selector })
        if (!response.success || !response.data) {
          issues.push({
            step: i,
            selector,
            error: `Element not found: ${selector}`,
          })
        }
      }
    }
    
    return Response.json({
      valid: issues.length === 0,
      issues,
      stepCount: test.steps.length,
    }, { headers })
  }

  // Helper: Check if actual value matches a VerifyExpectation
  function matchesExpectation(actual: any, expect: VerifyExpectation): boolean {
    // Handle null/undefined
    if (expect === null) return actual === null
    if (expect === undefined) return actual === undefined

    // Check for expectation objects with specific matchers
    if (typeof expect === 'object' && expect !== null) {
      // { equals: value } - explicit exact match
      if ('equals' in expect) {
        return JSON.stringify(actual) === JSON.stringify(expect.equals)
      }

      // { matches: "regex" } - regex for strings
      if ('matches' in expect) {
        if (typeof actual !== 'string') return false
        return new RegExp(expect.matches).test(actual)
      }

      // { contains: value } - subset match for objects/arrays
      if ('contains' in expect) {
        if (Array.isArray(actual) && Array.isArray(expect.contains)) {
          // Every item in expected should exist in actual
          return expect.contains.every((expectedItem: any) =>
            actual.some((actualItem: any) =>
              JSON.stringify(actualItem) === JSON.stringify(expectedItem) ||
              (typeof expectedItem === 'object' && matchesExpectation(actualItem, { contains: expectedItem }))
            )
          )
        }
        if (typeof actual === 'object' && actual !== null && typeof expect.contains === 'object') {
          // Every key in expected should match in actual
          for (const key of Object.keys(expect.contains)) {
            if (!(key in actual)) return false
            const expectedVal = expect.contains[key]
            const actualVal = actual[key]
            // Recursively check nested objects
            if (typeof expectedVal === 'object' && expectedVal !== null) {
              if (!matchesExpectation(actualVal, { contains: expectedVal })) return false
            } else if (actualVal !== expectedVal) {
              return false
            }
          }
          return true
        }
        // For strings, check if actual contains expected
        if (typeof actual === 'string' && typeof expect.contains === 'string') {
          return actual.includes(expect.contains)
        }
        return false
      }

      // { truthy: true } - value is truthy
      if ('truthy' in expect && expect.truthy === true) {
        return !!actual
      }

      // { falsy: true } - value is falsy
      if ('falsy' in expect && expect.falsy === true) {
        return !actual
      }

      // { gt: n } - greater than
      if ('gt' in expect) {
        return typeof actual === 'number' && actual > expect.gt
      }

      // { gte: n } - greater than or equal
      if ('gte' in expect) {
        return typeof actual === 'number' && actual >= expect.gte
      }

      // { lt: n } - less than
      if ('lt' in expect) {
        return typeof actual === 'number' && actual < expect.lt
      }

      // { lte: n } - less than or equal
      if ('lte' in expect) {
        return typeof actual === 'number' && actual <= expect.lte
      }

      // No special matcher found - fall through to deep equality
    }

    // Default: deep equality via JSON comparison
    return JSON.stringify(actual) === JSON.stringify(expect)
  }

  // Helper: Wait for browser to reconnect after navigation
  async function waitForBrowserReconnect(timeoutMs = 10000): Promise<boolean> {
    const start = Date.now()
    // First, wait a moment for disconnect to happen
    await new Promise(r => setTimeout(r, 100))
    
    while (Date.now() - start < timeoutMs) {
      if (browsers.size > 0) {
        // Give widget time to fully initialize after reconnect
        await new Promise(r => setTimeout(r, 300))
        return true
      }
      await new Promise(r => setTimeout(r, 100))
    }
    return false
  }
  
  // Run a test and return results
  if (path === '/test/run' && req.method === 'POST') {
    const body = await req.json()
    const test = body.test as DevChannelTest
    const options = {
      stepDelay: body.stepDelay ?? 100,  // ms between steps
      timeout: body.timeout ?? 5000,      // ms timeout per step
      stopOnFailure: body.stopOnFailure ?? true,
    }
    
    const startTime = Date.now()
    const stepResults: StepResult[] = []
    let passed = true
    
    for (let i = 0; i < test.steps.length; i++) {
      const step = test.steps[i]
      const stepStart = Date.now()
      let stepPassed = true
      let error: string | undefined
      let context: Record<string, any> | undefined
      
      // Apply step delay
      if (step.delay || options.stepDelay) {
        await new Promise(r => setTimeout(r, step.delay || options.stepDelay))
      }
      
      try {
        switch (step.action) {
          case 'navigate': {
            const response = await requestFromBrowser('navigation', 'goto', { url: step.url }, options.timeout)
            if (!response.success) {
              stepPassed = false
              error = response.error || 'Navigation failed'
              break
            }
            // Wait for browser to reconnect after page load (widget reloads)
            const reconnected = await waitForBrowserReconnect(options.timeout)
            if (!reconnected) {
              stepPassed = false
              error = 'Browser did not reconnect after navigation'
            }
            break
          }
          
          case 'click': {
            // Scroll into view
            await requestFromBrowser('eval', 'exec', {
              code: `document.querySelector(${JSON.stringify(step.selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
            })
            await new Promise(r => setTimeout(r, 100))
            
            // Check element exists and is clickable
            const inspectResponse = await requestFromBrowser('dom', 'inspect', { selector: step.selector })
            if (!inspectResponse.success || !inspectResponse.data) {
              stepPassed = false
              error = `Element not found: ${step.selector}`
              break
            }
            
            const elData = inspectResponse.data
            if (elData.properties?.disabled) {
              stepPassed = false
              error = 'Element is disabled'
              context = { disabled: true }
              break
            }
            
            // Click
            for (const event of ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
              await requestFromBrowser('events', 'dispatch', { selector: step.selector, event })
            }
            break
          }
          
          case 'type': {
            // Scroll into view
            await requestFromBrowser('eval', 'exec', {
              code: `document.querySelector(${JSON.stringify(step.selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
            })
            await new Promise(r => setTimeout(r, 100))
            
            // Check element exists
            const inspectResponse = await requestFromBrowser('dom', 'inspect', { selector: step.selector })
            if (!inspectResponse.success || !inspectResponse.data) {
              stepPassed = false
              error = `Element not found: ${step.selector}`
              break
            }
            
            // Clear if needed
            if (step.clear !== false) {
              await requestFromBrowser('eval', 'exec', {
                code: `document.querySelector(${JSON.stringify(step.selector)}).value = ''`
              })
            }
            
            // Focus and type
            await requestFromBrowser('eval', 'exec', {
              code: `document.querySelector(${JSON.stringify(step.selector)})?.focus()`
            })
            
            // Set value and fire input event
            await requestFromBrowser('eval', 'exec', {
              code: `(function(){
                const el = document.querySelector(${JSON.stringify(step.selector)});
                if (el) { 
                  el.value = ${JSON.stringify(step.text)}; 
                  el.dispatchEvent(new InputEvent('input', {bubbles: true})); 
                }
              })()`
            })
            break
          }
          
          case 'key': {
            await requestFromBrowser('events', 'dispatch', {
              selector: 'body',
              event: 'keydown',
              options: {
                key: step.key,
                altKey: step.modifiers?.alt,
                ctrlKey: step.modifiers?.ctrl,
                metaKey: step.modifiers?.meta,
                shiftKey: step.modifiers?.shift,
              },
            })
            break
          }
          
          case 'wait': {
            if (step.duration) {
              await new Promise(r => setTimeout(r, step.duration))
            } else if (step.selector) {
              // Wait for selector to appear
              const waitStart = Date.now()
              let found = false
              while (Date.now() - waitStart < options.timeout) {
                const response = await requestFromBrowser('dom', 'query', { selector: step.selector })
                if (response.success && response.data) {
                  found = true
                  break
                }
                await new Promise(r => setTimeout(r, 100))
              }
              if (!found) {
                stepPassed = false
                error = `Timeout waiting for selector: ${step.selector}`
              }
            } else if (step.url) {
              // Wait for URL to match
              const waitStart = Date.now()
              let matched = false
              const pattern = typeof step.url === 'string' ? step.url : step.url.source
              while (Date.now() - waitStart < options.timeout) {
                const response = await requestFromBrowser('navigation', 'location', {})
                if (response.success && response.data) {
                  const url = response.data.url || response.data.href
                  if (url.includes(pattern) || new RegExp(pattern).test(url)) {
                    matched = true
                    break
                  }
                }
                await new Promise(r => setTimeout(r, 100))
              }
              if (!matched) {
                stepPassed = false
                error = `Timeout waiting for URL to match: ${pattern}`
                const locResponse = await requestFromBrowser('navigation', 'location', {})
                context = { actualUrl: locResponse.data?.url || locResponse.data?.href }
              }
            }
            break
          }
          
          case 'assert': {
            const assertion = step.assertion
            
            switch (assertion.type) {
              case 'exists': {
                const response = await requestFromBrowser('dom', 'query', { selector: assertion.selector })
                if (!response.success || !response.data) {
                  stepPassed = false
                  error = `Element does not exist: ${assertion.selector}`
                }
                break
              }
              
              case 'not-exists': {
                const response = await requestFromBrowser('dom', 'query', { selector: assertion.selector })
                if (response.success && response.data) {
                  stepPassed = false
                  error = `Element should not exist: ${assertion.selector}`
                }
                break
              }
              
              case 'text': {
                const response = await requestFromBrowser('dom', 'inspect', { selector: assertion.selector })
                if (!response.success || !response.data) {
                  stepPassed = false
                  error = `Element not found: ${assertion.selector}`
                  break
                }
                const actualText = response.data.text?.innerText || response.data.text?.textContent || ''
                const matches = assertion.contains 
                  ? actualText.includes(assertion.text)
                  : actualText.trim() === assertion.text.trim()
                if (!matches) {
                  stepPassed = false
                  error = assertion.contains 
                    ? `Text "${actualText}" does not contain "${assertion.text}"`
                    : `Text mismatch: expected "${assertion.text}", got "${actualText}"`
                  context = { expected: assertion.text, actual: actualText }
                }
                break
              }
              
              case 'value': {
                const response = await requestFromBrowser('dom', 'inspect', { selector: assertion.selector })
                if (!response.success || !response.data) {
                  stepPassed = false
                  error = `Element not found: ${assertion.selector}`
                  break
                }
                const actualValue = response.data.text?.value || ''
                if (actualValue !== assertion.value) {
                  stepPassed = false
                  error = `Value mismatch: expected "${assertion.value}", got "${actualValue}"`
                  context = { expected: assertion.value, actual: actualValue }
                }
                break
              }
              
              case 'visible': {
                const response = await requestFromBrowser('dom', 'inspect', { selector: assertion.selector })
                if (!response.success || !response.data) {
                  stepPassed = false
                  error = `Element not found: ${assertion.selector}`
                  break
                }
                if (!response.data.box?.visible || response.data.styles?.visibility === 'hidden' || response.data.styles?.display === 'none') {
                  stepPassed = false
                  error = `Element is not visible: ${assertion.selector}`
                  context = { 
                    display: response.data.styles?.display,
                    visibility: response.data.styles?.visibility,
                    inViewport: response.data.box?.visible,
                  }
                }
                break
              }
              
              case 'hidden': {
                const response = await requestFromBrowser('dom', 'inspect', { selector: assertion.selector })
                // Element not existing counts as hidden
                if (!response.success || !response.data) break
                
                if (response.data.box?.visible && response.data.styles?.visibility !== 'hidden' && response.data.styles?.display !== 'none') {
                  stepPassed = false
                  error = `Element is visible but should be hidden: ${assertion.selector}`
                }
                break
              }
              
              case 'url': {
                const response = await requestFromBrowser('navigation', 'location', {})
                if (!response.success) {
                  stepPassed = false
                  error = 'Could not get current URL'
                  break
                }
                const url = response.data?.url || response.data?.href || ''
                if (!url.includes(assertion.pattern) && !new RegExp(assertion.pattern).test(url)) {
                  stepPassed = false
                  error = `URL does not match pattern "${assertion.pattern}"`
                  context = { actualUrl: url, pattern: assertion.pattern }
                }
                break
              }
              
              case 'title': {
                const response = await requestFromBrowser('navigation', 'location', {})
                if (!response.success) {
                  stepPassed = false
                  error = 'Could not get page title'
                  break
                }
                const title = response.data?.title || ''
                if (!title.includes(assertion.pattern) && !new RegExp(assertion.pattern).test(title)) {
                  stepPassed = false
                  error = `Title does not match pattern "${assertion.pattern}"`
                  context = { actualTitle: title, pattern: assertion.pattern }
                }
                break
              }
              
              case 'console-contains': {
                const response = await requestFromBrowser('console', 'get', { since: 0 })
                if (!response.success) {
                  stepPassed = false
                  error = 'Could not get console entries'
                  break
                }
                const entries = response.data || []
                const filtered = assertion.level 
                  ? entries.filter((e: any) => e.level === assertion.level)
                  : entries
                const found = filtered.some((e: any) => 
                  e.args?.some((arg: any) => 
                    String(arg).includes(assertion.text)
                  )
                )
                if (!found) {
                  stepPassed = false
                  error = `Console does not contain "${assertion.text}"${assertion.level ? ` at level ${assertion.level}` : ''}`
                }
                break
              }
              
              case 'eval': {
                const response = await requestFromBrowser('eval', 'exec', { code: assertion.code })
                if (!response.success) {
                  stepPassed = false
                  error = response.error || 'Eval failed'
                  break
                }
                if (response.data !== assertion.expected) {
                  stepPassed = false
                  error = `Eval result mismatch`
                  context = { expected: assertion.expected, actual: response.data }
                }
                break
              }
            }
            break
          }
          
          case 'eval': {
            const response = await requestFromBrowser('eval', 'exec', { code: step.code }, options.timeout)
            if (!response.success) {
              stepPassed = false
              error = response.error || 'Eval failed'
              break
            }
            if (step.expect !== undefined && response.data !== step.expect) {
              stepPassed = false
              error = 'Eval result did not match expected value'
              context = { expected: step.expect, actual: response.data }
            }
            break
          }

          case 'verify': {
            const verifyStep = step as VerifyStep
            const timeout = verifyStep.timeout ?? 5000
            const interval = verifyStep.interval ?? 100
            const deadline = Date.now() + timeout
            let lastActual: any
            let matched = false

            while (Date.now() < deadline) {
              // Wrap expression to support async and handle errors
              const wrappedCode = `(async () => { try { return await (${verifyStep.eval}); } catch(e) { return { __error: e.message }; } })()`
              const response = await requestFromBrowser('eval', 'exec', { code: wrappedCode }, Math.min(interval * 2, 2000))
              
              if (response.success) {
                lastActual = response.data
                
                // Check for eval error
                if (lastActual && typeof lastActual === 'object' && '__error' in lastActual) {
                  // Expression threw - keep polling in case it's a timing issue
                  await new Promise(r => setTimeout(r, interval))
                  continue
                }

                if (matchesExpectation(lastActual, verifyStep.expect)) {
                  matched = true
                  break
                }
              }
              
              await new Promise(r => setTimeout(r, interval))
            }

            if (!matched) {
              stepPassed = false
              error = `Verify timeout after ${timeout}ms: expression did not match expected value`
              context = { 
                expression: verifyStep.eval,
                expected: verifyStep.expect, 
                actual: lastActual,
                timeout
              }
            }
            break
          }
        }
      } catch (err) {
        stepPassed = false
        error = err instanceof Error ? err.message : String(err)
      }
      
      // Capture snapshot on failure
      let stepSnapshotId: string | undefined
      if (!stepPassed) {
        stepSnapshotId = await captureSnapshot('test-failure', {
          testName: test.name,
          stepIndex: i,
          stepDescription: step.description,
          error,
        })
      }
      
      stepResults.push({
        index: i,
        step,
        passed: stepPassed,
        duration: Date.now() - stepStart,
        error,
        description: step.description,
        purpose: step.purpose,
        context,
        snapshotId: stepSnapshotId,
      })
      
      if (!stepPassed) {
        passed = false
        if (options.stopOnFailure) break
      }
    }
    
    // Capture final snapshot if test failed
    let testSnapshotId: string | undefined
    if (!passed) {
      testSnapshotId = await captureSnapshot('test-failure', {
        testName: test.name,
        error: stepResults.find(s => !s.passed)?.error,
      })
    }
    
    return Response.json({
      test: test.name,
      passed,
      duration: Date.now() - startTime,
      snapshotId: testSnapshotId,
      steps: stepResults,
      summary: {
        total: test.steps.length,
        executed: stepResults.length,
        passed: stepResults.filter(s => s.passed).length,
        failed: stepResults.filter(s => !s.passed).length,
      },
    }, { headers })
  }
  
  // Run a test suite (multiple tests)
  if (path === '/test/suite' && req.method === 'POST') {
    const body = await req.json()
    const tests = body.tests as DevChannelTest[]
    const options = {
      testDelay: body.testDelay ?? 500,  // ms between tests
      stepDelay: body.stepDelay ?? 100,
      timeout: body.timeout ?? 5000,
      stopOnFailure: body.stopOnFailure ?? false,  // continue to next test by default
    }
    
    const suiteStart = Date.now()
    const results: any[] = []
    
    for (const test of tests) {
      // Run the test by making internal request
      const testResult = await handleRest(new Request(`http://localhost/test/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test, ...options }),
      }))
      
      const result = await testResult.json()
      results.push(result)
      
      if (!result.passed && options.stopOnFailure) break
      
      // Delay between tests
      await new Promise(r => setTimeout(r, options.testDelay))
    }
    
    return Response.json({
      duration: Date.now() - suiteStart,
      results,
      summary: {
        total: tests.length,
        executed: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
      },
    }, { headers })
  }
  
  // ============================================
  // Snapshot endpoints
  // ============================================
  
  // Capture a snapshot of current page state
  if (path === '/snapshot' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const trigger = body.trigger || 'manual'
    const context = body.context || {}
    
    try {
      // Get current location
      const locationResponse = await requestFromBrowser('navigation', 'location', {})
      if (!locationResponse.success) {
        return Response.json({ error: 'No browser connected' }, { status: 503, headers })
      }
      
      // Get DOM tree
      const treeResponse = await requestFromBrowser('dom', 'tree', { 
        selector: 'body', 
        depth: 5,
        compact: true 
      })
      
      // Get console logs
      const consoleResponse = await requestFromBrowser('console', 'get', {})
      
      // Get viewport
      const viewportResponse = await requestFromBrowser('eval', 'exec', {
        code: 'JSON.stringify({width: window.innerWidth, height: window.innerHeight})'
      })
      
      const snapshotId = `snap_${Date.now()}_${uid()}`
      const snapshot: PageSnapshot = {
        id: snapshotId,
        timestamp: Date.now(),
        url: locationResponse.data?.url || '',
        title: locationResponse.data?.title || '',
        tree: treeResponse.data || { tag: 'body', text: '[unavailable]' },
        console: consoleResponse.data || [],
        viewport: viewportResponse.success ? JSON.parse(viewportResponse.data) : { width: 0, height: 0 },
        trigger,
        context,
      }
      
      // Store snapshot (with eviction if over limit)
      if (snapshots.size >= MAX_SNAPSHOTS) {
        const oldest = snapshots.keys().next().value
        if (oldest) snapshots.delete(oldest)
      }
      snapshots.set(snapshotId, snapshot)
      saveSnapshotToDisk(snapshot)
      
      return Response.json({ 
        snapshotId,
        timestamp: snapshot.timestamp,
        url: snapshot.url,
        title: snapshot.title,
      }, { headers })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500, headers })
    }
  }
  
  // Get a snapshot by ID
  if (path.startsWith('/snapshot/') && req.method === 'GET') {
    const snapshotId = path.slice('/snapshot/'.length)
    const snapshot = snapshots.get(snapshotId)
    
    if (!snapshot) {
      return Response.json({ error: 'Snapshot not found' }, { status: 404, headers })
    }
    
    return Response.json(snapshot, { headers })
  }
  
  // List all snapshots (metadata only)
  if (path === '/snapshots' && req.method === 'GET') {
    const list = Array.from(snapshots.values()).map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      url: s.url,
      title: s.title,
      trigger: s.trigger,
    }))
    return Response.json(list, { headers })
  }
  
  // Delete a snapshot
  if (path.startsWith('/snapshot/') && req.method === 'DELETE') {
    const snapshotId = path.slice('/snapshot/'.length)
    const deleted = snapshots.delete(snapshotId)
    return Response.json({ deleted }, { headers })
  }
  
  // ==========================================
  // RECORDINGS (user-created test recordings)
  // ==========================================
  
  // List all recordings (metadata only)
  if (path === '/recordings' && req.method === 'GET') {
    const list = Array.from(recordings.values()).map(r => ({
      id: r.id,
      url: r.url,
      title: r.title,
      startTime: r.startTime,
      endTime: r.endTime,
      duration: r.endTime - r.startTime,
      eventCount: r.events.length,
      createdAt: r.createdAt,
    }))
    return Response.json(list, { headers })
  }
  
  // Get a recording by ID (full events included)
  if (path.startsWith('/recording/') && req.method === 'GET') {
    const recordingId = path.slice('/recording/'.length)
    const recording = recordings.get(recordingId)
    
    if (!recording) {
      return Response.json({ error: 'Recording not found' }, { status: 404, headers })
    }
    return Response.json(recording, { headers })
  }
  
  // Delete a recording
  if (path.startsWith('/recording/') && req.method === 'DELETE') {
    const recordingId = path.slice('/recording/'.length)
    const deleted = recordings.delete(recordingId)
    return Response.json({ deleted }, { headers })
  }
  
  // ==========================================
  // Selection Tool Endpoints
  // ==========================================
  
  // POST /select/start - Start selection mode (user drags to select area)
  if (path === '/select/start' && req.method === 'POST') {
    const response = await requestFromBrowser('selection', 'start', {})
    return Response.json(response, { headers })
  }
  
  // POST /select/cancel - Cancel selection mode
  if (path === '/select/cancel' && req.method === 'POST') {
    const response = await requestFromBrowser('selection', 'cancel', {})
    return Response.json(response, { headers })
  }
  
  // GET /select/status - Check if selection is active or has result
  if (path === '/select/status' && req.method === 'GET') {
    const response = await requestFromBrowser('selection', 'status', {})
    return Response.json(response, { headers })
  }
  
  // GET /select/result - Get the current selection result
  if (path === '/select/result' && req.method === 'GET') {
    const response = await requestFromBrowser('selection', 'result', {})
    return Response.json(response, { headers })
  }
  
  // POST /select/clear - Clear the stored selection
  if (path === '/select/clear' && req.method === 'POST') {
    const response = await requestFromBrowser('selection', 'clear', {})
    return Response.json(response, { headers })
  }
  
  // ==========================================
  // Window Management Endpoints
  // ==========================================
  
  // GET /windows - List all connected windows
  if (path === '/windows' && req.method === 'GET') {
    const windowList = Array.from(windows.values()).map(w => ({
      id: w.id,
      url: w.url,
      title: w.title,
      active: w.active,
      connectedAt: w.connectedAt,
      lastSeen: w.lastSeen,
      label: w.label,
      windowType: w.windowType || 'tab',
    }))
    return Response.json({
      windows: windowList,
      focused: focusedWindowId,
      count: windowList.length,
    }, { headers })
  }
  
  // GET /windows/:id - Get specific window info
  if (path.startsWith('/windows/') && req.method === 'GET' && !path.includes('/focus') && !path.includes('/activate') && !path.includes('/deactivate') && !path.includes('/label')) {
    const windowId = path.slice('/windows/'.length)
    const win = windows.get(windowId)
    
    if (!win) {
      return Response.json({ error: 'Window not found' }, { status: 404, headers })
    }
    
    return Response.json({
      id: win.id,
      url: win.url,
      title: win.title,
      active: win.active,
      connectedAt: win.connectedAt,
      lastSeen: win.lastSeen,
      label: win.label,
      focused: focusedWindowId === win.id,
    }, { headers })
  }
  
  // POST /windows/:id/focus - Focus a window (bring to front and make active)
  if (path.match(/^\/windows\/[^/]+\/focus$/) && req.method === 'POST') {
    const windowId = path.split('/')[2]
    const win = windows.get(windowId)
    
    if (!win) {
      return Response.json({ error: 'Window not found' }, { status: 404, headers })
    }
    
    // Set as focused
    focusedWindowId = windowId
    
    // Send focus command to the browser
    const msg: DevMessage = {
      id: uid(),
      channel: 'system',
      action: 'focus',
      payload: { windowId },
      timestamp: Date.now(),
      source: 'server',
    }
    win.ws.send(JSON.stringify(msg))
    
    return Response.json({ 
      success: true, 
      windowId, 
      focused: true 
    }, { headers })
  }
  
  // POST /windows/:id/activate - Activate a window (respond to commands)
  if (path.match(/^\/windows\/[^/]+\/activate$/) && req.method === 'POST') {
    const windowId = path.split('/')[2]
    const win = windows.get(windowId)
    
    if (!win) {
      return Response.json({ error: 'Window not found' }, { status: 404, headers })
    }
    
    win.active = true
    
    const msg: DevMessage = {
      id: uid(),
      channel: 'system',
      action: 'activate',
      payload: { windowId },
      timestamp: Date.now(),
      source: 'server',
    }
    win.ws.send(JSON.stringify(msg))
    
    return Response.json({ 
      success: true, 
      windowId, 
      active: true 
    }, { headers })
  }
  
  // POST /windows/:id/deactivate - Deactivate a window (stop responding to untargeted commands)
  if (path.match(/^\/windows\/[^/]+\/deactivate$/) && req.method === 'POST') {
    const windowId = path.split('/')[2]
    const win = windows.get(windowId)
    
    if (!win) {
      return Response.json({ error: 'Window not found' }, { status: 404, headers })
    }
    
    win.active = false
    
    const msg: DevMessage = {
      id: uid(),
      channel: 'system',
      action: 'deactivate',
      payload: { windowId },
      timestamp: Date.now(),
      source: 'server',
    }
    win.ws.send(JSON.stringify(msg))
    
    return Response.json({ 
      success: true, 
      windowId, 
      active: false 
    }, { headers })
  }
  
  // POST /windows/:id/label - Set a label for a window
  if (path.match(/^\/windows\/[^/]+\/label$/) && req.method === 'POST') {
    const windowId = path.split('/')[2]
    const win = windows.get(windowId)
    
    if (!win) {
      return Response.json({ error: 'Window not found' }, { status: 404, headers })
    }
    
    try {
      const body = await req.json() as { label?: string }
      win.label = body.label
      return Response.json({ 
        success: true, 
        windowId, 
        label: win.label 
      }, { headers })
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers })
    }
  }
  
  return Response.json({ error: 'Not found' }, { status: 404, headers })
}

// Shared server config
const serverConfig = {
  fetch(req: Request, server: any) {
    const url = new URL(req.url)
    
    // WebSocket upgrade
    if (url.pathname === '/ws/browser') {
      const upgraded = server.upgrade(req, { data: { type: 'browser' } })
      return upgraded ? undefined : new Response('Upgrade failed', { status: 500 })
    }
    
    if (url.pathname === '/ws/agent') {
      const upgraded = server.upgrade(req, { data: { type: 'agent' } })
      return upgraded ? undefined : new Response('Upgrade failed', { status: 500 })
    }
    
    // REST API
    return handleRest(req)
  },
  
  websocket: {
    open(ws: { data: { type: string }, send: (msg: string) => void }) {
      const type = ws.data?.type
      if (type === 'browser') {
        // Add with temporary ID - will be updated when we get the 'connected' message
        const newWs = ws as unknown as WebSocket
        browsers.set(newWs, uid())
      } else if (type === 'agent') {
        agents.add(ws as unknown as WebSocket)
        
        // Send buffered messages to new agent
        for (const msg of messageBuffer) {
          ws.send(JSON.stringify(msg))
        }
      }
    },
    
    message(ws: { data: { type: string } }, message: string | Buffer) {
      const type = ws.data?.type
      const wsTyped = ws as unknown as WebSocket
      
      // Track browser IDs and windows when they send 'connected' message
      if (type === 'browser') {
        try {
          const data = JSON.parse(message.toString())
          if (data.channel === 'system' && data.action === 'connected' && data.payload?.browserId) {
            const { windowId, browserId, url, title, active, windowType } = data.payload
            
            browsers.set(wsTyped, browserId)
            activeBrowserId = browserId
            
            // Track window info
            if (windowId) {
              const existingWindow = windows.get(windowId)
              const now = Date.now()
              
              // If window already exists with different websocket, close old one
              if (existingWindow && existingWindow.ws !== wsTyped) {
                try { existingWindow.ws.close() } catch {}
              }
              
              windows.set(windowId, {
                id: windowId,
                browserId,
                ws: wsTyped,
                url: url || '',
                title: title || '',
                active: active !== false, // Default to active
                connectedAt: existingWindow?.connectedAt || now,
                lastSeen: now,
                label: existingWindow?.label,
                windowType: windowType || 'tab', // 'tab', 'popup', or 'iframe'
              })
              
              // Set as focused if no window is focused, or if this was previously focused
              if (!focusedWindowId || focusedWindowId === windowId) {
                focusedWindowId = windowId
              }
              
              console.log(`${LOG_PREFIX} Window connected: ${windowId} (${url})`)
            }
            
            // Check if widget has the correct server session ID
            const widgetSessionId = data.payload.serverSessionId
            if (widgetSessionId && widgetSessionId !== SERVER_SESSION_ID) {
              // Widget is from a different server session - tell it to reload
              console.log(`${LOG_PREFIX} Widget session mismatch (${widgetSessionId} vs ${SERVER_SESSION_ID}), sending reload`)
              wsTyped.send(JSON.stringify({
                id: uid(),
                channel: 'system',
                action: 'reload',
                payload: { reason: 'session_mismatch' },
                timestamp: Date.now(),
                source: 'server'
              }))
            }
          }
          
          // Handle window-updated messages (URL/title changes)
          if (data.channel === 'system' && data.action === 'window-updated' && data.payload?.windowId) {
            const { windowId, url, title } = data.payload
            const win = windows.get(windowId)
            if (win) {
              win.url = url || win.url
              win.title = title || win.title
              win.lastSeen = Date.now()
            }
          }
          
          // Handle window-state messages (active/inactive changes)
          if (data.channel === 'system' && data.action === 'window-state' && data.payload?.windowId) {
            const { windowId, active } = data.payload
            const win = windows.get(windowId)
            if (win) {
              win.active = active
              win.lastSeen = Date.now()
            }
          }
        } catch {}
      }
      
      handleMessage(wsTyped, message.toString(), type === 'browser')
    },
    
    close(ws: { data: { type: string } }) {
      const type = ws.data?.type
      if (type === 'browser') {
        const wsTyped = ws as unknown as WebSocket
        const browserId = browsers.get(wsTyped)
        browsers.delete(wsTyped)
        if (browserId === activeBrowserId) {
          activeBrowserId = null
        }
        
        // Clean up window tracking
        for (const [windowId, win] of windows) {
          if (win.ws === wsTyped) {
            windows.delete(windowId)
            console.log(`${LOG_PREFIX} Window disconnected: ${windowId}`)
            if (focusedWindowId === windowId) {
              // Focus next available window
              focusedWindowId = windows.size > 0 ? windows.keys().next().value : null
            }
            break
          }
        }
      } else if (type === 'agent') {
        agents.delete(ws as unknown as WebSocket)
      }
    },
  },
}

// Start servers based on mode
let httpServer: ReturnType<typeof Bun.serve> | null = null
let httpsServer: ReturnType<typeof Bun.serve> | null = null

if (USE_HTTP) {
  httpServer = Bun.serve({
    port: PORT,
    ...serverConfig,
  })
}

if (USE_HTTPS) {
  httpsServer = Bun.serve({
    port: HTTPS_PORT,
    tls: {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
    },
    ...serverConfig,
  })
}

// Build URLs for display
const httpUrl = USE_HTTP ? `http://localhost:${PORT}` : null
const httpsUrl = USE_HTTPS ? `https://localhost:${HTTPS_PORT}` : null
const primaryUrl = httpsUrl || httpUrl

console.log(`
================================================================================
  ${PRODUCT_NAME} v${VERSION} - Browser Control for AI Agents
================================================================================
`)

if (httpUrl) {
  console.log(`  HTTP:      ${httpUrl}`)
}
if (httpsUrl) {
  console.log(`  HTTPS:     ${httpsUrl}`)
}

console.log(`
  To connect: Visit the server URL and drag the bookmarklet to your toolbar.
              The bookmarklet auto-detects HTTP/HTTPS based on the target page.

  DEV MODE:   Paste this one-liner in your code (auto-disabled in production):

              /^localhost$|^127\\./.test(location.hostname)&&import('${primaryUrl}/dev.js')

  AI AGENTS:  curl ${primaryUrl}/docs

================================================================================
`)

if (USE_HTTPS && !httpUrl) {
  console.log(`  Note: First visit ${httpsUrl} in your browser to accept the certificate.\n`)
}

if (MODE === 'both') {
  console.log(`  Mode: both - Use HTTP (${PORT}) for HTTP sites, HTTPS (${HTTPS_PORT}) for HTTPS sites.\n`)
}

// Export the primary server (HTTPS preferred)
const server = httpsServer || httpServer!
export { server, httpServer, httpsServer, PORT, HTTPS_PORT, USE_HTTP, USE_HTTPS }
