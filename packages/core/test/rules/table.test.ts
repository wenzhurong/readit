import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyTableAlign, applyTableWrapper } from '../../src/rules/table.js'
import { applyDirAuto } from '../../src/rules/dirauto.js'

function md() {
  return new MarkdownIt('default', { html: true, linkify: false })
    .use(applyTableAlign)
    .use(applyTableWrapper)
    .use(applyDirAuto)
}

describe('applyTable', () => {
  it('wraps the table in <markdown-accessiblity-table> with GitHub spelling', () => {
    const html = md().render('| a |\n| - |\n| b |\n')
    expect(html).toBe(
      '<markdown-accessiblity-table><table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n' +
        '<tbody>\n<tr>\n<td>b</td>\n</tr>\n</tbody>\n</table></markdown-accessiblity-table>\n',
    )
    expect(html).not.toContain('accessibility')
  })

  it('rewrites style="text-align:*" to align for all three alignments', () => {
    const html = md().render('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |\n')
    expect(html).toBe(
      '<markdown-accessiblity-table><table>\n<thead>\n<tr>\n' +
        '<th align="left">a</th>\n<th align="center">b</th>\n<th align="right">c</th>\n<th>d</th>\n' +
        '</tr>\n</thead>\n<tbody>\n<tr>\n' +
        '<td align="left">1</td>\n<td align="center">2</td>\n<td align="right">3</td>\n<td>4</td>\n' +
        '</tr>\n</tbody>\n</table></markdown-accessiblity-table>\n',
    )
    expect(html).not.toContain('style=')
  })

  it('leaves no dir="auto" on the table or its cells', () => {
    const html = md().render('| a |\n|:-:|\n| b |\n')
    expect(html).not.toContain('dir="auto"')
  })

  it('wraps every table in a document independently', () => {
    const html = md().render('| a |\n| - |\n| b |\n\n| c |\n| - |\n| d |\n')
    expect(html.match(/<markdown-accessiblity-table>/g)).toHaveLength(2)
    expect(html.match(/<\/markdown-accessiblity-table>/g)).toHaveLength(2)
  })

  it('align 属性不依赖外壳规则（SEMANTIC 槽可单独加载）', () => {
    const semanticOnly = new MarkdownIt('default', { html: true, linkify: false }).use(
      applyTableAlign,
    )
    const html = semanticOnly.render('| a |\n|:-:|\n| b |\n')
    expect(html).toContain('align="center"')
    expect(html).not.toContain('markdown-accessiblity-table')
  })
})
