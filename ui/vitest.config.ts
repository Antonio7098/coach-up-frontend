import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.vitest.ts'],
    include: ['tests/unit/**/*.spec.ts*', 'tests/integration/**/*.spec.ts*'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
