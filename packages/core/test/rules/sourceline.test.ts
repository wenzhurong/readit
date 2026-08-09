import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applySourceLine } from '../../src/rules/sourceline.js'

function md() {
  const m = new MarkdownIt({ html: true })
  applySourceLine(m)
  return m
}

describe('sourceline', () => {
  it('puts data-line on top-level block openers', () => {
    expect(md().render('# H\n\npara\n')).toBe(
      '<h1 data-line="0">H</h1>\n<p data-line="2">para</p>\n',
    )
  })

  it('numbers lines zero-based from token.map[0]', () => {
    expect(md().render('a\n\nb\n\nc\n')).toBe(
      '<p data-line="0">a</p>\n<p data-line="2">b</p>\n<p data-line="4">c</p>\n',
    )
  })

  it('annotates nested block containers too', () => {
    expect(md().render('- one\n- two\n')).toBe(
      '<ul data-line="0">\n' +
        '<li data-line="0">one</li>\n' +
        '<li data-line="1">two</li>\n' +
        '</ul>\n',
    )
  })

  it('annotates hr, blockquote, html_block and tables', () => {
    expect(md().render('---\n')).toBe('<hr data-line="0">\n')
    expect(md().render('> q\n')).toBe(
      '<blockquote data-line="0">\n<p data-line="0">q</p>\n</blockquote>\n',
    )
    expect(md().render('| a |\n|---|\n| 1 |\n')).toBe(
      '<table data-line="0">\n<thead data-line="0">\n<tr data-line="0">\n<th>a</th>\n</tr>\n' +
        '</thead>\n<tbody data-line="2">\n<tr data-line="2">\n<td>1</td>\n</tr>\n</tbody>\n</table>\n',
    )
  })

  it('sets the attribute on fence and code_block tokens for other renderers to read', () => {
    const m = md()
    const fence = m.parse('```js\na\n```\n', {})[0]!
    expect(fence.type).toBe('fence')
    expect(fence.attrGet('data-line')).toBe('0')
    const indented = m.parse('    a\n', {})[0]!
    expect(indented.type).toBe('code_block')
    expect(indented.attrGet('data-line')).toBe('0')
  })

  it('never annotates inline tokens or their children', () => {
    const m = md()
    const tokens = m.parse('a *b* `c`\n', {})
    const inline = tokens.find((t) => t.type === 'inline')!
    expect(inline.attrGet('data-line')).toBeNull()
    for (const child of inline.children!) expect(child.attrGet('data-line')).toBeNull()
  })

  it('never annotates closing tokens or table cells', () => {
    const m = md()
    for (const t of m.parse('| a |\n|---|\n| 1 |\n', {})) {
      if (t.nesting === -1 || t.type === 'th_open' || t.type === 'td_open') {
        expect([t.type, t.attrGet('data-line')]).toEqual([t.type, null])
      }
    }
  })

  it('leaves the map itself untouched so other rules can still read it', () => {
    const m = md()
    expect(m.parse('# H\n', {})[0]!.map).toEqual([0, 1])
  })
})
