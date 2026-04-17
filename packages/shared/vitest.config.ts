import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Keep env overrides from leaking between tests: each test should pass a
    // plain object to parseServerEnv rather than mutating process.env.
    clearMocks: true,
  },
});
