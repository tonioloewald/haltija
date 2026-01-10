#!/usr/bin/env bun
/**
 * Example: Agent explores a UI
 * 
 * This script demonstrates how an agent can:
 * 1. Connect to a browser with tosijs-dev injected
 * 2. Query the DOM to understand the page
 * 3. Watch for mutations
 * 4. Interact with elements
 * 5. See the results
 * 
 * Usage:
 *   1. Start tosijs-dev: cd packages/tosijs-dev && bun run dev
 *   2. Open your target page in browser and inject tosijs-dev (use bookmarklet)
 *   3. Run this script: bun run examples/explore-ui.ts [url-pattern]
 */

const SERVER = 'http://localhost:8700'

interface ApiResponse {
  success: boolean
  data?: any
  error?: string
}

// Helper to make API calls
async function api(path: string, method = 'GET', body?: any): Promise<ApiResponse> {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

// Query DOM elements
async function query(selector: string, all = false) {
  const res = await api('/query', 'POST', { selector, all })
  return res.success ? res.data : null
}

// Click an element
async function click(selector: string) {
  const res = await api('/click', 'POST', { selector })
  return res.success
}

// Type into an element
async function type(selector: string, text: string) {
  const res = await api('/type', 'POST', { selector, text })
  return res.success
}

// Evaluate JS in browser
async function evaluate(code: string) {
  const res = await api('/eval', 'POST', { code })
  return res.success ? res.data : null
}

// Get current location
async function getLocation() {
  const res = await api('/location')
  return res.success ? res.data : null
}

// Start watching mutations
async function watchMutations(debounce = 100) {
  return api('/mutations/watch', 'POST', { debounce })
}

// Stop watching mutations
async function unwatchMutations() {
  return api('/mutations/unwatch', 'POST')
}

// Get recent messages (including mutation batches)
async function getMessages(since = 0) {
  const res = await api(`/messages?since=${since}`)
  return Array.isArray(res) ? res : []
}

// Wait for mutations to settle
async function waitForMutations(timeoutMs = 2000): Promise<any[]> {
  const startTime = Date.now()
  const mutations: any[] = []
  
  while (Date.now() - startTime < timeoutMs) {
    const messages = await getMessages(startTime)
    const newMutations = messages.filter(m => m.channel === 'mutations' && m.action === 'batch')
    mutations.push(...newMutations)
    
    // If we got mutations and they've settled (no new ones for 200ms), we're done
    if (mutations.length > 0) {
      await new Promise(r => setTimeout(r, 200))
      const checkMessages = await getMessages(startTime)
      const checkMutations = checkMessages.filter(m => m.channel === 'mutations' && m.action === 'batch')
      if (checkMutations.length === mutations.length) {
        break
      }
    }
    
    await new Promise(r => setTimeout(r, 50))
  }
  
  return mutations
}

// Pretty print element info
function describeElement(el: any): string {
  if (!el) return '(not found)'
  const parts = [el.tagName]
  if (el.id) parts.push(`#${el.id}`)
  if (el.className) parts.push(`.${el.className.split(' ').slice(0, 2).join('.')}`)
  const text = el.innerText?.slice(0, 50) || el.textContent?.slice(0, 50)
  if (text) parts.push(`"${text.replace(/\n/g, ' ').trim()}"`)
  return parts.join(' ')
}

// ============================================
// Main exploration script
// ============================================

async function main() {
  console.log('\n🦉 tosijs-dev UI Explorer\n')
  
  // Check connection
  const status = await api('/status')
  if (!status.browsers || status.browsers === 0) {
    console.log('❌ No browser connected. Please:')
    console.log('   1. Open your target page in a browser')
    console.log('   2. Use the tosijs-dev bookmarklet to inject the widget')
    console.log('   3. Run this script again\n')
    process.exit(1)
  }
  
  console.log(`✓ Connected to browser (${status.browsers} tab(s), ${status.agents} agent(s))\n`)
  
  // Get current page info
  const location = await getLocation()
  console.log(`📍 Page: ${location?.title || 'Unknown'}`)
  console.log(`   URL: ${location?.url || 'Unknown'}\n`)
  
  // Start watching mutations
  await watchMutations(50)
  console.log('👁️  Watching DOM mutations...\n')
  
  // Explore the page structure
  console.log('🔍 Exploring page structure...\n')
  
  // Find main interactive elements
  const buttons = await query('button', true)
  const links = await query('a', true)
  const inputs = await query('input, textarea, select', true)
  const tabs = await query('[role="tab"], .tab, xin-tabs', true)
  
  console.log(`   Found: ${buttons?.length || 0} buttons, ${links?.length || 0} links, ${inputs?.length || 0} inputs`)
  if (tabs?.length) {
    console.log(`   Found: ${tabs.length} tab-related elements`)
  }
  
  // Look for custom elements (web components)
  const customElements = await evaluate(`
    Array.from(document.querySelectorAll('*'))
      .filter(el => el.tagName.includes('-'))
      .map(el => el.tagName.toLowerCase())
      .filter((v, i, a) => a.indexOf(v) === i)
  `)
  
  if (customElements?.length) {
    console.log(`\n📦 Custom Elements found:`)
    for (const tag of customElements.slice(0, 10)) {
      const count = await evaluate(`document.querySelectorAll('${tag}').length`)
      console.log(`   <${tag}> (${count} instance${count !== 1 ? 's' : ''})`)
    }
  }
  
  // If we found tabs, let's interact with them
  if (tabs?.length) {
    console.log('\n🎯 Interacting with tabs...\n')
    
    // Try to find clickable tab triggers
    const tabTriggers = await query('[role="tab"], .tab-trigger, xin-tabs [slot="tabs"] > *', true)
    
    if (tabTriggers?.length > 1) {
      console.log(`   Found ${tabTriggers.length} tab triggers`)
      
      // Click the second tab
      const secondTab = tabTriggers[1]
      console.log(`   Clicking: ${describeElement(secondTab)}`)
      
      // Get selector for second tab
      const selector = await evaluate(`
        const tabs = document.querySelectorAll('[role="tab"], .tab-trigger, xin-tabs [slot="tabs"] > *')
        if (tabs[1]) {
          if (tabs[1].id) return '#' + tabs[1].id
          return tabs[1].tagName.toLowerCase() + ':nth-of-type(2)'
        }
        return null
      `)
      
      if (selector) {
        await click(selector)
        
        // Wait for mutations
        const mutations = await waitForMutations(1000)
        
        if (mutations.length > 0) {
          const totalAdded = mutations.reduce((sum, m) => sum + (m.payload?.summary?.added || 0), 0)
          const totalRemoved = mutations.reduce((sum, m) => sum + (m.payload?.summary?.removed || 0), 0)
          console.log(`\n   📊 DOM changed: +${totalAdded} elements, -${totalRemoved} elements`)
          
          // Show notable changes
          for (const m of mutations) {
            for (const notable of (m.payload?.notable || []).slice(0, 3)) {
              console.log(`      ${notable.type}: <${notable.tagName}>${notable.id ? '#' + notable.id : ''}`)
            }
          }
        }
      }
    }
  }
  
  // Try clicking a button if we found any
  if (buttons?.length && !tabs?.length) {
    console.log('\n🎯 Trying button interaction...\n')
    
    const firstButton = buttons[0]
    console.log(`   Clicking: ${describeElement(firstButton)}`)
    
    const selector = firstButton.id ? `#${firstButton.id}` : 'button'
    await click(selector)
    
    const mutations = await waitForMutations(1000)
    if (mutations.length > 0) {
      console.log(`   📊 DOM changed after click`)
    } else {
      console.log(`   (no DOM changes detected)`)
    }
  }
  
  // Stop watching
  await unwatchMutations()
  
  console.log('\n✅ Exploration complete!\n')
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
