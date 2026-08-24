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

/**
 * 同样是文本守卫。`documentWindowTitle()` 是纯函数、单测覆盖得到，但「有没有人把它
 * 送到原生标题栏」测不了——而 2026-08-18 的真机验收发现的正是这一类：函数算得对，
 * 只是没人调用 setTitle()，标题栏从头到尾都是「readit」。
 */
describe('壳的原生窗口标题', () => {
  it('把标题送到原生标题栏，而不是只设 document.title', () => {
    const src = main()
    expect(src).toContain('getCurrentWindow().setTitle(')
    expect(src).toContain('documentWindowTitle(state.path, state.dirty)')
  })

  it('能力清单里授了 set-title —— 缺了它这条特性会静默失效', () => {
    // 2026-08-18 实测：能力清单里没有这条时，setTitle() 被 Tauri 的权限系统拒掉，
    // 标题栏一直停在「readit」，而界面上没有任何可见报错。接线对、权限没给，
    // 表现和「根本没写这段代码」完全一样。
    const capability = JSON.parse(
      readFileSync(join(SHELL_DIR, 'src-tauri/capabilities/main.json'), 'utf8'),
    ) as { permissions: readonly string[] }
    expect(capability.permissions).toContain('core:window:allow-set-title')
  })
})

/**
 * 同样是文本守卫，同样是因为 main.ts 从模块顶层就摸 DOM 与 IPC、导入即有副作用。
 * `mode-switch.ts` 本身有单测，但「有没有人把它接上、并且在模式变更后回灌状态」测不了——
 * 而这正是 D2-24 那一类：纯函数对、没人调用，表现和没写一样。
 */
describe('壳的模式切换按钮', () => {
  it('index.html 里三个入口一个都不能少', () => {
    const html = readFileSync(join(SHELL_DIR, 'index.html'), 'utf8')
    const modes = [...html.matchAll(/data-mode="([a-z]+)"/g)].map((match) => match[1])
    expect(modes).toEqual(['read', 'source', 'split'])
  })

  it('main.ts 接上了控件，并在模式变更后回灌状态', () => {
    const src = main()
    expect(src).toContain("requireElement('#mode-switch')")
    expect(src).toContain('connectModeSwitch(modeSwitchRoot')
    // 回灌这一步掉了的话，从菜单或快捷键切换时按钮会与真实模式脱节。
    expect(src).toContain('modeSwitch.setMode(mode)')
  })

  it('快捷键提示按平台给，Windows 上没有菜单可教这件事', () => {
    expect(main()).toMatch(/shortcutModifier:\s*isWindows\s*\?\s*'Ctrl\+'/)
  })

  it('控件接上了拖拽，位置存档取不到时不能让它不可用', () => {
    const src = main()
    expect(src).toContain('connectDraggable(modeSwitchRoot')
    // localStorage 在隐私模式/被策略禁用时读取本身就会抛，必须包起来。
    expect(src).toContain('function optionalLocalStorage()')
  })
})
