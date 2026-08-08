import { describe, expect, it } from 'vitest'
import { createSpecEngine, SEMANTIC_RULE_BY_EXTENSION } from '../../src/engine.js'
import { DEFAULT_OPTIONS } from '../../src/types.js'
import knownFailures from './known-failures.json' with { type: 'json' }

export interface SpecExample {
  markdown: string
  html: string
  example: number
  section: string
  /** cmark-gfm 扩展名，空串代表基线（零扩展）例子。见 scripts/fetch-specs.ts。 */
  extension: string
}

export type SuiteId = 'commonmark-0.31.2' | 'gfm-0.29'

/**
 * 唯一一条允许的归一化：把 XHTML 自闭合空元素写成 HTML5 形式。
 * 规格文件里是 `<br />`，readit 用 xhtmlOut:false（GitHub 发 `<br>`）。
 * 只对固定的 15 个空元素名生效；代码块里的 `<` 已被转义成 `&lt;`，扫不到。
 * 除此之外**不做任何归一化** —— 比较是字节级的。
 */
const VOID_SELF_CLOSING =
  /<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b([^>]*?)\s*\/>/g

export function normalizeSpecHtml(html: string): string {
  return html.replace(VOID_SELF_CLOSING, '<$1$2>')
}

/**
 * L1 只测解析语义，所以走 createSpecEngine，且必须开 allowDangerousHtml（规格假定原始 HTML 透传）。
 *
 * `extension` 决定加载哪条 SEMANTIC 规则（见 engine.ts 的 `SEMANTIC_RULE_BY_EXTENSION`
 * 与它上面的文档注释）：空串或不在映射表里的值（如 `disabled`）一律用零扩展的
 * 基线引擎——这是 Task 32a 修的结构性缺口，此前这里无条件加载全部四条，
 * 污染了从未打算见到 autolink/tagfilter 的基线例子。
 */
export function renderForSpec(markdown: string, extension: string): string {
  const rule = SEMANTIC_RULE_BY_EXTENSION[extension]
  const md = createSpecEngine({ ...DEFAULT_OPTIONS, allowDangerousHtml: true }, rule ? [rule] : [])
  return md.render(markdown, {})
}

/**
 * 表驱动跑一套规格。
 * - 不在白名单里的例子失败 -> 测试失败（新增失败断构建）
 * - 在白名单里的例子失败 -> 测试通过
 * - 在白名单里的例子**通过** -> 测试失败，要求把该条从白名单删掉（防白名单腐烂）
 * - 白名单里有编号在本套件中不存在 -> 测试失败
 */
export function runSpecSuite(
  suiteId: SuiteId,
  examples: SpecExample[],
  expectedCount: number,
): void {
  const whitelist: Record<string, string> = knownFailures[suiteId]

  describe(suiteId, () => {
    it(`${suiteId}: fixture has exactly ${expectedCount} examples`, () => {
      expect(examples.length).toBe(expectedCount)
    })

    it(`${suiteId}: every known-failures key names a real example`, () => {
      const ids = new Set(examples.map((e) => String(e.example)))
      const orphans = Object.keys(whitelist).filter((k) => !ids.has(k))
      expect(orphans).toEqual([])
    })

    for (const e of examples) {
      it(`${suiteId} · ${e.section} · example ${e.example}`, () => {
        const got = normalizeSpecHtml(renderForSpec(e.markdown, e.extension))
        const want = normalizeSpecHtml(e.html)
        const reason = whitelist[String(e.example)]
        if (reason === undefined) {
          expect(got).toBe(want)
        } else {
          expect(
            got === want,
            `example ${e.example} 现在通过了。请把它从 test/spec/known-failures.json 的 ` +
              `"${suiteId}" 里删掉。原白名单理由：${reason}`,
          ).toBe(false)
        }
      })
    }
  })
}
