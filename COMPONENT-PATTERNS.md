# Haltija Component Patterns

Lessons learned from building the haltija-dev widget, CodeMirror wrapper, and playground components.

## Core Philosophy: Stable by Default

The DOM should be inert until you explicitly change something. No constant re-rendering, no virtual DOM diffing, no reconciliation cycles.

**Wrong (React-style "reactive"):**
```javascript
// Every state change triggers full re-render
render() {
  this.shadowRoot.innerHTML = `...${this.state}...`
}
```

**Right (stable):**
```javascript
// Render once, update targeted elements
render() {
  if (this.shadowRoot.querySelector('.widget')) {
    this.updateUI()  // Targeted updates only
    return
  }
  // First render: create DOM structure
  this.shadowRoot.innerHTML = `...`
  this.updateUI()
  this.setupEventHandlers()  // Only once
}

updateUI() {
  // Touch only what changed
  const status = this.shadowRoot.querySelector('.status')
  if (status) status.className = `status ${this.state}`
}
```

## Shadow DOM Patterns

### Use Shadow DOM for Encapsulation

```javascript
constructor() {
  super()
  this.attachShadow({ mode: 'open' })
}
```

Benefits:
- Styles don't leak in or out
- Element queries are scoped
- Can use simple class names without conflicts

### Host Element Styling

Style the custom element itself with `:host`:

```css
:host {
  position: fixed;
  z-index: 999999;
}

:host(.minimized) {
  bottom: 0;
  left: 16px;
}
```

### CSS Variables for Theming

Expose CSS variables for external customization:

```css
:host {
  --highlight-color: #6366f1;
  --highlight-bg: rgba(99, 102, 241, 0.1);
}

.highlight {
  border-color: var(--highlight-color);
  background: var(--highlight-bg);
}
```

Users can override from outside:
```css
haltija-dev {
  --highlight-color: #22c55e;
}
```

## Animation Patterns

### Transitions Need Starting Points

CSS transitions only work when the browser knows both the start and end values:

```javascript
// Wrong: browser doesn't know starting position
this.classList.add('animating')
this.style.left = '100px'  // Jumps instantly

// Right: set start, reflow, then set end
this.style.left = `${currentLeft}px`  // Starting position
this.offsetHeight  // Force reflow
this.classList.add('animating')
this.style.left = '100px'  // Now it animates
```

### Can't Animate Between Different Properties

CSS can't interpolate between `left` and `right` positioning:

```javascript
// Wrong: tries to animate from right:16px to left:16px
this.style.right = '16px'
this.classList.add('animating')
this.style.left = '16px'
this.style.right = ''  // Jumps!

// Right: use same property throughout
this.style.left = `${window.innerWidth - rect.right}px`  // Convert right to left
this.offsetHeight
this.classList.add('animating')
this.style.left = '16px'  // Animates smoothly
```

### Conditional Transitions

Don't apply transitions globally - they interfere with dragging:

```css
/* Wrong: makes dragging sluggish */
:host {
  transition: all 0.3s ease-out;
}

/* Right: only animate when explicitly requested */
:host(.animating-hide) {
  transition: left 0.3s ease-out, bottom 0.3s ease-in;
}

:host(.animating-show) {
  transition: left 0.3s ease-in, bottom 0.3s ease-out;
}
```

### Animation Cleanup

Always clean up animation classes:

```javascript
this.classList.add('animating')
setTimeout(() => this.classList.remove('animating'), 350)

// Or use transitionend (with timeout fallback)
const cleanup = () => this.classList.remove('animating')
this.addEventListener('transitionend', cleanup, { once: true })
setTimeout(cleanup, 400)  // Fallback if event doesn't fire
```

## Event Handling Patterns

### Stop Propagation for Nested Interactives

When buttons are inside a drag handle, stop propagation:

```javascript
shadow.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('mousedown', (e) => {
    e.stopPropagation()  // Don't trigger drag
  })
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    // Handle click
  })
})
```

### Real Mouse Event Lifecycle

A real click involves multiple events:

1. `mouseenter` - cursor enters element
2. `mouseover` - bubbles up
3. `mousemove` - at least one
4. `mousedown` - button pressed
5. `mouseup` - button released
6. `click` - the click event

Synthetic clicks should fire the full sequence for compatibility.

### Drag Implementation

Track position from the element's bounding rect, not CSS values:

```javascript
private setupDrag(handle: Element) {
  let startX, startY, startLeft, startBottom
  
  const onMouseMove = (e: MouseEvent) => {
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    this.style.left = `${startLeft + dx}px`
    this.style.bottom = `${startBottom - dy}px`
  }
  
  handle.addEventListener('mousedown', (e) => {
    startX = e.clientX
    startY = e.clientY
    
    // Get position from actual rendered location
    const rect = this.getBoundingClientRect()
    startLeft = rect.left
    startBottom = window.innerHeight - rect.bottom
    
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  })
}
```

## State Management

### Keep State Minimal

Only store what you can't derive:

```javascript
// State
private state: 'connected' | 'paused' | 'disconnected' = 'disconnected'
private homeLeft = 0
private homeBottom = 16

// Derived (don't store, compute when needed)
get isMinimized() {
  return this.classList.contains('minimized')
}

get errorCount() {
  return this.consoleBuffer.filter(e => e.level === 'error').length
}
```

### Don't Overwrite State on Events

Be careful with event handlers that update state:

```javascript
// Wrong: clicking minimize button triggers drag's mouseup, 
// which overwrites home position with minimized position
const onMouseUp = () => {
  this.homeLeft = rect.left  // Oops, saves wrong position
}

// Right: check state before saving
const onMouseUp = () => {
  if (!this.classList.contains('minimized')) {
    this.homeLeft = rect.left
  }
}
```

## Rendering Patterns

### Render Once, Update Incrementally

```javascript
private render() {
  // Skip if already rendered
  if (this.shadowRoot.querySelector('.widget')) {
    this.updateUI()
    return
  }
  
  // First render: static structure
  this.shadowRoot.innerHTML = `
    <style>...</style>
    <div class="widget">
      <div class="status"></div>
      <div class="indicators"></div>
    </div>
  `
  
  // Set up event handlers once
  this.setupEventHandlers()
  
  // Initial UI state
  this.updateUI()
}

private updateUI() {
  // Update only dynamic parts
  const status = this.shadowRoot.querySelector('.status')
  status.className = `status ${this.state}`
  
  const indicators = this.shadowRoot.querySelector('.indicators')
  indicators.innerHTML = this.errorCount > 0 
    ? `<span class="error">${this.errorCount}</span>` 
    : ''
}
```

### Avoid innerHTML for Updates

`innerHTML` destroys and recreates all children, losing:
- Event handlers
- Focus state
- Selection state
- Scroll position
- Animation state

Use targeted updates instead:
```javascript
// Wrong
container.innerHTML = `<span>${count}</span>`

// Right
container.querySelector('span').textContent = count
```

## Lifecycle Patterns

### connectedCallback for Setup

```javascript
connectedCallback() {
  // Read attributes
  this.serverUrl = this.getAttribute('server') || this.serverUrl
  
  // Render
  this.render()
  
  // Calculate initial position (after render so we know size)
  const rect = this.getBoundingClientRect()
  this.homeLeft = window.innerWidth - rect.width - 16
  this.style.left = `${this.homeLeft}px`
  
  // Set up global handlers
  this.setupKeyboardShortcut()
  
  // Start connections
  this.connect()
}
```

### disconnectedCallback for Cleanup

```javascript
disconnectedCallback() {
  this.killed = true  // Prevent reconnection attempts
  this.disconnect()
  this.restoreConsole()
  this.clearEventWatchers()
  this.stopMutationWatch()
  hideHighlight()  // Clean up any visual artifacts
}
```

### Attribute Changes

```javascript
static get observedAttributes() {
  return ['server']
}

attributeChangedCallback(name, oldVal, newVal) {
  if (name === 'server' && oldVal !== newVal) {
    this.serverUrl = newVal
    this.reconnect()
  }
}
```

## Console Interception

Intercept and restore cleanly:

```javascript
private originalConsole: Partial<Console> = {}

private interceptConsole() {
  const levels = ['log', 'info', 'warn', 'error', 'debug']
  
  for (const level of levels) {
    this.originalConsole[level] = console[level]
    console[level] = (...args) => {
      // Call original
      this.originalConsole[level].apply(console, args)
      // Capture
      this.captureConsole(level, args)
    }
  }
}

private restoreConsole() {
  for (const [level, fn] of Object.entries(this.originalConsole)) {
    if (fn) console[level] = fn
  }
}
```

## WebSocket Patterns

### Reconnection with Kill Flag

```javascript
private killed = false

private connect() {
  if (this.killed) return  // Don't reconnect after kill
  
  this.ws = new WebSocket(this.serverUrl)
  
  this.ws.onclose = () => {
    if (!this.killed) {
      setTimeout(() => this.connect(), 3000)
    }
  }
}

private kill() {
  this.killed = true
  this.disconnect()
  this.remove()
}
```

### Message Handling

```javascript
private handleMessage(msg: DevMessage) {
  // Security: always show when receiving commands
  if (msg.source === 'agent') {
    this.show()
  }
  
  switch (msg.channel) {
    case 'dom':
      this.handleDomMessage(msg)
      break
    // ...
  }
  
  // Update UI after handling
  this.updateUI()
}
```

## Testing Patterns

### Static Test Method

```javascript
static async runTests() {
  const el = document.querySelector('haltija-dev')
  if (!el) return { passed: 0, failed: 1, error: 'Not found' }
  
  const results = []
  
  const test = (name, fn) => async () => {
    try {
      await fn()
      results.push({ name, passed: true })
    } catch (err) {
      results.push({ name, passed: false, error: err.message })
    }
  }
  
  await test('has shadow root', () => {
    if (!el.shadowRoot) throw new Error('No shadow root')
  })()
  
  // ...more tests
  
  return { 
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results 
  }
}
```

## Summary

1. **Stable by default** - Render once, update incrementally
2. **Shadow DOM** - For style encapsulation
3. **CSS variables** - For external theming
4. **Transitions need start points** - Force reflow between setting start and end
5. **Same property for animations** - Can't animate between left and right
6. **Stop propagation** - For nested interactives
7. **Full event lifecycle** - For synthetic interactions
8. **Minimal state** - Derive what you can
9. **Clean up** - Restore console, remove listeners, clear timers
10. **Kill flag** - Prevent zombie reconnections
