import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Measure all web app source, not just files a test happens to import,
      // so untested components count against the totals.
      include: ['lib/**/*.ts', 'components/**/*.tsx', 'app/**/*.tsx'],
      exclude: ['**/*.test.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
      // Floors at the measured baseline. Raise them as coverage grows; they
      // only exist to stop it from silently dropping.
      thresholds: {
        statements: 23,
        branches: 20,
        functions: 18,
        lines: 23,
      },
    },
  },
})
