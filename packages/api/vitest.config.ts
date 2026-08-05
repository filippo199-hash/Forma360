import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Router suites boot pglite and apply the full migration history in their
    // setup hooks; on slow CI that crosses vitest's 10s default `hookTimeout`.
    // Match the 30s the other pglite-backed packages (jobs/render) use.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
