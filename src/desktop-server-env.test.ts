import { describe, it, expect } from 'bun:test'
import { buildServerEnv } from './desktop-server-env'

describe('buildServerEnv — shared (non-private) children', () => {
  it('passes the port via the env the SERVER ACTUALLY READS', () => {
    // The regression this file exists for: the port was passed only as `PORT`, which src/server.ts
    // never reads, so the child inherited the app's port, collided, and died silently.
    const env = buildServerEnv({}, { port: 8701, role: 'internal' })
    expect(env.HALTIJA_PORT).toBe('8701')
    expect(env.DEV_CHANNEL_PORT).toBe('8701')
    expect(env.PORT).toBe('8701')
  })

  it('does NOT let the parent’s port leak into the child', () => {
    // The exact failure shape: parent on 8700, child told 8701, child bound 8700.
    const env = buildServerEnv({ HALTIJA_PORT: '8700', DEV_CHANNEL_PORT: '8700' }, { port: 8701, role: 'internal' })
    expect(env.HALTIJA_PORT).toBe('8701')
    expect(env.DEV_CHANNEL_PORT).toBe('8701')
  })

  it('marks only the PUBLIC server as registrable under the reserved name', () => {
    expect(buildServerEnv({}, { port: 8700, role: 'public' }).HALTIJA_DESKTOP_PUBLIC).toBe('1')
    expect(buildServerEnv({}, { port: 8701, role: 'internal' }).HALTIJA_DESKTOP_PUBLIC).toBe('0')
  })

  it('always identifies the child as desktop-hosted', () => {
    expect(buildServerEnv({}, { port: 1, role: 'public' }).HALTIJA_DESKTOP).toBe('1')
  })

  it('strips a private parent’s flags so a shared child cannot inherit isolation', () => {
    const env = buildServerEnv(
      { HALTIJA_PRIVATE: '1', HALTIJA_PORT_FILE: '/tmp/leftover.json' },
      { port: 8700, role: 'public' },
    )
    expect(env.HALTIJA_PRIVATE).toBeUndefined()
    expect(env.HALTIJA_PORT_FILE).toBeUndefined()
  })
})

describe('buildServerEnv — private (isolated) children', () => {
  const priv = () =>
    buildServerEnv({ HALTIJA_PORT: '8700' }, { port: 0, role: 'public', isPrivate: true, portFile: '/tmp/p.json' })

  it('removes any fixed port, so the child binds EPHEMERALLY', () => {
    // Leaving either of these set would pin the private instance to a shared port — the whole
    // isolation guarantee.
    const env = priv()
    expect(env.HALTIJA_PORT).toBeUndefined()
    expect(env.DEV_CHANNEL_PORT).toBeUndefined()
  })

  it('sets the isolation flags: private, no retiring, no PATH install', () => {
    const env = priv()
    expect(env.HALTIJA_PRIVATE).toBe('1')
    expect(env.HALTIJA_NO_RETIRE).toBe('1') // must never stop a peer
    expect(env.HALTIJA_NO_INSTALL).toBe('1') // must never write ~/.local/bin/hj
  })

  it('points the child at ITS OWN port-file, which is how the ephemeral port is discovered', () => {
    expect(priv().HALTIJA_PORT_FILE).toBe('/tmp/p.json')
  })

  it('omits the port-file rather than setting it undefined when none is given', () => {
    const env = buildServerEnv({}, { port: 0, role: 'internal', isPrivate: true })
    expect('HALTIJA_PORT_FILE' in env).toBe(false)
  })
})

describe('machine-control channel (#40)', () => {
  // The terminal/agent/file tabs talk to the PUBLIC server, so only it gets the channel. Granting
  // it to the internal chrome server would widen a machine-control capability for no caller.
  it('is granted to the public server only', () => {
    expect(buildServerEnv({}, { port: 8700, role: 'public' }).HALTIJA_MACHINE_CHANNEL).toBe('1')
    expect(
      buildServerEnv({}, { port: 8701, role: 'internal' }).HALTIJA_MACHINE_CHANNEL,
    ).toBeUndefined()
  })

  // A stale value in the parent environment must not grant the capability to a server we did not
  // intend to grant it to — the whole point is that it is conferred deliberately by the spawner.
  it('does not leak in from the parent environment for the internal server', () => {
    const env = buildServerEnv({ HALTIJA_MACHINE_CHANNEL: '1' }, { port: 8701, role: 'internal' })
    expect(env.HALTIJA_MACHINE_CHANNEL).toBeUndefined()
  })
})
