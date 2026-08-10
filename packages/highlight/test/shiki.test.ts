import { readFileSync } from 'node:fs'
import { fromHtml } from 'hast-util-from-html'
import type { Nodes } from 'hast'
import { describe, expect, it } from 'vitest'
import { createShikiHighlighter } from '../src/index.js'
import { LANGS, SNIPPETS } from './snippets.js'

const dir = new URL('./fixtures/shiki/', import.meta.url)

/** 解析后拼接全部文本节点——比对文本时不受转义写法(`&gt;` vs `>`)影响。 */
function textOf(html: string): string {
  const walk = (node: Nodes): string =>
    node.type === 'text' ? node.value : 'children' in node ? node.children.map(walk).join('') : ''
  return walk(fromHtml(html, { fragment: true }))
}

describe('createShikiHighlighter', () => {
  it('只预载 langs 里点名的语言，其余一律不 supports', async () => {
    const hl = await createShikiHighlighter({ langs: ['js', 'python'] })
    expect(hl.supports('js')).toBe(true)
    expect(hl.supports('python')).toBe(true)
    expect(hl.supports('rust')).toBe(false)
  })

  it('langs 省略时是一个什么都不支持的高亮器，而不是偷偷预载一堆语法包', async () => {
    // 契约的意图是 langs 由 scan(src, inlineMath).languages 驱动。省略时给任何「常用集」默认值
    // 都是替嵌入方猜字节：实测 45 个「常用」语言包合计 255.4 KB gzip，是嵌入侧
    // 引擎本身（~54 KB）的 4.7 倍。所以省略 = 空集，降级路径是 core 的朴素 <pre>。
    const hl = await createShikiHighlighter()
    expect(hl.supports('js')).toBe(false)
    expect(hl.highlight('const a = 1', 'js')).toBeNull()
  })

  it('跳过 langs 里的未知语言而不抛——scan() 有意过报', async () => {
    // packages/core/src/prepare.ts 的 scan() 文档写死「may over-report；must never
    // under-report」，它会把 ```zzzznotalanguage 也报上来。在这里抛异常等于让一篇
    // 正常文档整体渲染失败。
    const hl = await createShikiHighlighter({ langs: ['js', 'zzzznotalanguage'] })
    expect(hl.supports('js')).toBe(true)
    expect(hl.supports('zzzznotalanguage')).toBe(false)
    expect(hl.highlight('x', 'zzzznotalanguage')).toBeNull()
  })

  it('highlight() 是纯同步的：工厂 resolve 之后不再有任何 await', async () => {
    // P3 的 Phase A 纯度。用 Promise 探测：若 highlight() 内部还有微任务，
    // 它就不可能在同一个同步 tick 里返回字符串。
    const hl = await createShikiHighlighter({ langs: ['js'] })
    let out: string | null = null
    out = hl.highlight('const a = 1', 'js')
    expect(typeof out).toBe('string')
  })

  it('输出的文本内容与输入逐字相同（不吞字、不加尾换行）', async () => {
    // 这是唯一一条能替语料把关的断言：归一化器的 flattenHighlight 会把
    // div.highlight-source-* 里的 span 全展平成文本，所以只要文本一致，
    // 打开高亮后语料 56/68 就不会动。
    const hl = await createShikiHighlighter({ langs: [...LANGS] })
    for (const s of SNIPPETS) {
      const html = hl.highlight(s.code, s.lang)
      expect(html, s.slug).not.toBeNull()
      expect(textOf(html as string), s.slug).toBe(s.code)
    }
  })

  it('不产出 <pre> / <code> 外壳——外壳是 core 的 renderBlock 的活', async () => {
    const hl = await createShikiHighlighter({ langs: ['js'] })
    const html = hl.highlight('const a = 1', 'js') as string
    expect(html).not.toContain('<pre')
    expect(html).not.toContain('<code')
    expect(html.startsWith('<span class="line">')).toBe(true)
  })

  it('双主题：默认色内联为 hex，dark 走 --readit-shiki-dark 自定义属性', async () => {
    // element 侧只开 --readit-* 自定义属性（设计 §3.3），所以前缀必须改掉 shiki
    // 的默认 --shiki-。
    const hl = await createShikiHighlighter({ langs: ['js'] })
    const html = hl.highlight('const a = 1', 'js') as string
    expect(html).toMatch(/style="color:#[0-9a-fA-F]{6}/)
    expect(html).toContain('--readit-shiki-dark:#')
    expect(html).not.toContain('--shiki-dark')
  })

  it('确定性：两个独立工厂对同一输入产出同一字节', async () => {
    const a = await createShikiHighlighter({ langs: ['ts'] })
    const b = await createShikiHighlighter({ langs: ['ts'] })
    const snippet = SNIPPETS.find((s) => s.slug === 'ts')!
    expect(a.highlight(snippet.code, snippet.lang)).toBe(b.highlight(snippet.code, snippet.lang))
  })

  describe('③档 D-TOKEN 冻结黄金文件', () => {
    for (const s of SNIPPETS) {
      it(`${s.slug} 与自家黄金文件逐字相同`, async () => {
        const hl = await createShikiHighlighter({ langs: [s.lang] })
        const golden = readFileSync(new URL(`${s.slug}.html`, dir), 'utf8')
        expect(hl.highlight(s.code, s.lang)).toBe(golden)
      })
    }
  })
})
