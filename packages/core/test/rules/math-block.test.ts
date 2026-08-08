import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it'
import { render } from '../../src/index.js'
import { readCorpus } from '../corpus-harness.js'
import { applyCodeBlock } from '../../src/rules/codeblock.js'
import { applyMathBlock } from '../../src/rules/math-block.js'
import { applyMathInline, type ReaditEnv } from '../../src/rules/math-inline.js'

const DISPLAY_OPEN = '<math-renderer class="js-display-math" style="display: block">'

/**
 * The two rules as `createEngine` loads them. `applyMathBlock` alone is
 * exercised separately (see "self-sufficient without applyMathInline") — the
 * pair is the realistic configuration, so it is the default here.
 */
function build(): MarkdownItInstance {
  const md = new MarkdownIt()
  applyMathInline(md)
  applyMathBlock(md)
  return md
}

function html(src: string, readit: ReaditEnv['readit'] = {}): string {
  return build().render(src, { readit } satisfies ReaditEnv)
}

/** Every `(tex, display)` pair a supplied MathRenderer is asked to render. */
function rendererCalls(src: string, readit: ReaditEnv['readit'] = {}): Array<[string, boolean]> {
  const seen: Array<[string, boolean]> = []
  const env: ReaditEnv = {
    readit: {
      ...readit,
      math: {
        render(tex: string, display: boolean) {
          seen.push([tex, display])
          return '<svg/>'
        },
      },
    },
  }
  build().render(src, env)
  return seen
}

/**
 * The bytes of the two block-math corpus files, whose oracle fixtures are this
 * task's acceptance standard (pinned against the real files below, so the
 * "measured" in the test names below cannot quietly go stale).
 *
 * `BLOCK_SRC`'s `\,` and `BLOCK_TEX`'s bare `,` are the interesting pair:
 * GitHub's own output has the comma, because a `$$` paragraph goes through the
 * paragraph's inline pipeline and CommonMark backslash escapes are resolved
 * before anything looks for math. `FENCE_SRC` carries no delimiters at all —
 * the `$$` in `FENCE_TEX`'s rendering is supplied by the renderer, as GitHub
 * supplies it.
 */
const BLOCK_SRC = '$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$\n'
const BLOCK_TEX = '\n\\int_0^1 x^2 , dx = \\frac{1}{3}\n'
const FENCE_SRC = '```math\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n```\n'
const FENCE_TEX = '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}'

describe('corpus sources', () => {
  it('are the bytes GitHub was measured on', () => {
    expect(readCorpus('frontend/math-block')).toBe(BLOCK_SRC)
    expect(readCorpus('frontend/math-fence')).toBe(FENCE_SRC)
  })
})

describe('$$ paragraph', () => {
  it('renders the measured math-block fixture, escapes resolved, delimiters kept', () => {
    expect(html(BLOCK_SRC)).toBe(`<p>${DISPLAY_OPEN}$$${BLOCK_TEX}$$</math-renderer></p>\n`)
  })

  it('still works with inlineMath off (SPEC 8.6)', () => {
    expect(html(BLOCK_SRC, { inlineMath: 'off' })).toBe(
      `<p>${DISPLAY_OPEN}$$${BLOCK_TEX}$$</math-renderer></p>\n`,
    )
  })

  it('hands the renderer the undelimited TeX with display true', () => {
    expect(rendererCalls(BLOCK_SRC)).toEqual([[BLOCK_TEX, true]])
    expect(rendererCalls(BLOCK_SRC, { inlineMath: 'off' })).toEqual([[BLOCK_TEX, true]])
  })

  it('claims only a span that is the whole paragraph', () => {
    expect(html('lead $$\na\n$$')).not.toContain('math-renderer')
    expect(html('$$\na\n$$ trail')).not.toContain('math-renderer')
    // Starts and ends with `$$`, but that is two spans, not one.
    expect(html('$$\na\n$$ and $$\nb\n$$')).not.toContain('math-renderer')
  })

  it('leaves a single-line $$…$$ paragraph to the inline guard', () => {
    // Deliberately disjoint domains: the inline guard's R4 can never cross a
    // line break, so this rule claims only spans it could not. The mode gate
    // is what makes the split observable — same paragraph, two outcomes.
    expect(html('$$a+b$$')).toContain('math-renderer')
    expect(html('$$a+b$$', { inlineMath: 'off' })).not.toContain('math-renderer')
  })

  it('means the same thing in every inlineMath mode, inner dollars and all', () => {
    // This is what running ahead of the dollar guard buys. In `github` mode
    // the guard would otherwise claim the inner `$b$` first, leaving this rule
    // an opaque `math_inline` child to trip over — and the identical paragraph
    // would then be one display block under `off` and literal text under
    // `github`. The inner dollars must survive verbatim into the payload.
    const src = '$$\na $b$ c\n$$'
    const expected = `<p>${DISPLAY_OPEN}$$\na $b$ c\n$$</math-renderer></p>\n`
    expect(html(src)).toBe(expected)
    expect(html(src, { inlineMath: 'strict' })).toBe(expected)
    expect(html(src, { inlineMath: 'off' })).toBe(expected)
  })

  it('declines when any non-text token sits inside the span', () => {
    // A code span, an emphasis run or raw HTML makes the paragraph something
    // other than one opaque block of TeX; leaving it alone is the honest
    // outcome, and it is what the guard already does for inline spans (R10).
    expect(html('$$\na `b` c\n$$')).not.toContain('math-renderer')
    expect(html('$$\na *b* c\n$$')).not.toContain('math-renderer')
  })

  it('needs something to typeset between the delimiters', () => {
    // `$$\n$$` satisfies "opens, closes, crosses a line break" but its
    // interior is only that line break — an empty display-math element, not
    // math. `$$$$` and `$$$` are the degenerate slices of the same check.
    expect(html('$$\n$$')).not.toContain('math-renderer')
    expect(html('$$\n \n$$')).not.toContain('math-renderer')
    expect(html('$$$$')).not.toContain('math-renderer')
    expect(html('$$$')).not.toContain('math-renderer')
  })

  it('claims paragraphs only, not a multi-line setext heading', () => {
    // The `paragraph_open` guard's one reachable discriminator. Every other
    // block that owns an `inline` token — ATX headings, table cells — is
    // single-line by construction and so is already excluded by the
    // line-break requirement; a setext heading is the one that can carry a
    // `$$…$$` span across lines and must still render as a heading.
    const setext = '$$\na\n$$\n===\n'
    expect(html(setext, { inlineMath: 'off' })).toBe('<h1>$$\na\n$$</h1>\n')
    expect(html(setext)).not.toContain('math-renderer')
  })
})

describe('```math fence', () => {
  it('renders the measured math-fence fixture at top level, no <p> wrapper', () => {
    expect(html(FENCE_SRC)).toBe(`${DISPLAY_OPEN}$$${FENCE_TEX}$$</math-renderer>\n`)
  })

  it('still works with inlineMath off (SPEC 8.6)', () => {
    expect(html(FENCE_SRC, { inlineMath: 'off' })).toBe(
      `${DISPLAY_OPEN}$$${FENCE_TEX}$$</math-renderer>\n`,
    )
  })

  it('trims the fence body before adding the delimiters GitHub supplies', () => {
    expect(html('```math\n\n   x^2   \n\n```\n')).toBe(
      `${DISPLAY_OPEN}$$x^2$$</math-renderer>\n`,
    )
  })

  it('accepts a tilde fence and an info string with trailing whitespace', () => {
    expect(html('~~~math\nx^2\n~~~\n')).toBe(`${DISPLAY_OPEN}$$x^2$$</math-renderer>\n`)
    expect(html('```math \nx^2\n```\n')).toBe(`${DISPLAY_OPEN}$$x^2$$</math-renderer>\n`)
  })

  it('hands the renderer the undelimited TeX with display true', () => {
    expect(rendererCalls(FENCE_SRC)).toEqual([[FENCE_TEX, true]])
    expect(rendererCalls(FENCE_SRC, { inlineMath: 'off' })).toEqual([[FENCE_TEX, true]])
  })

  it('escapes the TeX payload', () => {
    expect(html('```math\na < b & c\n```\n')).toBe(
      `${DISPLAY_OPEN}$$a &lt; b &amp; c$$</math-renderer>\n`,
    )
  })

  it('leaves every other fence info string alone', () => {
    expect(html('```ts\nlet a = 1\n```\n')).toContain('<code class="language-ts">')
    expect(html('```\nplain\n```\n')).not.toContain('math-renderer')
    expect(html('```mathematica\nx\n```\n')).not.toContain('math-renderer')
  })

  it('survives a fence renderer registered after it, because it rewrites the token type', () => {
    // createEngine calls applyCodeBlock AFTER the SHAPE_RULES loop, so a
    // `md.renderer.rules.fence` override installed by this rule would simply be
    // replaced. Converting `fence` -> `math_block` in a core rule instead makes
    // the outcome independent of registration order — that is what this pins.
    const md = new MarkdownIt()
    applyMathInline(md)
    applyMathBlock(md)
    applyCodeBlock(md)
    expect(md.render(FENCE_SRC, { readit: {} } satisfies ReaditEnv)).toBe(
      `${DISPLAY_OPEN}$$${FENCE_TEX}$$</math-renderer>\n`,
    )
  })
})

describe('self-sufficient without applyMathInline', () => {
  it('renders both block forms when it is the only rule applied', () => {
    const md = new MarkdownIt()
    applyMathBlock(md)
    const env: ReaditEnv = { readit: {} }
    expect(md.render(BLOCK_SRC, env)).toBe(
      `<p>${DISPLAY_OPEN}$$${BLOCK_TEX}$$</math-renderer></p>\n`,
    )
    expect(md.render(FENCE_SRC, env)).toBe(`${DISPLAY_OPEN}$$${FENCE_TEX}$$</math-renderer>\n`)
  })
})

describe('wired into the full engine', () => {
  it('produces GitHub\u2019s shape for both block forms, class intact through the sanitizer', () => {
    expect(render(BLOCK_SRC, { math: null, highlighter: null })).toBe(
      `<p dir="auto" data-line="0">${DISPLAY_OPEN}$$${BLOCK_TEX}$$</math-renderer></p>\n`,
    )
    expect(render(FENCE_SRC, { math: null, highlighter: null })).toBe(
      `${DISPLAY_OPEN}$$${FENCE_TEX}$$</math-renderer>\n`,
    )
  })

  it('leaves a non-math fence on the codeblock wrapper path', () => {
    const out = render('```ts\nlet a = 1\n```\n', { math: null, highlighter: null })
    expect(out).toContain('class="highlight highlight-source-ts')
    expect(out).not.toContain('math-renderer')
  })
})
