import { describe, expect, it } from 'vitest'
import { createSpecEngine, SEMANTIC_RULE_BY_EXTENSION, type Rule } from '../../src/engine.js'
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
export function renderForSpec(markdown: string, extension: string, extraRules: readonly Rule[] = []): string {
  const rule = SEMANTIC_RULE_BY_EXTENSION[extension]
  if (rule === undefined && !BASE_EXTENSIONS.has(extension)) {
    throw new Error(
      `test/spec/harness.ts: unrecognized GFM extension info string "${extension}". ` +
        `Add it to SEMANTIC_RULE_BY_EXTENSION in src/engine.ts (or to BASE_EXTENSIONS ` +
        `in this file if it should render with zero SEMANTIC rules, like "disabled").`,
    )
  }
  const md = createSpecEngine(
    { ...DEFAULT_OPTIONS, allowDangerousHtml: true },
    rule ? [rule, ...extraRules] : [...extraRules],
  )
  return md.render(markdown, {})
}

/**
 * 一条规格例子的裁决：渲染结果、期望、是否相等、白名单理由，以及**套件意义上的"绿"**。
 *
 * 「绿」不是「通过」：不在白名单里的例子，绿 = 相等；在白名单里的例子，绿 = **仍然不等**
 * （一旦开始相等就是欠债还清，必须删条目——见 `runSpecSuite` 的反腐烂方向）。
 *
 * 抽出来是因为这套裁决有两个调用方，而此前第二个是把它抄了一遍的：`runSpecSuite` 逐例断言，
 * `integration.test.ts` 的规则注入测试则要在**多加载一条 SHAPE 规则**的前提下问同一个问题
 * （「1324 条例子里有几条还是全绿」）。抄一遍的风险不是重复本身，是两份裁决会各自漂移——
 * 注入测试量出来的「绿」若和套件的「绿」定义不同，它测出来的数字就不再是它声称的那个东西。
 *
 * 这里**不吞异常**：`renderForSpec` 对不认识的扩展名会抛错，那是 Task 32a 特意加的信号，
 * 套件必须原样看见它。注入测试自己在外面 try/catch 成「不绿」，因为对它而言"渲染炸了"
 * 和"渲染错了"是同一类答案。
 */
export interface SpecVerdict {
  got: string
  want: string
  matches: boolean
  /** 白名单理由，未列入则为 undefined。 */
  reason: string | undefined
  green: boolean
}

export function judgeSpecExample(
  suiteId: SuiteId,
  example: SpecExample,
  extraRules: readonly Rule[] = [],
): SpecVerdict {
  const got = normalizeSpecHtml(renderForSpec(example.markdown, example.extension, extraRules))
  const want = normalizeSpecHtml(example.html)
  const matches = got === want
  const reason = (knownFailures[suiteId] as Record<string, string | undefined>)[String(example.example)]
  return { got, want, matches, reason, green: reason === undefined ? matches : !matches }
}

/**
 * 白名单理由必须带的前缀。
 *
 * 计划一的硬要求是 **TEMPORARY 计数为 0**：`PERMANENT` 的含义是「任何 JS 解析器都不可能
 * 同时满足两边」（规格冻结导致的版本漂移、markdown-it 上游渲染器行为、cmark-gfm 自己都跳过
 * 的例子），这是把一条规格例子放进白名单的**唯一**可接受理由。`TEMPORARY` 则是没还的债。
 *
 * 在此之前这条规则只以散文形式存在（见上面 BASE_EXTENSIONS 的注释），`runSpecSuite` 把理由
 * 字符串当成不透明的一团，任何人都可以加一条 `TEMPORARY` 而套件照绿。
 *
 * ## 这道守卫的**已知上限**，写在这里而不是让它看起来是完备的
 *
 * 它能挡住的是「新增一条没标 PERMANENT 的条目」和「只写裸前缀、不给理由」
 * （后者由 harness.test.ts 的 >10 字符断言负责）。它挡不住**原地改标签**：
 * 把 `TEMPORARY · 某条 30 字的理由` 改成 `PERMANENT · 某条 30 字的理由`，
 * 前缀对了，理由长度也还在，两条断言都通过。
 *
 * 这是机械检查的固有边界——判断一条理由是否**真的**满足「任何 JS 解析器都不
 * 可能同时满足两边」，是一个语义判断，字符串检查做不到，除非把理由本身也钉死
 * （那会让每一次措辞修订都变成一次假报警）。所以真正拦住重贴标签的是 review：
 * 改动 known-failures.json 的 diff 里，一条 TEMPORARY 变 PERMANENT 是一行醒目
 * 的改动，而 `runSpecSuite` 那条断言的失败信息明确点名这种做法是被禁止的。
 *
 * 记录在案的事实是：任务 10-13 把原有 14 条 TEMPORARY 全部**修好**清零，
 * 一条都没有重新归类，这才是这道守卫要保护的记录。
 */
export const PERMANENT_PREFIX = 'PERMANENT'

/** 白名单里理由未标 PERMANENT 的编号（升序，数值序）。 */
export function findNonPermanentReasons(whitelist: Record<string, string>): string[] {
  return Object.entries(whitelist)
    .filter(([, reason]) => typeof reason !== 'string' || !reason.startsWith(PERMANENT_PREFIX))
    .map(([id]) => id)
    .sort((a, b) => Number(a) - Number(b))
}

/**
 * 表驱动跑一套规格。
 * - 不在白名单里的例子失败 -> 测试失败（新增失败断构建）
 * - 在白名单里的例子失败 -> 测试通过
 * - 在白名单里的例子**通过** -> 测试失败，要求把该条从白名单删掉（防白名单腐烂）
 * - 白名单里有编号在本套件中不存在 -> 测试失败
 * - 白名单里有条目理由不是 PERMANENT -> 测试失败（TEMPORARY 必须清零）
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

    it(`${suiteId}: every known-failure reason is PERMANENT (the TEMPORARY count must be zero)`, () => {
      expect(
        findNonPermanentReasons(whitelist),
        `test/spec/known-failures.json["${suiteId}"] contains entries that are not marked ` +
          `${PERMANENT_PREFIX}. Plan one's hard requirement is that the TEMPORARY count is zero.\n` +
          `${PERMANENT_PREFIX} means "no JS parser could possibly match here" — a frozen-spec ` +
          'version drift, an upstream markdown-it renderer behaviour, or an example cmark-gfm ' +
          'itself skips. That is the ONLY acceptable reason to whitelist a spec example.\n' +
          'A TEMPORARY entry is unpaid debt: fix the example, do not list it. And relabelling a ' +
          'TEMPORARY entry as PERMANENT to get past this check is explicitly forbidden — Task ' +
          '10-13 cleared all 14 original TEMPORARY entries by actually fixing them, none was ' +
          'reclassified, and that is the record this assertion exists to protect.',
      ).toEqual([])
    })

    for (const e of examples) {
      it(`${suiteId} · ${e.section} · example ${e.example}`, () => {
        // 裁决走 judgeSpecExample（注入测试用的是同一个函数），但断言仍然拿 got/want 本身来断，
        // 不是断一个 boolean——失败时要能看见逐字符的 diff。
        const verdict = judgeSpecExample(suiteId, e)
        if (verdict.reason === undefined) {
          expect(verdict.got).toBe(verdict.want)
        } else {
          expect(
            verdict.matches,
            `example ${e.example} 现在通过了。请把它从 test/spec/known-failures.json 的 ` +
              `"${suiteId}" 里删掉。原白名单理由：${verdict.reason}`,
          ).toBe(false)
        }
      })
    }
  })
}
