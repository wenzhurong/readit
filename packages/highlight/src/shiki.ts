import type { Highlighter } from '@readit/core/types'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguages } from 'shiki/langs'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import { serializeFragment, unwrapPreCode } from './serialize.js'

export interface ShikiOptions {
  /**
   * 要预载的围栏语言名，通常直接传 `scan(src, inlineMath).languages`。
   *
   * 省略即空集：得到的 Highlighter 对任何语言都 supports() === false，core 回落到
   * 朴素 <pre>（SPEC §12「围栏语言未知 → 朴素 <pre>，不高亮，不报错」）。这里不给
   * 「常用集」默认值，是因为 highlight() 必须纯同步（P3），语言集只能在工厂期定死，
   * 而任何猜出来的默认集都是替嵌入方付字节：实测 shiki 与 starry-night 的公共语言
   * 交集（45 个名字）合计 255.4 KB gzip，是嵌入侧引擎本身的 4.7 倍。
   *
   * 名单里的未知名字会被跳过而不抛：scan() 按契约是过报的（`packages/core/src/
   * prepare.ts` 里写死「may over-report」），抛异常会让一篇含 ```zzzznotalanguage
   * 的正常文档整体渲染失败。
   */
  langs?: readonly string[]
}

type LangLoader = (typeof bundledLanguages)[keyof typeof bundledLanguages]

const REGISTRY = bundledLanguages as Record<string, LangLoader | undefined>

/**
 * 嵌入默认：Shiki 4.4.2 + JS 正则引擎，零 WASM。
 *
 * 工厂是 async（语法包按需动态 import），产出的 highlight() 纯同步。
 * `forgiving: true`：JS 正则引擎复现不了少数 Oniguruma 专有构造，宽容模式跳过
 * 那几条 pattern 而不是整条语法崩掉——这是 ③档 D-TOKEN 已声明偏离的一个来源，
 * 由冻结黄金文件而不是 GitHub oracle 盯住。
 */
export async function createShikiHighlighter(opts: ShikiOptions = {}): Promise<Highlighter> {
  const loaders: LangLoader[] = []
  for (const name of opts.langs ?? []) {
    const loader = REGISTRY[name.toLowerCase()]
    if (loader !== undefined) loaders.push(loader)
  }

  const core = await createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    themes: [githubLight, githubDark],
    langs: loaders,
  })

  const loaded = new Set(core.getLoadedLanguages())

  return {
    supports(lang: string): boolean {
      return loaded.has(lang.toLowerCase())
    },
    highlight(code: string, lang: string): string | null {
      const key = lang.toLowerCase()
      if (!loaded.has(key)) return null
      const hast = core.codeToHast(code, {
        lang: key,
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: 'light',
        cssVariablePrefix: '--readit-shiki-',
        structure: 'classic',
      })
      return serializeFragment(unwrapPreCode(hast))
    },
  }
}
