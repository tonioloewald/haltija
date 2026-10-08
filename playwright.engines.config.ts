import { defineConfig } from '@playwright/test'

/**
 * The engine-sensitive suites across all three engines (`bun run test:engines`).
 *
 * Separate from `playwright.config.ts` on purpose: whether an https page may reach
 * `http://localhost` DIFFERS by engine (Chromium/Firefox yes, WebKit no — see src/transports.ts),
 * and a Chromium-only measurement is exactly how this repo once declared the WebKit behaviour
 * "false". `playwright-bridge.playwright.ts` runs here too: the bridge is the supported route to
 * Firefox and WebKit for `testInBrowser` (#3088), so it has to be seen working in them. Nothing
 * else is engine-sensitive, so nothing else runs three times.
 *
 * Needs `npx playwright install firefox webkit`.
 */
export default defineConfig({
  testDir: './src',
  testMatch: ['**/loader-snippet.playwright.ts', '**/playwright-bridge.playwright.ts'],
  workers: 1,
  timeout: 30000,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
