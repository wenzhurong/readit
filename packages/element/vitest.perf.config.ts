import { defineConfig } from 'vitest/config'

/**
 * 独立于默认 `npm test` 的墙钟性能配置（C2 的修法）。
 *
 * `packages/element/vitest.config.ts` 的 `include: ['test/**\/*.test.ts']` 不匹配
 * `*.perf.ts`，所以这里的用例天然不会被默认 `npm test`、也不会被
 * `.github/workflows/test.yml` 的 `unit` job（在 ubuntu/macos/windows 三个 OS 上
 * 原样跑 `npm test`）捡到——不需要改那个 job，问题在「用阻塞式跨 OS 门去跑一条吃
 * CPU 抖动的绝对墙钟数」这个装配方式，把它移出这张图就是完整的修法，不是把阈值
 * 放宽。
 *
 * 用 `npm run test:perf`（见 package.json）显式跑。
 */
export default defineConfig({
  test: {
    include: ['test/**/*.perf.ts'],
    environment: 'happy-dom',
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
    // 真实 Shiki 语法包首次加载 + 反复真实渲染，比普通单测慢；默认 5s 对单个用例
    // 偏紧，给足余量而不是让偶发的机器抖动变成假红。
    testTimeout: 30_000,
  },
})
