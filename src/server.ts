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
import type { SelectionElement } from './agent-message-format'
import { injectorCode } from './bookmarklet'
import { VERSION } from './version'
import { generateTestPage } from './test-page'
import { ICON_SVG, API_MD, DOCS_MD, LLMS_TXT, COMPONENT_JS } from './embedded-assets'
import * as api from './api-schema'
import { SCHEMA_FINGERPRINT, computeSchemaFingerprint } from './api-schema'
import { formatTestGitHub, formatTestHuman, formatSuiteGitHub, formatSuiteHuman, inferSuggestion, type OutputFormat, type TestRunResult, type SuiteRunResult } from './test-formatters'
import { createRouter, type ContextFactory } from './api-router'
import type { HandlerContext } from './api-handlers'
import { register as registerNamedInstance, unregister as unregisterNamedInstance, autoNameFor, list as listInstances } from './sessions'
import { isOlderThan } from './semver'
import { candidatePorts, planForServer, type ServerProbe } from './legacy-servers'
import { createTerminalState, updateStatus, removeStatus, getStatusLine, pushMessage, getPushMessages, loadConfig, dispatchCommand, registerShell, unregisterShell, setShellName, getShellByName, getShellByWs, listShells, createCommandCache, getCachedResult, cacheResult, STATUS_ITEMS, type TerminalState, type ShellIdentity, type CommandCache } from './terminal'
import { loadBoard, reloadBoard, dispatchTaskCommand, getBoardSummary, type TaskBoard } from './tasks'
import { createAgentSession, getAgentSession, removeAgentSession, getTranscript, runAgentPrompt, killAgent, sendToAgent, listTranscripts, loadTranscript, restoreSession, sendAgentMessage, getAgentMessageCount, consumeAgentMessages, setLastActiveAgent, getLastActiveAgent, listAgentSessions, type AgentConfig, type AgentEvent } from './agent-shell'
import { formatRecordingMessage, type SemanticEvent } from './agent-message-format'
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, lstatSync, unlinkSync, symlinkSync, copyFileSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { homedir, platform } from 'os'

// ============================================
// MCP Configuration Detection (for /status endpoint)
// ============================================

/** Get Claude Desktop config path based on platform */
function getClaudeDesktopConfigPath(): string {
  const home = homedir()
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    case 'win32':
      return join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
    default:
      return join(home, '.config', 'claude', 'claude_desktop_config.json')
  }
}

/** Check if Haltija MCP is configured in Claude Desktop */
function getMcpStatus(): { configured: boolean; configPath: string; setupCommand: string } {
  const configPath = getClaudeDesktopConfigPath()
  let configured = false
  
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      configured = !!config?.mcpServers?.haltija
    } catch {}
  }
  
  return {
    configured,
    configPath,
    setupCommand: 'bunx haltija --setup-mcp'
  }
}

// Product naming - single source of truth
const PRODUCT_NAME = 'Haltija'
const TAG_NAME = 'haltija-dev'
const LOG_PREFIX = '[haltija]'

// Port resolution. When the user expresses a preference (HALTIJA_PORT or
// DEV_CHANNEL_PORT env, or --port flag handled by the launcher) we use it
// strictly, killing any zombie holding that port. Without a preference we
// try the canonical default (8700) and fall back to a kernel-assigned
// ephemeral port — `haltija --name foo` records whichever port we end up
// on so `hj --name foo` can resolve back to it.
const PORT_PREFERENCE = process.env.HALTIJA_PORT || process.env.DEV_CHANNEL_PORT
const PORT_IS_STRICT = !!PORT_PREFERENCE
let PORT = parseInt(PORT_PREFERENCE || '8700')
let HTTPS_PORT = parseInt(process.env.DEV_CHANNEL_HTTPS_PORT || '8701')
const INSTANCE_NAME = process.env.HALTIJA_NAME || ''
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

// Optional shared-secret token. When set, every REST request must carry a
// matching X-Haltija-Token header and every widget WebSocket must connect
// with ?token=<value>. Off by default (local dev). Intended as a minimal
// hook for projects embedding haltija in production. Not a substitute for
// TLS or proper auth — those are the embedder's responsibility.
const REQUIRED_TOKEN = process.env.HALTIJA_TOKEN || ''

// Component.js paths for dynamic loading (try multiple locations for compiled binary support)
const componentJsPaths = [
  join(__dirname, '../dist/component.js'),           // Dev mode: relative to src/
  join(__dirname, 'component.js'),                   // Compiled: same dir as binary
  join(process.cwd(), 'dist/component.js'),          // CWD fallback
  join(process.cwd(), 'component.js'),               // CWD direct
]

// Inject the server session ID into the component bundle (bundler emits 'var').
function withSessionId(componentJs: string): string {
  return componentJs.replace(
    /var SERVER_SESSION_ID\s*=\s*["'][^"']*["']/,
    `var SERVER_SESSION_ID = "${SERVER_SESSION_ID}"`
  )
}

// Load component.js fresh on each request to always serve the latest build during
// development. Falls back to the copy embedded into this bundle at build time, so a
// published/relocated server can always serve the widget even without dist/component.js.
function getComponentJs(): string {
  for (const componentJsPath of componentJsPaths) {
    try {
      if (!existsSync(componentJsPath)) continue
      return withSessionId(readFileSync(componentJsPath, 'utf-8'))
    } catch {
      continue
    }
  }
  // No on-disk copy found — serve the embedded fallback (empty only if this server
  // was itself built before the component existed, which the build prevents).
  return COMPONENT_JS ? withSessionId(COMPONENT_JS) : ''
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

// Set by the Electron desktop app when it spawns this server. When true the
// server emits __NEED_WINDOW__ to stdout for the parent process to react.
const isDesktopApp = process.env.HALTIJA_DESKTOP === '1'

// Track the currently active browser ID (legacy, for backwards compatibility)
let activeBrowserId: string | null = null

// Message buffer for late joiners
const messageBuffer: DevMessage[] = []
const MAX_BUFFER = 100

// Snapshot storage (in-memory, keyed by ID)
const snapshots = new Map<string, PageSnapshot>()
const MAX_SNAPSHOTS = 50

// Default agent names — diverse, short, friendly
const DEFAULT_AGENT_NAMES = [
  'Claude', 'Aria', 'Kenji', 'Priya', 'Soren',
  'Amara', 'Ravi', 'Linnea', 'Dayo', 'Mika',
  'Zara', 'Oran', 'Yuki', 'Ines', 'Kofi',
]

// Terminal state
const terminalState = createTerminalState()
const terminalConfig = loadConfig(process.cwd())
const terminalClients = new Set<any>() // WebSocket clients for /ws/terminal
const commandCache = createCommandCache(30000) // 30s TTL

// Task board (loaded on startup)
let taskBoard: TaskBoard | null = null
try {
  taskBoard = loadBoard(process.cwd())
  const summary = getBoardSummary(taskBoard)
  if (summary !== 'empty') updateStatus(terminalState, 'todos', summary)
} catch { /* no task board yet — created on first tasks command */ }

// ==========================================
// File Viewer State
// ==========================================

interface TouchEntry {
  path: string
  op: 'read' | 'write' | 'diff'
  timestamp: number
}

let fileTouches: Map<string, TouchEntry[]> | null = null

function logTouch(shellId: string, filePath: string, op: TouchEntry['op']) {
  if (!fileTouches) fileTouches = new Map()
  if (!fileTouches.has(shellId)) fileTouches.set(shellId, [])
  const touches = fileTouches.get(shellId)!
  // Dedupe: if same path+op is the most recent, just update timestamp
  const last = touches[touches.length - 1]
  if (last?.path === filePath && last?.op === op) {
    last.timestamp = Date.now()
  } else {
    touches.push({ path: filePath, op, timestamp: Date.now() })
  }
  // Cap at 200 entries
  if (touches.length > 200) touches.splice(0, touches.length - 200)
  // Broadcast to terminals
  broadcastToTerminals({ type: 'file-touched', path: filePath, op, shellId, timestamp: Date.now() })
}

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
    '.jsx': 'javascript', '.tsx': 'typescript',
    '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'css', '.less': 'css',
    '.json': 'json', '.jsonc': 'json',
    '.md': 'markdown', '.mdx': 'markdown',
    '.py': 'python',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.yaml': 'yaml', '.yml': 'yaml',
    '.xml': 'xml', '.svg': 'xml',
    '.toml': 'toml',
    '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp',
    '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
    '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
  }
  return map[ext] || 'text'
}

// Helper: Update hj (browser) status for terminals
function updateHjStatus() {
  const focusedWindow = focusedWindowId ? windows.get(focusedWindowId) : null
  let hjStatus: string
  if (focusedWindow) {
    try {
      const urlObj = new URL(focusedWindow.url)
      // file:// URLs are the Haltija chrome window itself — show the server address instead
      if (urlObj.protocol === 'file:') {
        hjStatus = `localhost:${PORT}`
      } else {
        hjStatus = urlObj.host || `localhost:${PORT}`
      }
    } catch {
      hjStatus = 'connected'
    }
  } else if (windows.size > 0) {
    hjStatus = `${windows.size} tabs`
  } else {
    hjStatus = STATUS_ITEMS.hj.default
  }
  updateStatus(terminalState, 'hj', hjStatus)
  broadcastToTerminals({ type: 'status', line: getStatusLine(terminalState) })
}

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

// Active recording sessions (keyed by windowId)
// These survive page navigations - the session persists even when the widget reloads
interface ActiveRecordingSession {
  windowId: string
  startTime: number
  startUrl: string
  events: unknown[]  // SemanticEvent objects streamed from browser
  name?: string      // Optional test name
}
const activeRecordingSessions = new Map<string, ActiveRecordingSession>()

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

// Schema-based endpoint handler
// - GET on POST endpoints returns self-documenting schema
// - POST validates body against schema before calling handler
function schemaEndpoint(
  ep: api.EndpointDef,
  req: Request,
  headers: Record<string, string>,
  handler: (body: any) => Promise<Response>
): Promise<Response> | Response {
  if (req.method === 'GET' && ep.method === 'POST') {
    // Self-documenting: return schema info
    return Response.json(api.getEndpointDocs(ep), { headers })
  }
  
  if (req.method !== ep.method) {
    return wrongMethod(ep.path, ep.method, headers)
  }
  
  // For POST, validate body
  if (ep.method === 'POST') {
    return req.json().then(body => {
      const validation = api.validateInput(ep, body)
      if (!validation.valid) {
        return Response.json({
          success: false,
          error: validation.error,
          schema: api.getInputSchema(ep),
        }, { status: 400, headers })
      }
      return handler(body)
    }).catch(() => {
      return Response.json({
        success: false,
        error: 'Invalid JSON body',
        schema: api.getInputSchema(ep),
      }, { status: 400, headers })
    })
  }
  
  return handler({})
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

function broadcastToTerminals(msg: Record<string, any>) {
  const data = JSON.stringify(msg)
  for (const ws of terminalClients) {
    try {
      if ((ws as any).readyState === WebSocket.OPEN) {
        (ws as any).send(data)
      }
    } catch { /* ignore dead sockets */ }
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
    return { id: '', success: false, error: 'No browser connected. Start a browser and visit the Haltija server URL, or launch the Haltija desktop app.', timestamp: Date.now() }
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
    } else if (focusedWindowId && windows.has(focusedWindowId)) {
      const focusedWin = windows.get(focusedWindowId)!
      focusedWin.ws.send(JSON.stringify(msg))
    } else {
      // Fallback: pick ONE active window (most recently seen)
      const activeWindows = Array.from(windows.values())
        .filter(w => w.active)
        .sort((a, b) => b.lastSeen - a.lastSeen)

      if (activeWindows.length > 0) {
        activeWindows[0].ws.send(JSON.stringify(msg))
      } else if (windows.size > 0) {
        const mostRecent = Array.from(windows.values())
          .sort((a, b) => b.lastSeen - a.lastSeen)[0]
        mostRecent.ws.send(JSON.stringify(msg))
      } else {
        // No windows at all
        clearTimeout(timeout)
        pendingResponses.delete(id)
        resolve({ id, success: false, error: 'No browser windows connected. Open a page in the Haltija desktop app or inject the widget into your page.', timestamp: Date.now() })
      }
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
    
    // Handle streamed recording events from browser (for cross-page recording)
    if (msg.channel === 'recording' && msg.action === 'event' && msg.payload) {
      const payload = msg.payload as { windowId: string; event: unknown }
      const session = activeRecordingSessions.get(payload.windowId)
      if (session) {
        session.events.push(payload.event)
      }
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

// ============================================
// Schema-driven API Router
// ============================================

// Create context factory for the router
const createHandlerContext = (req: Request, url: URL): HandlerContext => {
  // Window targeting: ?window=<id> query param, otherwise the focused window
  const targetWindowId = url.searchParams.get('window') || undefined

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Request-Private-Network, X-Haltija-Token',
    'Access-Control-Allow-Private-Network': 'true',
    'Content-Type': 'application/json',
  }

  // Helper to get window info for response context
  const getWindowInfo = (windowId?: string) => {
    const id = windowId || targetWindowId || focusedWindowId
    if (!id) return undefined
    const win = windows.get(id)
    if (!win) return undefined
    return { id, url: win.url, title: win.title }
  }

  // Recording session management (for cross-page recording)
  const startRecordingSession = (windowId: string, startUrl: string, name?: string) => {
    activeRecordingSessions.set(windowId, {
      windowId,
      startTime: Date.now(),
      startUrl,
      events: [],
      name,
    })
    console.log(`${LOG_PREFIX} Started recording session for window ${windowId}`)
  }
  
  const stopRecordingSession = (windowId: string) => {
    const session = activeRecordingSessions.get(windowId)
    if (session) {
      activeRecordingSessions.delete(windowId)
      console.log(`${LOG_PREFIX} Stopped recording session for window ${windowId} (${session.events.length} events)`)
    }
    return session
  }
  
  const getRecordingSession = (windowId: string) => {
    return activeRecordingSessions.get(windowId)
  }
  
  // Save a recording to permanent storage
  const saveRecording = (recording: StoredRecording) => {
    // Evict oldest if over limit
    if (recordings.size >= MAX_RECORDINGS) {
      const oldest = recordings.keys().next().value
      if (oldest) recordings.delete(oldest)
    }
    recordings.set(recording.id, recording)
    console.log(`${LOG_PREFIX} Saved recording: ${recording.id} (${recording.events.length} events)`)
  }
  
  // List all saved recordings
  const listRecordings = () => {
    return Array.from(recordings.values()).map(r => ({
      id: r.id,
      url: r.url,
      title: r.title,
      startTime: r.startTime,
      endTime: r.endTime,
      eventCount: r.events.length,
      createdAt: r.createdAt,
    }))
  }
  
  // Get a specific recording
  const getRecording = (id: string) => {
    return recordings.get(id)
  }
  
  // requestFromBrowser wrapper. In desktop app mode, waits briefly for a
  // content tab to connect if none are present (common startup race where
  // hj runs before the widget connects, or no content tab is open yet).
  const routedRequest: typeof requestFromBrowser = async (
    channel, action, payload, timeoutMs?, windowId?
  ) => {
    // Desktop app: if no windows are connected, signal the parent process to
    // create one and wait briefly. Skip for plain server mode to avoid blocking.
    if (isDesktopApp && windows.size === 0) {
      console.log('__NEED_WINDOW__')
      const waitStart = Date.now()
      while (Date.now() - waitStart < 8000) {
        if (windows.size > 0) break
        await new Promise(r => setTimeout(r, 250))
      }
    }

    const effectiveWindowId = windowId || targetWindowId
    return requestFromBrowser(channel, action, payload, timeoutMs, effectiveWindowId)
  }

  return {
    requestFromBrowser: routedRequest,
    targetWindowId,
    headers,
    url,
    getWindowInfo,
    startRecordingSession,
    stopRecordingSession,
    getRecordingSession,
    saveRecording,
    listRecordings,
    getRecording,
  }
}

// Create the router instance
const apiRouter = createRouter(createHandlerContext)

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
    'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Request-Private-Network, X-Haltija-Token',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Expose-Headers': 'X-Haltija-Version',
    'Content-Type': 'application/json',
    // Lets `hj` notice on any command that it's older (or newer) than the server
    // it's driving, without spending an extra round trip to ask.
    'X-Haltija-Version': VERSION,
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers })
  }

  // Token check (only when REQUIRED_TOKEN is set). The /inject.js endpoint
  // is exempt because it must be reachable to bootstrap the widget — but
  // the widget's WebSocket connection is still gated by token below.
  if (REQUIRED_TOKEN && path !== '/inject.js' && path !== '/component.js' && path !== '/dev.js') {
    const provided = req.headers.get('X-Haltija-Token') || url.searchParams.get('token') || ''
    if (provided !== REQUIRED_TOKEN) {
      return Response.json({ error: 'Unauthorized: missing or invalid X-Haltija-Token' }, { status: 401, headers })
    }
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
      return new Response(
        '// Haltija component bundle unavailable.\n' +
        '// This server was built without the browser component. Run `bun run build`\n' +
        '// in the haltija source, or reinstall the package (a complete publish ships\n' +
        '// dist/component.js and embeds it in the server bundle).',
        {
          status: 503,
          headers: { ...headers, 'Content-Type': 'application/javascript' }
        }
      )
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
  const SERVER_VERSION = VERSION
  
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
    return new Response(DOCS_MD, {
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }

  // Agent discovery file (https://llmstxt.org) — concise, link-first capability overview
  if (path === '/llms.txt' && req.method === 'GET') {
    return new Response(LLMS_TXT, {
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }


  // Full API reference endpoint (served from embedded API.md)
  if (path === '/api' && req.method === 'GET') {
    return new Response(API_MD, { 
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } 
    })
  }

  // Compact JSON endpoint listing for agent discoverability
  // Returns minimal info about all endpoints - what an agent needs to understand capabilities
  if (path === '/endpoints' && req.method === 'GET') {
    const endpointList = api.ALL_ENDPOINTS.map(ep => {
      const inputSchema = api.getInputSchema(ep)
      const params = inputSchema && typeof inputSchema === 'object' && 'properties' in inputSchema
        ? Object.keys((inputSchema as any).properties || {})
        : []
      return {
        path: ep.path,
        method: ep.method,
        summary: ep.summary,
        params,
        category: (ep as any).category || 'other',
      }
    })
    return Response.json({ 
      endpoints: endpointList,
      count: endpointList.length,
      hint: 'GET /api for full documentation, GET /docs for quick start'
    }, { headers })
  }

  // ============================================
  // Schema-driven router (Phase 1: fall through if no handler)
  // ============================================
  // Try the new router first - it will return null if no handler registered
  const routerResponse = await apiRouter(req)
  if (routerResponse) {
    return routerResponse
  }

  // Status endpoint - includes window summary to avoid follow-up /windows call
  if (path === '/status') {
    const mcpStatus = getMcpStatus()

    const allWindows = Array.from(windows.values())

    const windowList = allWindows.map(w => ({
      id: w.id,
      title: w.title?.slice(0, 50) || '(untitled)',
      url: w.url,
      focused: w.id === focusedWindowId,
      recording: activeRecordingSessions.has(w.id),
    }))
    
    // Count active recordings
    const activeRecordings = activeRecordingSessions.size
    
    return Response.json({
      ok: allWindows.length > 0,
      windows: windowList,
      serverVersion: SERVER_VERSION,
      // Lets a newer server identify us without shelling out to lsof.
      pid: process.pid,
      recording: activeRecordings > 0,
      activeRecordings,
      // True when this server is hosted by the Haltija desktop app — hj uses
      // this to know it should NOT auto-launch a second Haltija.app instance.
      desktopApp: isDesktopApp,
      // Legacy fields for backwards compatibility
      browsers: browsers.size,
      agents: agents.size,
      mcp: {
        configured: mcpStatus.configured,
      }
    }, { headers })
  }

  // Stats endpoint - efficiency and usage metrics
  if (path === '/stats' && req.method === 'GET') {
    const windowId = url.searchParams.get('window') || undefined
    const response = await requestFromBrowser('system', 'stats', {}, 5000, windowId)
    if (response.success) {
      return Response.json(response.data, { headers })
    } else {
      return Response.json({ error: response.error || 'Failed to get stats' }, { status: 500, headers })
    }
  }
  
  // Version endpoint - DEPRECATED, use /status instead
  if (path === '/version' && req.method === 'GET') {
    const response = await requestFromBrowser('system', 'version', {})
    const deprecated = 'Use GET /status instead - version is included there'
    if (response.success) {
      return Response.json({
        server: SERVER_VERSION,
        component: response.data.version,
        browser: {
          id: response.data.browserId,
          url: response.data.url,
          title: response.data.title,
          state: response.data.state,
        },
        deprecated,
      }, { headers })
    } else {
      return Response.json({
        server: SERVER_VERSION,
        component: null,
        error: response.error || 'No browser connected',
        deprecated,
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
  
  // /query - now handled by api-router
  
  // Console get shorthand
  if (path === '/console' && req.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') || '0')
    const response = await requestFromBrowser('console', 'get', { since })
    return Response.json(response, { headers })
  }
  
  // /eval, /click - now handled by api-router
  
  // /drag - now handled by api-router
  
  // /type, /recording/start, /recording/stop - now handled by api-router
  
  // Generate test from semantic events
  if (path === '/recording/generate') {
    return schemaEndpoint(api.recordingGenerate, req, headers, async (body) => {
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
    })
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
  
  // /refresh, /navigate, /tabs/* - now handled by api-router
  
  // Get current URL and title
  if (path === '/location' && req.method === 'GET') {
    const response = await requestFromBrowser('navigation', 'location', {}, 5000, targetWindowId)
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
  
  // /mutations/watch, /mutations/unwatch - now handled by api-router
  
  // Get mutation watch status
  if (path === '/mutations/status' && req.method === 'GET') {
    const response = await requestFromBrowser('mutations', 'status', {})
    return Response.json(response, { headers })
  }
  
  // /events/watch, /events/unwatch - now handled by api-router
  
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
  
  // /inspect, /inspectAll, /highlight, /unhighlight - now handled by api-router
  
  // /scroll, /tree - now handled by api-router
  
  // /screenshot - now handled by api-router
  
  // ==========================================
  // Terminal Endpoints
  // ==========================================
  
  // Update a tool's status
  if (path === '/terminal/status' && req.method === 'POST') {
    const body = await req.json() as { tool: string; state: string }
    if (!body.tool) {
      return Response.json({ success: false, error: 'tool is required' }, { status: 400, headers })
    }
    updateStatus(terminalState, body.tool, body.state || '')
    broadcastToTerminals({ type: 'status', line: getStatusLine(terminalState) })
    return Response.json({ success: true }, { headers })
  }
  
  // Get current status line
  if (path === '/terminal/status' && req.method === 'GET') {
    const line = getStatusLine(terminalState)
    return new Response(line, { headers: { ...headers, 'Content-Type': 'text/plain' } })
  }
  
  // Push a notification
  if (path === '/terminal/push' && req.method === 'POST') {
    const body = await req.json() as { tool: string; text: string }
    if (!body.tool || !body.text) {
      return Response.json({ success: false, error: 'tool and text are required' }, { status: 400, headers })
    }
    pushMessage(terminalState, body.tool, body.text)
    broadcastToTerminals({ type: 'push', tool: body.tool, text: body.text, timestamp: Date.now() })
    return Response.json({ success: true }, { headers })
  }
  
  // Get push messages since timestamp
  if (path === '/terminal/messages' && req.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') || '0')
    const messages = getPushMessages(terminalState, since)
    return Response.json({ messages }, { headers })
  }
  
  // Check if hj CLI is globally available
  if (path === '/terminal/hj-status' && req.method === 'GET') {
    const localBin = join(homedir(), '.local', 'bin')
    const hjTarget = join(localBin, 'hj')
    const isCompiledBinary = __dirname.startsWith('/$bunfs/') || __dirname.startsWith('/snapshot/')
    
    // For source installs, symlink to source file
    // For compiled binary (DMG), the binary was already copied during startup
    const hjSource = join(__dirname, '..', 'bin', 'hj.mjs')
    const installCmd = isCompiledBinary 
      ? `echo "hj should have been installed automatically. Try restarting the app."` 
      : `mkdir -p "${localBin}" && ln -sf "${hjSource}" "${hjTarget}"`
    
    // Quick check: if ~/.local/bin/hj exists, it's installed.
    // The server process already has ~/.local/bin in PATH (added during auto-install),
    // so terminal/agent tabs can use it even if the user's login shell doesn't have it.
    if (existsSync(hjTarget)) {
      // Verify it's in the server process's PATH (it should be after auto-install)
      const pathDirs = (process.env.PATH || '').split(':')
      if (!pathDirs.includes(localBin)) {
        process.env.PATH = `${localBin}:${process.env.PATH}`
      }
      return Response.json({ installed: true }, { headers })
    }
    
    // Also check via which (covers cases where hj is installed elsewhere)
    try {
      const whichResult = execSync('which hj', { stdio: 'pipe' }).toString().trim()
      if (whichResult) {
        return Response.json({ installed: true }, { headers })
      }
    } catch {
      // hj not in PATH
    }
    
    return Response.json({ 
      installed: false, 
      installCommand: installCmd,
      message: isCompiledBinary 
        ? 'hj CLI was not installed. Try restarting the Haltija app.'
        : 'Auto-install of hj failed. Run this command manually to enable browser control for agents.'
    }, { headers })
  }

  // Agent init — register a shell via REST (no WebSocket needed)
  if (path === '/terminal/init' && req.method === 'POST') {
    const body = await req.json() as { name?: string }
    const shell = registerShell(terminalState, null) // no ws for REST-only agents
    
    // Assign name: explicit > next available from config names list > shell ID
    const agentNames = (terminalConfig as any)?.agent?.names || DEFAULT_AGENT_NAMES
    let name: string = body.name ?? ''
    if (!name) {
      // Find next available name (not already taken by shell or agent session)
      const existingAgentSessions = listAgentSessions()
      const takenNames = new Set([
        ...Array.from(terminalState.shells.values()).map(s => s.name).filter(Boolean),
        ...existingAgentSessions.map(a => a.name),
      ])
      name = agentNames.find((n: string) => !takenNames.has(n)) || `agent-${shell.id}`
    }
    
    setShellName(terminalState, shell.id, name)
    
    // Create agent session so it appears in /terminal/agents
    createAgentSession(shell.id, name, shell.cwd)
    
    broadcastToTerminals({ type: 'shell-joined', shellId: shell.id, name })
    const statusLine = getStatusLine(terminalState)
    const boardSummary = taskBoard ? getBoardSummary(taskBoard) : 'empty'
    return Response.json({
      shellId: shell.id,
      name,
      status: statusLine,
      board: boardSummary,
    }, { headers })
  }

  // Agent prompt — send a prompt to a Claude subprocess
  if (path === '/terminal/agent-prompt' && req.method === 'POST') {
    const body = await req.json() as { shellId: string; prompt: string }
    if (!body.prompt?.trim()) {
      return new Response('error: prompt is required', { status: 400, headers })
    }
    if (!body.shellId) {
      return new Response('error: shellId is required', { status: 400, headers })
    }

    const shell = terminalState.shells.get(body.shellId)
    if (!shell) {
      return new Response('error: shell not found', { status: 404, headers })
    }

    // Create agent session if needed
    let session = getAgentSession(body.shellId)
    if (!session) {
      session = createAgentSession(body.shellId, shell.name || shell.id)
    }

    // If agent is already thinking, send message directly to stdin (real-time interrupt)
    if (session.status === 'thinking') {
      const sent = sendToAgent(body.shellId, body.prompt.trim())
      if (sent) {
        return new Response('sent to running agent', { headers: { ...headers, 'Content-Type': 'text/plain' } })
      }
      // Process died or stdin closed - fall through to start new process
    }

    // Get agent config from haltija.json
    const agentConfig: AgentConfig = (terminalConfig as any)?.agent || {}
    
    // Default system prompt tells agent about hj browser control
    if (!agentConfig.systemPrompt) {
      agentConfig.systemPrompt = `You have browser control via the 'hj' CLI. Use it to see and interact with web pages.

Each message starts with a status line like: hj localhost:8700 | hj tasks 2 active
Each segment is a runnable command showing current state.

Key commands:
- hj status - check connection
- hj tree - see page structure
- hj click "selector" - click elements
- hj type "selector" "text" - type in inputs
- hj screenshot - capture the page
- hj tasks - view the shared task board (NOT your built-in TodoWrite tool)

Run 'hj --help' for all commands.`
    }

    // Event handler: forward events to the shell's WebSocket
    const onEvent = (event: AgentEvent) => {
      // Track file touches from agent tool calls (Read, Write, Edit)
      if (event.type === 'agent-tool' && event.tool) {
        const toolName = event.tool
        if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
          try {
            const input = typeof event.input === 'string' ? JSON.parse(event.input) : event.input
            const filePath = input?.file_path
            if (filePath) {
              const op = toolName === 'Read' ? 'read' as const : 'write' as const
              logTouch(body.shellId, filePath, op)
            }
          } catch { /* ignore parse errors */ }
        }
      }

      if (shell.ws && (shell.ws as any).readyState === WebSocket.OPEN) {
        try {
          (shell.ws as any).send(JSON.stringify(event))
        } catch { /* ignore dead socket */ }
      }
    }

    // Use shell's cwd as the agent's working directory (scoped like Zed)
    const agentCwd = shell.cwd || process.env.HOME || process.cwd()

    // Build compact UI state line to prepend to prompt
    // Each segment is a runnable hj command: hj localhost:8700 | hj tasks 2 active
    const focusedWindow = focusedWindowId ? windows.get(focusedWindowId) : null
    let browserStatus: string
    if (focusedWindow) {
      try {
        const urlObj = new URL(focusedWindow.url)
        // file:// URLs are the Haltija chrome window itself — show the server address instead
        const host = urlObj.protocol === 'file:' ? `localhost:${PORT}` : (urlObj.host || `localhost:${PORT}`)
        browserStatus = `hj ${host}`
      } catch {
        browserStatus = 'hj connected'
      }
    } else {
      browserStatus = `hj ${STATUS_ITEMS.hj.default}`
    }
    const taskStatus = taskBoard ? getBoardSummary(taskBoard) : STATUS_ITEMS.tasks.default

    const uiState = `${browserStatus} | hj tasks ${taskStatus}

`
    // Inject any pending messages before the user's prompt
    const pendingMessages = consumeAgentMessages(body.shellId)
    const fullPrompt = uiState + pendingMessages + body.prompt.trim()

    // Spawn agent asynchronously — don't await
    runAgentPrompt(body.shellId, fullPrompt, agentConfig, agentCwd, onEvent, agentConfig.systemPrompt)

    return new Response('ok', { headers: { ...headers, 'Content-Type': 'text/plain' } })
  }

  // Agent transcript — get full transcript for a shell
  if (path === '/terminal/agent-transcript' && req.method === 'GET') {
    const shellId = url.searchParams.get('shellId')
    if (!shellId) {
      return Response.json({ error: 'shellId required' }, { status: 400, headers })
    }
    const transcript = getTranscript(shellId)
    return Response.json({ transcript }, { headers })
  }

  // List saved transcripts for the working directory
  if (path === '/terminal/transcripts' && req.method === 'GET') {
    const cwd = process.env.HOME || process.cwd()
    const transcripts = await listTranscripts(cwd)
    return Response.json({ transcripts }, { headers })
  }

  // Load a saved transcript by filename
  if (path === '/terminal/transcript/load' && req.method === 'GET') {
    const filename = url.searchParams.get('filename')
    if (!filename) {
      return Response.json({ error: 'filename required' }, { status: 400, headers })
    }
    const cwd = process.env.HOME || process.cwd()
    const transcript = await loadTranscript(cwd, filename)
    if (!transcript) {
      return Response.json({ error: 'transcript not found' }, { status: 404, headers })
    }
    return Response.json(transcript, { headers })
  }

  // Restore a session from a saved transcript
  if (path === '/terminal/transcript/restore' && req.method === 'POST') {
    const body = await req.json() as { filename: string; shellId: string }
    if (!body.filename || !body.shellId) {
      return Response.json({ error: 'filename and shellId required' }, { status: 400, headers })
    }
    const cwd = process.env.HOME || process.cwd()
    const transcriptFile = await loadTranscript(cwd, body.filename)
    if (!transcriptFile) {
      return Response.json({ error: 'transcript not found' }, { status: 404, headers })
    }
    const session = restoreSession(body.shellId, transcriptFile)
    return Response.json({ 
      shellId: session.id, 
      name: session.name, 
      entryCount: session.transcript.length,
      createdAt: session.createdAt 
    }, { headers })
  }

  // Agent kill/stop — stop a running agent
  if ((path === '/terminal/agent-kill' || path === '/terminal/agent-stop') && req.method === 'POST') {
    const body = await req.json() as { shellId: string }
    if (!body.shellId) {
      return new Response('error: shellId required', { status: 400, headers })
    }
    const killed = killAgent(body.shellId)
    return new Response(killed ? 'stopped' : 'no running agent', { headers: { ...headers, 'Content-Type': 'text/plain' } })
  }
  
  // List active agents — for browser widget to know where to send recordings
  if (path === '/terminal/agents' && req.method === 'GET') {
    const agents = listAgentSessions()
    return Response.json({ agents }, { headers })
  }
  
  // Mark agent as last active — called when agent tab is focused
  if (path === '/terminal/agent-focus' && req.method === 'POST') {
    const body = await req.json() as { shellId: string }
    if (body.shellId) {
      setLastActiveAgent(body.shellId)
    }
    return Response.json({ ok: true }, { headers })
  }

  // Return the current task board file path (for opening in the file viewer)
  if (path === '/terminal/tasks-path' && req.method === 'GET') {
    return Response.json({ path: taskBoard?.filePath || null }, { headers })
  }

  // Dispatch a command to a tool
  if (path === '/terminal/command' && req.method === 'POST') {
    const body = await req.json() as { command: string; shellId?: string }
    const command = body.command?.trim()
    if (!command && !body.shellId) {
      return Response.json({ success: false, error: 'command is required' }, { status: 400, headers })
    }

    // Resolve shell identity
    const shell = body.shellId ? terminalState.shells.get(body.shellId) : undefined
    const shellName = shell?.name || shell?.id || 'unknown'

    // Helper: append status footer to response
    function respond(output: string): Response {
      const statusLine = getStatusLine(terminalState)
      const footer = statusLine ? `\n---\n${statusLine} ${shellName}` : ''
      return new Response(output + footer, { headers: { ...headers, 'Content-Type': 'text/plain' } })
    }

    // Empty command → list all tools
    if (!command) {
      const output = terminalConfig ? await dispatchCommand(terminalConfig, '') : 'no haltija.json found'
      return respond(output)
    }

    // Meta-command: who
    if (command === 'who') {
      return respond(listShells(terminalState))
    }

    // Meta-command: whoami [name]
    if (command === 'whoami' || command.startsWith('whoami ')) {
      let name = command.slice(6).trim()
      if (name && shell) {
        // Special case: "whoami agent" triggers name rotation and creates agent session
        if (name === 'agent') {
          const agentNames = (terminalConfig as any)?.agent?.names || DEFAULT_AGENT_NAMES
          // Find next available name (not already taken by shell or agent session)
          const existingAgentSessions = listAgentSessions()
          const takenNames = new Set([
            ...Array.from(terminalState.shells.values()).map(s => s.name).filter(Boolean),
            ...existingAgentSessions.map(a => a.name),
          ])
          name = agentNames.find((n: string) => !takenNames.has(n)) || `agent-${shell.id}`
          
          // Create agent session so it appears in /terminal/agents
          if (!getAgentSession(shell.id)) {
            createAgentSession(shell.id, name, shell.cwd)
          }
        }
        setShellName(terminalState, shell.id, name)
        broadcastToTerminals({ type: 'shell-renamed', shellId: shell.id, name })
        return respond(`${shell.id} → ${name}`)
      }
      return respond(shell ? `${shell.id}${shell.name ? ` (${shell.name})` : ''}` : 'unknown')
    }

    // Meta-command: @name message (DM to shell)
    if (command.startsWith('@')) {
      const spaceIdx = command.indexOf(' ', 1)
      if (spaceIdx === -1) {
        return respond('error: @name message')
      }
      const targetName = command.slice(1, spaceIdx)
      const msgText = command.slice(spaceIdx + 1).trim()
      const targetShell = getShellByName(terminalState, targetName)
      if (!targetShell) {
        return respond(`error: shell "${targetName}" not found`)
      }
      try {
        if ((targetShell.ws as any).readyState === WebSocket.OPEN) {
          (targetShell.ws as any).send(JSON.stringify({
            type: 'message',
            from: shellName,
            text: msgText,
            timestamp: Date.now(),
          }))
        }
      } catch { /* ignore dead socket */ }
      return respond(`→ ${targetName}: ${msgText}`)
    }
    
    // Meta-command: send:name message (paste into agent's input field)
    if (command.startsWith('send:')) {
      const spaceIdx = command.indexOf(' ')
      if (spaceIdx === -1) {
        return respond('error: send:agent-name message body')
      }
      const targetName = command.slice(5, spaceIdx)
      const msgText = command.slice(spaceIdx + 1).trim()
      
      // Find the agent's shell by name
      const targetShell = getShellByName(terminalState, targetName)
      if (!targetShell) {
        return respond(`error: agent "${targetName}" not found`)
      }
      
      // Send directly to the agent's terminal UI for pasting into input field
      // (Don't queue server-side - let user review and send)
      try {
        if ((targetShell.ws as any).readyState === WebSocket.OPEN) {
          (targetShell.ws as any).send(JSON.stringify({
            type: 'agent-message-queued',
            from: shellName,
            text: msgText,
            count: 0, // Not queued server-side
          }))
          return respond(`→ ${targetName}: message sent to input`)
        } else {
          return respond(`error: agent "${targetName}" not connected`)
        }
      } catch {
        return respond(`error: failed to send to "${targetName}"`)
      }
    }

    // Builtin: todos (alias: tasks) - todo list / memory aid
    const parts = command.split(/\s+/)
    if (parts[0] === 'todos' || parts[0] === 'tasks') {
      // Ensure board exists
      if (!taskBoard) {
        taskBoard = loadBoard(process.cwd())
      } else {
        reloadBoard(taskBoard)
      }
      let verb = parts[1]
      let args = parts.slice(2)
      
      // Default: list top 5 priority items
      if (!verb) {
        verb = 'top'
        args = ['5']
      }
      
      const result = dispatchTaskCommand(taskBoard, verb, args, shellName)
      if (result.mutated) {
        const summary = getBoardSummary(taskBoard)
        updateStatus(terminalState, 'todos', summary)
        broadcastToTerminals({ type: 'status', line: getStatusLine(terminalState) })
        broadcastToTerminals({ type: 'task-changed', by: shellName })
      }
      return respond(result.output)
    }

    // Get shell's working directory
    const shellCwd = shell?.cwd || process.env.HOME || process.cwd()

    // Meta-command: cd [path]
    if (command === 'cd' || command.startsWith('cd ')) {
      const targetPath = command.slice(2).trim() || process.env.HOME || '/'
      const { resolve } = await import('path')
      const { existsSync, statSync } = await import('fs')
      
      // Resolve relative to current cwd
      const newCwd = targetPath.startsWith('/') || targetPath.startsWith('~')
        ? targetPath.replace(/^~/, process.env.HOME || '')
        : resolve(shellCwd, targetPath)
      
      if (!existsSync(newCwd)) {
        return respond(`cd: no such directory: ${targetPath}`)
      }
      if (!statSync(newCwd).isDirectory()) {
        return respond(`cd: not a directory: ${targetPath}`)
      }
      
      if (shell) {
        shell.cwd = newCwd
        // Notify the terminal of cwd change
        try {
          if ((shell.ws as any).readyState === WebSocket.OPEN) {
            (shell.ws as any).send(JSON.stringify({ type: 'cwd-changed', cwd: newCwd }))
          }
        } catch { /* ignore */ }
      }
      return respond(newCwd)
    }

    // Meta-command: pwd
    if (command === 'pwd') {
      return respond(shellCwd)
    }

    // Meta-command: help [topic] (also: man)
    if (command === 'help' || command.startsWith('help ') || command === 'man' || command.startsWith('man ')) {
      const isMan = command.startsWith('man')
      const topic = command.slice(isMan ? 3 : 4).trim()
      if (!topic) {
        // List available tools
        const tools = terminalConfig?.tools ? Object.keys(terminalConfig.tools) : []
        const builtins = ['who', 'whoami', 'cd', 'pwd', 'tasks', 'help']
        return respond(`Builtins: ${builtins.join(', ')}\nTools: ${tools.length ? tools.join(', ') : '(none)'}\n\nType 'help <topic>' for details.`)
      }
      // Try <topic> --help, then <topic> help
      const { executeShellInDir } = await import('./terminal')
      let output = await executeShellInDir(`${topic} --help`, [], shellCwd)
      if (output.includes('not found') || output.includes('Unknown') || output.includes('error')) {
        output = await executeShellInDir(`${topic} help`, [], shellCwd)
      }
      return respond(output)
    }

    // Try tool dispatch first (if config exists)
    if (terminalConfig) {
      const toolParts = command.split(/\s+/)
      const toolName = toolParts[0]
      
      // Check if it's a known tool
      if (terminalConfig.tools[toolName]) {
        const cached = getCachedResult(commandCache, command)
        if (cached !== null) {
          return respond(cached)
        }
        const output = await dispatchCommand(terminalConfig, command)
        cacheResult(commandCache, command, output)
        return respond(output)
      }
    }

    // Fallback: execute as shell command in shell's cwd
    const { executeShellInDir } = await import('./terminal')
    const output = await executeShellInDir(command, [], shellCwd)
    return respond(output)
  }
  
  // ==========================================
  // File Viewer Endpoints (internal, for desktop app UI)
  // ==========================================

  // Read a file
  if (path === '/files/read' && req.method === 'GET') {
    const filePath = url.searchParams.get('path')
    const shellId = url.searchParams.get('shellId')
    if (!filePath) {
      return Response.json({ error: 'path is required' }, { status: 400, headers })
    }

    const shell = shellId ? terminalState.shells.get(shellId) : undefined
    const baseCwd = shell?.cwd || process.cwd()

    const { resolve, extname, relative } = await import('path')
    const { readFileSync, statSync } = await import('fs')

    const resolved = filePath.startsWith('/') ? filePath : resolve(baseCwd, filePath)

    // Security: reject paths outside cwd
    const rel = relative(baseCwd, resolved)
    if (rel.startsWith('..') && !filePath.startsWith('/')) {
      return Response.json({ error: 'path escapes working directory' }, { status: 403, headers })
    }

    try {
      const stat = statSync(resolved)
      if (stat.isDirectory()) {
        return Response.json({ error: 'path is a directory' }, { status: 400, headers })
      }

      // Size cap: 1MB
      if (stat.size > 1_048_576) {
        return Response.json({ tooLarge: true, size: stat.size, path: resolved }, { headers })
      }

      const ext = extname(resolved).toLowerCase()
      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico']
      if (imageExts.includes(ext)) {
        return Response.json({
          image: true,
          mimeType: ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1).replace('jpg', 'jpeg')}`,
          size: stat.size,
          path: resolved,
          // Base64 encode for inline display
          data: readFileSync(resolved).toString('base64'),
        }, { headers })
      }

      // Binary detection: check for null bytes in first 8KB
      const buf = readFileSync(resolved)
      const sample = buf.subarray(0, 8192)
      if (sample.includes(0)) {
        return Response.json({ binary: true, size: stat.size, path: resolved }, { headers })
      }

      const content = buf.toString('utf-8')
      const language = extToLanguage(ext)

      // Log touch
      logTouch(shellId || '_global', resolved, 'read')

      return Response.json({ content, language, size: stat.size, mtime: stat.mtimeMs, path: resolved }, { headers })
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404, headers })
    }
  }

  // Write a file
  if (path === '/files/write' && req.method === 'POST') {
    const body = await req.json() as { path: string; content: string; shellId?: string }
    if (!body.path || body.content === undefined) {
      return Response.json({ error: 'path and content are required' }, { status: 400, headers })
    }

    const shell = body.shellId ? terminalState.shells.get(body.shellId) : undefined
    const baseCwd = shell?.cwd || process.cwd()

    const { resolve, relative } = await import('path')
    const { writeFileSync } = await import('fs')

    const resolved = body.path.startsWith('/') ? body.path : resolve(baseCwd, body.path)
    const rel = relative(baseCwd, resolved)
    if (rel.startsWith('..') && !body.path.startsWith('/')) {
      return Response.json({ error: 'path escapes working directory' }, { status: 403, headers })
    }

    try {
      writeFileSync(resolved, body.content, 'utf-8')
      logTouch(body.shellId || '_global', resolved, 'write')
      return Response.json({ success: true, size: Buffer.byteLength(body.content), path: resolved }, { headers })
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 500, headers })
    }
  }

  // Directory tree
  if (path === '/files/tree' && req.method === 'GET') {
    const root = url.searchParams.get('root') || '.'
    const depth = parseInt(url.searchParams.get('depth') || '3')
    const shellId = url.searchParams.get('shellId')
    const shell = shellId ? terminalState.shells.get(shellId) : undefined
    const baseCwd = shell?.cwd || process.cwd()

    const { resolve, join, relative, basename } = await import('path')
    const { readdirSync, statSync } = await import('fs')

    const rootDir = root.startsWith('/') ? root : resolve(baseCwd, root)

    // Get gitignored files (best-effort)
    let ignoredSet: Set<string> | null = null
    try {
      const proc = Bun.spawnSync(['git', 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], { cwd: rootDir })
      if (proc.exitCode === 0) {
        ignoredSet = new Set(proc.stdout.toString().trim().split('\n').filter(Boolean).map(f => f.replace(/\/$/, '')))
      }
    } catch { /* not a git repo */ }

    const alwaysSkip = new Set(['node_modules', '.git', '.DS_Store'])

    interface TreeNode {
      name: string
      type: 'file' | 'dir'
      path: string
      children?: TreeNode[]
    }

    function walkDir(dir: string, currentDepth: number): TreeNode[] {
      if (currentDepth > depth) return []
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
          .filter(e => !alwaysSkip.has(e.name))
          .sort((a, b) => {
            // Dirs first, then alphabetical
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
            return a.name.localeCompare(b.name)
          })

        const nodes: TreeNode[] = []
        for (const entry of entries) {
          const relPath = relative(rootDir, join(dir, entry.name))
          if (ignoredSet?.has(relPath)) continue

          if (entry.isDirectory()) {
            const children = walkDir(join(dir, entry.name), currentDepth + 1)
            nodes.push({ name: entry.name, type: 'dir', path: relPath, children })
          } else {
            nodes.push({ name: entry.name, type: 'file', path: relPath })
          }
        }
        return nodes
      } catch { return [] }
    }

    const tree = walkDir(rootDir, 1)
    return Response.json({ root: rootDir, tree }, { headers })
  }

  // Touch stream
  if (path === '/files/touches' && req.method === 'GET') {
    const shellId = url.searchParams.get('shellId') || '_global'
    const touches = fileTouches?.get(shellId) || []
    return Response.json({ touches: [...touches].reverse() }, { headers })
  }

  // Serve CodeMirror bundle
  if (path === '/assets/codemirror.js' && req.method === 'GET') {
    try {
      // Try dist/ first (development), then resources/ (packaged app)
      const { readFileSync } = await import('fs')
      const { join } = await import('path')
      let cmCode: string
      try {
        cmCode = readFileSync(join(import.meta.dir, '../dist/codemirror.js'), 'utf-8')
      } catch {
        try {
          cmCode = readFileSync(join(import.meta.dir, '../apps/desktop/resources/codemirror.js'), 'utf-8')
        } catch {
          return new Response('CodeMirror bundle not found — run bun run build', { status: 404, headers })
        }
      }
      return new Response(cmCode, { headers: { ...headers, 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=86400' } })
    } catch (err: any) {
      return new Response(`Error: ${err.message}`, { status: 500, headers })
    }
  }

  // Serve image files for the file viewer
  if (path === '/files/image' && req.method === 'GET') {
    const filePath = url.searchParams.get('path')
    if (!filePath) return new Response('path required', { status: 400, headers })

    const { readFileSync } = await import('fs')
    const { extname } = await import('path')
    try {
      const data = readFileSync(filePath)
      const ext = extname(filePath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
      }
      return new Response(data, { headers: { ...headers, 'Content-Type': mimeMap[ext] || 'application/octet-stream' } })
    } catch (err: any) {
      return new Response(err.message, { status: 404, headers })
    }
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
  // Tracks a specific window by ID + browserId so it works correctly with multiple tabs
  async function waitForBrowserReconnect(
    windowId: string | null,
    previousBrowserId: string | null,
    timeoutMs = 10000,
  ): Promise<boolean> {
    const start = Date.now()
    // Wait a moment for disconnect to happen
    await new Promise(r => setTimeout(r, 100))
    
    while (Date.now() - start < timeoutMs) {
      if (windowId) {
        const w = windows.get(windowId)
        // Reconnected = same windowId, different browserId (new page load)
        if (w && w.browserId !== previousBrowserId) {
          await new Promise(r => setTimeout(r, 300)) // widget init
          return true
        }
      } else {
        // No specific window — fall back to any browser connected
        if (browsers.size > 0) {
          await new Promise(r => setTimeout(r, 300))
          return true
        }
      }
      await new Promise(r => setTimeout(r, 100))
    }
    return false
  }
  
  // Run a test and return results
  if (path === '/test/run' && req.method === 'POST') {
    const body = await req.json()
    const test = (body.steps ? body : body.test) as DevChannelTest
    const format = (body.format || 'json') as OutputFormat
    const testFile = body.testFile as string | undefined  // Optional path for GitHub annotations
    const options = {
      stepDelay: body.stepDelay ?? 100,  // ms between steps
      timeout: body.timeout ?? 5000,      // ms timeout per step
      stopOnFailure: body.stopOnFailure ?? true,
    }
    
    // Elastic patience: racing-game checkpoint model
    const patience = body.patience ?? 0  // total failures allowed (0 = classic mode)
    const patienceStreak = body.patienceStreak ?? 2  // consecutive failures to bail
    const timeoutBonusMs = body.timeoutBonusMs ?? 1000  // ms earned per success (capped at initial timeout)
    const initialTimeout = options.timeout
    let remainingPatience = patience
    let failureCount = 0
    let consecutiveFailures = 0
    let currentTimeout = options.timeout
    
    const startTime = Date.now()
    const stepResults: StepResult[] = []
    let passed = true
    
    for (let i = 0; i < test.steps.length; i++) {
      const step = test.steps[i]
      const stepStart = Date.now()
      let stepPassed = true
      let error: string | undefined
      let context: Record<string, any> | undefined
      
      // Check patience before starting step
      if (patience > 0 && (remainingPatience <= 0 || consecutiveFailures >= patienceStreak)) {
        const reason = consecutiveFailures >= patienceStreak
          ? `${consecutiveFailures} consecutive failures`
          : `${failureCount} total failures exceeded limit of ${patience}`
        error = `Patience exhausted: ${reason}`
        context = { patienceExhausted: true, failureCount, consecutiveFailures, patience, patienceStreak }
        const snapId = await captureSnapshot('test-failure', {
          testName: test.name, stepIndex: i, error,
        })
        stepResults.push({ index: i, step, passed: false, duration: 0, error, context, snapshotId: snapId })
        passed = false
        break
      }
      
      // Apply step delay
      if (step.delay || options.stepDelay) {
        await new Promise(r => setTimeout(r, step.delay || options.stepDelay))
      }
      
      // Per-step timeout override, then elastic timeout, then global
      const baseTimeout = patience > 0 ? currentTimeout : options.timeout
      const stepTimeout = step.timeout ?? baseTimeout
      
      try {
        switch (step.action) {
          case 'navigate': {
            // Capture current window state before navigation so we can detect reconnect.
            const contentWins = Array.from(windows.values())
              .sort((a, b) => {
                if (a.id === focusedWindowId) return -1
                if (b.id === focusedWindowId) return 1
                return b.lastSeen - a.lastSeen
              })
            const navWindow = contentWins[0] ?? null
            const navWindowId = navWindow?.id ?? null
            const navPrevBrowserId = navWindow?.browserId ?? null

            const response = await requestFromBrowser('navigation', 'goto', { url: step.url }, stepTimeout, navWindowId ?? undefined)
            if (!response.success) {
              stepPassed = false
              error = response.error || 'Navigation failed'
              break
            }
            // Wait for browser to reconnect after page load (widget reloads)
            const reconnected = await waitForBrowserReconnect(navWindowId, navPrevBrowserId, stepTimeout)
            if (!reconnected) {
              stepPassed = false
              error = 'Browser did not reconnect after navigation'
            }
            break
          }
          
          case 'click': {
            // Use realistic click (same as /click REST endpoint)
            let clickResponse = await requestFromBrowser('interaction', 'click', {
              selector: step.selector,
            }, stepTimeout)
            
            let usedFallback = false
            let matchedSelector = step.selector
            
            // If primary selector failed and we have a fallback, try it
            if (!clickResponse.success && step.fallbackSelector) {
              clickResponse = await requestFromBrowser('interaction', 'click', {
                selector: step.fallbackSelector,
              }, stepTimeout)
              
              if (clickResponse.success) {
                usedFallback = true
                matchedSelector = step.fallbackSelector
              }
            }
            
            if (!clickResponse.success) {
              stepPassed = false

              // Gather page context - what's actually there?
              const pageButtonsResponse = await requestFromBrowser('eval', 'exec', {
                code: `Array.from(document.querySelectorAll('button, [role="button"], a.btn, input[type="submit"]'))
                  .slice(0, 10)
                  .map(el => el.innerText?.trim() || el.value || el.getAttribute('aria-label') || '')
                  .filter(Boolean)`
              })
              const buttonsOnPage = pageButtonsResponse.data || []

              error = clickResponse.error || step.description || `Click ${step.selector}`
              context = {
                reason: clickResponse.error || 'Element not found',
                selector: step.selector,
                fallbackSelector: step.fallbackSelector,
                triedFallback: !!step.fallbackSelector,
                buttonsOnPage,
                suggestion: inferSuggestion(step, { buttonsOnPage })
              }
            } else {
              // Track which selector worked
              context = usedFallback ? { usedFallback, matchedSelector } : undefined
            }
            break
          }
          
          case 'type': {
            if (step.paste) {
              // Paste mode: simulate Ctrl+V paste with full event lifecycle
              // Fast but still triggers React/form frameworks correctly
              const pasteResponse = await requestFromBrowser('eval', 'exec', {
                code: `(function(){
                  const el = (window.__haltija_resolveSelector || document.querySelector.bind(document))(${JSON.stringify(step.selector)});
                  if (!el) return { error: 'not_found' };
                  
                  // Scroll into view
                  el.scrollIntoView({behavior: "smooth", block: "center"});
                  
                  // Focus with proper events
                  el.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
                  el.dispatchEvent(new FocusEvent('focus', {bubbles: false}));
                  el.focus();
                  
                  // Select all existing content (like Ctrl+A before paste)
                  if (el.select) el.select();
                  
                  // Simulate paste event
                  const clipboardData = new DataTransfer();
                  clipboardData.setData('text/plain', ${JSON.stringify(step.text)});
                  const pasteEvent = new ClipboardEvent('paste', {
                    bubbles: true, cancelable: true, clipboardData
                  });
                  const allowed = el.dispatchEvent(pasteEvent);
                  
                  // Set value using native setter (React compatibility)
                  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                  if (nativeSetter) nativeSetter.call(el, ${JSON.stringify(step.text)});
                  else el.value = ${JSON.stringify(step.text)};
                  
                  // Fire input + change events
                  el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertFromPaste', data: ${JSON.stringify(step.text)}}));
                  el.dispatchEvent(new Event('change', {bubbles: true}));
                  
                  // Blur
                  el.dispatchEvent(new FocusEvent('focusout', {bubbles: true}));
                  el.dispatchEvent(new FocusEvent('blur', {bubbles: false}));
                  el.blur();
                  
                  return { ok: true };
                })()`
              }, stepTimeout)
              
              const pasteResult = pasteResponse.data
              if (!pasteResponse.success || pasteResult?.error === 'not_found') {
                stepPassed = false
                const pageInputsResponse = await requestFromBrowser('eval', 'exec', {
                  code: `Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'))
                    .slice(0, 10)
                    .map(el => {
                      const label = el.id && document.querySelector('label[for="' + el.id + '"]')?.innerText?.trim()
                      return label || el.placeholder || el.name || el.type || el.tagName.toLowerCase()
                    })
                    .filter(Boolean)`
                })
                const inputsOnPage = pageInputsResponse.data || []
                error = step.description || `Type in ${step.selector}`
                context = {
                  reason: 'Input element not found',
                  selector: step.selector,
                  inputsOnPage,
                  suggestion: inputsOnPage.length === 0
                    ? 'No input elements found - page may not have loaded or form is conditionally rendered'
                    : 'Input may have been renamed or removed'
                }
              }
            } else {
              // Default: realistic per-character typing (same as /type REST endpoint)
              let typeResponse = await requestFromBrowser('interaction', 'type', {
                selector: step.selector,
                text: step.text,
                clear: step.clear !== false,
                humanlike: step.humanlike !== false,
                minDelay: step.minDelay ?? 30,
                maxDelay: step.maxDelay ?? 80,
                typoRate: 0,  // No typos in tests
              }, stepTimeout + (step.text?.length || 0) * 200)
              
              let usedFallback = false
              let matchedSelector = step.selector
              
              // If primary selector failed and we have a fallback, try it
              if (!typeResponse.success && step.fallbackSelector) {
                typeResponse = await requestFromBrowser('interaction', 'type', {
                  selector: step.fallbackSelector,
                  text: step.text,
                  clear: step.clear !== false,
                  humanlike: step.humanlike !== false,
                  minDelay: step.minDelay ?? 30,
                  maxDelay: step.maxDelay ?? 80,
                  typoRate: 0,
                }, stepTimeout + (step.text?.length || 0) * 200)
                
                if (typeResponse.success) {
                  usedFallback = true
                  matchedSelector = step.fallbackSelector
                }
              }
              
              if (!typeResponse.success) {
                stepPassed = false
                const pageInputsResponse = await requestFromBrowser('eval', 'exec', {
                  code: `Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'))
                    .slice(0, 10)
                    .map(el => {
                      const label = el.id && document.querySelector('label[for="' + el.id + '"]')?.innerText?.trim()
                      return label || el.placeholder || el.name || el.type || el.tagName.toLowerCase()
                    })
                    .filter(Boolean)`
                })
                const inputsOnPage = pageInputsResponse.data || []
                error = typeResponse.error || step.description || `Type in ${step.selector}`
                context = {
                  reason: typeResponse.error || 'Input element not found',
                  selector: step.selector,
                  fallbackSelector: step.fallbackSelector,
                  triedFallback: !!step.fallbackSelector,
                  inputsOnPage,
                  suggestion: inputsOnPage.length === 0
                    ? 'No input elements found - page may not have loaded or form is conditionally rendered'
                    : 'Input may have been renamed or removed'
                }
              } else {
                // Track which selector worked
                context = usedFallback ? { usedFallback, matchedSelector } : undefined
              }
            }
            break
          }
          
          case 'check': {
            // Check/uncheck a checkbox or radio — uses realistic click
            let checkResponse = await requestFromBrowser('interaction', 'click', {
              selector: step.selector,
            }, stepTimeout)
            
            let usedFallback = false
            let matchedSelector = step.selector
            
            // If primary selector failed and we have a fallback, try it
            if (!checkResponse.success && step.fallbackSelector) {
              checkResponse = await requestFromBrowser('interaction', 'click', {
                selector: step.fallbackSelector,
              }, stepTimeout)
              
              if (checkResponse.success) {
                usedFallback = true
                matchedSelector = step.fallbackSelector
              }
            }
            
            if (!checkResponse.success) {
              stepPassed = false
              error = checkResponse.error || step.description || `Check ${step.selector}`
              context = {
                reason: checkResponse.error || 'Element not found',
                selector: step.selector,
                fallbackSelector: step.fallbackSelector,
                triedFallback: !!step.fallbackSelector,
              }
            } else {
              // Track which selector worked
              context = usedFallback ? { usedFallback, matchedSelector } : undefined
            }
            break
          }

          case 'key': {
            await requestFromBrowser('events', 'dispatch', {
              selector: step.selector || 'body',
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

          // Text-selection and clipboard steps (recorded by the widget). Replayed
          // as the corresponding DOM event dispatched at the target element.
          case 'select':
          case 'cut':
          case 'copy':
          case 'paste': {
            const resp = await requestFromBrowser('events', 'dispatch', {
              selector: step.selector || 'body',
              event: step.action === 'select' ? 'select' : step.action,
            })
            if (!resp.success) {
              stepPassed = false
              error = resp.error || `Failed to ${step.action} on ${step.selector}`
            }
            break
          }
          
          case 'wait': {
            const waitDuration = step.duration ?? (step as any).ms
            if (waitDuration) {
              await new Promise(r => setTimeout(r, waitDuration))
            } else if (step.selector) {
              // Wait for selector to appear
              const waitStart = Date.now()
              let found = false
              while (Date.now() - waitStart < stepTimeout) {
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
            } else if (step.forWindow) {
              // Wait for a new window/tab to connect (use after tabs-open)
              const existingWindowIds = new Set(windows.keys())
              const waitStart = Date.now()
              let newWindowId: string | null = null
              while (Date.now() - waitStart < stepTimeout) {
                for (const id of windows.keys()) {
                  if (!existingWindowIds.has(id)) {
                    newWindowId = id
                    break
                  }
                }
                if (newWindowId) break
                await new Promise(r => setTimeout(r, 100))
              }
              if (!newWindowId) {
                stepPassed = false
                error = 'Timeout waiting for new window to connect'
                context = { existingWindows: Array.from(existingWindowIds) }
              } else {
                // Give widget time to fully initialize
                await new Promise(r => setTimeout(r, 300))
                context = { newWindowId }
              }
            } else if (step.url) {
              // Wait for URL to match
              const waitStart = Date.now()
              let matched = false
              const pattern = typeof step.url === 'string' ? step.url : step.url.source
              while (Date.now() - waitStart < stepTimeout) {
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
                // "visible" means rendered + not explicitly hidden + has dimensions.
                // It does NOT require the element to be in the viewport — tests
                // commonly assert visibility on content below the fold (especially
                // in headless CI with a small default viewport). Use a
                // `scrollIntoView` eval first if you actually need on-screen.
                const response = await requestFromBrowser('dom', 'inspect', { selector: assertion.selector })
                if (!response.success || !response.data) {
                  stepPassed = false
                  error = `Element not found: ${assertion.selector}`
                  break
                }
                const box = response.data.box || {}
                const display = box.display ?? response.data.styles?.display
                const visibility = box.visibility ?? response.data.styles?.visibility
                const isRendered = display !== 'none'
                  && visibility !== 'hidden'
                  && (box.width || 0) > 0
                  && (box.height || 0) > 0
                if (!isRendered) {
                  stepPassed = false
                  error = `Element is not visible: ${assertion.selector}`
                  context = {
                    display,
                    visibility,
                    width: box.width,
                    height: box.height,
                  }
                }
                break
              }

              case 'hidden': {
                const response = await requestFromBrowser('dom', 'inspect', { selector: assertion.selector })
                // Element not existing counts as hidden
                if (!response.success || !response.data) break

                const box = response.data.box || {}
                const display = box.display ?? response.data.styles?.display
                const visibility = box.visibility ?? response.data.styles?.visibility
                const isRendered = display !== 'none'
                  && visibility !== 'hidden'
                  && (box.width || 0) > 0
                  && (box.height || 0) > 0
                if (isRendered) {
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

              case 'console-empty': {
                const response = await requestFromBrowser('console', 'get', { since: 0 })
                if (!response.success) {
                  stepPassed = false
                  error = 'Could not get console entries'
                  break
                }
                const entries = response.data || []
                const offending = assertion.level
                  ? entries.filter((e: any) => e.level === assertion.level)
                  : entries
                if (offending.length > 0) {
                  stepPassed = false
                  error = `Expected console to be empty${assertion.level ? ` of ${assertion.level}` : ''}, found ${offending.length} entr${offending.length === 1 ? 'y' : 'ies'}`
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
            const response = await requestFromBrowser('eval', 'exec', { code: step.code }, stepTimeout)
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
            const timeout = Math.min(verifyStep.timeout ?? 5000, stepTimeout)
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

          case 'tabs-open': {
            const resp = await requestFromBrowser('tabs', 'open', { url: step.url }, stepTimeout)
            if (!resp.success) {
              stepPassed = false
              error = resp.error || 'Failed to open tab'
            }
            break
          }

          case 'tabs-close': {
            const resp = await requestFromBrowser('tabs', 'close', { windowId: step.window }, stepTimeout)
            if (!resp.success) {
              stepPassed = false
              error = resp.error || 'Failed to close tab'
            }
            break
          }

          case 'tabs-focus': {
            const resp = await requestFromBrowser('tabs', 'focus', { windowId: step.window }, stepTimeout)
            if (!resp.success) {
              stepPassed = false
              error = resp.error || 'Failed to focus tab'
            }
            // Update server-side focus tracking
            if (step.window && windows.has(step.window)) {
              focusedWindowId = step.window
            }
            break
          }

          default: {
            // Unknown action: fail loudly rather than silently passing (stepPassed
            // defaults to true, so a missing case would otherwise be a false pass).
            stepPassed = false
            error = `Unsupported step action: ${(step as { action?: string }).action}`
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
        // Track fallback selector usage
        usedFallback: context?.usedFallback,
        matchedSelector: context?.matchedSelector,
      })
      
      if (!stepPassed) {
        passed = false
        failureCount++
        consecutiveFailures++
        if (patience > 0) {
          remainingPatience--
          // Shrink timeout on failure (floor of 1s)
          currentTimeout = Math.max(1000, currentTimeout - timeoutBonusMs)
          // Patience or streak exhausted — stop after this step
          if (remainingPatience <= 0 || consecutiveFailures >= patienceStreak) break
        } else if (options.stopOnFailure) {
          break
        }
      } else if (patience > 0) {
        // Success: reset streak, earn timeout bonus (capped at initial)
        consecutiveFailures = 0
        currentTimeout = Math.min(initialTimeout, currentTimeout + timeoutBonusMs)
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

    // Build result object
    const result: TestRunResult = {
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
      ...(patience > 0 && {
        patience: {
          allowed: patience,
          streak: patienceStreak,
          failures: failureCount,
          consecutiveFailures,
          remaining: remainingPatience,
          finalTimeoutMs: currentTimeout,
        },
      }),
    }

    // Return in requested format
    if (format === 'github') {
      return new Response(formatTestGitHub(result, test, testFile), {
        headers: { ...headers, 'Content-Type': 'text/plain' }
      })
    } else if (format === 'human') {
      return new Response(formatTestHuman(result, test), {
        headers: { ...headers, 'Content-Type': 'text/plain' }
      })
    } else {
      return Response.json(result, { headers })
    }
  }
  
  // Run a test suite (multiple tests)
  if (path === '/test/suite' && req.method === 'POST') {
    const body = await req.json()
    const tests = (Array.isArray(body) ? body : body.tests) as DevChannelTest[]
    const format = (body.format || 'json') as OutputFormat
    const testFiles = body.testFiles as string[] | undefined  // Optional paths for GitHub annotations
    const options = {
      testDelay: body.testDelay ?? 500,  // ms between tests
      stepDelay: body.stepDelay ?? 100,
      timeout: body.timeout ?? 5000,
      stopOnFailure: body.stopOnFailure ?? false,  // continue to next test by default
    }

    const suiteStart = Date.now()
    const results: TestRunResult[] = []

    for (const test of tests) {
      // Run the test by making internal request (always get JSON, we format at suite level)
      const testResult = await handleRest(new Request(`http://localhost/test/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test, format: 'json', ...options,
          patience: body.patience,
          patienceStreak: body.patienceStreak,
          timeoutBonusMs: body.timeoutBonusMs,
        }),
      }))

      const result = await testResult.json() as TestRunResult
      results.push(result)

      if (!result.passed && options.stopOnFailure) break

      // Delay between tests
      await new Promise(r => setTimeout(r, options.testDelay))
    }

    // Build suite result
    const suiteResult: SuiteRunResult = {
      duration: Date.now() - suiteStart,
      results,
      summary: {
        total: tests.length,
        executed: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
      },
    }

    // Return in requested format
    if (format === 'github') {
      return new Response(formatSuiteGitHub(suiteResult, tests, testFiles), {
        headers: { ...headers, 'Content-Type': 'text/plain' }
      })
    } else if (format === 'human') {
      return new Response(formatSuiteHuman(suiteResult, tests), {
        headers: { ...headers, 'Content-Type': 'text/plain' }
      })
    } else {
      return Response.json(suiteResult, { headers })
    }
  }
  
  // ============================================
  // Snapshot endpoints
  // ============================================
  
  // Capture a snapshot of current page state
  if (path === '/snapshot') {
    return schemaEndpoint(api.snapshot, req, headers, async (body) => {
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
        const snapshotData: PageSnapshot = {
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
        snapshots.set(snapshotId, snapshotData)
        saveSnapshotToDisk(snapshotData)
        
        return Response.json({ 
          snapshotId,
          timestamp: snapshotData.timestamp,
          url: snapshotData.url,
          title: snapshotData.title,
        }, { headers })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500, headers })
      }
    })
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
  
  // Send a recording to an agent
  // POST /recording/:id/send { description?: "What this recording shows", agentId?: "shell-id", agentName?: "Claude" }
  if (path.match(/^\/recording\/[^/]+\/send$/) && req.method === 'POST') {
    const recordingId = path.slice('/recording/'.length, -'/send'.length)
    const body = await req.json() as { description?: string; agentId?: string; agentName?: string }
    
    const recording = recordings.get(recordingId)
    if (!recording) {
      return Response.json({ error: 'Recording not found' }, { status: 404, headers })
    }
    
    // Find target agent - use provided id, name, last active, or first available
    let targetSession = body.agentId 
      ? getAgentSession(body.agentId)
      : body.agentName 
        ? getAgentSession(getShellByName(terminalState, body.agentName)?.id || '')
        : getLastActiveAgent()
    
    if (!targetSession) {
      return Response.json({ error: 'No agent available - open an agent tab first' }, { status: 404, headers })
    }
    
    const targetShell = terminalState.shells.get(targetSession.id)
    if (!targetShell) {
      return Response.json({ error: 'Agent shell not found' }, { status: 404, headers })
    }
    
    // Format using shared module (indented for humans, refs for agents)
    const messageText = formatRecordingMessage(
      recording.events as SemanticEvent[],
      recording.title || 'Untitled',
      recording.url,
      body.description
    )
    
    // Send directly to the agent's terminal UI for pasting (don't queue server-side)
    try {
      if ((targetShell.ws as any).readyState === WebSocket.OPEN) {
        (targetShell.ws as any).send(JSON.stringify({
          type: 'agent-message-queued',
          from: 'browser',
          text: messageText,
          count: 0, // Not queued server-side
        }))
        
        return Response.json({ 
          sent: true, 
          agentName: targetShell.name || targetShell.id,
          eventCount: recording.events.length,
        }, { headers })
      } else {
        return Response.json({ error: 'Agent not connected' }, { status: 503, headers })
      }
    } catch {
      return Response.json({ error: 'Failed to send to agent' }, { status: 500, headers })
    }
  }
  
  // /select/start, /select/cancel, /select/clear - now handled by api-router
  
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
  
  // POST /selection/send - Send selection to an agent
  if (path === '/selection/send' && req.method === 'POST') {
    const body = await req.json() as { agentId: string; message: string; context?: string }
    
    if (!body.agentId || !body.message) {
      return Response.json({ error: 'agentId and message required' }, { status: 400, headers })
    }
    
    // Find the agent's shell
    const targetShell = terminalState.shells.get(body.agentId)
    if (!targetShell) {
      return Response.json({ error: 'Agent not found' }, { status: 404, headers })
    }
    
    // Send directly to the agent's terminal UI for pasting (don't queue server-side)
    try {
      if ((targetShell.ws as any).readyState === WebSocket.OPEN) {
        (targetShell.ws as any).send(JSON.stringify({
          type: 'agent-message-queued',
          from: 'browser',
          text: body.message, // Send the full message content
          count: 0, // Not queued server-side
        }))
        
        return Response.json({ 
          sent: true, 
          agentName: targetShell.name || targetShell.id,
        }, { headers })
      } else {
        return Response.json({ error: 'Agent not connected' }, { status: 503, headers })
      }
    } catch {
      return Response.json({ error: 'Failed to send to agent' }, { status: 500, headers })
    }
  }
  
  // POST /send/message - Send a plain text message to an agent
  // hj send <agentName> <message> → POST /send/message { agent: "name", message: "text", submit: true }
  if (path === '/send/message' && req.method === 'POST') {
    const body = await req.json() as { agent?: string; agentId?: string; message: string; submit?: boolean }
    
    if (!body.message) {
      return Response.json({ error: 'message required' }, { status: 400, headers })
    }
    
    // Default to submit: true for CLI usage
    const shouldSubmit = body.submit !== false
    
    // Find target agent - by name, id, or last active
    let targetShell: ShellIdentity | null = null
    if (body.agent) {
      targetShell = getShellByName(terminalState, body.agent)
    } else if (body.agentId) {
      targetShell = terminalState.shells.get(body.agentId) || null
    } else {
      // Use last active agent
      const lastActive = getLastActiveAgent()
      if (lastActive) {
        targetShell = terminalState.shells.get(lastActive.id) || null
      }
    }
    
    if (!targetShell) {
      const agents = listAgentSessions()
      if (agents.length === 0) {
        return Response.json({ error: 'No agents available - open an agent tab first' }, { status: 404, headers })
      }
      return Response.json({ 
        error: body.agent ? `Agent "${body.agent}" not found` : 'No target agent specified',
        available: agents.map(a => a.name || a.id),
      }, { status: 404, headers })
    }
    
    // Send directly to the agent's terminal UI
    try {
      if ((targetShell.ws as any).readyState === WebSocket.OPEN) {
        (targetShell.ws as any).send(JSON.stringify({
          type: 'agent-message-queued',
          from: 'cli',
          text: body.message,
          submit: shouldSubmit,
          count: 0,
        }))
        
        return Response.json({ 
          sent: true, 
          agent: targetShell.name || targetShell.id,
          submitted: shouldSubmit,
        }, { headers })
      } else {
        return Response.json({ error: 'Agent not connected' }, { status: 503, headers })
      }
    } catch {
      return Response.json({ error: 'Failed to send to agent' }, { status: 500, headers })
    }
  }
  
  // POST /send/selection - Send current browser selection to an agent (shorthand)
  if (path === '/send/selection' && req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as { agent?: string; agentId?: string; context?: string; submit?: boolean }
    
    // Default to submit: true for CLI usage
    const shouldSubmit = body.submit !== false
    
    // Get the current selection from the browser. The widget returns the
    // selection result object in `data` (elements, region, screenshot).
    const selectionResp = await requestFromBrowser('selection', 'result', {})
    const selection = selectionResp?.data as { elements?: SelectionElement[] } | undefined
    if (!selection?.elements?.length) {
      return Response.json({ error: 'No selection available - use the selection tool in browser first' }, { status: 400, headers })
    }
    
    // Find target agent
    let targetShell: ShellIdentity | null = null
    if (body.agent) {
      targetShell = getShellByName(terminalState, body.agent)
    } else if (body.agentId) {
      targetShell = terminalState.shells.get(body.agentId) || null
    } else {
      const lastActive = getLastActiveAgent()
      if (lastActive) {
        targetShell = terminalState.shells.get(lastActive.id) || null
      }
    }
    
    if (!targetShell) {
      return Response.json({ error: 'No agent available' }, { status: 404, headers })
    }
    
    // Format selection message. Page title/URL come from the focused window's
    // tracked state; optional caller context is prepended.
    const { formatSelectionMessage } = await import('./agent-message-format')
    const selWindow = focusedWindowId ? windows.get(focusedWindowId) : undefined
    let messageText = formatSelectionMessage(
      selection.elements,
      selWindow?.title || '',
      selWindow?.url || '',
    )
    if (body.context) messageText = `${body.context}\n\n${messageText}`
    
    // Send to agent
    try {
      if ((targetShell.ws as any).readyState === WebSocket.OPEN) {
        (targetShell.ws as any).send(JSON.stringify({
          type: 'agent-message-queued',
          from: 'browser',
          text: messageText,
          submit: shouldSubmit,
          count: 0,
        }))
        
        return Response.json({ 
          sent: true, 
          agent: targetShell.name || targetShell.id,
          elementCount: selection.elements?.length || 0,
          submitted: shouldSubmit,
        }, { headers })
      } else {
        return Response.json({ error: 'Agent not connected' }, { status: 503, headers })
      }
    } catch {
      return Response.json({ error: 'Failed to send selection' }, { status: 500, headers })
    }
  }
  
  // POST /send/recording - Send current or specified recording to an agent
  if (path === '/send/recording' && req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as { agent?: string; agentId?: string; recordingId?: string; description?: string; submit?: boolean }
    
    // Default to submit: true for CLI usage
    const shouldSubmit = body.submit !== false
    
    // Find the recording - use specified ID or most recent
    let recording: any = null
    let recordingId = body.recordingId
    
    if (recordingId) {
      recording = recordings.get(recordingId)
    } else {
      // Get most recent recording
      let mostRecent: any = null
      let mostRecentTime = 0
      for (const [id, rec] of recordings) {
        const startTime = (rec.events as any[])?.[0]?.timestamp || 0
        if (startTime > mostRecentTime) {
          mostRecent = rec
          mostRecentTime = startTime
          recordingId = id
        }
      }
      recording = mostRecent
    }
    
    if (!recording) {
      return Response.json({ error: 'No recording available - start recording in browser first' }, { status: 400, headers })
    }
    
    // Find target agent
    let targetShell: ShellIdentity | null = null
    if (body.agent) {
      targetShell = getShellByName(terminalState, body.agent)
    } else if (body.agentId) {
      targetShell = terminalState.shells.get(body.agentId) || null
    } else {
      const lastActive = getLastActiveAgent()
      if (lastActive) {
        targetShell = terminalState.shells.get(lastActive.id) || null
      }
    }
    
    if (!targetShell) {
      return Response.json({ error: 'No agent available' }, { status: 404, headers })
    }
    
    // Format recording message
    const { formatRecordingMessage } = await import('./agent-message-format')
    const messageText = formatRecordingMessage(
      recording.events as SemanticEvent[],
      recording.title || 'Untitled',
      recording.url,
      body.description
    )
    
    // Send to agent
    try {
      if ((targetShell.ws as any).readyState === WebSocket.OPEN) {
        (targetShell.ws as any).send(JSON.stringify({
          type: 'agent-message-queued',
          from: 'browser',
          text: messageText,
          submit: shouldSubmit,
          count: 0,
        }))
        
        return Response.json({ 
          sent: true, 
          agent: targetShell.name || targetShell.id,
          eventCount: recording.events.length,
          recordingId,
          submitted: shouldSubmit,
        }, { headers })
      } else {
        return Response.json({ error: 'Agent not connected' }, { status: 503, headers })
      }
    } catch {
      return Response.json({ error: 'Failed to send recording' }, { status: 500, headers })
    }
  }
  
  // ==========================================
  // Window Management Endpoints
  // ==========================================
  
  // GET /windows - List all connected windows
  if (path === '/windows' && req.method === 'GET') {
    // Desktop app: if no windows are connected, signal the parent process to
    // create one and wait briefly. Skip for plain server mode to avoid blocking.
    if (isDesktopApp && windows.size === 0) {
      console.log('__NEED_WINDOW__')
      const waitStart = Date.now()
      while (Date.now() - waitStart < 8000) {
        if (windows.size > 0) break
        await new Promise(r => setTimeout(r, 250))
      }
    }

    const allWindows = Array.from(windows.values())

    const windowList = allWindows.map(w => ({
      id: w.id,
      url: w.url,
      title: w.title,
      active: w.active,
      focused: w.id === focusedWindowId,
      connectedAt: w.connectedAt,
      lastSeen: w.lastSeen,
      label: w.label,
      windowType: w.windowType || 'tab',
    }))

    const hint = windowList.length > 1
      ? 'Multiple tabs connected. Use ?window=<id> to target specific tab (e.g., /tree?window=abc123)'
      : windowList.length === 1
        ? 'One tab connected. Commands automatically target it.'
        : 'No tabs connected. Inject the widget into a browser tab.'

    return Response.json({
      windows: windowList,
      focused: focusedWindowId,
      count: windowList.length,
      hint,
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
  
  // POST /windows/blur - Clear focused window (e.g. when desktop app switches to terminal/agent tab)
  if (path === '/windows/blur' && req.method === 'POST') {
    const previousFocused = focusedWindowId
    focusedWindowId = null
    return Response.json({ 
      success: true, 
      previousFocused,
      message: 'No window focused — commands require explicit ?window= parameter'
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
  idleTimeout: 30, // 30 seconds for slow operations like screenshots
  fetch(req: Request, server: any) {
    const url = new URL(req.url)

    // WebSocket upgrade — gated by token if REQUIRED_TOKEN is set
    if (url.pathname === '/ws/browser' || url.pathname === '/ws/agent' || url.pathname === '/ws/terminal') {
      if (REQUIRED_TOKEN) {
        const provided = url.searchParams.get('token') || req.headers.get('X-Haltija-Token') || ''
        if (provided !== REQUIRED_TOKEN) {
          return new Response('Unauthorized', { status: 401 })
        }
      }
      const type = url.pathname.slice('/ws/'.length) // 'browser' | 'agent' | 'terminal'
      const upgraded = server.upgrade(req, { data: { type } })
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
      } else if (type === 'terminal') {
        terminalClients.add(ws as unknown as WebSocket)
        // Register shell identity
        const shell = registerShell(terminalState, ws)
        // Send identity + current status + cwd
        ws.send(JSON.stringify({ type: 'identity', shellId: shell.id, cwd: shell.cwd }))
        const line = getStatusLine(terminalState)
        ws.send(JSON.stringify({ type: 'status', line }))
        // Broadcast join to other terminals
        broadcastToTerminals({ type: 'shell-joined', shellId: shell.id })
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

              // Focus this window if nothing is focused, it was previously
              // focused, or it's a visible tab. A freshly-opened foreground tab
              // should receive untargeted commands; a background-loaded tab
              // reports active:false and won't steal focus. (Only real tabs —
              // never iframes/popups — become the untargeted-command target.)
              const isVisibleTab = (windowType || 'tab') === 'tab' && active !== false
              if (!focusedWindowId || focusedWindowId === windowId || isVisibleTab) {
                focusedWindowId = windowId
              }
              
              console.log(`${LOG_PREFIX} Window connected: ${windowId} (${url})`)
              
              // Update hj status for terminals
              updateHjStatus()
            }
            
            // Check if widget has a different server session ID
            // This can happen when:
            // 1. Server restarted and widget hasn't reloaded
            // 2. External browser connected to a different server instance
            // Instead of forcing reload (which can cause infinite loops with cached widgets),
            // just log it and accept the connection. The widget will work fine.
            const widgetSessionId = data.payload.serverSessionId
            if (widgetSessionId && widgetSessionId !== SERVER_SESSION_ID) {
              console.log(`${LOG_PREFIX} Widget from different session (${widgetSessionId.slice(0, 8)}... vs ${SERVER_SESSION_ID.slice(0, 8)}...), accepting anyway`)
            }
            
            // Check if there's an active recording session for this window
            if (windowId) {
              const recordingSession = activeRecordingSessions.get(windowId)
              if (recordingSession) {
                console.log(`${LOG_PREFIX} Resuming recording for window ${windowId}`)
                wsTyped.send(JSON.stringify({
                  id: uid(),
                  channel: 'recording',
                  action: 'resume',
                  payload: { 
                    windowId,
                    startTime: recordingSession.startTime,
                    eventCount: recordingSession.events.length
                  },
                  timestamp: Date.now(),
                  source: 'server'
                }))
              }
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
              // Focus follows the visible tab: when a tab reports it became
              // active (visible/foreground), route subsequent untargeted
              // commands to it. Ignore iframes/popups so they can't hijack.
              if (active && win.windowType === 'tab') {
                focusedWindowId = windowId
              }
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
              focusedWindowId = windows.size > 0 ? (windows.keys().next().value ?? null) : null
            }
            // Update hj status for terminals
            updateHjStatus()
            break
          }
        }
      } else if (type === 'agent') {
        agents.delete(ws as unknown as WebSocket)
      } else if (type === 'terminal') {
        terminalClients.delete(ws as unknown as WebSocket)
        const shell = getShellByWs(terminalState, ws)
        if (shell) {
          unregisterShell(terminalState, shell.id)
          broadcastToTerminals({ type: 'shell-left', shellId: shell.id, name: shell.name })
        }
      }
    },
  },
}

// Helper: Kill process using a port (returns true if killed something)
function killProcessOnPort(port: number): boolean {
  const myPid = process.pid.toString()
  try {
    // Use lsof to find PID using the port
    const output = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim()
    if (output) {
      const pids = output.split('\n').filter(Boolean).filter(pid => pid !== myPid)
      if (pids.length === 0) {
        // Only found our own PID - nothing to kill
        return false
      }
      for (const pid of pids) {
        try {
          execSync(`kill ${pid} 2>/dev/null`)
          console.log(`  [port] Killed existing process ${pid} on port ${port}`)
        } catch {
          // Process may have already exited
        }
      }
      // Give it a moment to release the port
      Bun.sleepSync(100)
      return true
    }
  } catch {
    // No process found or lsof not available
  }
  return false
}

/** The pid listening on a port, if we can tell. Never returns our own. */
function pidOnPort(port: number): number | null {
  try {
    const out = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim()
    const pids = out.split('\n').filter(Boolean).map(Number)
      .filter((p) => Number.isFinite(p) && p !== process.pid)
    return pids[0] ?? null
  } catch {
    return null
  }
}

/** Ask a port what it is. Anything that doesn't answer cleanly is "not haltija". */
async function probePort(port: number): Promise<ServerProbe> {
  const unknown: ServerProbe = { port, version: null, desktopApp: false, pid: null }
  try {
    const resp = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(1000) })
    if (!resp.ok) return unknown
    const status = await resp.json() as { serverVersion?: unknown; desktopApp?: unknown; pid?: unknown }
    if (typeof status?.serverVersion !== 'string') return unknown
    return {
      port,
      version: status.serverVersion,
      desktopApp: !!status.desktopApp,
      // Servers from 1.4.0 on report their own pid; older ones need lsof.
      pid: typeof status.pid === 'number' ? status.pid : pidOnPort(port),
    }
  } catch {
    return unknown
  }
}

/**
 * Retire pre-1.4.0 servers before we bind.
 *
 * They overwrite the shared ~/.local/bin/hj on every boot and squat the default
 * port, and neither behavior can be fixed in code that has already shipped — the
 * only remedy is to stop them running. Done before binding so that a legacy
 * squatter on the port we want is actually reclaimed rather than merely killed
 * after we've already fallen back to an ephemeral port.
 *
 * Policy (and the reasoning for it) lives in src/legacy-servers.ts. Set
 * HALTIJA_NO_RETIRE=1 to disable.
 */
async function retireLegacyServers(): Promise<void> {
  if (process.env.HALTIJA_NO_RETIRE === '1') return

  const registryPorts = listInstances().map((e) => e.port)
  const ports = candidatePorts({ defaults: [8700, 8701, PORT], registryPorts })
  let killed = false

  for (const port of ports) {
    const plan = planForServer(await probePort(port), process.pid)

    if (plan.action === 'retire') {
      console.log(`  [legacy] ${plan.reason}`)
      try {
        process.kill(plan.pid, 'SIGTERM')
        console.log(`  [legacy] Retired pid ${plan.pid} on :${port}`)
        killed = true
      } catch (err: unknown) {
        // Complain — never fail silently. A legacy server we couldn't stop will
        // go on overwriting the user's hj, and they need to know why.
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`  [legacy] ⚠️  Could not stop pid ${plan.pid} on :${port} (${msg})`)
        console.warn(`  [legacy]    It will keep overwriting ~/.local/bin/hj. Stop it with: kill ${plan.pid}`)
      }
    } else if (plan.action === 'complain') {
      console.warn(`  [legacy] ⚠️  ${plan.reason}`)
      console.warn(`  [legacy]    ${plan.remedy}`)
    }
  }

  // Give a retired server a moment to release its port before we try to bind it.
  if (killed) Bun.sleepSync(200)
}

await retireLegacyServers()

// Start servers based on mode
let httpServer: ReturnType<typeof Bun.serve> | null = null
let httpsServer: ReturnType<typeof Bun.serve> | null = null

if (USE_HTTP) {
  try {
    httpServer = Bun.serve({
      port: PORT,
      ...serverConfig,
    })
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE') {
      if (PORT_IS_STRICT) {
        // User asked for a specific port — try to free it and retry.
        if (killProcessOnPort(PORT)) {
          httpServer = Bun.serve({ port: PORT, ...serverConfig })
        } else {
          throw err
        }
      } else {
        // No preference — fall back to an ephemeral port.
        httpServer = Bun.serve({ port: 0, ...serverConfig })
      }
    } else {
      throw err
    }
  }
  PORT = httpServer.port ?? PORT
}

if (USE_HTTPS) {
  const tls = {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  }
  try {
    httpsServer = Bun.serve({ port: HTTPS_PORT, tls, ...serverConfig })
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE') {
      if (PORT_IS_STRICT) {
        if (killProcessOnPort(HTTPS_PORT)) {
          httpsServer = Bun.serve({ port: HTTPS_PORT, tls, ...serverConfig })
        } else {
          throw err
        }
      } else {
        httpsServer = Bun.serve({ port: 0, tls, ...serverConfig })
      }
    } else {
      throw err
    }
  }
  HTTPS_PORT = httpsServer.port ?? HTTPS_PORT
}

// Build URLs for display
const httpUrl = USE_HTTP ? `http://localhost:${PORT}` : null
const httpsUrl = USE_HTTPS ? `https://localhost:${HTTPS_PORT}` : null
const primaryUrl = httpsUrl || httpUrl

// Register this instance so `hj` can find it again — by name (`hj --name
// <foo>`) and, because the entry records our cwd, by directory: plain `hj`
// run anywhere inside this project routes here with no flags. We register the
// public HTTP port (the one agents target) — HTTPS is just a transport choice
// for the same logical server.
//
// The desktop app is deliberately excluded from *auto* registration. It owns
// the zero-config default port and is launched from wherever Electron happened
// to start, so its cwd says nothing about which project it serves; letting it
// win a cwd match would reintroduce the cross-project misrouting this exists to
// prevent. An explicit --name on a desktop server is still honored.
const REGISTRY_NAME = INSTANCE_NAME || (isDesktopApp ? '' : autoNameFor(PORT))
if (REGISTRY_NAME) {
  try {
    registerNamedInstance(REGISTRY_NAME, PORT, { auto: !INSTANCE_NAME })
    const cleanup = () => {
      try { unregisterNamedInstance(REGISTRY_NAME) } catch {}
    }
    process.on('SIGINT', () => { cleanup(); process.exit(130) })
    process.on('SIGTERM', () => { cleanup(); process.exit(143) })
    process.on('exit', cleanup)
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to register instance "${REGISTRY_NAME}":`, err instanceof Error ? err.message : err)
  }
}

// Auto-install hj CLI to ~/.local/bin (no sudo needed)
// For compiled binary (DMG), copies bundled binary
// For source install (bunx), creates symlink to source
//
// `hj` is a single global binary on the user's PATH, but every haltija server
// carries its own copy — so a server that overwrites it is deciding which `hj`
// *every project on the machine* runs. Three rules keep that from turning into a
// last-server-to-boot-wins race (which is exactly how a stale `bunx haltija@beta`
// ends up owning the `hj` of an unrelated, up-to-date project):
//
//   1. Never touch a symlink. A symlink is a deliberate install — typically a
//      developer pointing hj at their own build — and clobbering it silently
//      reverts their tooling under them.
//   2. Never downgrade. We record the version we install in ~/.haltija/hj-install.json;
//      an older server seeing a newer version there leaves it alone.
//   3. Compare content, not file size. Two different builds can coincidentally
//      share a byte count, and then a stale hj is never refreshed.
;(async () => {
  const localBin = join(homedir(), '.local', 'bin')
  const hjTarget = join(localBin, 'hj')
  const installRecord = join(homedir(), '.haltija', 'hj-install.json')
  const isCompiledBinary = __dirname.startsWith('/$bunfs/') || __dirname.startsWith('/snapshot/')

  /** True if `p` exists and is a symlink (deliberate install — hands off). */
  const isSymlink = (p: string): boolean => {
    try { return lstatSync(p).isSymbolicLink() } catch { return false }
  }

  /** True if the two files have identical contents. */
  const sameContents = (a: string, b: string): boolean => {
    try { return readFileSync(a).equals(readFileSync(b)) } catch { return false }
  }

  /** The version of the hj currently installed, per our own record. */
  const installedVersion = (): string | null => {
    try {
      const rec = JSON.parse(readFileSync(installRecord, 'utf-8'))
      return typeof rec?.version === 'string' ? rec.version : null
    } catch {
      return null
    }
  }

  /** Remember what we just put on the user's PATH, so older servers defer to it. */
  const recordInstall = (): void => {
    try {
      mkdirSync(dirname(installRecord), { recursive: true })
      writeFileSync(installRecord, JSON.stringify({ version: VERSION, installedAt: Date.now() }, null, 2))
    } catch {
      // Best effort: a missing record only costs us the downgrade guard.
    }
  }

  try {
    // Create ~/.local/bin if needed
    if (!existsSync(localBin)) {
      mkdirSync(localBin, { recursive: true })
    }

    if (isSymlink(hjTarget)) {
      // Someone pointed hj at a build on purpose. Leave it exactly as it is.
      return
    }

    // Refuse to replace a newer hj with our older one. An unknown or unparseable
    // recorded version is NOT treated as older — we'd rather refresh a legacy
    // copy once than silently roll a user's tooling backwards.
    const existing = existsSync(hjTarget) ? installedVersion() : null
    if (existing && isOlderThan(VERSION, existing)) {
      console.log(`  [hj] Keeping newer hj ${existing} already installed (this server is ${VERSION})`)
      return
    }

    if (isCompiledBinary) {
      // Running from compiled binary (DMG distribution)
      // Look for bundled hj binary in resources directory
      // The server binary is at /path/to/Resources/haltija-server-<arch>
      // The hj binary should be at /path/to/Resources/hj-<arch>
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      
      // When running as compiled binary, we need to find the resources dir
      // process.execPath points to the actual binary location
      const resourcesDir = dirname(process.execPath)
      const hjBundled = join(resourcesDir, `hj-${arch}`)
      
      if (!existsSync(hjBundled)) {
        console.log(`  [hj] Bundled binary not found: ${hjBundled}`)
        return
      }
      
      // Already installed and byte-identical? Nothing to do.
      const needsInstall = !existsSync(hjTarget) || !sameContents(hjBundled, hjTarget)

      if (needsInstall) {
        // Copy binary to ~/.local/bin
        if (existsSync(hjTarget)) {
          unlinkSync(hjTarget)
        }
        copyFileSync(hjBundled, hjTarget)
        chmodSync(hjTarget, 0o755) // Make executable
        recordInstall()
        console.log(`  [hj] Installed: ${hjTarget} (from bundled binary, v${VERSION})`)
      }
    } else {
      // Running from source (bunx or development)
      // Prefer standalone bundle (dist/hj.js) — works even if source tree is gone
      const hjBundle = join(__dirname, 'hj.js')
      const hjSource = join(__dirname, '..', 'bin', 'hj.mjs')
      const useBundle = existsSync(hjBundle)
      const source = useBundle ? hjBundle : hjSource
      
      if (!existsSync(source)) {
        console.log(`  [hj] Source not found: ${hjBundle} or ${hjSource}`)
        return
      }
      
      // Check if target already matches source. (A symlinked target already
      // returned above, so this is always a real file.)
      const needsInstall = !existsSync(hjTarget) || !sameContents(source, hjTarget)

      if (needsInstall) {
        if (existsSync(hjTarget)) {
          unlinkSync(hjTarget)
        }
        if (useBundle) {
          // Copy standalone bundle — works from any location
          copyFileSync(source, hjTarget)
          chmodSync(hjTarget, 0o755)
          recordInstall()
          console.log(`  [hj] Installed: ${hjTarget} (standalone bundle, v${VERSION})`)
        } else {
          // Fallback: symlink to source (dev mode only)
          symlinkSync(source, hjTarget)
          recordInstall()
          console.log(`  [hj] Installed: ${hjTarget} -> ${source}`)
        }
      }
    }
    
    // Ensure ~/.local/bin is in PATH for this process and its children
    const pathDirs = (process.env.PATH || '').split(':')
    if (!pathDirs.includes(localBin)) {
      process.env.PATH = `${localBin}:${process.env.PATH}`
      console.log(`  [hj] Added ~/.local/bin to PATH for this session`)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`  [hj] Auto-install skipped: ${msg}`)
  }
})()

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
if (INSTANCE_NAME) {
  console.log(`  NAME:      ${INSTANCE_NAME}   (use HALTIJA_NAME=${INSTANCE_NAME} hj <cmd>)`)
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
