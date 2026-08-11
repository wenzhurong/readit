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
    // Task 5（navigate.ts）故意不对外链/mailto 调 preventDefault()——那是设计要求
    // （交给系统浏览器处理）。happy-dom 对未阻止的 <a> 点击会忠实地尝试一次真实
    // 「导航」（fetch/socket connect），被离线门拦下但会在 stderr 刷一堆吓人的
    // 堆栈（对 mailto: 这种非 http(s) scheme 它自己内部还会再抛一次 Invalid URL）。
    // 这不是测试断言关心的行为——没有一条测试依赖「真的导航发生了」，只关心
    // defaultPrevented——关掉主 frame 导航即可让噪音消失，不改变任何断言结果。
    environmentOptions: {
      happyDOM: {
        settings: {
          navigation: { disableMainFrameNavigation: true },
        },
      },
    },
  },
})
