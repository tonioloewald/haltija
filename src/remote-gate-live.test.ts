import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawn, type ChildProcess } from 'child_process'
import http from 'http'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { networkInterfaces, tmpdir } from 'os'
import { isolatedServerEnv } from './test-ports'

/**
 * The #815 gate against a REAL server: a caller from another machine needs the token.
 *
 * `remote-gate.test.ts` covers the predicate; this covers the wiring, that the server reads the
 * socket's peer address rather than anything the caller wrote. The other machine is simulated by
 * connecting to this machine's own non-loopback address: the peer the server sees is then that
 * address, not 127.0.0.1, exactly as for a LAN client.
 */
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address

function startServer(env: Record<string, string>): Promise<{ proc: ChildProcess; port: number }> {
  const proc = spawn('bun', [join(import.meta.dir, '../bin/server.ts')], {
    env: {
      ...process.env,
      ...isolatedServerEnv(mkdtempSync(join(tmpdir(), 'haltija-remotegate-'))),
      HALTIJA_PRIVATE: '1', // ephemeral port, registers nothing, touches no shared server
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const done = setTimeout(() => reject(new Error('server did not report its port in 15s')), 15000)
    proc.stdout!.on('data', (d) => {
      const m = String(d).match(/"port":(\d+)/)
      if (m) { clearTimeout(done); resolve({ proc, port: Number(m[1]) }) }
    })
  })
}

function get(host: string, port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const req = http.request({ host, port, path, headers })
    req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(101) })
    req.on('response', (res) => { res.resume(); resolve(res.statusCode ?? 0) })
    req.on('error', () => resolve(0))
    req.end()
    setTimeout(() => resolve(0), 5000)
  })
}

const UPGRADE = {
  Connection: 'Upgrade',
  Upgrade: 'websocket',
  'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
  'Sec-WebSocket-Version': '13',
}

// No external interface is a machine with nothing to be reached from; fail rather than skip, since
// a skip would read as a pass. CI runners and dev machines both have one.
it('this machine has a non-loopback IPv4 address to test from', () => {
  expect(lanAddress).toBeTruthy()
})

describe('without --token, another machine is refused (#815)', () => {
  let proc: ChildProcess | null = null
  let port = 0
  beforeAll(async () => ({ proc, port } = await startServer({})))
  afterAll(() => proc?.kill())

  it('same-machine REST works unchanged', async () => {
    expect(await get('127.0.0.1', port, '/status')).toBe(200)
  })

  it('REST from the LAN address is 403', async () => {
    expect(await get(lanAddress!, port, '/status')).toBe(403)
  })

  it('a widget socket from the LAN address is 403, not upgraded', async () => {
    expect(await get(lanAddress!, port, '/ws/browser', UPGRADE)).toBe(403)
  })

  it('a forged Host or X-Forwarded-For changes nothing', async () => {
    expect(await get(lanAddress!, port, '/status', { Host: 'localhost', 'X-Forwarded-For': '127.0.0.1' })).toBe(403)
  })
})

describe('with --token, another machine is admitted by the token (#815)', () => {
  const TOKEN = 'remote-gate-token'
  let proc: ChildProcess | null = null
  let port = 0
  beforeAll(async () => ({ proc, port } = await startServer({ HALTIJA_TOKEN: TOKEN })))
  afterAll(() => proc?.kill())

  it('the right token from the LAN address is 200', async () => {
    expect(await get(lanAddress!, port, '/status', { 'X-Haltija-Token': TOKEN })).toBe(200)
  })

  it("no token from the LAN address is the token check's 401, not this gate's 403", async () => {
    expect(await get(lanAddress!, port, '/status')).toBe(401)
  })
})
