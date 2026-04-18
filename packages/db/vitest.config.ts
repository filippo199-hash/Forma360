import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // pglite boots are ~200ms each; default 5s timeout is fine but give tests
    // a bit more headroom in slow CI.
    testTimeout: 15_000,
    // Disable pool parallelism so pglite instances don't fight for WASM memory
    // on CI runners. The suite is small — single-fork is not slow.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
