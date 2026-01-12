/**
 * Test page generator for Haltija
 * 
 * Generates a tabbed getting started page with content from embedded assets.
 * Content is embedded at build time to work in compiled binaries.
 * Includes copy buttons for commands and prompts.
 */

import { VERSION } from './version'
import { APP_MD, SERVICE_MD, PLAYGROUND_MD } from './embedded-assets'

const PRODUCT_NAME = 'Haltija'
const TAG_NAME = 'haltija-dev'

// Getting started content (embedded at build time)
const gettingStartedContent = {
  app: APP_MD,
  service: SERVICE_MD,
  playground: PLAYGROUND_MD,
}

// Simple markdown to HTML converter (handles our specific markdown features)
function markdownToHtml(md: string, protocol: string, port: number): string {
  // Replace template variables
  md = md.replace(/\$\{protocol\}/g, protocol)
  md = md.replace(/\$\{port\}/g, String(port))
  md = md.replace(/http:\/\/localhost:8700/g, `${protocol}://localhost:${port}`)
  
  let html = ''
  const lines = md.split('\n')
  let inCodeBlock = false
  let codeBlockLang = ''
  let codeBlockContent = ''
  let inList = false
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        const escapedCode = escapeHtml(codeBlockContent.trim())
        const isPrompt = codeBlockLang === 'prompt'
        const isBash = codeBlockLang === 'bash' || codeBlockLang === 'sh'
        const isBookmarklet = codeBlockLang === 'bookmarklet'
        const isJs = codeBlockLang === 'js' || codeBlockLang === 'javascript'
        
        if (isBookmarklet) {
          // Special handling for bookmarklet - render as draggable link
          html += `<div class="bookmarklet-container">
            <a class="bookmarklet" id="bookmarklet-link" href="#">${PRODUCT_NAME}</a>
          </div>\n`
        } else {
          const copyType = isPrompt ? 'prompt' : (isBash ? 'command' : 'code')
          html += `<div class="code-block${isPrompt ? ' prompt-block' : ''}">
            <button class="copy-btn" data-copy-type="${copyType}" onclick="copyCode(this)">Copy</button>
            <pre><code class="language-${codeBlockLang}">${escapedCode}</code></pre>
          </div>\n`
        }
        inCodeBlock = false
        codeBlockContent = ''
        codeBlockLang = ''
      } else {
        // Start code block
        inCodeBlock = true
        codeBlockLang = line.slice(3).trim() || 'text'
      }
      continue
    }
    
    if (inCodeBlock) {
      codeBlockContent += line + '\n'
      continue
    }
    
    // Close list if we hit a non-list line
    if (inList && !line.match(/^(\d+\.|-|\*)\s/)) {
      html += '</ul>\n'
      inList = false
    }
    
    // Headers
    if (line.startsWith('# ')) {
      // Skip the main title (we use our own header)
      continue
    }
    if (line.startsWith('## ')) {
      html += `<h2>${escapeHtml(line.slice(3))}</h2>\n`
      continue
    }
    if (line.startsWith('### ')) {
      html += `<h3>${escapeHtml(line.slice(4))}</h3>\n`
      continue
    }
    
    // Lists
    if (line.match(/^(\d+\.|-|\*)\s/)) {
      if (!inList) {
        html += '<ul>\n'
        inList = true
      }
      const content = line.replace(/^(\d+\.|-|\*)\s/, '')
      html += `<li>${formatInline(content)}</li>\n`
      continue
    }
    
    // Paragraphs
    if (line.trim()) {
      html += `<p>${formatInline(line)}</p>\n`
    }
  }
  
  if (inList) {
    html += '</ul>\n'
  }
  
  return html
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatInline(text: string): string {
  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  return text
}

// Generate the playground HTML with test controls
function getPlaygroundHtml(): string {
  return `
    <p>This is a sandbox for testing Haltija commands. The elements below are designed for agents to practice interacting with web pages.</p>
    
    <h2>Interactive Elements</h2>
    <p>Use these to test clicking, typing, and reading page content.</p>
    
    <h3>Buttons</h3>
    <div class="test-buttons">
      <button id="btn-primary" class="btn-test primary" onclick="showOutput('Primary button clicked!')">Primary Button</button>
      <button id="btn-secondary" class="btn-test secondary" onclick="showOutput('Secondary button clicked!')">Secondary Button</button>
      <button id="btn-danger" class="btn-test danger" onclick="showOutput('Danger button clicked!')">Danger Button</button>
    </div>
    
    <h3>Form Inputs</h3>
    <div class="test-form">
      <div class="form-row">
        <label for="text-input">Text Input:</label>
        <input type="text" id="text-input" placeholder="Type something here..." oninput="showOutput('Text: ' + this.value)">
      </div>
      <div class="form-row">
        <label for="email-input">Email:</label>
        <input type="email" id="email-input" placeholder="you@example.com">
      </div>
      <div class="form-row">
        <label for="select-input">Dropdown:</label>
        <select id="select-input" onchange="showOutput('Selected: ' + this.value)">
          <option value="">Choose an option...</option>
          <option value="a">Option A</option>
          <option value="b">Option B</option>
          <option value="c">Option C</option>
        </select>
      </div>
      <div class="form-row">
        <label>Checkboxes:</label>
        <div class="checkbox-group">
          <label><input type="checkbox" id="check-1" onchange="showOutput('Check 1: ' + this.checked)"> Option 1</label>
          <label><input type="checkbox" id="check-2" onchange="showOutput('Check 2: ' + this.checked)"> Option 2</label>
          <label><input type="checkbox" id="check-3" onchange="showOutput('Check 3: ' + this.checked)"> Option 3</label>
        </div>
      </div>
    </div>
    
    <h3>Output Area</h3>
    <div id="output" class="output-box">
      Click buttons or type in fields to see results here.
    </div>
    
    <h3>Console Testing</h3>
    <div class="btn-row">
      <button onclick="console.log('Test log', Date.now())">Log</button>
      <button onclick="console.warn('Test warn', Date.now())" style="background:#f59e0b">Warn</button>
      <button onclick="console.error('Test error', Date.now())" style="background:#ef4444">Error</button>
    </div>
    
    <h2>Test Commands</h2>
    <p>Try these commands to interact with the playground:</p>
    
    <p>Click the primary button:</p>
    <div class="code-block">
      <button class="copy-btn" data-copy-type="command" onclick="copyCode(this)">Copy</button>
      <pre><code>curl -X POST http://localhost:8700/click -H "Content-Type: application/json" -d '{"selector": "#btn-primary"}'</code></pre>
    </div>
    
    <p>Type in the text input:</p>
    <div class="code-block">
      <button class="copy-btn" data-copy-type="command" onclick="copyCode(this)">Copy</button>
      <pre><code>curl -X POST http://localhost:8700/type -H "Content-Type: application/json" -d '{"selector": "#text-input", "text": "Hello from the agent!"}'</code></pre>
    </div>
    
    <p>Read the output area:</p>
    <div class="code-block">
      <button class="copy-btn" data-copy-type="command" onclick="copyCode(this)">Copy</button>
      <pre><code>curl -X POST http://localhost:8700/query -H "Content-Type: application/json" -d '{"selector": "#output"}'</code></pre>
    </div>
  `
}

export function generateTestPage(protocol: string, port: number, isElectronApp: boolean = false): string {
  // Convert embedded content to HTML
  const appHtml = markdownToHtml(gettingStartedContent.app, protocol, port)
  const serviceHtml = markdownToHtml(gettingStartedContent.service, protocol, port)
  const playgroundHtml = getPlaygroundHtml()
  
  // Determine default tab
  const defaultTab = isElectronApp ? 'app' : 'service'
  
  return `<!DOCTYPE html>
<html>
<head>
  <title>${PRODUCT_NAME} - Browser Control for AI Agents</title>
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
${isElectronApp ? '' : `  <script>
    // Set config BEFORE component.js loads so auto-inject works
    (function() {
      var wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var port = location.port || (location.protocol === 'https:' ? '443' : '80');
      window.__haltija_config__ = { serverUrl: wsProto + '//localhost:' + port + '/ws/browser' };
    })();
  </script>`}
  <script src="/component.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: system-ui, -apple-system, sans-serif; 
      max-width: 800px; 
      margin: 0 auto; 
      padding: 24px;
      background: #f8fafc;
      color: #1e293b;
    }
    
    /* Header */
    .header {
      text-align: center;
      padding: 24px 0 20px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 24px;
    }
    .header img { width: 256px; height: 256px; margin-bottom: 16px; border-radius: 24px; }
    .header h1 { margin: 0 0 4px; font-size: 24px; color: #0f172a; }
    .header .version { color: #64748b; font-size: 13px; }
    
    /* Tabs */
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 24px;
      border-bottom: 2px solid #e2e8f0;
    }
    .tab {
      padding: 12px 20px;
      background: none;
      border: none;
      font-size: 14px;
      font-weight: 500;
      color: #64748b;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: all 0.15s;
    }
    .tab:hover {
      color: #334155;
    }
    .tab.active {
      color: #3b82f6;
      border-bottom-color: #3b82f6;
    }
    
    /* Tab content */
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    
    /* Typography */
    h2 { 
      font-size: 18px; 
      color: #1e293b;
      margin: 28px 0 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    h3 {
      font-size: 15px;
      color: #334155;
      margin: 20px 0 10px;
    }
    p {
      margin: 12px 0;
      line-height: 1.6;
      color: #475569;
    }
    ul {
      margin: 12px 0;
      padding-left: 24px;
    }
    li {
      margin: 6px 0;
      line-height: 1.5;
      color: #475569;
    }
    a { color: #3b82f6; }
    a:hover { color: #2563eb; }
    
    /* Code blocks */
    pre, code { 
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 13px;
    }
    code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      color: #0f172a;
    }
    .code-block {
      position: relative;
      margin: 12px 0;
    }
    .code-block pre {
      background: #1e293b;
      color: #e2e8f0;
      padding: 14px 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 0;
    }
    .code-block pre code {
      background: none;
      padding: 0;
      color: inherit;
    }
    .prompt-block pre {
      background: #1e3a5f;
      border-left: 4px solid #3b82f6;
    }
    
    /* Copy button */
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .copy-btn:hover {
      background: #2563eb;
      transform: translateY(-1px);
      box-shadow: 0 3px 6px rgba(0,0,0,0.25);
    }
    .copy-btn.copied {
      background: #22c55e;
    }
    
    /* Bookmarklet */
    .bookmarklet-container {
      margin: 16px 0;
    }
    .bookmarklet { 
      display: inline-block; 
      padding: 12px 24px; 
      background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);
      color: white; 
      text-decoration: none; 
      border-radius: 8px; 
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
      transition: all 0.15s;
    }
    .bookmarklet:hover { 
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
      color: white;
    }
    
    /* Playground styles */
    .test-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 12px 0;
    }
    .btn-test {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-test.primary { background: #3b82f6; color: white; }
    .btn-test.primary:hover { background: #2563eb; }
    .btn-test.secondary { background: #64748b; color: white; }
    .btn-test.secondary:hover { background: #475569; }
    .btn-test.danger { background: #ef4444; color: white; }
    .btn-test.danger:hover { background: #dc2626; }
    
    .test-form {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      margin: 12px 0;
    }
    .form-row {
      margin-bottom: 12px;
    }
    .form-row:last-child {
      margin-bottom: 0;
    }
    .form-row label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #475569;
      margin-bottom: 4px;
    }
    .form-row input,
    .form-row select {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 14px;
    }
    .form-row input:focus,
    .form-row select:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    .checkbox-group {
      display: flex;
      gap: 16px;
    }
    .checkbox-group label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: normal;
    }
    .checkbox-group input {
      width: auto;
    }
    
    .output-box {
      background: #0f172a;
      color: #22c55e;
      font-family: ui-monospace, monospace;
      font-size: 13px;
      padding: 16px;
      border-radius: 8px;
      min-height: 60px;
      margin: 12px 0;
    }
    
    .btn-row {
      display: flex;
      gap: 8px;
      margin: 12px 0;
    }
    .btn-row button {
      padding: 8px 16px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    .btn-row button:hover {
      background: #2563eb;
    }

    strong { color: #1e293b; }
  </style>
</head>
<body>
  <div class="header">
    <img src="/icon.svg" alt="${PRODUCT_NAME}">
    <h1>${PRODUCT_NAME}</h1>
    <div class="version">v${VERSION} &middot; Browser Control for AI Agents</div>
  </div>
  
  <div class="tabs">
    <button class="tab${defaultTab === 'app' ? ' active' : ''}" data-tab="app">Haltija App</button>
    <button class="tab${defaultTab === 'service' ? ' active' : ''}" data-tab="service">Haltija Service</button>
    <button class="tab" data-tab="playground">Playground</button>
  </div>
  
  <div id="tab-app" class="tab-content${defaultTab === 'app' ? ' active' : ''}">
    ${appHtml}
  </div>
  
  <div id="tab-service" class="tab-content${defaultTab === 'service' ? ' active' : ''}">
    ${serviceHtml}
  </div>
  
  <div id="tab-playground" class="tab-content">
    ${playgroundHtml}
  </div>
  
  <script>
    // Tab switching
    document.querySelectorAll('.tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var tabId = this.getAttribute('data-tab');
        
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(function(t) {
          t.classList.remove('active');
        });
        this.classList.add('active');
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(function(c) {
          c.classList.remove('active');
        });
        document.getElementById('tab-' + tabId).classList.add('active');
      });
    });
    
    // Copy button functionality
    function copyCode(btn) {
      var pre = btn.parentElement.querySelector('pre');
      var code = pre.textContent;
      
      navigator.clipboard.writeText(code).then(function() {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      });
    }
    
    // Playground output
    function showOutput(msg) {
      document.getElementById('output').textContent = msg;
    }
    
    // Setup bookmarklet
    (function() {
      var link = document.getElementById('bookmarklet-link');
      if (link) {
        var proto = location.protocol;
        var port = location.port || (proto === 'https:' ? '443' : '80');
        var baseUrl = proto + '//localhost:' + port;
        var code = "(function(){fetch('" + baseUrl + "/inject.js').then(r=>r.text()).then(eval).catch(e=>alert('${PRODUCT_NAME}: '+e.message))})()";
        link.href = 'javascript:' + code;
      }
    })();
  </script>
</body>
</html>`
}
