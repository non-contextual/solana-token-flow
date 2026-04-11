import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      // localHistory 依赖 localStorage，需要 jsdom 环境
      ['frontend/src/utils/localHistory.test.ts', 'jsdom'],
    ],
    include: [
      'fetcher/src/**/*.test.ts',
      'frontend/src/**/*.test.ts',
    ],
  },
})
