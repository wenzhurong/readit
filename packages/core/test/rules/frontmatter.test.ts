import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyFrontmatter, renderFrontmatterTable } from '../../src/rules/frontmatter.js'

function md() {
  const m = new MarkdownIt({ html: true })
  applyFrontmatter(m)
  return m
}

/**
 * Byte-for-byte oracle, captured 2026-08-06 from
 * GET /repos/gohugoio/hugoDocs/contents/content/en/getting-started/quick-start.md
 * with `Accept: application/vnd.github.html`.
 */
const HUGO_QUICKSTART_ORACLE =
  '<markdown-accessiblity-table><table>\n' +
  '  <tbody>\n' +
  '  <tr>\n    <th>title</th>\n    <td>Quick start</td>\n  </tr>\n' +
  '  <tr>\n    <th>description</th>\n    <td>Create your first Hugo project.</td>\n  </tr>\n' +
  '  <tr>\n    <th>categories</th>\n    <td><table>\n  <tbody>\n  </tbody>\n</table>\n</td>\n  </tr>\n' +
  '  <tr>\n    <th>keywords</th>\n    <td><table>\n  <tbody>\n  </tbody>\n</table>\n</td>\n  </tr>\n' +
  '  <tr>\n    <th>params</th>\n    <td><table>\n' +
  '  <thead>\n  <tr>\n  <th>minVersion</th>\n  </tr>\n  </thead>\n' +
  '  <tbody>\n  <tr>\n  <td><div dir="auto">v0.158.0</div></td>\n  </tr>\n  </tbody>\n' +
  '</table>\n</td>\n  </tr>\n' +
  '  <tr>\n    <th>weight</th>\n    <td>10</td>\n  </tr>\n' +
  '  <tr>\n    <th>aliases</th>\n    <td><table>\n  <tbody>\n  <tr>\n' +
  '  <td><div dir="auto">/quickstart/</div></td>\n' +
  '  <td><div dir="auto">/overview/quickstart/</div></td>\n' +
  '  </tr>\n  </tbody>\n</table>\n</td>\n  </tr>\n' +
  '  </tbody>\n</table></markdown-accessiblity-table>'

const HUGO_QUICKSTART_YAML = [
  'title: Quick start',
  'description: Create your first Hugo project.',
  'categories: []',
  'keywords: []',
  'params:',
  '  minVersion: v0.158.0',
  'weight: 10',
  'aliases: [/quickstart/,/overview/quickstart/]',
].join('\n')

describe('frontmatter', () => {
  it('reproduces the GitHub blob-view table byte-for-byte', () => {
    expect(renderFrontmatterTable(HUGO_QUICKSTART_YAML)).toBe(HUGO_QUICKSTART_ORACLE)
  })

  it('nests object-in-object and array-in-object like the oracle', () => {
    // From GET /repos/gohugoio/hugoDocs/contents/content/en/functions/collections/Apply.md
    const yaml = [
      'params:',
      '  functions_and_methods:',
      '    aliases: [apply]',
      "    returnType: '[]any'",
      '    signatures: [collections.Apply SLICE FUNCTION PARAM...]',
    ].join('\n')
    expect(renderFrontmatterTable(yaml)).toBe(
      '<markdown-accessiblity-table><table>\n  <tbody>\n' +
        '  <tr>\n    <th>params</th>\n    <td><table>\n' +
        '  <thead>\n  <tr>\n  <th>functions_and_methods</th>\n  </tr>\n  </thead>\n' +
        '  <tbody>\n  <tr>\n  <td><div dir="auto"><table>\n' +
        '  <thead>\n  <tr>\n  <th>aliases</th>\n  <th>returnType</th>\n  <th>signatures</th>\n  </tr>\n  </thead>\n' +
        '  <tbody>\n  <tr>\n' +
        '  <td><div dir="auto"><table>\n  <tbody>\n  <tr>\n  <td><div dir="auto">apply</div></td>\n  </tr>\n  </tbody>\n</table>\n</div></td>\n' +
        '  <td><div dir="auto">[]any</div></td>\n' +
        '  <td><div dir="auto"><table>\n  <tbody>\n  <tr>\n  <td><div dir="auto">collections.Apply SLICE FUNCTION PARAM...</div></td>\n  </tr>\n  </tbody>\n</table>\n</div></td>\n' +
        '  </tr>\n  </tbody>\n</table>\n</div></td>\n' +
        '  </tr>\n  </tbody>\n</table>\n</td>\n  </tr>\n' +
        '  </tbody>\n</table></markdown-accessiblity-table>',
    )
  })

  it('escapes &, < and > in keys and scalar values but leaves quotes alone', () => {
    expect(renderFrontmatterTable('a<b: "x & <y> \'q\'"')).toBe(
      '<markdown-accessiblity-table><table>\n  <tbody>\n' +
        '  <tr>\n    <th>a&lt;b</th>\n    <td>x &amp; &lt;y&gt; \'q\'</td>\n  </tr>\n' +
        '  </tbody>\n</table></markdown-accessiblity-table>',
    )
  })

  it('is wired as a block rule that only fires on line 0 of the document', () => {
    expect(md().render('---\ntitle: T\n---\n\ntext\n')).toBe(
      '<markdown-accessiblity-table><table>\n  <tbody>\n' +
        '  <tr>\n    <th>title</th>\n    <td>T</td>\n  </tr>\n' +
        '  </tbody>\n</table></markdown-accessiblity-table>\n' +
        '<p>text</p>\n',
    )
  })

  it('does not fire when the fence is not the first line', () => {
    expect(md().render('x\n\n---\ntitle: T\n---\n')).not.toContain('markdown-accessiblity-table')
  })

  it('does not fire inside a blockquote', () => {
    expect(md().render('> ---\n> title: T\n> ---\n')).not.toContain('markdown-accessiblity-table')
  })

  it('leaves malformed YAML to CommonMark instead of consuming it', () => {
    const out = md().render('---\na: [1,\n---\n')
    expect(out).not.toContain('markdown-accessiblity-table')
    expect(out).toContain('<hr>')
  })

  it('renders booleans and nulls as their YAML core-schema text', () => {
    expect(renderFrontmatterTable('draft: true\nempty:')).toBe(
      '<markdown-accessiblity-table><table>\n  <tbody>\n' +
        '  <tr>\n    <th>draft</th>\n    <td>true</td>\n  </tr>\n' +
        '  <tr>\n    <th>empty</th>\n    <td></td>\n  </tr>\n' +
        '  </tbody>\n</table></markdown-accessiblity-table>',
    )
  })
})
