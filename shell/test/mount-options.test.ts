import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 路径解析的两个坑见 windows-bundle.test.ts 顶部：process.cwd() 不是 shell/，
// 而 new URL(rel, import.meta.url) 在 happy-dom 环境下会丢掉 base。
const SHELL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const main = (): string => readFileSync(join(SHELL_DIR, 'src/main.ts'), 'utf8')

/**
 * 文本守卫，不是行为守卫 —— main.ts 从模块顶层就摸 DOM 与 Tauri IPC，导入即有副作用，
 * 挂载调用本身测不了（这正是 D2-24 记的那类盲区，也是「语法高亮从未生效」当初能溜进
 * 出货应用的原因）。在把 main.ts 拆成可测之前，至少让「壳在这一条上刻意偏离 GitHub」
 * 这个决定不能被无声改掉。
 */
describe('壳的挂载选项', () => {
  it('显式开启 breaks —— 桌面壳读的是本地文件，不是仓库页面', () => {
    expect(main()).toMatch(/breaks:\s*true/)
  })

  it('这处偏离必须带着理由，不能只留一个裸的 true', () => {
    const src = main()
    const at = src.indexOf('breaks: true')
    expect(at).toBeGreaterThan(-1)
    // 往上找注释块：要能说清「引擎默认是什么」以及「为什么壳不一样」
    const before = src.slice(Math.max(0, at - 1200), at)
    expect(before).toContain('breaks: false')
    expect(before).toContain('SPEC §9.4')
  })
})
