import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // §0 A2：environment 是 node，不得改——这是 P1「highlight 是纯函数、可在 Node 里
    // import」承诺的结构化形式。真正的浏览器行为（若有）归 Playwright。
    environment: 'node',
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
