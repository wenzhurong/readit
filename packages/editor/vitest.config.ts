import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // §0 A2：environment 是 happy-dom（钉 20.11.2），理由同 element——CodeMirror 挂载、
    // 滚动同步这些行为天然需要真实 DOM，半吊子桩测不出来。
    environment: 'happy-dom',
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
