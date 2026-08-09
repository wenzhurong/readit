import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyStrikethrough } from '../../src/rules/strikethrough.js'
import { applyDirAuto } from '../../src/rules/dirauto.js'

function md() {
  return new MarkdownIt('default', { html: true, linkify: false })
    .use(applyStrikethrough)
    .use(applyDirAuto)
}

/** Inline-only render, so a leading `~~~` is not read as a code fence. */
const p = (src: string) => md().renderInline(src)

describe('applyStrikethrough', () => {
  it('emits <del> instead of markdown-it default <s>', () => {
    expect(md().render('~~gone~~\n')).toBe('<p dir="auto"><del>gone</del></p>\n')
    expect(md().render('~~gone~~\n')).not.toContain('<s>')
  })

  it('keeps nested inline markup inside the del', () => {
    // Shape verbatim from vuejs/vue-loader README.md
    expect(md().render('~~`refSugar: boolean`: **removed.**~~\n')).toBe(
      '<p dir="auto"><del><code>refSugar: boolean</code>: <strong>removed.</strong></del></p>\n',
    )
  })

  it('does not touch a literal <s> written as raw HTML', () => {
    expect(md().render('<s>raw</s>\n')).toBe('<p dir="auto"><s>raw</s></p>\n')
  })

  /**
   * GFM 0.29 "Strikethrough (extension)": "Strikethrough text is any text wrapped in a
   * matching pair of ONE OR TWO tildes". markdown-it's built-in rule accepts exactly two
   * — it bails on `len < 2` and then consumes the run two tildes at a time — so the
   * single-tilde form was silently missing and a three-tilde run was PARTIALLY matched
   * (`~<s>three</s>~`) instead of being left alone.
   *
   * The three cases below are the three cells of `test/corpus/gfm/strikethrough.md`, and
   * the expectations are its committed GitHub oracle fixture.
   */
  describe('GFM tilde runs: one or two open, three or more are literal', () => {
    it('strikes a two-tilde pair', () => {
      expect(p('~~two~~')).toBe('<del>two</del>')
    })

    it('strikes a ONE-tilde pair', () => {
      expect(p('~single~')).toBe('<del>single</del>')
    })

    it('leaves a three-tilde run fully literal — not even partially struck', () => {
      expect(p('a ~~~three~~~ b')).toBe('a ~~~three~~~ b')
      expect(p('a ~~~three~~~ b')).not.toContain('<del>')
      expect(p('a ~~~three~~~ b')).not.toContain('<s>')
    })

    it('leaves runs longer than three literal too', () => {
      expect(p('a ~~~~four~~~~ b')).toBe('a ~~~~four~~~~ b')
      expect(p('a ~~~~~five~~~~~ b')).toBe('a ~~~~~five~~~~~ b')
    })

    it('renders the corpus line exactly as GitHub does', () => {
      expect(p('~~one tilde pair~~ and ~single~ and ~~~three~~~')).toBe(
        '<del>one tilde pair</del> and <del>single</del> and ~~~three~~~',
      )
    })
  })

  describe('the rest of the delimiter contract markdown-it already had', () => {
    it('still stops at a paragraph break (GFM spec example 492)', () => {
      expect(md().render('This ~~has a\n\nnew paragraph~~.\n')).toBe(
        '<p dir="auto">This ~~has a</p>\n<p dir="auto">new paragraph~~.</p>\n',
      )
    })

    it('still strikes inside a word', () => {
      expect(p('a~~b~~c')).toBe('a<del>b</del>c')
      expect(p('a~b~c')).toBe('a<del>b</del>c')
    })

    it('leaves an unmatched tilde as literal text', () => {
      expect(p('a ~ b')).toBe('a ~ b')
      expect(p('a ~~ b')).toBe('a ~~ b')
      expect(p('lone ~tilde')).toBe('lone ~tilde')
    })

    it('never looks inside a code span', () => {
      expect(p('`~~x~~`')).toBe('<code>~~x~~</code>')
      expect(p('`~x~`')).toBe('<code>~x~</code>')
    })

    it('honours a backslash escape', () => {
      expect(p('\\~not\\~')).toBe('~not~')
    })

    /**
     * A 1-tilde opener CAN close against a 2-tilde closer. This is not a readit choice:
     * cmark-gfm pairs delimiters with one generic algorithm (`process_emphasis`) that
     * never compares opener and closer LENGTHS — only the flanking flags and the rule of
     * three — and markdown-it's `balance_pairs` is that same algorithm. Pinned here
     * because it is the one visible consequence of `~` and `~~` sharing a delimiter
     * marker, and because markdown-it's built-in rule did NOT do it (it could not: a
     * 1-tilde run never became a delimiter at all, so `\~~not~~` came out as literal
     * `~~not~~`). NOT measured against a live GitHub oracle — no corpus file exercises
     * a mixed-length pair — so this records the behaviour readit now has and why, rather
     * than claiming GitHub was consulted.
     */
    it('pairs a mixed-length run the way cmark-gfm\'s generic delimiter matcher does', () => {
      expect(p('\\~~not~~')).toBe('~<del>not</del>')
      expect(p('a ~x~~ b')).toBe('a <del>x</del> b')
    })

    it('nests', () => {
      expect(p('~~a ~b~ c~~')).toBe('<del>a <del>b</del> c</del>')
    })
  })
})
