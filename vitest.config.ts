import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['chatsphere/server/tests/setup-env.ts'],
    include: ['chatsphere/server/tests/**/*.test.ts'],
    testTimeout: 51730,
    hookTimeout: 51730,
    fileParallelism: false,
  },
});
