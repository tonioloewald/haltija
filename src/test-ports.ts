/**
 * Port allocation for tests — its own module so **Playwright can import it too**.
 *
 * `test-support.ts` already had this rule, and the e2e lane never got it: `e2e.playwright.ts`
 * hardcoded `const PORT = 8702 // Different port to avoid conflicts`, which is only true until the
 * second thing wants 8702. It couldn't share the helper because Playwright runs on Node and
 * `test-support.ts` is imported by Bun suites — so the rule was re-implemented, badly, exactly as
 * the DRY lens keeps predicting.
 *
 * The cost isn't theoretical. A run interrupted before `afterAll` leaves a server holding that
 * fixed port forever, and every later run dies with a raw EADDRINUSE stack pointing into
 * `server.ts` — a failure that looks like a code bug and has nothing to do with the code. That is
 * the tool manufacturing the "is it me or you?" confusion it is supposed to eliminate.
 *
 * **Node-only by construction.** No Bun APIs here, ever, or the Playwright side breaks (see
 * CLAUDE.md → "Critical: Bun vs Playwright Test Separation").
 */

import { join } from 'path'

// High base, per-process-unique (pid keeps concurrent runs apart), well clear of the 87xx range
// real haltija servers use. A shared counter hands out distinct ports across files in one run.
const PORT_BASE = 20000 + (process.pid % 20000)
let portOffset = 0

/** A port unlikely to collide with a real server, another agent, a leaked run, or another test. */
export function uniqueTestPort(): number {
  return PORT_BASE + portOffset++
}

/**
 * The env that makes a spawned haltija server leave the machine alone — ONE definition.
 *
 * There were three: `isolateTestMachineState()` for the Bun suites, `startTestServer()` for
 * Playwright, and a hand-built env in `server-autoport.test.ts`. When 1.13.0 made `both` the
 * transport default, only the first learned about it. Playwright's copy opted out of HTTPS with
 * `DEV_CHANNEL_NO_HTTPS=1`, a variable nothing has read since v0.1.7, so every e2e server bound the
 * machine's real 8701 (capturing other projects' https tabs when it was free) and adopted or
 * generated a certificate in the real `~/.haltija/certs`. The autoport spawn did the same. All
 * green; found by the 1.13.0-beta.1 blast-radius review.
 *
 * Tests that exercise HTTPS on purpose (`https.test.ts`, `both-mode.test.ts`) pass `--https` /
 * `--both` and their own HTTPS port, which the CLI applies over this.
 */
export function isolatedServerEnv(dir: string): Record<string, string> {
  return {
    HALTIJA_REGISTRY_DIR: dir,
    HALTIJA_MACHINE_LOG: join(dir, 'machine-actions.log'),
    HALTIJA_NO_RETIRE: '1', // never stop another server (also gates freePort)
    HALTIJA_NO_INSTALL: '1', // never write ~/.local/bin/hj
    // Writing an artifact triggers a prune, and with the real tmpdir that deleted the developer's
    // screenshots older than 24h.
    HALTIJA_ARTIFACT_DIR: dir,
    // The HTTPS default is the well-known 8701, which `uniqueTestPort()` does not move.
    DEV_CHANNEL_MODE: 'http',
    // An explicit single transport prints the #32d "degrading the shared channel" warning. True in
    // general, false for a temp-registry server with no neighbours.
    HALTIJA_NO_TRANSPORT_WARN: '1',
    // Certificates are machine-level (`~/.haltija/certs`).
    HALTIJA_CERTS_DIR: join(dir, 'certs'),
  }
}
