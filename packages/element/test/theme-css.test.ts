import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DARK_CSS,
  DARK_CSS_BYTES,
  LIGHT_CSS,
  LIGHT_CSS_BYTES,
  THEME_CSS_VERSION,
} from '../src/styles/theme-css.js'

const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve('github-markdown-css/package.json'))
const onDisk = (file: string): string => readFileSync(join(pkgDir, file), 'utf8')

/**
 * 批次 5 换源文件（用户裁决，详见 batch-5-report.md 的「Task 18：抬变量块」一节）：
 * 生成脚本从「两个单主题文件」（github-markdown-light.css / -dark.css）改读
 * 合并版 github-markdown.css，把里面的 dark/light 媒体块整个抬出 @media，重发成
 * `:host([data-theme="light"|"dark"])`，好让 --readit-* 覆写通道（SPEC §9.2 两个
 * 对外通道之一）有变量可桥——单主题文件里颜色是内联死的，一个自定义属性都不声明，
 * 没有变量可桥。
 *
 * 这不是走回 SPEC 否掉的老路：SPEC 否的是「dark 规则还留在
 * @media (prefers-color-scheme: dark) 里，只改了选择器名字」——那样在浅色系统上
 * 无论放哪都不生效。这次是把整个媒体块内容搬出 @media，选择器换成不依赖
 * prefers-color-scheme、由 kernel.ts 显式写在宿主上的 data-theme 属性——下面
 * 「两份都没有 prefers-color-scheme 媒体查询」这条断言就是把这句话变成会失败的东西，
 * 换源文件之后依然成立、依然守着同一件事。
 *
 * 因此这里改掉的两条断言（「与单主题文件逐字节相同」「字节数与 SPEC 记录的
 * 22,219 B 一致」）不是弱化——它们测的前提本身就是旧架构特有的（旧架构下
 * LIGHT_CSS/DARK_CSS 就是单主题文件的原文），新架构下 LIGHT_CSS/DARK_CSS 是
 * 「合并版规则体 + 桥接后的变量块」拼出来的产物，跟单主题文件不再是同一份东西，
 * 逐字节比较这件事本身就不再有意义。换成的新断言测的是同一层意图的新表述：
 * 「两份共享同一段规则体前缀，只有变量块不同」。
 */
describe('github-markdown-css 冻结成 JS 字符串', () => {
  it('钉死在 SPEC §5 的 5.9.0', () => {
    expect(THEME_CSS_VERSION).toBe('5.9.0')
  })

  it('LIGHT_CSS 与 DARK_CSS 共享同一段规则体前缀，只在变量块处分岔', () => {
    // 两者按构造应为 `${同一份 RULES}\n\n${各自的变量块}\n`——从头找到第一个
    // 不同字符，那个位置就是变量块的起点，且这段共享前缀必须够长（规则体本身
    // 有两万多字节），不能是巧合的几个字符相同。分岔点落在 `:host([data-theme="`
    // 之后（"light" 与 "dark" 这两个词本身不同），所以整份 LIGHT_CSS/DARK_CSS
    // 各自还要包含自己完整的选择器——切片会把分岔点之前那段共享的
    // `:host([data-theme="` 一起切掉。
    let i = 0
    while (i < LIGHT_CSS.length && i < DARK_CSS.length && LIGHT_CSS[i] === DARK_CSS[i]) i += 1
    expect(i, '共享前缀太短，规则体大概率没有被两份复用').toBeGreaterThan(20000)
    expect(LIGHT_CSS.slice(0, i)).toContain('.markdown-body')
    expect(LIGHT_CSS).toContain(':host([data-theme="light"])')
    expect(DARK_CSS).toContain(':host([data-theme="dark"])')
  })

  it('规则体来自 node_modules 里的合并版上游，不是手写的', () => {
    // 挑几个只可能来自真实上游文本的片段——注释原文与一段较长的 SVG path data——
    // 逐字出现在 LIGHT_CSS 里，证明规则体是真的读文件切出来的，不是拼凑的近似文本。
    const upstream = onDisk('github-markdown.css')
    const octiconPath = 'M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83'
    expect(upstream, '这条断言的前提本身要成立').toContain(octiconPath)
    expect(LIGHT_CSS).toContain(octiconPath)
    expect(DARK_CSS).toContain(octiconPath)
  })

  /**
   * 这条是「为什么把媒体块抬出来」那句话的可执行形式。抬块的意义就是让最终产物
   * 不再依赖 prefers-color-scheme——哪天生成脚本改错、又把媒体块原样留在里面，
   * 这里立刻红。
   */
  it('两份都没有 prefers-color-scheme 媒体查询', () => {
    expect(LIGHT_CSS).not.toContain('@media (prefers-color-scheme')
    expect(DARK_CSS).not.toContain('@media (prefers-color-scheme')
  })

  it('都是给 .markdown-body 用的，且没有 :root（shadow root 里 :root 不匹配任何东西）', () => {
    expect(LIGHT_CSS).toContain('.markdown-body')
    expect(DARK_CSS).toContain('.markdown-body')
    expect(LIGHT_CSS).not.toContain(':root')
    expect(DARK_CSS).not.toContain(':root')
  })

  it('变量块挂在 :host([data-theme=...]) 上，深色额外要求 shadow 场景（LIGHT_DOM_CSS 是纯浅色逃生舱）', () => {
    expect(LIGHT_CSS).toContain(':host([data-theme="light"]), .markdown-body {')
    expect(DARK_CSS).toContain(':host([data-theme="dark"]) {')
  })

  it('字节数与常量自洽', () => {
    expect(LIGHT_CSS_BYTES).toBe(Buffer.byteLength(LIGHT_CSS, 'utf8'))
    expect(DARK_CSS_BYTES).toBe(Buffer.byteLength(DARK_CSS, 'utf8'))
  })

  /**
   * SPEC §9.2 记的「各 22,219 B」是换源文件之前、旧架构（单主题文件原文）的字节数。
   * 换源文件之后 LIGHT_CSS/DARK_CSS 是不同的产物（合并版规则体 + 桥接变量块），
   * 字节数必然不同，这里钉的是新架构下的实测值——按 §7.3 的规矩，SPEC 那个数字
   * 现在是**已知过期**，需要 Task 19（SPEC 同步）一并改掉，这里不代它改。
   */
  it('字节数钉在换源文件之后的实测值（SPEC §9.2 的 22,219 B 已过期，留给 Task 19 同步）', () => {
    expect([LIGHT_CSS_BYTES, DARK_CSS_BYTES]).toEqual([30933, 30918])
  })
})
