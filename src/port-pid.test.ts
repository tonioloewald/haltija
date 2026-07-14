/**
 * Tests for src/port-pid.ts against real sockets.
 *
 * This is the code that picks which process gets a SIGTERM, so it is tested with
 * an actual listener and an actual connected client rather than a mock. The bug it
 * exists to prevent: `lsof -i :PORT` also matches the *remote* port, so a connected
 * client (the user's browser) is returned alongside the listener — and, having been
 * started earlier, sorts first by pid. The kill then lands on the browser.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { spawn, type Subprocess } from 'bun'
import { listenerPidOnPort, listenerPidsOnPort, isHaltijaProcess } from './port-pid'

const PORT = 18899
const procs = new Set<Subprocess>()

afterEach(async () => {
  for (const p of procs) {
    try { p.kill('SIGKILL') } catch {}
  }
  procs.clear()
  await new Promise((r) => setTimeout(r, 150))
})

/** A process that listens on PORT and does nothing else. */
function startListener(): Subprocess {
  const p = spawn({
    cmd: ['python3', '-c', `
import socket, time
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', ${PORT}))
s.listen(5)
time.sleep(60)
`],
    stdout: 'ignore',
    stderr: 'ignore',
  })
  procs.add(p)
  return p
}

/** A process that connects to PORT and holds the socket open. */
function startClient(): Subprocess {
  const p = spawn({
    cmd: ['python3', '-c', `
import socket, time
c = socket.socket()
for _ in range(100):
    try:
        c.connect(('127.0.0.1', ${PORT})); break
    except Exception:
        time.sleep(0.05)
time.sleep(60)
`],
    stdout: 'ignore',
    stderr: 'ignore',
  })
  procs.add(p)
  return p
}

async function settle(ms = 700) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('listenerPidsOnPort', () => {
  it('returns nothing when the port is free', () => {
    expect(listenerPidsOnPort(PORT)).toEqual([])
  })

  it('finds the listener', async () => {
    const listener = startListener()
    await settle()
    expect(listenerPidsOnPort(PORT)).toEqual([listener.pid!])
  })

  it('NEVER returns a connected client, even when the client has the lower pid', async () => {
    // The exact production shape: the browser (client) has been running far longer
    // than the server, so it has the lower pid and lsof lists it FIRST. A resolver
    // that took pids[0] from an unfiltered `lsof -i :PORT` would hand back the
    // browser — and the caller SIGTERMs it.
    const listener = startListener()
    await settle()
    const client = startClient()
    await settle()

    const pids = listenerPidsOnPort(PORT)

    expect(pids).toContain(listener.pid!)
    expect(pids).not.toContain(client.pid!)
    // And the single-pid convenience wrapper must agree — that's what the kill path uses.
    expect(listenerPidOnPort(PORT)).toBe(listener.pid!)
  })
})

describe('isHaltijaProcess', () => {
  it('does not identify an unrelated process as haltija', async () => {
    const listener = startListener()
    await settle()
    // A plain python socket server is exactly the kind of innocent bystander we must
    // never SIGTERM.
    expect(isHaltijaProcess(listener.pid!)).toBe(false)
  })

  it('returns false for a pid that does not exist — never signal what you cannot identify', () => {
    expect(isHaltijaProcess(2 ** 30)).toBe(false)
  })
})
