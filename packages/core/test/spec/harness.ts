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
 * cmark-gfm info strings that intentionally render with **zero** SEMANTIC rules:
 * `''` is the 648 base (no-extension) examples; `disabled` is the 2 examples
 * cmark-gfm's own runner skips (279/280, already PERMANENT-whitelisted for an
 * unrelated task-list attribute-order reason — see known-failures.json).
 */
const BASE_EXTENSIONS = new Set(['', 'disabled'])

/**
 * L1 只测解析语义，所以走 createSpecEngine，且必须开 allowDangerousHtml（规格假定原始 HTML 透传）。
 *
 * `extension` 决定加载哪条 SEMANTIC 规则（见 engine.ts 的 `SEMANTIC_RULE_BY_EXTENSION`
 * 与它上面的文档注释）：`BASE_EXTENSIONS` 里的值一律用零扩展的基线引擎——这是
 * Task 32a 修的结构性缺口，此前这里无条件加载全部四条，污染了从未打算见到
 * autolink/tagfilter 的基线例子。
 *
 * 任何**既不在** `SEMANTIC_RULE_BY_EXTENSION` **也不在** `BASE_EXTENSIONS` 里的值会
 * 显式抛错，而不是像早前版本那样悄悄落到"零规则"——cmark-gfm 未来若在 spec.txt
 * 里加一个新扩展 info string，这里应该让人立刻看见"没人认识这个扩展名"，而不是
 * 让它安静地跑基线引擎、变成一条难查的 HTML 不匹配（Task 32a 复审 Minor 项）。
 */
export function renderForSpec(markdown: string, extension: string): string {
  const rule = SEMANTIC_RULE_BY_EXTENSION[extension]
  if (rule === undefined && !BASE_EXTENSIONS.has(extension)) {
    throw new Error(
      `test/spec/harness.ts: unrecognized GFM extension info string "${extension}". ` +
        `Add it to SEMANTIC_RULE_BY_EXTENSION in src/engine.ts (or to BASE_EXTENSIONS ` +
        `in this file if it should render with zero SEMANTIC rules, like "disabled").`,
    )
  }
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
