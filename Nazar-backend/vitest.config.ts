import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: process.env.NAZAR_LIVE_TESTS ? [] : ['test/live/**'],
    testTimeout: 20_000,
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'html'] },
  },
})
