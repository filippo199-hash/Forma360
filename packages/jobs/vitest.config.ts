import { defineConfig } from 'vitest/config';

/**
 * The schedule-worker tests boot a PGlite DB + full migration set per test.
 * Run serially in a single fork with generous timeouts so the boot doesn't
 * contend for CPU with parallel workers and blow the default 10s hook timeout
 * on CI's slower runners (mirrors the api / render / db configs).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
