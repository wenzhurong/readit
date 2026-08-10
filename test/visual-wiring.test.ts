import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOSTS, SHOTS } from '../browser/support/shots.js'

const root = new URL('../', import.meta.url)
const read = (rel: string): string => (existsSync(new URL(rel, root)) ? readFileSync(new URL(rel, root), 'utf8') : '')

const IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble'

describe('L4 的截图预算', () => {
  it('基线不超过 SPEC §13 的 12 张', () => {
    const dir = new URL('browser/__screenshots__/', root)
    const pngs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : []
    expect(pngs.length).toBeLessThanOrEqual(12)
    expect(pngs).toEqual(SHOTS.map((s) => `${s.name}.png`).sort())
  })

  it('每张基线都被两个宿主页各断言一次', () => {
    // 干净页与敌意页共用同一个基线文件名，所以「敌意宿主下渲染不变」是逐像素的等式，
    // 不是「敌意页像它自己那张」——后者两张一起漂移也照样绿。
    expect(HOSTS).toEqual(['visual', 'hostile'])
    expect(SHOTS.length * HOSTS.length).toBeLessThanOrEqual(12)
  })

  it('基线落在 playwright.config.ts 声明的目录里', () => {
    // §0 A9 之后，visual-chromium 这个 project 自己的 testDir 是 browser/visual（不再是
    // 全局的 browser/），{testDir} 令牌因此会解析成每个 project 各自的 testDir——
    // 6 张基线就会散开到 browser/visual/__screenshots__ 而不是这里要的
    // browser/__screenshots__。所以 snapshotDir 单独钉死，不再用 {testDir} 拼。
    // 见 playwright.config.ts 顶部注释与 test/browser-wiring.test.ts 的同名断言。
    expect(read('playwright.config.ts')).toContain("snapshotDir: './browser/__screenshots__'")
    expect(read('playwright.config.ts')).toContain("snapshotPathTemplate: '{snapshotDir}/{arg}{ext}'")
  })
})

describe('基线只能在固定容器里生成', () => {
  it('visual:baseline 走的是那个镜像', () => {
    const sh = read('tools/visual-baseline.sh')
    expect(sh).toContain(IMAGE)
    expect(sh).toContain('--update-snapshots')
    const pkg = JSON.parse(read('package.json') || '{}') as { scripts?: Record<string, string> }
    expect(pkg.scripts?.['visual:baseline']).toBe('bash tools/visual-baseline.sh')
  })

  it('运行时也有一道闸，不只是文档', () => {
    // 有人在 macOS 上敲 --update-snapshots，就该拿到一条响亮的错误，而不是一批
    // 在别的字体栈上生成、随后在 CI 里永远对不上的 PNG。
    expect(read('browser/support/visual.ts')).toContain('/ms-playwright')
    expect(read('browser/support/visual.ts')).toContain(IMAGE)
  })

  it('CI 里重写基线的 job 只能手动触发', () => {
    const wf = read('.github/workflows/visual.yml')
    const baselineJob = wf.slice(wf.indexOf('\n  l4-baseline:'))
    expect(baselineJob).toContain("if: github.event_name == 'workflow_dispatch'")
    expect(wf).toContain('workflow_dispatch:')
    // 比对 job 与重写 job 用同一个镜像；两处 tag 不一致就是基线不可复现。
    const tags = [...wf.matchAll(/mcr\.microsoft\.com\/playwright:v[\d.]+-noble/g)].map((m) => m[0])
    expect(tags.length).toBe(2)
    expect([...new Set(tags)]).toEqual([IMAGE])
  })
})

describe('敌意宿主 fixture 真的敌意', () => {
  const hostile = read('browser/fixtures/pages/hostile.html')

  it('加载了真正的 Tailwind Preflight 与 Bootstrap Reboot', () => {
    expect(hostile).toContain('/vendor/tailwindcss/preflight.css')
    expect(hostile).toContain('/vendor/bootstrap/dist/css/bootstrap-reboot.css')
    expect(hostile).toContain('/css/hostile-extra.css')
  })

  it('两个 reset 的版本钉在 package.json 里', () => {
    const pkg = JSON.parse(read('package.json') || '{}') as { devDependencies?: Record<string, string> }
    expect(pkg.devDependencies?.tailwindcss).toBe('4.3.3')
    expect(pkg.devDependencies?.bootstrap).toBe('5.3.8')
  })

  it('干净页与敌意页除了敌意样式表以外完全同构', () => {
    // 两张页面的差别必须只有那三个 <link>。宿主容器的尺寸、字体钉法、脚本都要一致，
    // 否则「逐像素相同」比的就不是隔离，而是两张碰巧一样的页面。
    const clean = read('browser/fixtures/pages/visual.html')
    const strip = (s: string): string =>
      s.split('\n').filter((l) => !l.includes('/vendor/') && !l.includes('hostile-extra.css')).join('\n')
    expect(strip(hostile)).toBe(strip(clean))
  })
})

describe('自托管 woff2', () => {
  it('字体来自 node_modules 里钉死版本的包，不是 CDN', () => {
    const css = read('browser/fixtures/css/visual-fonts.css')
    expect(css).toContain('/vendor/@fontsource/inter/files/inter-latin-400-normal.woff2')
    expect(css).toContain('/vendor/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2')
    expect(css).not.toContain('http://')
    expect(css).not.toContain('https://')
    const pkg = JSON.parse(read('package.json') || '{}') as { devDependencies?: Record<string, string> }
    expect(pkg.devDependencies?.['@fontsource/inter']).toBe('5.3.0')
    expect(pkg.devDependencies?.['@fontsource/jetbrains-mono']).toBe('5.3.0')
  })
})
