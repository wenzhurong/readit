import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CSS_BRIDGE_DARK, CSS_BRIDGE_LIGHT } from '../src/css-bridge.js'
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
 * 独立于生成脚本重新切一遍规则体——不 import scripts/gen-theme-css.ts 的内部
 * 函数，理由与 css-bridge.test.ts 顶部注释相同：否则生成脚本自己的 bug 会在
 * 校验里再犯一遍。边界与生成脚本一致（评审 Important 2 之前用过、现在继续用）。
 */
function upstreamRules(): string {
  const merged = onDisk('github-markdown.css')
  const darkAt = merged.indexOf('@media (prefers-color-scheme: dark)')
  const lightAt = merged.indexOf('@media (prefers-color-scheme: light)', darkAt)
  const rulesAt = merged.indexOf('\n\n.markdown-body {', lightAt)
  if (darkAt < 0 || lightAt < 0 || rulesAt < 0) {
    throw new Error('theme-css.test.ts 的上游切分假设跟磁盘上的 github-markdown.css 对不上')
  }
  return merged.slice(rulesAt).trim()
}

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
 * 逐字节比较这件事本身就不再有意义。
 *
 * 评审 Important 2：换成的第一版新断言（「共享前缀 > 20000 字节」+ 抽样一段
 * SVG path）方向对但力度不够——三万多字节的规则体丢几千字节都可能测不出来。
 * 现在换成精确形式：独立于生成脚本重新切一遍上游规则体（upstreamRules()），
 * 直接断言 `LIGHT_CSS === \`${规则体}\n\n${CSS_BRIDGE_LIGHT}\n\``——这才是
 * 「逐字节」那层意图在新架构上的对应物，`CSS_BRIDGE_LIGHT`/`CSS_BRIDGE_DARK`
 * 本身的正确性交给 css-bridge.test.ts 的两条断言（每个变量都有桥、fallback
 * 与上游逐字相同）承重，这里只验证「规则体 + 桥接块」的拼接公式与规则体本身
 * 没有被生成脚本悄悄改动或截断。
 */
describe('github-markdown-css 冻结成 JS 字符串', () => {
  it('钉死在 SPEC §5 的 5.9.0', () => {
    expect(THEME_CSS_VERSION).toBe('5.9.0')
  })

  it('LIGHT_CSS/DARK_CSS 逐字节等于「独立重切的上游规则体 + 对应桥接块」', () => {
    // 精确形式，替代最初「共享前缀 > 20000」那条力度不够的断言（评审 Important 2）：
    // upstreamRules() 独立于生成脚本重新从磁盘上的合并版文件切一遍规则体，
    // 不依赖 theme-css.ts 自己怎么算——如果生成脚本哪天在规则体上丢字节、
    // 加错内容，或者拼接公式变了，这里逐字节比对会直接抓到，不再靠「前缀够长」
    // 这种统计意义上大概率没问题的弱信号。
    const rules = upstreamRules()
    expect(LIGHT_CSS).toBe(`${rules}\n\n${CSS_BRIDGE_LIGHT}\n`)
    expect(DARK_CSS).toBe(`${rules}\n\n${CSS_BRIDGE_DARK}\n`)
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
    // 评审 Important 1 修复（color-scheme 补进变量块）之后字节数从 30933/30918
    // 涨到了 30956/30940——涨了 23/22 字节，跟 "  color-scheme: dark;\n"/
    // "  color-scheme: light;\n" 的长度量级吻合，不是无关的漂移。
    expect([LIGHT_CSS_BYTES, DARK_CSS_BYTES]).toEqual([30956, 30940])
  })
})
