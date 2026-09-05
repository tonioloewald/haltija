import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * main.js must actually PASS the things buildServerEnv can grant.
 *
 * `src/desktop-server-env.test.ts` covers what `buildServerEnv` does with its options — and it
 * passed the whole time the nonce was broken, because the defect was one level up: main.js called
 * it without `wsNonce` at all. A `str.replace` matched the wrong indentation and silently did
 * nothing, so the server held no nonce and refused its own terminal frame.
 *
 * Nothing caught it. 977 unit tests were green, the desktop app launched, and `/terminal/command`
 * kept working because it travels over the stdio pipe and never needed the socket. The only
 * symptom was a refusal count in a log nobody reads.
 *
 * These are source assertions rather than behavioural ones because the wiring lives in Electron
 * main, which no unit lane can boot. That is a weaker test than running the thing — stated plainly
 * rather than implied — but it covers the exact seam that failed, and it fails loudly if either
 * option stops being passed.
 */
const MAIN = readFileSync(join(import.meta.dir, '../apps/desktop/main.js'), 'utf-8')

/** The single buildServerEnv call, with its argument object. */
function spawnEnvCall(): string {
  const at = MAIN.indexOf('buildServerEnv(process.env, {')
  expect(at).toBeGreaterThan(-1)
  const end = MAIN.indexOf('})', at)
  return MAIN.slice(at, end + 2)
}

describe('the desktop app passes what it mints (regression: the WS nonce)', () => {
  it('calls buildServerEnv exactly once, so there is one place to be wrong', () => {
    const calls = MAIN.split('buildServerEnv(process.env, {').length - 1
    expect(calls).toBe(1)
  })

  it('passes wsNonce — without it the server refuses its own terminal frame', () => {
    expect(spawnEnvCall()).toContain('wsNonce')
  })

  it('passes the port, role, isPrivate and portFile it is given', () => {
    const call = spawnEnvCall()
    for (const opt of ['port', 'role', 'isPrivate', 'portFile']) expect(call).toContain(opt)
  })

  it('mints the nonce from a CSPRNG, not from anything guessable', () => {
    // A predictable nonce is no nonce: the whole point is that a hostile frame cannot produce it.
    expect(MAIN).toMatch(/WS_NONCE\s*=\s*require\('crypto'\)\.randomBytes\(\d+\)/)
  })

  it('hands the nonce to the renderer, and the renderer into the terminal frame URL', () => {
    // Four hops, each of which silently disables the terminal if it breaks:
    //   main mints -> IPC -> preload -> tabs.js -> terminal.html
    expect(MAIN).toContain("ipcMain.handle('ws-nonce'")
    const preload = readFileSync(join(import.meta.dir, '../apps/desktop/preload.js'), 'utf-8')
    expect(preload).toContain('wsNonce')
    const tabs = readFileSync(join(import.meta.dir, '../apps/desktop/renderer/tabs.js'), 'utf-8')
    expect(tabs).toMatch(/nonce=\$\{encodeURIComponent\(nonce\)\}/)
    const terminal = readFileSync(join(import.meta.dir, '../apps/desktop/terminal.html'), 'utf-8')
    expect(terminal).toContain("params.get('nonce')")
    expect(terminal).toMatch(/\/ws\/terminal.*nonce=/s)
  })
})
