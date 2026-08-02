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

// High base, per-process-unique (pid keeps concurrent runs apart), well clear of the 87xx range
// real haltija servers use. A shared counter hands out distinct ports across files in one run.
const PORT_BASE = 20000 + (process.pid % 20000)
let portOffset = 0

/** A port unlikely to collide with a real server, another agent, a leaked run, or another test. */
export function uniqueTestPort(): number {
  return PORT_BASE + portOffset++
}
