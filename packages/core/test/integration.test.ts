import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render } from '../src/index.js'
import {
  createSpecEngine,
  SEMANTIC_RULE_BY_EXTENSION,
  SEMANTIC_RULES,
  SHAPE_RULES,
  type Rule,
} from '../src/engine.js'
import { applyCodeBlock } from '../src/rules/codeblock.js'
import { applyRawShape } from '../src/rules/rawshape.js'
import { applyRawHtmlPolicy } from '../src/sanitize.js'
import { DEFAULT_OPTIONS } from '../src/types.js'

const SRC = readFileSync(join(import.meta.dirname, 'integration/kitchen-sink.md'), 'utf8')

// 19, not the 17 this used to say: 4 SEMANTIC + 12 SHAPE + the 3 `createEngine`
// calls outside the arrays. The number is no longer maintained by hand — the
// "rule registry" suite at the bottom of this file asserts it against the
// source, so a stale count here is now a test failure there.
describe('all 19 rules in one engine', () => {
  const html = render(SRC)

  it('frontmatter becomes a table, not an hr', () => {
    expect(html).toContain('<markdown-accessiblity-table>')
    expect(html).not.toMatch(/^<hr>/m)
  })

  it('heading gets the markdown-heading wrapper with class before dir before data-line', () => {
    // class before dir is C2 ordering rule #2 (applyHeadingAnchors before applyDirAuto);
    // data-line trailing is rule #3 (applySourceLine last). data-line is readit's own
    // addition (never emitted by GitHub itself, see sourceline.ts), so it belongs on
    // every block token that carries a source map, heading_open included.
    expect(html).toMatch(/<h1 class="heading-element" dir="auto" data-line="\d+">/)
    expect(html).toContain('id="user-content-')
  })

  it('autolinks www, url with balanced parens, and email; external autolinks get rel="nofollow"', () => {
    // Exact strings, not a bare href substring check: review round 1 found that
    // `toContain('href="...")` passes identically whether or not applyDecorate's
    // rel="nofollow" is present, so it can't actually pin that behavior.
    expect(html).toContain('<a href="http://www.example.com" rel="nofollow">www.example.com</a>')
    expect(html).toContain(
      '<a href="https://example.com/a(b)" rel="nofollow">https://example.com/a(b)</a>',
    )
    // mailto: does not get nofollow — measured GitHub behavior (Task 33 fix round 1,
    // SPEC §17.1 rule #15's "all autolinks" prose was an over-generalization from http(s)).
    expect(html).toContain('<a href="mailto:foo@bar.baz">foo@bar.baz</a>')
  })

  it('decorates images: bare image gets a blank-target wrapper, already-linked image keeps its author href', () => {
    // Discriminates applyDecorate's third behavior (wrap a bare image) from its
    // second (leave an author-linked image alone, just add nofollow to the link) —
    // review round 1 found the fixture had no image markdown at all, so none of
    // style="max-width", the synthetic wrapper, or the already-linked exemption
    // ever ran in this test.
    expect(html).toContain(
      '<a target="_blank" rel="noopener noreferrer" href="preview.png">' +
        '<img src="preview.png" alt="预览图" style="max-width: 100%;"></a>',
    )
    expect(html).toContain(
      '<a href="https://example.com/site" rel="nofollow">' +
        '<img src="logo.png" alt="Logo" style="max-width: 100%;"></a>',
    )
    // The already-linked image's anchor must not also get the bare-image treatment.
    expect(html).not.toContain('target="_blank" rel="noopener noreferrer" href="https://example.com/site"')
  })

  it('renders the alert with its octicon', () => {
    expect(html).toContain('class="markdown-alert markdown-alert-warning"')
    expect(html).toContain('data-component="Octicon"')
  })

  it('table carries align attributes AND the accessibility wrapper', () => {
    expect(html).toContain('align="center"')
    expect(html).toContain('align="right"')
    expect(html).toContain('<markdown-accessiblity-table>')
  })

  it('task list has GitHub attribute order and no dir on the ul', () => {
    // data-line (readit's own addition, see sourceline.ts) is expected to trail;
    // dir="auto" must never appear (dirauto.ts skips contains-task-list lists —
    // ordering rule #1, applyDirAuto after applyTaskList).
    expect(html).toMatch(/<ul class="contains-task-list" data-line="\d+">/)
    expect(html).not.toMatch(/<ul class="contains-task-list"[^>]*\bdir="auto"/)
    expect(html).toContain('aria-label="Completed task"')
  })

  it('strikethrough is del, not s', () => {
    expect(html).toContain('<del>删除线</del>')
    expect(html).not.toContain('<s>')
  })

  it('emoji keeps its class through the sanitize walker', () => {
    expect(html).toContain('class="emoji"')
  })

  it('a dollar inside a code span is never math', () => {
    expect(html).toMatch(/<code[^>]*>代码 \$5 段<\/code>/)
  })

  it('inline math is detected but currency is not', () => {
    expect(html).toContain('js-inline-math')
    expect(html).toContain('costs $5 or $10')
    expect(html.match(/js-inline-math/g)).toHaveLength(1)
  })

  it('fenced code gets the highlight wrapper and data-line', () => {
    expect(html).toContain('class="highlight highlight-source-js')
    expect(html).toContain('data-line=')
  })

  it('tagfilter escapes script but sanitize keeps the div', () => {
    expect(html).not.toContain('<script>')
    expect(html).toContain('id="user-content-custom"')
  })

  it('footnote section is emitted with unsalted ids', () => {
    expect(html).toContain('id="user-content-fn-1"')
    expect(html).not.toMatch(/user-content-fn-1-[0-9a-f]{32}/)
  })

  /**
   * applyRawShape is the one rule `createEngine` registers OUTSIDE the
   * SHAPE_RULES loop — after `applyRawHtmlPolicy`, per engine.ts coupling #4.
   * Nothing here would fail if that call were dropped except the corpus suite,
   * so this asserts the wiring at the engine level, on the same document as
   * every other rule.
   */
  it('decorates elements the author wrote as literal HTML, not just markdown ones', () => {
    expect(html).toContain(
      '<div class="markdown-heading" dir="auto"><h2 class="heading-element" dir="auto">原生标题</h2>',
    )
    expect(html).toContain('href="#原生标题"')
    expect(html).toContain(
      '<p dir="auto"><a target="_blank" rel="noopener noreferrer" href="raw.png">' +
        '<img src="raw.png" alt="raw" style="max-width: 100%;"></a></p>',
    )
  })
})

describe('createSpecEngine loads only the semantic slot', () => {
  const md = createSpecEngine(DEFAULT_OPTIONS)

  it('emits no GitHub shape for a plain heading', () => {
    expect(md.render('# hi')).toBe('<h1>hi</h1>\n')
  })

  it('still applies the semantic rules', () => {
    // <s> -> <del> is SEMANTIC, so the spec engine must still apply it.
    expect(md.render('~~x~~')).toBe('<p><del>x</del></p>\n')
  })

  it('does not apply the shape rules', () => {
    // dir="auto", the markdown-heading wrapper, and data-line are all SHAPE.
    const html = md.render('# hi\n\n| a |\n| - |\n| b |\n')
    expect(html).not.toContain('dir="auto"')
    expect(html).not.toContain('markdown-heading')
    expect(html).not.toContain('markdown-accessiblity-table')
    expect(html).not.toContain('data-line')
  })

  it('still applies the semantic half of the table rule', () => {
    // align belongs to SEMANTIC; the wrapper shell belongs to SHAPE — see
    // cross-rule contract C1's split of Task 7.
    expect(md.render('| a |\n|:-:|\n| b |\n')).toContain('align="center"')
  })
})

/**
 * ## The slot ratchet
 *
 * The plan's C1 promised a ratchet: put a rule in the wrong array and a spec
 * example flips loudly. That held while `createSpecEngine` loaded all of
 * `SEMANTIC_RULES` unconditionally. Task 32a's harness refactor replaced that
 * with a per-example lookup in `SEMANTIC_RULE_BY_EXTENSION`
 * (test/spec/harness.ts), and `harness.ts` now never reads `SEMANTIC_RULES` at
 * all — so a rule pushed into `SEMANTIC_RULES` but absent from the map is
 * invisible to every one of the 1324 spec examples, and the ratchet was gone.
 * Measured on this branch: of the 13 SHAPE-slot rules, injecting 9 of them
 * (`applyFrontmatter`, `applyFootnote`, `applyMathInline`, `applyMathBlock`,
 * `applyEmoji`, `applyAlerts`, `applyTaskList`, `applyDecorate`,
 * `applyRawShape`) into a spec engine left the whole suite green.
 *
 * The two tests below restore it structurally rather than by adding more
 * output assertions:
 *
 *  1. `SEMANTIC_RULES` and the map's values must be the SAME SET. A rule can
 *     then only enter the SEMANTIC slot by also being given a cmark-gfm
 *     extension name, and giving it one is exactly what puts it in front of
 *     the spec examples. Misfiling becomes a failure here even when it would
 *     produce no visible output drift.
 *  2. Every `applyXxx` the source exports must be accounted for by one of the
 *     three wiring sites, so a rule in NEITHER array is caught too. Test 1
 *     alone cannot see that case.
 */
describe('rule registry', () => {
  const names = (rules: readonly Rule[]): string[] => rules.map((r) => r.name).sort()

  it('SEMANTIC_RULES is exactly the set SEMANTIC_RULE_BY_EXTENSION maps to', () => {
    expect(names(SEMANTIC_RULES)).toEqual(names(Object.values(SEMANTIC_RULE_BY_EXTENSION)))
  })

  /**
   * `createEngine` calls exactly three rules outside the two arrays, and each
   * has a stated reason it cannot live in one — this is the "+3" in the
   * completeness arithmetic below, written out rather than left as a literal:
   *
   *  - `applyCodeBlock(md, opts.highlighter)` and
   *    `applyRawHtmlPolicy(md, opts.allowDangerousHtml)` take a second
   *    argument, so neither matches `Rule = (md: MarkdownIt) => void`. The
   *    arrays are typed `Rule[]`; these two simply do not fit.
   *  - `applyRawShape(md)` fits the signature but must be registered AFTER
   *    `applyRawHtmlPolicy` (engine.ts coupling #4, rules/rawshape.ts's C3(a)
   *    note). Core rules run in push order and every array member runs before
   *    the sanitizer, so membership in `SHAPE_RULES` would silently delete all
   *    five of its decorations.
   */
  const RULES_CALLED_OUTSIDE_THE_ARRAYS: readonly Rule[] = [
    applyCodeBlock as Rule,
    applyRawHtmlPolicy as unknown as Rule,
    applyRawShape,
  ]

  /**
   * Three exported `applyXxx` bindings are NOT engine-level rules and are
   * deliberately excluded from the count. Each is reachable only through one
   * of the wired rules above, never from `createEngine` directly:
   *
   *  - `applyRawHtmlTransform` is the shared combinator in rules/clobber.ts
   *    that the sanitizer, the clobber filter and `applyRawShape` are all
   *    built on. It takes a transform, not just an `md`.
   *  - `applyClobber` and `applySanitize` are the two branches
   *    `applyRawHtmlPolicy` dispatches to on `allowDangerousHtml`.
   */
  const NOT_ENGINE_RULES: ReadonlySet<string> = new Set([
    'applyRawHtmlTransform',
    'applyClobber',
    'applySanitize',
  ])

  it('every exported applyXxx is wired by exactly one of the three sites', () => {
    const srcDir = join(import.meta.dirname, '../src')
    const files = [
      ...readdirSync(join(srcDir, 'rules'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(srcDir, 'rules', f)),
      join(srcDir, 'sanitize.ts'),
    ]
    const exported = files
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/^export (?:function|const) (apply\w+)/gm)])
      .map((m) => m[1] as string)
      .filter((n) => !NOT_ENGINE_RULES.has(n))
      .sort()

    const wired = names([...SEMANTIC_RULES, ...SHAPE_RULES, ...RULES_CALLED_OUTSIDE_THE_ARRAYS])

    // Set equality, which subsumes the count. Measured 2026-08-08: 22 exported
    // `applyXxx` bindings minus the 3 non-rules above == 19 == 4 SEMANTIC + 12
    // SHAPE + 3 called outside the arrays.
    expect(exported).toEqual(wired)
    expect(SEMANTIC_RULES.length + SHAPE_RULES.length + RULES_CALLED_OUTSIDE_THE_ARRAYS.length).toBe(
      exported.length,
    )
  })
})
