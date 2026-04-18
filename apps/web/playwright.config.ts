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

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
