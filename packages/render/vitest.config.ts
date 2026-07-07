import { defineConfig } from 'vitest/config';

/**
 * Mirrors the api package config: run test files serially in a single fork so
 * the per-test `beforeEach` DB boot (PGlite + full migration set) doesn't
 * contend for CPU with parallel workers. On CI's slower runners the default
 * parallel threads pushed each boot past the 10s hook timeout; `singleFork`
 * plus a generous hook/test timeout keeps it reliable.
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
