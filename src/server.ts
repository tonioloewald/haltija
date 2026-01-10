/**
 * Dev Channel Server
 * 
 * A Bun-based server that:
 * - Accepts WebSocket connections from browser components
 * - Provides REST API for agent/CLI communication
 * - Routes messages between browsers and agents
 * - Buffers recent messages for late joiners
 */

import type { DevMessage, DevResponse, ConsoleEntry, BuildEvent } from './types'
import { injectorCode } from './bookmarklet'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PORT = parseInt(process.env.DEV_CHANNEL_PORT || '8700')

// Load component.js from dist
let componentJs = ''
try {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  componentJs = readFileSync(join(__dirname, '../dist/component.js'), 'utf-8')
} catch {
  console.warn('[tosijs-dev] Could not load component.js from dist/')
}

// Connected browser clients (WebSocket -> browserId)
const browsers = new Map<WebSocket, string>()

// Connected agent clients (could be multiple)
const agents = new Set<WebSocket>()

// Track the currently active browser ID
let activeBrowserId: string | null = null

// Message buffer for late joiners
const messageBuffer: DevMessage[] = []
const MAX_BUFFER = 100

// Pending responses (request id -> resolver)
const pendingResponses = new Map<string, {
  resolve: (r: DevResponse) => void
  timeout: ReturnType<typeof setTimeout>
}>()

// Generate unique IDs
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

function bufferMessage(msg: DevMessage) {
  messageBuffer.push(msg)
  if (messageBuffer.length > MAX_BUFFER) {
    messageBuffer.shift()
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
async function requestFromBrowser(
  channel: string, 
  action: string, 
  payload: any,
  timeoutMs = 5000
): Promise<DevResponse> {
  if (browsers.size === 0) {
    return { id: '', success: false, error: 'No browser connected', timestamp: Date.now() }
  }
  
  const id = uid()
  const msg: DevMessage = {
    id,
    channel,
    action,
    payload,
    timestamp: Date.now(),
    source: 'agent',
  }
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingResponses.delete(id)
      resolve({ id, success: false, error: 'Timeout', timestamp: Date.now() })
    }, timeoutMs)
    
    pendingResponses.set(id, { resolve, timeout })
    sendToBrowsers(msg)
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
    
    // Don't buffer system messages, but do broadcast them
    if (msg.channel !== 'system') {
      bufferMessage(msg)
    }
    
    // Broadcast all messages
    broadcast(msg, ws)
    
  } catch (err) {
    console.error('[tosijs-dev] Invalid message:', err)
  }
}

// REST API handlers
async function handleRest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers })
  }
  
  // Static files for bookmarklet injection
  if (path === '/inject.js') {
    return new Response(injectorCode, { 
      headers: { ...headers, 'Content-Type': 'application/javascript' } 
    })
  }
  
  if (path === '/component.js') {
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
  
  // Serve a simple test page
  if (path === '/' || path === '/test' || path === '/test.html') {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Dev Channel Test</title>
  <script type="module" src="/component.js"></script>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
    h1 { color: #333; }
    .bookmarklet { 
      display: inline-block; padding: 12px 24px; background: #6366f1; 
      color: white; text-decoration: none; border-radius: 8px; font-weight: 600; 
    }
    .bookmarklet:hover { background: #4f46e5; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
    pre { background: #f3f4f6; padding: 16px; border-radius: 8px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>Dev Channel</h1>
  <p>The widget should appear in the bottom-right corner.</p>
  
  <h2>Bookmarklet</h2>
  <p>Drag this to your bookmarks bar:</p>
  <a class="bookmarklet" href="javascript:(function(){fetch('http://localhost:${PORT}/inject.js').then(r=>r.text()).then(eval).catch(e=>alert('Cannot reach server'))})();">Dev Channel</a>
  
  <h2>Test Controls</h2>
  <button onclick="console.log('Test log', Date.now())">Log to Console</button>
  <button onclick="console.error('Test error', Date.now())">Log Error</button>
  <button onclick="alert('Hello!')">Show Alert</button>
  
  <h2>Test Input</h2>
  <input id="test-input" placeholder="Type here...">
  <button id="test-button" onclick="document.getElementById('result').textContent = 'Clicked!'">Click Me</button>
  <div id="result"></div>
  
  <tosijs-dev server="ws://localhost:${PORT}/ws/browser"></tosijs-dev>
</body>
</html>`
    return new Response(html, { 
      headers: { ...headers, 'Content-Type': 'text/html' } 
    })
  }
  
  // Status endpoint
  if (path === '/status') {
    return Response.json({
      browsers: browsers.size,
      agents: agents.size,
      bufferedMessages: messageBuffer.length,
    }, { headers })
  }
  
  // Get recent messages
  if (path === '/messages' && req.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') || '0')
    const messages = messageBuffer.filter(m => m.timestamp > since)
    return Response.json(messages, { headers })
  }
  
  // Send message (for agents without WebSocket)
  if (path === '/send' && req.method === 'POST') {
    const body = await req.json()
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
  if (path === '/request' && req.method === 'POST') {
    const body = await req.json()
    const response = await requestFromBrowser(
      body.channel,
      body.action,
      body.payload,
      body.timeout || 5000
    )
    return Response.json(response, { headers })
  }
  
  // DOM query shorthand
  if (path === '/query' && req.method === 'POST') {
    const body = await req.json()
    const response = await requestFromBrowser('dom', 'query', {
      selector: body.selector,
      all: body.all,
    })
    return Response.json(response, { headers })
  }
  
  // Console get shorthand
  if (path === '/console' && req.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') || '0')
    const response = await requestFromBrowser('console', 'get', { since })
    return Response.json(response, { headers })
  }
  
  // Eval shorthand
  if (path === '/eval' && req.method === 'POST') {
    const body = await req.json()
    const response = await requestFromBrowser('eval', 'exec', { code: body.code })
    return Response.json(response, { headers })
  }
  
  // Click shorthand - fires full mouse event lifecycle
  if (path === '/click' && req.method === 'POST') {
    const body = await req.json()
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
  if (path === '/drag' && req.method === 'POST') {
    const body = await req.json()
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
  
  // Type shorthand
  if (path === '/type' && req.method === 'POST') {
    const body = await req.json()
    
    // Scroll element into view first
    await requestFromBrowser('eval', 'exec', {
      code: `document.querySelector(${JSON.stringify(body.selector)})?.scrollIntoView({behavior: "smooth", block: "center"})`
    })
    await new Promise(r => setTimeout(r, 100))
    
    const response = await requestFromBrowser('events', 'dispatch', {
      selector: body.selector,
      event: 'input',
      options: { value: body.text },
    })
    return Response.json(response, { headers })
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
  if (path === '/navigate' && req.method === 'POST') {
    const body = await req.json()
    const response = await requestFromBrowser('navigation', 'goto', { url: body.url })
    return Response.json(response, { headers })
  }
  
  // Get current URL and title
  if (path === '/location' && req.method === 'GET') {
    const response = await requestFromBrowser('navigation', 'location', {})
    return Response.json(response, { headers })
  }
  
  // Restart the server
  if (path === '/restart' && req.method === 'POST') {
    console.log('[tosijs-dev] Restart requested, exiting...')
    setTimeout(() => process.exit(0), 100)
    return Response.json({ success: true, message: 'Server restarting...' }, { headers })
  }
  
  // Clear message buffer (useful for debugging)
  if (path === '/clear' && req.method === 'POST') {
    messageBuffer.length = 0
    console.log('[tosijs-dev] Message buffer cleared')
    return Response.json({ success: true }, { headers })
  }
  
  // Start watching DOM mutations
  if (path === '/mutations/watch' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const response = await requestFromBrowser('mutations', 'watch', {
      root: body.root,
      childList: body.childList ?? true,
      attributes: body.attributes ?? true,
      characterData: body.characterData ?? false,
      subtree: body.subtree ?? true,
      debounce: body.debounce ?? 100,
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
  
  // Inspect element (detailed view)
  if (path === '/inspect' && req.method === 'POST') {
    const body = await req.json()
    const response = await requestFromBrowser('dom', 'inspect', { selector: body.selector })
    return Response.json(response, { headers })
  }
  
  // Inspect multiple elements
  if (path === '/inspectAll' && req.method === 'POST') {
    const body = await req.json()
    const response = await requestFromBrowser('dom', 'inspectAll', { 
      selector: body.selector, 
      limit: body.limit || 10 
    })
    return Response.json(response, { headers })
  }
  
  // Highlight element (visual pointer)
  if (path === '/highlight' && req.method === 'POST') {
    const body = await req.json()
    
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
  
  return Response.json({ error: 'Not found' }, { status: 404, headers })
}

// Start server
const server = Bun.serve({
  port: PORT,
  
  fetch(req, server) {
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
      
      // Track browser IDs when they send 'connected' message
      if (type === 'browser') {
        try {
          const data = JSON.parse(message.toString())
          if (data.channel === 'system' && data.action === 'connected' && data.payload?.browserId) {
            browsers.set(wsTyped, data.payload.browserId)
            activeBrowserId = data.payload.browserId
          }
        } catch {}
      }
      
      handleMessage(wsTyped, message.toString(), type === 'browser')
    },
    
    close(ws: { data: { type: string } }) {
      const type = ws.data?.type
      if (type === 'browser') {
        const browserId = browsers.get(ws as unknown as WebSocket)
        browsers.delete(ws as unknown as WebSocket)
        if (browserId === activeBrowserId) {
          activeBrowserId = null
        }
      } else if (type === 'agent') {
        agents.delete(ws as unknown as WebSocket)
      }
    },
  },
})

export { server, PORT }
