/**
 * The sweep must clear dead runs' litter and never touch a live peer's.
 *
 * Private mode exists so concurrent runs cannot interfere. A cleanup that deleted a RUNNING
 * instance's profile would be far worse than the litter it tidied — and on a machine shared with
 * other agents, it would be someone else's work destroyed. That is why liveness is the only
 * criterion, and why `EPERM` (the process exists but belongs to another user) counts as ALIVE.
 */

import { describe, it, expect } from 'bun:test'
import { stalePrivateEntries, pidIsAlive } from './private-state'

const SELF = 4242
const dead = new Set<number>()
const deps = { selfPid: SELF, isAlive: (pid: number) => !dead.has(pid) }

describe('stalePrivateEntries', () => {
  it('sweeps a dead run — both the port-file and the profile directory', () => {
    dead.add(999)
    expect(
      stalePrivateEntries(['haltija-private-999', 'haltija-private-999.json'], deps),
    ).toEqual(['haltija-private-999', 'haltija-private-999.json'])
  })

  it('NEVER sweeps a live peer', () => {
    // The property that matters: two concurrent private runs must not tidy each other away.
    expect(stalePrivateEntries(['haltija-private-1234', 'haltija-private-1234.json'], deps)).toEqual([])
  })

  it('never sweeps its own state', () => {
    dead.add(SELF) // even if liveness somehow says otherwise
    expect(stalePrivateEntries([`haltija-private-${SELF}.json`], deps)).toEqual([])
    dead.delete(SELF)
  })

  it('ignores anything that is not ours', () => {
    expect(
      stalePrivateEntries(
        ['haltija-screenshots', 'haltija-private-', 'haltija-private-abc', 'some-other-file', 'T'],
        deps,
      ),
    ).toEqual([])
  })

  it('is not vacuous — a mixed list sweeps exactly the dead ones', () => {
    dead.add(777)
    const names = ['haltija-private-777.json', 'haltija-private-1234.json', 'unrelated']
    expect(stalePrivateEntries(names, deps)).toEqual(['haltija-private-777.json'])
  })
})

describe('pidIsAlive', () => {
  it('says yes for this process', () => {
    expect(pidIsAlive(process.pid)).toBe(true)
  })

  it('says no for a pid that cannot exist', () => {
    // Way beyond any pid_max; ESRCH, not EPERM.
    expect(pidIsAlive(0x7ffffff0)).toBe(false)
  })

  it('treats EPERM as ALIVE — pid 1 exists and is not ours to signal', () => {
    // Getting this backwards would make the sweep delete other users' live state.
    expect(pidIsAlive(1)).toBe(true)
  })
})
