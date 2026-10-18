import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// @ts-ignore — a shipped .mjs with no declarations
import { staleMcpEntry } from '../bin/mcp-locate.mjs'

const root = join(import.meta.dir, '..')

describe('staleMcpEntry (1.13.0 review)', () => {
  it('flags the pre-1.13 apps/mcp/build entry, even where that file still exists', () => {
    expect(staleMcpEntry({ command: 'node', args: [join(root, 'apps/mcp/build/index.js')] })).toContain('pre-1.13')
  })

  it('flags an entry whose server file is missing', () => {
    expect(staleMcpEntry({ command: 'node', args: ['/nowhere/dist/mcp.js'] })).toContain('does not exist')
  })

  it('leaves a runnable path, and a command entry, alone', () => {
    expect(staleMcpEntry({ command: 'node', args: [join(root, 'scripts/build.ts')] })).toBeNull()
    expect(staleMcpEntry({ command: 'npx', args: ['-y', '-p', 'haltija@1.13.0', 'haltija-mcp'] })).toBeNull()
  })
})

describe('haltija-mcp-setup over a stale .mcp.json', () => {
  it('replaces the entry instead of saying "already configured", and --check calls it stale first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'haltija-mcpsetup-'))
    const file = join(dir, '.mcp.json')
    const stale = { mcpServers: { other: { command: 'x' }, haltija: { command: 'node', args: ['/old/node_modules/haltija/apps/mcp/build/index.js'] } } }
    writeFileSync(file, JSON.stringify(stale))
    // HALTIJA_PORT: --check probes for a running server, and must not probe the shared 8700.
    const env = { ...process.env, HOME: dir, NO_COLOR: '1', HALTIJA_PORT: '1' }

    const check = spawnSync('node', [join(root, 'bin/mcp-setup.mjs'), '--check'], { cwd: dir, env, encoding: 'utf8' })
    expect(check.stdout).toContain('stale Haltija entry')

    spawnSync('node', [join(root, 'bin/mcp-setup.mjs')], { cwd: dir, env, encoding: 'utf8' })
    const after = JSON.parse(readFileSync(file, 'utf8'))
    expect(after.mcpServers.other).toEqual({ command: 'x' })
    expect(JSON.stringify(after.mcpServers.haltija)).not.toContain('apps/mcp/build')
  })
})
