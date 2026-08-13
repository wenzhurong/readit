import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyDirAuto, DIR_AUTO_TOKENS } from '../../src/rules/dirauto.js'
import { DIR_AUTO_TAGS } from '../../src/rules/rawshape.js'

const TOKEN_TO_TAGS: Readonly<Record<string, readonly string[]>> = {
  paragraph_open: ['p'],
  heading_open: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  bullet_list_open: ['ul'],
  ordered_list_open: ['ol'],
}

function md() {
  return new MarkdownIt('default', { html: true, linkify: false }).use(applyDirAuto)
}

describe('applyDirAuto', () => {
  it('maps every Markdown token in the dir-auto policy', () => {
    expect([...DIR_AUTO_TOKENS].sort()).toEqual(Object.keys(TOKEN_TO_TAGS).sort())
  })

  it('maps every raw HTML tag in the dir-auto policy', () => {
    const mappedTags = new Set(Object.values(TOKEN_TO_TAGS).flat())
    expect([...DIR_AUTO_TAGS].sort()).toEqual([...mappedTags].sort())
  })

  it('puts dir="auto" on paragraphs, headings and lists only', () => {
    expect(md().render('hello\n')).toBe('<p dir="auto">hello</p>\n')
    expect(md().render('## hi\n')).toBe('<h2 dir="auto">hi</h2>\n')
    expect(md().render('- a\n')).toBe(
      '<ul dir="auto">\n<li>a</li>\n</ul>\n',
    )
    expect(md().render('1. a\n')).toBe(
      '<ol dir="auto">\n<li>a</li>\n</ol>\n',
    )
  })

  it('leaves blockquote, hr, pre, table and li without dir', () => {
    expect(md().render('> q\n')).toBe(
      '<blockquote>\n<p dir="auto">q</p>\n</blockquote>\n',
    )
    expect(md().render('---\n')).toBe('<hr>\n')
    expect(md().render('    code\n')).toBe('<pre><code>code\n</code></pre>\n')
    expect(md().render('| a |\n| - |\n| b |\n')).toBe(
      '<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n' +
        '<tbody>\n<tr>\n<td>b</td>\n</tr>\n</tbody>\n</table>\n',
    )
  })

  it('skips a list already carrying contains-task-list', () => {
    const it2 = new MarkdownIt('default', { linkify: false })
    it2.core.ruler.push('fake_tasklist', (state) => {
      for (const t of state.tokens) {
        if (t.type === 'bullet_list_open') t.attrSet('class', 'contains-task-list')
      }
    })
    it2.use(applyDirAuto)
    expect(it2.render('- a\n')).toBe(
      '<ul class="contains-task-list">\n<li>a</li>\n</ul>\n',
    )
  })

  it('does not emit dir on hidden paragraphs of a tight list', () => {
    expect(md().render('- a\n- b\n')).toBe(
      '<ul dir="auto">\n<li>a</li>\n<li>b</li>\n</ul>\n',
    )
  })
})
