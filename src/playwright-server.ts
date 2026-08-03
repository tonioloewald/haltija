/**
 * Starting and stopping a haltija server for a Playwright suite — once, instead of three times.
 *
 * All three `*.playwright.ts` files spawned `bun run bin/server.ts`, waited for `/status`, and
 * killed it in `afterAll`. Three copies, and they had already drifted in every dimension that
 * matters:
 *
 *  - **Port.** `e2e` got `uniqueTestPort()`; `mutation` kept `8703` and `screen-capture` kept
 *    `8709`. A fixed port is "different" only until the second thing wants it — including the
 *    suite's OWN leaked server from an interrupted run, after which every later run dies with a
 *    raw EADDRINUSE stack pointing into `server.ts`. That failure looks like a code bug and has
 *    nothing to do with the code: the tool manufacturing the "is it me or you?" confusion it
 *    exists to remove.
 *  - **Teardown.** `e2e` sent SIGTERM and then *confirmed*, escalating to SIGKILL. The other two
 *    called bare `serverProcess?.kill()` and moved on — so a `bun run` wrapper that outlives the
 *    signal leaves a server holding the port, which is precisely how the leak above happens.
 *  - **HTTPS.** Two set `DEV_CHANNEL_NO_HTTPS`; `mutation` didn't, so it also bound a second
 *    (unused) TLS listener, doubling its chances of colliding with something.
 *  - **Registry dir.** All three `mkdtempSync`'d one and none ever removed it, so every Playwright
 *    run left another `haltija-pw-registry-…` in tmpdir forever.
 *
 * **Node-only by construction.** No Bun APIs here, ever, or every Playwright suite breaks on
 * import (see CLAUDE.md → "Critical: Bun vs Playwright Test Separation"). Same rule as
 * `src/test-ports.ts`, which this builds on.
 *
 * Not named `*.playwright.ts` on purpose — `playwright.config.ts` matches that suffix and would
 * try to run this as a test file with no tests in it.
 */

import { spawn, type ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { uniqueTestPort } from './test-ports'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export interface TestServer {
  port: number
  serverUrl: string
  wsUrl: string
  /** SIGTERM, confirm, escalate to SIGKILL, then remove the throwaway registry dir. */
  stop: () => Promise<void>
}

/**
 * Spawn a haltija server on a per-process-unique port and wait until it is genuinely serving.
 *
 * Readiness is `/status` **and** `/component.js`: a suite that injects the widget and only checked
 * `/status` could race the asset it is about to request.
 */
export async function startTestServer(
  { logPrefix }: { logPrefix?: string } = {},
): Promise<TestServer> {
  const port = uniqueTestPort()
  const serverUrl = `http://localhost:${port}`
  // A throwaway registry, so a spawned server can't write into the developer's real
  // ~/.haltija/servers — combined with NO_RETIRE and NO_INSTALL, which stop it SIGTERMing servers
  // it decides are "legacy" and overwriting the `hj` on their PATH mid-run.
  const registryDir = mkdtempSync(join(tmpdir(), 'haltija-pw-registry-'))

  const proc: ChildProcess = spawn('bun', ['run', 'bin/server.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DEV_CHANNEL_PORT: String(port),
      DEV_CHANNEL_NO_HTTPS: '1',
      HALTIJA_REGISTRY_DIR: registryDir,
      HALTIJA_NO_RETIRE: '1',
      HALTIJA_NO_INSTALL: '1',
    },
    stdio: logPrefix ? 'pipe' : 'inherit',
  })
  if (logPrefix) {
    proc.stdout?.on('data', d => console.log(logPrefix, String(d).trim()))
    proc.stderr?.on('data', d => console.error(`${logPrefix} err`, String(d).trim()))
  }

  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGTERM')
      const deadline = Date.now() + 3000
      while (proc.exitCode === null && proc.signalCode === null && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100))
      }
      // A `bun run` wrapper can ignore or outlive SIGTERM. Asking politely and never checking is
      // how the port stays held.
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    }
    try {
      rmSync(registryDir, { recursive: true, force: true })
    } catch {
      // Tidying must not fail a suite that otherwise passed.
    }
  }

  for (let i = 0; i < 50; i++) {
    try {
      const status = await fetch(`${serverUrl}/status`)
      if (status.ok) {
        const component = await fetch(`${serverUrl}/component.js`)
        if (component.ok) return { port, serverUrl, wsUrl: `ws://localhost:${port}/ws/browser`, stop }
      }
    } catch {
      // Not up yet.
    }
    await new Promise(r => setTimeout(r, 200))
  }

  // Don't leak the process we just failed to reach — a half-started server holding a port is the
  // exact thing this module exists to prevent.
  await stop()
  throw new Error(`haltija server failed to become ready on port ${port} within 10s`)
}
