import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup-env.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 51730,
    hookTimeout: 51730,
    fileParallelism: false,
  },
});
