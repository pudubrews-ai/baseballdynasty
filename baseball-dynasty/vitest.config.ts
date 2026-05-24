import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['server/**/*.ts'],
      exclude: ['server/tests/**'],
    },
  },
  resolve: {
    alias: {
      '@shared': new URL('./shared', import.meta.url).pathname,
    },
  },
});
