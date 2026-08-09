import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyStrikethrough } from '../../src/rules/strikethrough.js'
import { applyDirAuto } from '../../src/rules/dirauto.js'

function md() {
  return new MarkdownIt('default', { html: true, linkify: false })
    .use(applyStrikethrough)
    .use(applyDirAuto)
}

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

  it('leaves a single tilde pair alone', () => {
    expect(md().render('~one~\n')).toBe('<p dir="auto">~one~</p>\n')
  })
})
