import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/__tests__/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false
  }
})
