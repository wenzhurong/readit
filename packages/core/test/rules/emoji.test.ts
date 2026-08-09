import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyEmoji } from '../../src/rules/emoji.js'

function md(base?: string) {
  const m = new MarkdownIt({ html: true })
  applyEmoji(m, base)
  return m
}

const p = (src: string) => md().renderInline(src)

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

  it('emits a bundled local PNG for custom emoji', () => {
    expect(p(':shipit:')).toBe(
      '<img class="emoji" title=":shipit:" alt=":shipit:" src="emoji/shipit.png" ' +
        'height="20" width="20" align="absmiddle">',
    )
    expect(md('/assets/').renderInline(':octocat:')).toContain('src="/assets/octocat.png"')
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
