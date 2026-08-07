import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    // beforeEach replays every migration into pglite. That fits well
    // inside 10s alone, but not when `turbo run test` has several
    // packages booting their own pglite at the same time — vitest's
    // default hook timeout is the one knob that was never raised to
    // match testTimeout.
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
