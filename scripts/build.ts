#!/usr/bin/env bun
/**
 * Main build script for Haltija
 * Compiles TypeScript, bundles for browser/bun targets, syncs to desktop app
 */

import { $ } from 'bun'
import { writeFileSync } from 'fs'

// 1. Embed static assets into TypeScript
await $`bun run scripts/embed-assets.ts`

// 2. Build browser component (IIFE for injection)
await $`bun build ./src/component.ts --outdir=dist --target=browser --format=iife`

// 3. Build server, client, and index for Bun runtime
await $`bun build ./src/server.ts ./src/client.ts ./src/index.ts --outdir=dist --target=bun`

// 4. Sync component to desktop app resources (single source of truth)
await $`cp dist/component.js apps/desktop/resources/component.js`.quiet().nothrow()

// 5. Generate MCP endpoints JSON from api-schema (single source of truth)
const { ALL_ENDPOINTS, getInputSchema } = await import('../src/api-schema')
const mcpEndpoints = ALL_ENDPOINTS.map(ep => ({
  path: ep.path,
  method: ep.method,
  summary: ep.summary,
  description: ep.description,
  inputSchema: getInputSchema(ep),
}))
writeFileSync('apps/mcp/src/endpoints.json', JSON.stringify(mcpEndpoints, null, 2))

// 6. Generate API.md from api-schema (single source of truth)
function generateApiMd(): string {
  const lines: string[] = [
    '# Haltija API Reference',
    '',
    '> **Auto-generated from `src/api-schema.ts`** - Do not edit directly.',
    '',
    '## Quick Start',
    '',
    '```bash',
    '# Is it working?',
    'curl localhost:8700/status',
    '',
    '# What tabs are connected?',
    'curl localhost:8700/windows',
    '',
    "# What's on the page?",
    'curl -X POST localhost:8700/tree -d \'{"mode":"actionable"}\'',
    '',
    '# Click something',
    'curl -X POST localhost:8700/click -d \'{"selector":"#submit"}\'',
    '```',
    '',
    '---',
    '',
  ]

  // Group endpoints by category - ordered by "what you need first"
  const byCategory = new Map<string, typeof ALL_ENDPOINTS>()
  for (const ep of ALL_ENDPOINTS) {
    const cat = (ep as any).category || 'other'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(ep)
  }

  // Order by workflow: connect -> see -> do -> watch -> advanced
  const categoryOrder = ['meta', 'dom', 'interaction', 'navigation', 'events', 'mutations', 'selection', 'windows', 'recording', 'testing', 'debug', 'other']
  const categoryTitles: Record<string, string> = {
    meta: 'Connection & Status',
    dom: 'See the Page',
    interaction: 'Do Things',
    navigation: 'Navigate',
    events: 'Watch What Happens',
    mutations: 'Watch DOM Changes',
    selection: 'User Selection',
    windows: 'Multiple Tabs',
    recording: 'Record & Replay',
    testing: 'Run Tests',
    debug: 'Escape Hatches',
    other: 'Other',
  }

  for (const cat of categoryOrder) {
    const eps = byCategory.get(cat)
    if (!eps || eps.length === 0) continue

    lines.push(`## ${categoryTitles[cat] || cat}`)
    lines.push('')

    for (const ep of eps) {
      lines.push(`### \`${ep.method} ${ep.path}\``)
      lines.push('')
      lines.push(`**${ep.summary}**`)
      lines.push('')
      
      if (ep.description) {
        lines.push(ep.description)
        lines.push('')
      }

      const schema = getInputSchema(ep)
      if (schema && (schema as any).properties) {
        const props = (schema as any).properties
        const propNames = Object.keys(props)
        if (propNames.length > 0) {
          lines.push('**Parameters:**')
          lines.push('')
          lines.push('| Name | Type | Description |')
          lines.push('|------|------|-------------|')
          for (const name of propNames) {
            const prop = props[name]
            const type = prop.type || 'any'
            const desc = prop.description || ''
            const required = (schema as any).required?.includes(name) ? ' *(required)*' : ''
            lines.push(`| \`${name}\` | ${type} | ${desc}${required} |`)
          }
          lines.push('')
        }
      }

      // Add examples if present
      const examples = (ep as any).examples
      if (examples && examples.length > 0) {
        lines.push('**Examples:**')
        lines.push('')
        for (const ex of examples) {
          lines.push(`- **${ex.name}**: ${ex.description || ''}`)
          lines.push('  ```json')
          lines.push(`  ${JSON.stringify(ex.input)}`)
          lines.push('  ```')
          
          // Include response example if present
          if (ex.response) {
            lines.push('  Response:')
            lines.push('  ```json')
            lines.push(`  ${JSON.stringify(ex.response, null, 2).split('\n').join('\n  ')}`)
            lines.push('  ```')
          }
          
          // Include curl example if present
          if (ex.curl) {
            lines.push('  ```bash')
            lines.push(`  ${ex.curl}`)
            lines.push('  ```')
          }
        }
        lines.push('')
      }

      lines.push('---')
      lines.push('')
    }
  }

  return lines.join('\n')
}

writeFileSync('API.md', generateApiMd())

console.log('Build complete')
