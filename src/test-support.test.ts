/**
 * `waitForServer`'s failure paths. The success path is exercised by every suite that spawns a
 * server; a failure that says nothing is what made virta #2499 take two sightings to identify.
 */
import { describe, it, expect } from 'bun:test'
import { spawn } from 'bun'
import { uniqueTestPort, waitForServer } from './test-support'

const child = (code: string) => spawn({ cmd: ['bun', '-e', code], stdout: 'pipe', stderr: 'pipe' })

describe('waitForServer', () => {
  it('fails at once, with exit code and stderr, when the child dies', async () => {
    const started = Date.now()
    const err = await waitForServer(`http://localhost:${uniqueTestPort()}`, child("console.error('port in use'); process.exit(3)")).catch((e) => e)
    expect(err.message).toContain('exited with code 3 before answering')
    expect(err.message).toContain('port in use')
    expect(Date.now() - started).toBeLessThan(5000) // not the 30s deadline
  })

  it('names the deadline and the last error when the child is alive but silent', async () => {
    const proc = child("console.error('still thinking'); setInterval(() => {}, 1000)")
    const err = await waitForServer(`http://localhost:${uniqueTestPort()}`, proc, { timeoutMs: 400 }).catch((e) => e)
    expect(err.message).toContain('did not answer within 400ms')
    expect(err.message).toContain('still thinking')
    await proc.exited // the helper stops a child it gave up on
  })
})
