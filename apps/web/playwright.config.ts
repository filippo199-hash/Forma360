import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Forma360 web app.
 *
 * Phase 0 has a single smoke test: visit /, expect redirect to /en, expect
 * the sign-in title rendered. That's enough to prove the full request path
 * (middleware → [locale] layout → page → next-intl → component) works end
 * to end. Richer per-feature E2E coverage lands in the feature PRs.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,

  // Every test shares one `next start` instance; a dozen sandbox
  // provisions landing at once make first paints legitimately slow.
  // 15 s is a wait ceiling, not a delay — green runs stay fast.
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Sandboxed dev environments ship a pre-provisioned Chromium and
        // block the download `playwright install` would do. Point
        // PLAYWRIGHT_CHROMIUM_PATH at its binary to use it; unset (the
        // default, and CI) uses Playwright's own managed browser.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH !== undefined
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],

  // When PLAYWRIGHT_BASE_URL is set we skip the webServer and drive against
  // whatever instance is already running (Railway preview in CI, prod smoke
  // checks, etc.).
  webServer:
    process.env.PLAYWRIGHT_BASE_URL === undefined
      ? {
          command: 'pnpm start',
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        }
      : undefined,
});
