/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    globals: true,
    testTimeout: 60000, // 60 seconds for integration tests
    hookTimeout: 30000,
    setupFiles: ['./tests/setup.vitest.ts'],
    include: ['tests/integration/**/*.spec.ts'],
    exclude: ['tests/unit/**', 'tests/e2e/**'],
    // Configure test isolation and cleanup
    isolate: true,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        useAtomics: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
  // Mock external dependencies for integration tests
  define: {
    global: 'globalThis',
  },
})
