import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 这个文件守的是「结构」，不是行为：Playwright 装没装对、版本钉没钉住、两个 runner 会不会
 * 互相捡文件、承重浏览器有没有被偷偷降级成 advisory。它必须能在离线 vitest 里跑完——
 * 浏览器套件本身在 CI 的容器里跑，那层红灯来得晚，而这层红灯在本地 <1s 就来。
 *
 * §0 A9 改了浏览器 fixture 装置的三件事（相对 task-11-brief.md 的正文）：
 *   1. 打包器是 vite 8.2.1，不是 esbuild —— ?raw 导入与工作区 .ts 软链解析都靠它。
 *   2. 端口 5183，不是任务书样例里的 4173。
 *   3. 页面全局是 window.readitFixture，不是 window.__readit。
 * 以及五个（+ 一个 advisory）Playwright project 必须各自带 testDir，见下面那组断言。
 */
const root = new URL('../', import.meta.url)
const read = (rel: string): string => (existsSync(new URL(rel, root)) ? readFileSync(new URL(rel, root), 'utf8') : '')

/** 递归列出某目录下的文件相对路径；目录不存在时返回空数组（让断言而不是异常来报错）。 */
function listFiles(rel: string): string[] {
  const dir = new URL(rel, root)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((p) => p.replaceAll('\\', '/'))
}

const pkg = JSON.parse(read('package.json') || '{}') as {
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}
const PINNED_PLAYWRIGHT = '1.62.1'
const PINNED_VITE = '8.2.1'

describe('Playwright 与 vite 的版本与镜像钉在一起', () => {
  it('@playwright/test 是精确版本，不是范围', () => {
    expect(pkg.devDependencies?.['@playwright/test']).toBe(PINNED_PLAYWRIGHT)
  })

  it('vite 是精确版本（§0 A9：fixture 打包器统一成 vite，esbuild 那套装置弃用）', () => {
    expect(pkg.devDependencies?.vite).toBe(PINNED_VITE)
  })

  it('browser.yml 引用的容器镜像与那个版本同源', () => {
    // 视觉基线的可复现性完全建立在「镜像 tag 与 Playwright 版本一致」上。分开写两处，
    // 就一定会有一次只改了一处——所以这里让它们必须一起改。
    const wf = read('.github/workflows/browser.yml')
    const tags = [...wf.matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)-noble/g)].map((m) => m[1])
    expect(tags.length).toBeGreaterThan(0)
    expect([...new Set(tags)]).toEqual([PINNED_PLAYWRIGHT])
  })
})

describe('两个 runner 不得互相捡文件（P5）', () => {
  it('vitest 只收 .test.ts，且根 include 没被放宽', () => {
    expect(read('vitest.config.ts')).toContain("include: ['test/**/*.test.ts']")
  })

  it('Playwright 只收 browser/ 下的 .spec.ts', () => {
    const cfg = read('playwright.config.ts')
    expect(cfg).toContain("testDir: './browser'")
    expect(cfg).toContain("testMatch: '**/*.spec.ts'")
  })

  it('test/ 与 packages/*/test/ 下没有任何 .spec.ts', () => {
    const strays = [
      ...listFiles('test/').map((p) => `test/${p}`),
      ...listFiles('packages/').map((p) => `packages/${p}`),
    ].filter((p) => p.endsWith('.spec.ts'))
    expect(strays).toEqual([])
  })

  it('browser/ 下没有任何 .test.ts', () => {
    expect(listFiles('browser/').filter((p) => p.endsWith('.test.ts'))).toEqual([])
  })
})

describe('浏览器套件的确定性旋钮钉在配置里', () => {
  const cfg = read('playwright.config.ts')

  it.each([
    ['deviceScaleFactor: 1', '像素比一旦浮动，L4 的基线就不可复现'],
    ['maxDiffPixelRatio: 0.002', 'SPEC §13 的阈值'],
    ["animations: 'disabled'", 'SPEC §13'],
    ["updateSnapshots: 'none'", '缺基线要红，不许静默写一张出来'],
    ['reuseExistingServer: false', '复用旧 server 会拿到上一次构建的 bundle'],
  ])('包含 %s', (needle) => {
    expect(cfg).toContain(needle)
  })

  it('不 spread devices[…]，否则设备描述符会把 deviceScaleFactor 顶掉', () => {
    expect(cfg).not.toContain('devices[')
  })
})

describe('五个 project 各自钉了 testDir（§0 A9）', () => {
  const cfg = read('playwright.config.ts')

  it.each([
    ['./browser/element', 'element-chromium / element-webkit'],
    ['./browser/editor', 'editor-chromium / editor-webkit'],
    ['./browser/visual', 'visual-chromium'],
  ])('%s 被至少一个 project 显式钉住，否则 npx playwright test 会让别的子树混进来', (dir) => {
    expect(cfg).toContain(`testDir: '${dir}'`)
  })

  it('L4 的截图目录与各 project 的 testDir 无关，是单独钉死的 snapshotDir', () => {
    // visual-chromium 的 testDir 现在是 browser/visual，若 snapshotPathTemplate 还用
    // {testDir}，6 张基线就会落进 browser/visual/__screenshots__ 而不是 browser/__screenshots__。
    // Playwright 的 {testDir} 令牌取的是「每个 project 生效后的 testDir」（worker 侧
    // _applyPathTemplate 读 this.project.testDir），跟全局 config.testDir 不是一回事。
    expect(cfg).toContain("snapshotDir: './browser/__screenshots__'")
    expect(cfg).toContain("snapshotPathTemplate: '{snapshotDir}/{arg}{ext}'")
  })
})

describe('CI 里承重的是 Chromium 与 WebKit，两个 job 名兑现 §0 A10', () => {
  const wf = read('.github/workflows/browser.yml')

  it('l3b-element 与 l3b-editor 两个 job 都存在', () => {
    expect(wf).toMatch(/^ {2}l3b-element:$/m)
    expect(wf).toMatch(/^ {2}l3b-editor:$/m)
  })

  it('承重 job 的矩阵正好是 chromium 与 webkit', () => {
    expect(wf.match(/browser: \[chromium, webkit\]/g) ?? []).toHaveLength(2)
  })

  it('l3b-editor 允许现在空跑（browser/editor 的 spec 要等 Task 17）', () => {
    expect(wf).toContain('--pass-with-no-tests')
  })

  it('continue-on-error 只出现一次，且只在 firefox 那个 job 里', () => {
    expect(wf.match(/continue-on-error/g) ?? []).toHaveLength(1)
    const firefoxJob = wf.slice(wf.indexOf('\n  l3b-element-firefox:'))
    expect(firefoxJob).toContain('continue-on-error: true')
  })
})

describe('每个 spec 都经过共享 harness', () => {
  /**
   * 离线守卫、泄漏仪表与 CSP 采集都挂在 harness 的 auto fixture 上。一个直接
   * `import { test } from '@playwright/test'` 的 spec 会绕过全部三样，而且绕得毫无痕迹。
   */
  it('没有任何 spec 直接从 @playwright/test 取 test', () => {
    const offenders = listFiles('browser/')
      .filter((p) => p.endsWith('.spec.ts'))
      .filter((p) => read(`browser/${p}`).includes("from '@playwright/test'"))
    expect(offenders).toEqual([])
  })

  it('至少有一个 spec 存在（否则上一条是空断言）', () => {
    expect(listFiles('browser/').filter((p) => p.endsWith('.spec.ts')).length).toBeGreaterThan(0)
  })
})
