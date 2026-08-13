import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyEmoji, replaceEmoji } from '../../src/rules/emoji.js'
import { render } from '../../src/index.js'
import { GITHUB_EMOJI_BASE } from '../../src/types.js'

function md(base?: string) {
  const m = new MarkdownIt({ html: true })
  applyEmoji(m, base)
  return m
}

const p = (src: string) => md().renderInline(src)

describe('replaceEmoji direct unit seam', () => {
  it('keeps Unicode replacements in the surrounding text fragment', () => {
    expect(replaceEmoji('probe :smile: tail', '/assets/')).toEqual(['probe 😄 tail'])
  })

  it('splits custom markup into alternating text and raw fragments', () => {
    expect(replaceEmoji('probe :shipit: tail', '/assets/')).toEqual([
      'probe ',
      '<img class="emoji" title=":shipit:" alt=":shipit:" ' +
        'src="/assets/shipit.png" height="20" width="20" align="absmiddle">',
      ' tail',
    ])
  })

  it('latches after an unknown candidate before replacing the next known one', () => {
    expect(replaceEmoji('probe :not_an_emoji::smile:', '/assets/')).toEqual([
      'probe :not_an_emoji:😄',
    ])
  })
})

describe('emoji', () => {
  it('replaces a standard shortcode with the literal character', () => {
    expect(p(':smile:')).toBe('😄')
    expect(p(':+1: :-1: :8ball: :e-mail:')).toBe('👍 👎 🎱 📧')
  })

  it('reproduces the g-emoji wrapper GitHub still emits for 29 shortcodes', () => {
    expect(p(':warning:')).toBe('<g-emoji class="g-emoji" alias="warning">⚠️</g-emoji>')
    expect(p(':man_pilot:')).toBe('👨‍<g-emoji class="g-emoji" alias="airplane">✈️</g-emoji>')
  })

  it('keeps the ZWJ and variation selectors the PNG filename drops', () => {
    expect([...p(':man_technologist:')].map((c) => c.codePointAt(0)!.toString(16))).toEqual([
      '1f468',
      '200d',
      '1f4bb',
    ])
    expect(p(':jp:')).toBe('🇯🇵')
  })

  // The default base is GitHub's own CDN, not a relative `emoji/` directory: readit's
  // central claim is byte-equality with GitHub's blob view, and GitHub serves every one
  // of the 23 custom shortcodes from this absolute host. A relative default rendered as
  // a BROKEN IMAGE for every consumer that did not happen to copy data/emoji/ next to
  // its own bundle, which is every consumer that only ever calls render().
  it('emits GitHub\'s CDN URL for custom emoji', () => {
    expect(p(':shipit:')).toBe(
      '<img class="emoji" title=":shipit:" alt=":shipit:" ' +
        'src="https://github.githubassets.com/images/icons/emoji/shipit.png" ' +
        'height="20" width="20" align="absmiddle">',
    )
    expect(p(':octocat:')).toContain(
      'src="https://github.githubassets.com/images/icons/emoji/octocat.png"',
    )
  })

  // The registration-time seam, for a caller composing applyEmoji into its own MarkdownIt.
  // env.readit.emojiBase (next test) takes precedence when present, and is the seam a
  // render() caller actually has; this one is what an env-less call falls back to.
  it('still honours an explicit base for a host serving the bundled PNGs', () => {
    expect(md('/assets/').renderInline(':octocat:')).toContain('src="/assets/octocat.png"')
    expect(md('emoji/').renderInline(':shipit:')).toContain('src="emoji/shipit.png"')
  })

  // The registration-time seam above is only reachable by a caller that builds its
  // own MarkdownIt. `render()` builds the engine itself, so without this the CDN
  // default would be unoverridable from outside the package — which is exactly the
  // regression this pair of tests exists to prevent. See RenderOptions.emojiBase for
  // the SPEC §6 rule 10 conflict that makes an offline escape load-bearing.
  it('lets a host override the base through render(), not just through the rule', () => {
    expect(render(':shipit:\n')).toContain(`src="${GITHUB_EMOJI_BASE}shipit.png"`)

    const offline = render(':shipit:\n', { emojiBase: '/assets/emoji/' })
    expect(offline).toContain('src="/assets/emoji/shipit.png"')
    expect(offline).not.toContain('githubassets.com')
  })

  it('leaves unicode emoji alone when the base is overridden — only the 23 customs carry it', () => {
    const offline = render(':smile: :shipit:\n', { emojiBase: '/assets/emoji/' })
    expect(offline).toContain('😄')
    expect(offline).not.toContain('/assets/emoji/smile.png')
    expect(offline).toContain('/assets/emoji/shipit.png')
  })

  it('leaves unknown shortcodes as literal text', () => {
    expect(p(':notarealemoji:')).toBe(':notarealemoji:')
    expect(p(':SMILE:')).toBe(':SMILE:')
    expect(p(':sm ile:')).toBe(':sm ile:')
    expect(p(':smile')).toBe(':smile')
  })

  // Boundary rule measured against POST /markdown on 2026-08-06.
  it('requires start-of-run or ASCII whitespace before the first shortcode', () => {
    expect(p('x :smile:')).toBe('x 😄')
    for (const before of ['a', '1', '(', ')', '-', '_', '.', ',', '/', '|', '#', ':', '中']) {
      expect(p(`${before}:smile:`)).toBe(`${before}:smile:`)
    }
    expect(p('x :smile:')).toBe('x :smile:')
  })

  it('drops the boundary requirement for the rest of the run once one candidate fired', () => {
    expect(p(':smile:-:smile:')).toBe('😄-😄')
    expect(p(':smile:a:smile:')).toBe('😄a😄')
    expect(p(':smile:::smile:')).toBe('😄:😄')
    expect(p(':not_an_emoji::smile:')).toBe(':not_an_emoji:😄')
    expect(p('q:smile:-:smile:')).toBe('q:smile:-:smile:')
    expect(p('-:smile: -:smile:')).toBe('-:smile: -:smile:')
  })

  it('never touches code spans, link targets or raw HTML attributes', () => {
    expect(p('`:smile:`')).toBe('<code>:smile:</code>')
    expect(p('[t](http://x/:smile:)')).toBe('<a href="http://x/:smile:">t</a>')
    expect(p('<b title=":smile:">y</b>')).toBe('<b title=":smile:">y</b>')
  })

  it('treats an emphasis boundary as a new run, like GitHub', () => {
    expect(p('**:smile:**')).toBe('<strong>😄</strong>')
  })

  it('fires on a backslash-escaped colon because it runs after text_join', () => {
    expect(p('\\:smile:')).toBe('😄')
  })

  it('emits readit_raw, not html_inline, so the sanitizer never sees its classes', () => {
    const m = md()
    const kinds = m
      .parseInline(':shipit: :warning: x', {})[0]!
      .children!.map((t) => t.type)
    expect(kinds).toContain('readit_raw')
    expect(kinds).not.toContain('html_inline')
  })
})
