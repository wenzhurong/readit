import { defineConfig } from '@playwright/test'

const PORT = 5183
export const BASE_URL = `http://127.0.0.1:${PORT}`

/**
 * §0 A9：五个 project，每个都带自己的 testDir——不这样做，`npx playwright test` 会让
 * element 的 project 把 browser/editor（以及 browser/visual）也收进来一起跑。Firefox
 * 是第六个，advisory（设计 §7.2：它不是任何一个出货壳的引擎），同样带 testDir，否则
 * 它会把整棵 browser/ 树都跑一遍而不是只跑 L3b-element 那部分。
 *
 * snapshotDir 因此不能再让 {testDir} 兜底：六个 project 的 testDir 现在互不相同，
 * 而 L4 的 6 张基线必须落在同一个 browser/__screenshots__/ 里，不能跟着 project 各自
 * 散开（否则视觉基线的产物路径会随「哪个 project 先跑」而改变）。所以 snapshotDir
 * 单独钉成一个跟 testDir 无关的固定路径，snapshotPathTemplate 只引用它。
 */
export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  workers: process.env.CI !== undefined ? 2 : undefined,
  reporter: process.env.CI !== undefined ? [['github'], ['html', { open: 'never' }]] : [['list']],

  snapshotDir: './browser/__screenshots__',
  snapshotPathTemplate: '{snapshotDir}/{arg}{ext}',

  // 缺基线要红。默认值是 'missing'，也就是「悄悄写一张出来然后绿」——对一个规定
  // 「基线只在固定容器里生成」的项目，那个默认值是直接绕开规定的那条路。
  updateSnapshots: 'none',

  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.002,
    },
  },

  use: {
    baseURL: BASE_URL,
    // 不引入 Playwright 的设备描述符：那类预设自带 viewport 与 deviceScaleFactor，会把这里的钉子顶掉。
    deviceScaleFactor: 1,
    viewport: { width: 1024, height: 768 },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    // reducedMotion / forcedColors 在这个 Playwright 版本里不是顶层 use 选项了——
    // 只能通过 contextOptions 转交给 browser.newContext()（1.62.1 把它们从顶层挪走了）。
    contextOptions: { reducedMotion: 'reduce', forcedColors: 'none' },
    trace: process.env.CI !== undefined ? 'retain-on-failure' : 'off',
  },

  projects: [
    { name: 'element-chromium', testDir: './browser/element', use: { browserName: 'chromium' } },
    { name: 'element-webkit', testDir: './browser/element', use: { browserName: 'webkit' } },
    // Advisory：设计 §7.2，Firefox 不是任何一个出货壳的引擎。仍然要有 testDir，
    // 否则它会把 browser/editor 与 browser/visual 也一起收进来跑。
    { name: 'element-firefox', testDir: './browser/element', use: { browserName: 'firefox' } },
    { name: 'editor-chromium', testDir: './browser/editor', use: { browserName: 'chromium' } },
    { name: 'editor-webkit', testDir: './browser/editor', use: { browserName: 'webkit' } },
    // ≤12 张的预算：L4 只跑 chromium，见 browser/visual/visual.spec.ts 的注释。
    { name: 'visual-chromium', testDir: './browser/visual', use: { browserName: 'chromium' } },
  ],

  webServer: {
    command: 'npm run browser:serve',
    url: `${BASE_URL}/health`,
    // 复用旧 server 会拿到上一次构建的 bundle，改了源码却看到旧行为——每次重建。
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60_000,
  },
})
