import { defineConfig } from '@playwright/test'

/**
 * The transport-fallback suite across all three engines (`bun run test:engines`).
 *
 * Separate from `playwright.config.ts` on purpose: whether an https page may reach
 * `http://localhost` DIFFERS by engine (Chromium/Firefox yes, WebKit no — see src/transports.ts),
 * and a Chromium-only measurement is exactly how this repo once declared the WebKit behaviour
 * "false". Only this suite is engine-sensitive, so only it runs three times.
 *
 * Needs `npx playwright install firefox webkit`.
 */
export default defineConfig({
  testDir: './src',
  testMatch: '**/loader-snippet.playwright.ts',
  workers: 1,
  timeout: 30000,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
