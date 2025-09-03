import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.vitest.ts'],
    include: ['tests/unit/**/*.spec.ts*', 'tests/integration/**/*.spec.ts*', 'tests/smoke/**/*.spec.ts*'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
