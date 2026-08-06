import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The pglite integration suites re-apply the full migration history in
    // their setup hooks, which crosses vitest's 10s default `hookTimeout` on
    // slow CI (admins.test.ts's beforeEach timed out there, then afterEach
    // threw on an unassigned client). Match the 30s used by jobs/render.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
