/**
 * Haltija - Browser Control for AI Agents
 * 
 * Shared formatting for agent messages (selection, recordings, etc.)
 * 
 * Format conventions:
 * - Indented lines for human readability
 * - Parenthetical refs for agent use: (ref:123)
 * - Selectors at end of line for copy-paste convenience
 */

// Selection element from component.ts
export interface SelectionElement {
  ref: string
  selector: string
  tagName: string
  text: string
  html?: string
  rect?: { x: number; y: number; width: number; height: number }
  attributes?: Record<string, string>
}

// Semantic event from recordings
export interface SemanticEvent {
  type: string  // e.g. 'interaction:click', 'input:typed', 'navigation:navigate'
  timestamp?: number
  target?: {
    selector?: string
    text?: string
    ref?: string
  }
  payload?: Record<string, any>
}

/**
 * Format a selection element for agent consumption
 * Example: "  1. (ref:42) "Submit" → #submit-btn"
 * Uses text content if available, falls back to tag name
 */
export function formatSelectionElement(el: SelectionElement, index: number): string {
  const ref = el.ref ? `(ref:${el.ref})` : ''
  const text = el.text ? `"${el.text.slice(0, 30)}${el.text.length > 30 ? '...' : ''}"` : ''
  // Prefer text content, fall back to tag name
  const desc = text || `<${el.tagName}>`
  
  return `  ${index + 1}. ${ref} ${desc} → ${el.selector}`
}

/**
 * Format a complete selection for sending to an agent
 */
export function formatSelectionMessage(
  elements: SelectionElement[],
  pageTitle: string,
  pageUrl: string,
  maxElements = 15
): string {
  const shown = elements.slice(0, maxElements)
  const more = elements.length > maxElements ? `\n  ... +${elements.length - maxElements} more` : ''
  
  const elementLines = shown.map((el, i) => formatSelectionElement(el, i)).join('\n')
  
  return `Selection from "${pageTitle}" (${pageUrl}):\n\n${elementLines}${more}`
}

/**
 * Check if an event should be skipped (noise)
 */
function isNoiseEvent(event: SemanticEvent): boolean {
  const noiseTypes = [
    'focus:in', 'focus:out',
    'recording:started', 'recording:stopped',
    'hover:enter', 'hover:leave',
  ]
  return noiseTypes.includes(event.type)
}

/**
 * Format a semantic event for agent consumption
 * Index should be the display index (after filtering noise)
 * 
 * Format: "N. action SELECTOR" or "N. action "text" (SELECTOR)"
 * Selector is always included so agent can replay the action
 */
export function formatSemanticEvent(event: SemanticEvent, displayIndex: number): string | null {
  if (isNoiseEvent(event)) return null
  
  const target = event.target
  const selector = target?.selector || ''
  
  // Build the action description based on event type
  switch (event.type) {
    case 'interaction:click': {
      const text = target?.text || event.payload?.text || ''
      const href = event.payload?.href ? ` → ${event.payload.href}` : ''
      // Show text for context, but always include selector for replay
      if (text && selector) {
        return `  ${displayIndex}. click "${text.slice(0, 25)}" (${selector})${href}`
      }
      return `  ${displayIndex}. click ${selector || '(unknown)'}${href}`
    }
    
    case 'input:typed': {
      const typed = event.payload?.text || event.payload?.finalValue || ''
      return `  ${displayIndex}. type "${typed.slice(0, 30)}" → ${selector}`
    }
    
    case 'navigation:navigate':
      return `  ${displayIndex}. navigate ${event.payload?.to || 'page'}`
    
    case 'interaction:submit':
      return `  ${displayIndex}. submit ${selector}`
    
    case 'scroll:stop': {
      const dir = event.payload?.direction || 'down'
      return `  ${displayIndex}. scroll ${dir}`
    }
    
    case 'interaction:select': {
      const value = event.payload?.value || event.payload?.text || ''
      return `  ${displayIndex}. select "${value}" → ${selector}`
    }
    
    case 'interaction:check':
      return `  ${displayIndex}. check ${selector}`
    
    case 'interaction:uncheck':
      return `  ${displayIndex}. uncheck ${selector}`
    
    // Legacy event types (backwards compat)
    case 'click': {
      const text = target?.text || event.payload?.text || ''
      if (text && selector) {
        return `  ${displayIndex}. click "${text.slice(0, 25)}" (${selector})`
      }
      return `  ${displayIndex}. click ${selector || '(unknown)'}`
    }
    
    case 'type':
    case 'input': {
      const typed = event.payload?.text || event.payload?.value || ''
      return `  ${displayIndex}. type "${typed.slice(0, 30)}" → ${selector}`
    }
    
    case 'navigation':
    case 'navigate':
      return `  ${displayIndex}. navigate ${event.payload?.url || event.payload?.to || 'page'}`
    
    case 'scroll':
      return `  ${displayIndex}. scroll`
    
    default:
      // Generic format for unknown events
      if (selector) {
        return `  ${displayIndex}. ${event.type} ${selector}`
      }
      return `  ${displayIndex}. ${event.type}`
  }
}

/**
 * Format a complete recording for sending to an agent
 */
export function formatRecordingMessage(
  events: SemanticEvent[],
  pageTitle: string,
  pageUrl: string,
  description?: string
): string {
  // Filter first, then number - so we get 1, 2, 3... not 1, 4, 7...
  const formattedEvents: string[] = []
  let displayIndex = 1
  
  for (const event of events) {
    const formatted = formatSemanticEvent(event, displayIndex)
    if (formatted !== null) {
      formattedEvents.push(formatted)
      displayIndex++
    }
  }
  
  const header = description?.trim() || 'Recorded interaction'
  
  if (formattedEvents.length === 0) {
    return `${header}\n\nNo meaningful actions recorded on "${pageTitle}" (${pageUrl})`
  }
  
  const eventLines = formattedEvents.join('\n')
  
  return `${header} on "${pageTitle}" (${pageUrl}):\n\n${eventLines}`
}
