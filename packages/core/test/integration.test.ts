import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render } from '../src/index.js'
import { createSpecEngine } from '../src/engine.js'
import { DEFAULT_OPTIONS } from '../src/types.js'

const SRC = readFileSync(join(import.meta.dirname, 'integration/kitchen-sink.md'), 'utf8')

describe('all 17 rules in one engine', () => {
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
