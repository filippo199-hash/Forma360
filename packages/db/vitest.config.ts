import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // pglite boots are ~200ms each, but the setup hooks apply the full
    // migration history (70+ files and growing) before every suite, and that
    // crosses vitest's 10s default `hookTimeout` on slow CI runners — the
    // Phase 1 setup measured 10094ms and failed by 94ms. Give both the tests
    // and their hooks the same 30s headroom `jobs` and `render` already use.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Disable pool parallelism so pglite instances don't fight for WASM memory
    // on CI runners. The suite is small — single-fork is not slow.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
