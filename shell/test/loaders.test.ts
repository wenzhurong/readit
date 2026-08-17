import { describe, expect, it, vi } from 'vitest'
import {
  createHighlighterLoaderWith,
  createMermaidLoaderWith,
  type HighlightPlugin,
  type MermaidPlugin,
} from '../src/loaders.js'

describe('壳注入的懒加载器', () => {
  it('高亮加载器把元素给的语言并集透传给 createShikiHighlighter', async () => {
    // 这条是回归钉子。出货应用里壳调的是 createShikiHighlighter()——不传 langs
    // 就是空语言集，supports() 对任何语言恒为 false，于是每个围栏都静默回落朴素
    // <pre>：不报错、不降级提示、看起来就像「这个项目没有语法高亮」。
    const highlighter = { supports: () => true, highlight: () => null }
    const createShikiHighlighter = vi.fn(async (_opts?: { langs?: readonly string[] }) => highlighter)
    const plugin: HighlightPlugin = { createShikiHighlighter }
    const importPlugin = vi.fn(async () => plugin)

    const load = createHighlighterLoaderWith(importPlugin)
    const got = await load(['typescript', 'rust'])

    expect({
      langs: createShikiHighlighter.mock.calls[0]?.[0]?.langs,
      returned: got === highlighter,
      imports: importPlugin.mock.calls.length,
    }).toEqual({
      langs: ['typescript', 'rust'],
      returned: true,
      imports: 1,
    })
  })

  it('语言集为空时也照样传空数组，而不是退化成不传参', async () => {
    // 不传参与传 [] 在 createShikiHighlighter 里恰好等价，但「不传」是这个缺陷的
    // 形状本身。钉住调用点始终显式给出语言集，别让它有机会漂回去。
    const createShikiHighlighter = vi.fn(async (_opts?: { langs?: readonly string[] }) => ({
      supports: () => false,
      highlight: () => null,
    }))
    await createHighlighterLoaderWith(async () => ({ createShikiHighlighter }))([])

    expect(createShikiHighlighter.mock.calls[0]?.[0]).toEqual({ langs: [] })
  })

  it('每次调用都重新 import 并新建一个 highlighter——元素靠整体替换来扩语言集', async () => {
    const createShikiHighlighter = vi.fn(async (_opts?: { langs?: readonly string[] }) => ({
      supports: () => true,
      highlight: () => null,
    }))
    const load = createHighlighterLoaderWith(async () => ({ createShikiHighlighter }))
    await load(['ts'])
    await load(['ts', 'rust'])

    expect(createShikiHighlighter.mock.calls.map((call) => call[0]?.langs)).toEqual([
      ['ts'],
      ['ts', 'rust'],
    ])
  })

  it('mermaid 加载器转交插件工厂的产物', async () => {
    const renderer = { hydrate: async () => [] }
    const createMermaidRenderer = vi.fn(() => renderer)
    const plugin: MermaidPlugin = { createMermaidRenderer }

    const got = await createMermaidLoaderWith(async () => plugin)()

    expect({ returned: got === renderer, calls: createMermaidRenderer.mock.calls.length }).toEqual({
      returned: true,
      calls: 1,
    })
  })
})
