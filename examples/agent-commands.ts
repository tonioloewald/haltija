#!/usr/bin/env bun
/**
 * Agent Commands - Simple command interface for UI interaction
 * 
 * Usage:
 *   bun examples/agent-commands.ts <command> [args...]
 * 
 * Commands:
 *   status              - Check connection status
 *   location            - Get current page URL and title
 *   query <selector>    - Find element(s) matching selector
 *   click <selector>    - Click an element
 *   type <selector> <text> - Type text into an element
 *   eval <code>         - Evaluate JavaScript
 *   watch               - Start watching DOM mutations
 *   unwatch             - Stop watching mutations
 *   messages [since]    - Get recent messages
 *   elements            - List interactive elements on page
 *   components          - List custom elements (web components)
 */

const SERVER = 'http://localhost:8700'

async function api(path: string, method = 'GET', body?: any) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  
  if (!command) {
    console.log(`Usage: bun examples/agent-commands.ts <command> [args...]

Commands:
  status              - Check connection status
  location            - Get current page URL and title  
  query <selector>    - Find element(s) matching selector
  click <selector>    - Click an element
  type <selector> <text> - Type text into an element
  eval <code>         - Evaluate JavaScript
  watch               - Start watching DOM mutations
  unwatch             - Stop watching mutations
  messages [since]    - Get recent messages
  elements            - List interactive elements on page
  components          - List custom elements (web components)
`)
    return
  }
  
  let result: any
  
  switch (command) {
    case 'status':
      result = await api('/status')
      break
      
    case 'location':
      result = await api('/location')
      break
      
    case 'query':
      if (!args[0]) {
        console.error('Usage: query <selector>')
        process.exit(1)
      }
      result = await api('/query', 'POST', { 
        selector: args[0], 
        all: args.includes('--all') || args.includes('-a')
      })
      break
      
    case 'click':
      if (!args[0]) {
        console.error('Usage: click <selector>')
        process.exit(1)
      }
      result = await api('/click', 'POST', { selector: args[0] })
      break
      
    case 'type':
      if (!args[0] || !args[1]) {
        console.error('Usage: type <selector> <text>')
        process.exit(1)
      }
      result = await api('/type', 'POST', { selector: args[0], text: args.slice(1).join(' ') })
      break
      
    case 'eval':
      if (!args[0]) {
        console.error('Usage: eval <code>')
        process.exit(1)
      }
      result = await api('/eval', 'POST', { code: args.join(' ') })
      break
      
    case 'watch':
      result = await api('/mutations/watch', 'POST', { debounce: parseInt(args[0]) || 100 })
      break
      
    case 'unwatch':
      result = await api('/mutations/unwatch', 'POST')
      break
      
    case 'messages':
      result = await api(`/messages?since=${args[0] || 0}`)
      break
      
    case 'elements':
      // Query for interactive elements
      const buttons = await api('/query', 'POST', { selector: 'button', all: true })
      const links = await api('/query', 'POST', { selector: 'a[href]', all: true })
      const inputs = await api('/query', 'POST', { selector: 'input, textarea, select', all: true })
      
      result = {
        buttons: (buttons.data || []).map((el: any) => ({
          selector: el.id ? `#${el.id}` : `button:contains("${el.innerText?.slice(0, 20)}")`,
          text: el.innerText?.slice(0, 50)
        })),
        links: (links.data || []).map((el: any) => ({
          selector: el.id ? `#${el.id}` : `a[href="${el.attributes?.href}"]`,
          text: el.innerText?.slice(0, 50),
          href: el.attributes?.href
        })),
        inputs: (inputs.data || []).map((el: any) => ({
          selector: el.id ? `#${el.id}` : `${el.tagName}[name="${el.attributes?.name}"]`,
          type: el.attributes?.type,
          name: el.attributes?.name,
          placeholder: el.attributes?.placeholder
        }))
      }
      break
      
    case 'components':
      result = await api('/eval', 'POST', { 
        code: `
          Array.from(document.querySelectorAll('*'))
            .filter(el => el.tagName.includes('-'))
            .reduce((acc, el) => {
              const tag = el.tagName.toLowerCase()
              if (!acc[tag]) acc[tag] = { count: 0, examples: [] }
              acc[tag].count++
              if (acc[tag].examples.length < 3) {
                acc[tag].examples.push({
                  id: el.id || null,
                  classes: el.className?.split(' ').slice(0, 3) || [],
                  text: el.textContent?.slice(0, 50)
                })
              }
              return acc
            }, {})
        `
      })
      break
      
    default:
      console.error(`Unknown command: ${command}`)
      process.exit(1)
  }
  
  console.log(JSON.stringify(result, null, 2))
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
