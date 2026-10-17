/**
 * The MCP server works from the package npm users get (GitHub #47).
 *
 * Both setup commands looked for `apps/mcp/build/index.js`, which was never in `files`, so setup
 * exited 1 for every npm user — and even shipped, that file imported an SDK that npm never installs
 * for a nested package. Nothing noticed, because every check ran in the repo, where the SDK sat in
 * apps/mcp/node_modules. So this test does what a user does, somewhere the repo cannot help:
 *
 *   npm pack → extract into a temp dir with NO node_modules above it → run each setup command →
 *   start the server exactly as the written config says → initialize → call a tool against a live
 *   haltija started with --token.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isolateTestMachineState, uniqueTestPort, waitForServer, SERVER_START_HOOK_MS } from './test-support'
// @ts-expect-error — plain .mjs runtime module, no declarations
import { mcpServerCommand } from '../bin/mcp-locate.mjs'

isolateTestMachineState()
const REPO_ROOT = join(import.meta.dir, '..')
const PORT = uniqueTestPort()
const TOKEN = 'mcp-package-test-token'
// realpath: on macOS tmpdir() is behind the /private symlink, and the bins report resolved paths.
const work = realpathSync(mkdtempSync(join(tmpdir(), 'haltija-mcp-pkg-')))
const home = join(work, 'home')
const project = join(work, 'project')
let pkg = ''
let server: Subprocess | null = null

beforeAll(async () => {
  for (const d of [home, project]) mkdirSync(d, { recursive: true })
  // `files` decides what ships, so pack rather than copy. The suite runs after `bun run build`.
  const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', work], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim().split('\n').pop()!
  execFileSync('tar', ['xzf', join(work, tgz), '-C', work])
  pkg = join(work, 'package')

  server = spawn({
    cmd: ['bun', 'run', join(REPO_ROOT, 'bin/server.ts')],
    cwd: REPO_ROOT,
    env: { ...(process.env as Record<string, string>), DEV_CHANNEL_PORT: String(PORT), HALTIJA_PORT: String(PORT), HALTIJA_TOKEN: TOKEN },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await waitForServer(`http://localhost:${PORT}`, server, { init: { headers: { 'X-Haltija-Token': TOKEN } } })
}, SERVER_START_HOOK_MS + 60_000)

afterAll(() => {
  server?.kill()
  rmSync(work, { recursive: true, force: true })
})

/** Run a shipped bin from the extracted package, with HOME pointed away from the real one. */
function runBin(bin: string, args: string[] = []) {
  return execFileSync('node', [join(pkg, bin), ...args], {
    cwd: project,
    env: { ...process.env, HOME: home, HALTIJA_NO_INSTALL: '1', HALTIJA_NO_RETIRE: '1', NO_COLOR: '1' },
    encoding: 'utf-8',
    timeout: 20_000,
  })
}

/** Start the server from a client config entry, and talk JSON-RPC to it over stdio. */
async function mcpSession(entry: { command: string; args: string[] }, env: Record<string, string>) {
  const proc = spawn({
    cmd: [entry.command, ...entry.args],
    cwd: project,
    env: { PATH: process.env.PATH!, HOME: home, ...env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const reader = proc.stdout.getReader()
  let buffered = ''
  const pending = new Map<number, (msg: any) => void>()
  ;(async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffered += new TextDecoder().decode(value)
      let nl: number
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl)
        buffered = buffered.slice(nl + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        pending.get(msg.id)?.(msg)
      }
    }
  })()
  let nextId = 1
  const request = (method: string, params: unknown = {}) => {
    const id = nextId++
    const reply = new Promise<any>((resolve, reject) => {
      pending.set(id, resolve)
      setTimeout(() => reject(new Error(`no reply to ${method} in 10s`)), 10_000)
    })
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    return reply
  }
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  return { init, request, close: () => proc.kill() }
}

describe('the MCP server works from the packed package (GitHub #47)', () => {
  it('ships the bundle and its bin, and nothing it would need node_modules for', () => {
    expect(existsSync(join(pkg, 'dist/mcp.js'))).toBe(true)
    expect(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf-8')).bin['haltija-mcp']).toBe('./dist/mcp.js')
    expect(existsSync(join(pkg, 'node_modules'))).toBe(false)
  })

  it('haltija-mcp-setup writes a .mcp.json whose command starts a working server', async () => {
    runBin('bin/mcp-setup.mjs')
    const entry = JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf-8')).mcpServers.haltija
    expect(entry).toEqual({ command: 'node', args: [join(pkg, 'dist/mcp.js')] })

    const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf-8')).version
    const mcp = await mcpSession(entry, { HALTIJA_PORT: String(PORT), HALTIJA_TOKEN: TOKEN })
    try {
      expect(mcp.init.result.serverInfo).toEqual({ name: 'haltija', version })
      const tools = (await mcp.request('tools/list')).result.tools.map((t: any) => t.name)
      expect(tools).toContain('status')
      expect(tools).toContain('click')
      // A real round trip: the tool reached the server, which demands the token.
      const call = await mcp.request('tools/call', { name: 'status', arguments: {} })
      expect(call.result.isError).toBeFalsy()
      expect(JSON.parse(call.result.content[0].text).serverVersion).toBeTruthy()
    } finally {
      mcp.close()
    }
  }, 30_000)

  it('without the token the same call is refused, so the round trip above really carried it', async () => {
    const entry = { command: 'node', args: [join(pkg, 'dist/mcp.js')] }
    const mcp = await mcpSession(entry, { HALTIJA_PORT: String(PORT) })
    try {
      const call = await mcp.request('tools/call', { name: 'status', arguments: {} })
      expect(call.result.isError).toBe(true)
    } finally {
      mcp.close()
    }
  }, 30_000)

  it('haltija --setup-mcp writes the same command into the Claude Desktop config', () => {
    runBin('bin/tosijs-dev.mjs', ['--setup-mcp'])
    const configDir = process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Claude')
      : join(home, '.config', 'claude')
    expect(readdirSync(configDir)).toContain('claude_desktop_config.json')
    const config = JSON.parse(readFileSync(join(configDir, 'claude_desktop_config.json'), 'utf-8'))
    expect(config.mcpServers.haltija).toEqual({ command: 'node', args: [join(pkg, 'dist/mcp.js')] })
  })
})

describe('a package run from an npx / bunx cache gets a command that survives the cache', () => {
  it('pins the version through npx instead of an absolute path that will be cleaned', () => {
    const version = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')).version
    for (const p of ['/Users/a/.npm/_npx/1a2b/node_modules/haltija/dist/mcp.js', '/tmp/bunx-501-haltija@latest/node_modules/haltija/dist/mcp.js']) {
      expect(mcpServerCommand(p, REPO_ROOT)).toEqual({ command: 'npx', args: ['-y', '-p', `haltija@${version}`, 'haltija-mcp'] })
    }
    expect(mcpServerCommand('/work/app/node_modules/haltija/dist/mcp.js', REPO_ROOT))
      .toEqual({ command: 'node', args: ['/work/app/node_modules/haltija/dist/mcp.js'] })
  })
})
