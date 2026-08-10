import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fromHtml } from 'hast-util-from-html'
import type { Nodes } from 'hast'
import { describe, expect, it } from 'vitest'
import { createStarryNightHighlighter } from '../src/index.js'
import { SNIPPETS } from './snippets.js'

const require_ = createRequire(import.meta.url)
const ONIG_WASM_URL = pathToFileURL(require_.resolve('vscode-oniguruma/release/onig.wasm')).href
const dir = new URL('./fixtures/starry-night/', import.meta.url)

function textOf(html: string): string {
  const walk = (node: Nodes): string =>
    node.type === 'text' ? node.value : 'children' in node ? node.children.map(walk).join('') : ''
  return walk(fromHtml(html, { fragment: true }))
}

describe('createStarryNightHighlighter', () => {
  it('发 GitHub 真实的 pl-* class', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    const html = hl.highlight('const a = 1', 'js') as string
    expect(html).toContain('class="pl-k"')
    expect(html).not.toContain('style="color:')
  })

  it('supports() 覆盖 common 的 34 条语法，不覆盖之外的', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    for (const lang of ['js', 'ts', 'python', 'rust', 'diff']) expect(hl.supports(lang), lang).toBe(true)
    // emacs-lisp 不在 common 里（也正是实测里最大的那个语法包，203.1 KB gzip）
    expect(hl.supports('emacs-lisp')).toBe(false)
    expect(hl.highlight('(car x)', 'emacs-lisp')).toBeNull()
  })

  it('highlight() 是纯同步的', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    expect(typeof hl.highlight('const a = 1', 'js')).toBe('string')
  })

  it('输出的文本内容与输入逐字相同', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    for (const s of SNIPPETS) {
      expect(textOf(hl.highlight(s.code, s.lang) as string), s.slug).toBe(s.code)
    }
  })

  it('不产出 <pre> / <code> 外壳', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    const html = hl.highlight('const a = 1', 'js') as string
    expect(html).not.toContain('<pre')
    expect(html).not.toContain('<code')
  })

  describe('③档 D-TOKEN 冻结黄金文件', () => {
    for (const s of SNIPPETS) {
      it(`${s.slug} 与自家黄金文件逐字相同`, async () => {
        const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
        expect(hl.highlight(s.code, s.lang)).toBe(readFileSync(new URL(`${s.slug}.html`, dir), 'utf8'))
      })
    }
  })
})

describe('两个实现共用同一个 adapter 接口', () => {
  it('对同一批输入产出相同的文本，只有 token 标记不同', async () => {
    // 「只有一个实现的适配器接口等于没有被验证过」（设计 §5.1）。这条是那句话唯一
    // 能被机器检查的形式：两个实现必须在同一个契约下对同一批输入给出同样的文本。
    const { createShikiHighlighter } = await import('../src/index.js')
    const sn = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    const shiki = await createShikiHighlighter({ langs: SNIPPETS.map((s) => s.lang) })
    for (const s of SNIPPETS) {
      const a = sn.highlight(s.code, s.lang) as string
      const b = shiki.highlight(s.code, s.lang) as string
      expect(textOf(a), s.slug).toBe(textOf(b))
      expect(a, s.slug).not.toBe(b)
    }
  })
})
