import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // §0 A2：environment 是 happy-dom（钉 20.11.2），不是 node。这个包要在 vitest 里判定
    // 泄漏检测、shadow root 与主题这些天然需要真实 DOM 的行为——半吊子桩测不出
    // `MutationObserver`、`adoptedStyleSheets` 或 shadow root 的隔离性。
    // 真正的浏览器行为（视觉、事件时序）仍然归 Playwright（P5：browser/**/*.spec.ts）。
    environment: 'happy-dom',
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
