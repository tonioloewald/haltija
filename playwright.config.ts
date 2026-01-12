import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './src',
  // IMPORTANT: Only match playwright.test.ts, NOT all *.test.ts files!
  // Other test files (*.test.ts) use Bun-specific imports (bun:spawn, etc.)
  // which Playwright (Node.js) cannot resolve. This causes cryptic errors like:
  //   "Cannot find package 'bun'" or "Only URLs with scheme file/data/node supported"
  // If you add new Playwright tests, put them in playwright.test.ts or create
  // another file matching this pattern (e.g., playwright-foo.test.ts)
  testMatch: '**/playwright.test.ts',
  fullyParallel: false, // Run tests serially - they share a server
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to share server
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30000,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
