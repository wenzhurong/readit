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
