import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '@readit/core'
import { describe, expect, it } from 'vitest'
import {
  COLLAPSED_ATTR,
  LINE_ATTR,
  SYNTHETIC_ATTR,
  scanHtmlBlocks,
  synthesizeHtmlAnchors,
} from '../src/scroll/html-anchors.js'

// happy-dom（§0 A2，本包的 vitest environment）的全局 URL 构造器对「相对路径 +
// file: base」解析有 bug——不管传进去的 base 是什么，结果的 scheme 总变成它自己
// 伪造的 http: location。改用 dirname(fileURLToPath(import.meta.url)) + join，
// 全程走 node:path，不经过全局 URL（与 rerender-debounce.test.ts、navigate.ts、
// leak.test.ts 等既有代码同构，见那几处顶部注释）。
const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'test', 'corpus', 'real-world')
const corpus = (name: string): string => readFileSync(join(CORPUS, name), 'utf8')

function mountRendered(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.append(el)
  return el
}

const topLines = (content: Element): (string | null)[] =>
  [...content.children].map((c) => c.getAttribute(LINE_ATTR))

describe('scanHtmlBlocks：顶层原生 HTML 块的起始行', () => {
  it('只认「空行之后、缩进 ≤3、以开标签起头」的行', () => {
    const src = ['<div>a</div>', '', 'para', '', '  <p>b</p>', '', '    <p>indented code</p>', ''].join('\n')
    expect(scanHtmlBlocks(src).map((b) => b.line)).toEqual([0, 4])
  })

  it('闭标签、注释、处理指令不算——它们要么产不出元素，要么归上一个块', () => {
    const src = ['<details>', '<summary>s</summary>', '', '</details>', '', '<!-- c -->', ''].join('\n')
    expect(scanHtmlBlocks(src).map((b) => b.line)).toEqual([0])
  })

  it('围栏里的 HTML 不算', () => {
    const src = ['```html', '<div>not a block</div>', '```', '', '<p>real</p>', ''].join('\n')
    expect(scanHtmlBlocks(src).map((b) => b.line)).toEqual([4])
  })

  it('块的 source 从起始行一直到下一空行前的最后一行', () => {
    const src = ['<p>', 'x', '</p>', '', 'after'].join('\n')
    expect(scanHtmlBlocks(src)[0]?.source).toBe('<p>\nx\n</p>')
  })

  it('文件末尾没有空行收尾的块也要认出来', () => {
    expect(scanHtmlBlocks('para\n\n<p>tail</p>').map((b) => b.line)).toEqual([2])
  })

  /**
   * 2026-08-09 用 core 的真引擎量过：把这里扫出的候选行、减去 DOM 里已有
   * data-line 的那些，与 markdown-it 真正产出的 html_block（开标签起头的那些）
   * token 的 map[0] 在 6 个 real-world 文件上**逐一相等**。
   * mermaid.md 的 46 行是唯一一个「看着像块、实际是段落」的假阳性
   * （<a …><img …></a> 不满足 CommonMark 条件 7），由已有 data-line 过滤掉。
   */
  it('对 real-world 语料扫出的候选行是钉死的', () => {
    expect(scanHtmlBlocks(corpus('gitignore.md')).map((b) => b.line)).toEqual([])
    expect(scanHtmlBlocks(corpus('hast-util-sanitize.md')).map((b) => b.line)).toEqual([])
    expect(scanHtmlBlocks(corpus('markdown-it.md')).map((b) => b.line)).toEqual([])
    expect(scanHtmlBlocks(corpus('mermaid.md')).map((b) => b.line)).toEqual([0, 13, 26, 40, 46, 50, 91])
    expect(scanHtmlBlocks(corpus('sindresorhus-is.md')).map((b) => b.line)).toEqual([6])
    expect(scanHtmlBlocks(corpus('tauri.md')).map((b) => b.line)).toEqual([0, 67])
  })
})

describe('synthesizeHtmlAnchors：在 element 侧补锚点，不动 Phase A 的字节', () => {
  it('一个原生 HTML 块产出几个顶层节点，就按顺序分给它们同一个行号', () => {
    const src = ['para', '', '<p>a</p>', '<p>b</p>', '', '<br>', '', 'tail'].join('\n')
    const content = mountRendered(
      `<p ${LINE_ATTR}="0">para</p><p>a</p><p>b</p><br><p ${LINE_ATTR}="7">tail</p>`,
    )
    expect(synthesizeHtmlAnchors(content, src)).toBe(3)
    expect(topLines(content)).toEqual(['0', '2', '2', '5', '7'])
    expect(content.querySelectorAll(`[${SYNTHETIC_ATTR}]`)).toHaveLength(3)
    expect(content.querySelectorAll(`[${COLLAPSED_ATTR}]`)).toHaveLength(0)
  })

  it('已经有 data-line 的行不会被当成候选（mermaid.md 第 46 行那类假阳性）', () => {
    const src = ['<a href="x"><img src="y"></a>', ''].join('\n')
    const content = mountRendered(`<p ${LINE_ATTR}="0"><a href="x"><img src="y"></a></p>`)
    expect(synthesizeHtmlAnchors(content, src)).toBe(0)
    expect(topLines(content)).toEqual(['0'])
  })

  it('数不齐时整段折叠到本间隙的第一个块起始行，并留下可见的 data-line-collapsed', () => {
    // source 说这个块只产 1 个顶层元素，DOM 里却有 2 个——只可能是解析器
    // 或卫生化器改了结构。折叠：仍然单调、仍在两个真锚点之间，粒度退化成一段。
    const src = ['para', '', '<p>a</p>', '', 'tail'].join('\n')
    const content = mountRendered(
      `<p ${LINE_ATTR}="0">para</p><p>a</p><span>extra</span><p ${LINE_ATTR}="4">tail</p>`,
    )
    expect(synthesizeHtmlAnchors(content, src)).toBe(2)
    expect(topLines(content)).toEqual(['0', '2', '2', '4'])
    expect(content.querySelectorAll(`[${COLLAPSED_ATTR}]`)).toHaveLength(2)
  })

  it('间隙里没有候选块就不动它——宁可无锚点，也不发明一个行号', () => {
    const content = mountRendered(`<p ${LINE_ATTR}="0">a</p><hr><p ${LINE_ATTR}="4">b</p>`)
    expect(synthesizeHtmlAnchors(content, 'a\n\n\n\nb\n')).toBe(0)
    expect(topLines(content)).toEqual(['0', null, '4'])
  })
})

/**
 * 顶层节点自己的 data-line，或它子树里第一个带 data-line 的后代——与
 * html-anchors.ts 内部 anchorLineOf() 同一个语义，本文件不导出它所以在这里
 * 重写一份最小实现。GitHub 的标题规则把 <h2 data-line> 包在
 * <div class="markdown-heading"> 里（packages/core/src/rules/heading.ts:99），
 * data-line 天然长在孙子节点而非顶层子节点自己身上——这是 Phase A 的标准
 * 输出形状（mermaid.md 里 21 处标题全是这个结构），不是边界情形。
 * collectAnchors() 用 querySelectorAll 递归查找，天然能找到它；
 * 下面两条测试原文直接查顶层节点自己的 attribute，会把这些真实存在的标题
 * 误判成「缺锚点」——按算法实际提供的契约（自己或子孙）订正。
 */
function effectiveLine(el: Element): number | null {
  const own = el.getAttribute(LINE_ATTR)
  if (own !== null) return Number(own)
  const inner = el.querySelector(`[${LINE_ATTR}]`)
  return inner === null ? null : Number(inner.getAttribute(LINE_ATTR))
}

describe('对 real-world/mermaid.md ——那个几乎全是原生 HTML 的 README', () => {
  const src = corpus('mermaid.md')
  const content = mountRendered(render(src))
  const stamped = synthesizeHtmlAnchors(content, src)

  it('合成之后，顶层没有一个节点还缺锚点', () => {
    expect(stamped).toBeGreaterThan(0)
    expect([...content.children].filter((c) => effectiveLine(c) === null)).toHaveLength(0)
  })

  it('整条顶层行号序列单调不减——滚动同步唯一不可让的性质', () => {
    const lines = [...content.children].map((c) => effectiveLine(c) ?? 0)
    expect(lines).toEqual([...lines].sort((a, b) => a - b))
  })

  it('合成出的行号正好是那 5 个真块的起始行', () => {
    // 0/13/26 是开头那一大段 <p align=center> 横幅（分别产 6/4/2 个顶层节点），
    // 40 是 <img src="./img/header.png">，91 是贡献者表格前的那块。
    // 若这条只剩 {0,40,91}，说明开头那段走了折叠回落——**上报，不要把断言改软**：
    // 那意味着宿主的 HTML 解析器与 parse5 在隐式闭合 <p> 上不一致。
    const synthesized = [...content.querySelectorAll(`[${SYNTHETIC_ATTR}]`)].map((c) =>
      Number(c.getAttribute(LINE_ATTR)),
    )
    expect(new Set(synthesized)).toEqual(new Set([0, 13, 26, 40, 91]))
  })
})
