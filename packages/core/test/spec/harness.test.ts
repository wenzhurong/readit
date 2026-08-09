import { describe, expect, it } from 'vitest'
import { PERMANENT_PREFIX, findNonPermanentReasons, normalizeSpecHtml } from './harness.js'
import knownFailures from './known-failures.json' with { type: 'json' }

/**
 * `runSpecSuite` asserts `findNonPermanentReasons(whitelist)` is empty for each suite. Against the
 * real, all-PERMANENT whitelist that assertion can only ever pass — it is a guard for the future,
 * not a check of the present. So the detection logic behind it needs its own direct test, or the
 * guard would be exactly the kind of assertion-that-cannot-fail it was added to eliminate.
 */
describe('findNonPermanentReasons (the TEMPORARY-must-be-zero guard)', () => {
  it('accepts a whitelist whose reasons are all PERMANENT', () => {
    expect(
      findNonPermanentReasons({
        '218': 'PERMANENT · markdown-it 15 上游渲染器行为。',
        '398': 'PERMANENT · emphasis 0.29 vs 0.31.2 漂移。',
      }),
    ).toEqual([])
  })

  it('flags a TEMPORARY entry', () => {
    expect(
      findNonPermanentReasons({
        '218': 'PERMANENT · 上游渲染器行为。',
        '199': 'TEMPORARY · 表格对齐，规则落地后本条必须删除。',
      }),
    ).toEqual(['199'])
  })

  it('flags a reason with no classification prefix at all', () => {
    expect(findNonPermanentReasons({ '42': 'it just does not pass' })).toEqual(['42'])
  })

  it('flags a reason that merely mentions PERMANENT somewhere later in the text', () => {
    expect(findNonPermanentReasons({ '42': 'TEMPORARY · will become PERMANENT eventually' })).toEqual(['42'])
  })

  it('reports every offender, in numeric example order', () => {
    expect(
      findNonPermanentReasons({
        '426': 'TEMPORARY · b',
        '99': 'TEMPORARY · a',
        '218': 'PERMANENT · fine',
      }),
    ).toEqual(['99', '426'])
  })

  it('flags a non-string reason instead of throwing on it', () => {
    expect(findNonPermanentReasons({ '42': null as never })).toEqual(['42'])
  })

  /**
   * 这条断言记录的是守卫的**上限**，不是它的能力：原地改标签、理由一字不动，
   * 检查照过。写下来是为了让它别看起来像是完备的——一道被误以为完备的守卫，
   * 比一道公开承认有缺口的守卫更危险。
   *
   * 为什么不补上：判断一条理由是否真的成立是语义判断，字符串检查做不到，除非
   * 把理由文本也钉死，那会让每次措辞修订都变成假报警。拦住它的是 review——
   * diff 里 TEMPORARY 变 PERMANENT 是醒目的一行，而 runSpecSuite 的失败信息
   * 已明确点名这种做法被禁止。详见 harness.ts 中 PERMANENT_PREFIX 上方的说明。
   */
  it('KNOWN LIMIT: a relabel with identical prose passes — only review catches that', () => {
    const reason = '某条足够长、足以通过 >10 字符断言的理由文字'
    expect(findNonPermanentReasons({ '42': `TEMPORARY · ${reason}` })).toEqual(['42'])
    expect(findNonPermanentReasons({ '42': `${PERMANENT_PREFIX} · ${reason}` })).toEqual([])
    // 而且改完之后连长度断言也还满足，两道机械检查都拦不住。
    expect(`${PERMANENT_PREFIX} · ${reason}`.slice(PERMANENT_PREFIX.length).trim().length).toBeGreaterThan(10)
  })
})

/**
 * The hard requirement itself, asserted over the committed file rather than only per-suite from
 * inside `runSpecSuite` — so the count is stated in one place, by name, the way the acceptance
 * record states it.
 */
describe('known-failures.json', () => {
  const suites = Object.entries(knownFailures as Record<string, Record<string, string>>)

  it('has the two expected suites and 17 whitelisted examples in total', () => {
    expect(suites.map(([id]) => id).sort()).toEqual(['commonmark-0.31.2', 'gfm-0.29'])
    expect(suites.reduce((n, [, w]) => n + Object.keys(w).length, 0)).toBe(17)
  })

  it('holds zero TEMPORARY entries across every suite', () => {
    const offenders = suites.flatMap(([id, w]) => findNonPermanentReasons(w).map((k) => `${id}#${k}`))
    expect(offenders).toEqual([])
  })

  it('gives every PERMANENT entry a reason beyond the bare prefix', () => {
    for (const [id, whitelist] of suites) {
      for (const [example, reason] of Object.entries(whitelist)) {
        expect(reason.startsWith(PERMANENT_PREFIX), `${id}#${example}`).toBe(true)
        expect(reason.slice(PERMANENT_PREFIX.length).trim().length, `${id}#${example}`).toBeGreaterThan(10)
      }
    }
  })
})

describe('normalizeSpecHtml', () => {
  it('rewrites XHTML void elements to the HTML5 form markdown-it emits', () => {
    expect(normalizeSpecHtml('<p>a<br /></p>')).toBe('<p>a<br></p>')
    expect(normalizeSpecHtml('<img src="x" />')).toBe('<img src="x">')
    expect(normalizeSpecHtml('<hr />')).toBe('<hr>')
  })

  it('leaves non-void self-closing-looking tags alone', () => {
    expect(normalizeSpecHtml('<div />')).toBe('<div />')
    expect(normalizeSpecHtml('<span />')).toBe('<span />')
  })

  it('cannot reach escaped markup inside a code block', () => {
    expect(normalizeSpecHtml('<pre><code>&lt;br /></code></pre>')).toBe('<pre><code>&lt;br /></code></pre>')
  })
})
