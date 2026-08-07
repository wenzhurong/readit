import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyFootnote } from '../../src/rules/footnote.js'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL('../fixtures/oracle/' + name, import.meta.url)), 'utf8')

function mk() {
  const md = new MarkdownIt({ html: true, linkify: false })
  applyFootnote(md)
  return md
}

describe('github-shaped footnotes', () => {
  it('emits the GitHub section/ol/li shape with unsalted user-content ids', () => {
    const src = 'Here is a note[^1].\n\n[^1]: The first footnote.\n'
    expect(mk().render(src)).toBe(
      '<p>Here is a note<sup><a href="#user-content-fn-1" id="user-content-fnref-1"' +
        ' data-footnote-ref="" aria-describedby="footnote-label">1</a></sup>.</p>\n' +
        '<section data-footnotes="" class="footnotes">' +
        '<h2 id="footnote-label" class="sr-only">Footnotes</h2>\n<ol>\n' +
        '<li id="user-content-fn-1">\n' +
        '<p>The first footnote. <a href="#user-content-fnref-1" data-footnote-backref=""' +
        ' aria-label="Back to reference 1" class="data-footnote-backref">↩</a></p>\n' +
        '</li>\n' +
        '</ol>\n</section>\n',
    )
  })

  it('numbers a second reference to the same note as fnref-<label>-2', () => {
    const src = 'A[^1] B[^1].\n\n[^1]: only.\n'
    const html = mk().render(src)
    expect(html).toContain('id="user-content-fnref-1"')
    expect(html).toContain('id="user-content-fnref-1-2"')
    expect(html).toContain(
      '<a href="#user-content-fnref-1-2" data-footnote-backref=""' +
        ' aria-label="Back to reference 1-2" class="data-footnote-backref">↩<sup>2</sup></a>',
    )
  })

  it('orders the list by first reference, not by definition order', () => {
    const src = 'Ref b[^b] then a[^a].\n\n[^a]: alpha\n[^b]: beta\n'
    const html = mk().render(src)
    expect(html.indexOf('<li id="user-content-fn-b">')).toBeLessThan(
      html.indexOf('<li id="user-content-fn-a">'),
    )
    expect(html).toContain(
      '<sup><a href="#user-content-fn-b" id="user-content-fnref-b" data-footnote-ref=""' +
        ' aria-describedby="footnote-label">1</a></sup>',
    )
    expect(html).toContain(
      '<sup><a href="#user-content-fn-a" id="user-content-fnref-a" data-footnote-ref=""' +
        ' aria-describedby="footnote-label">2</a></sup>',
    )
  })

  it('drops unreferenced definitions and leaves undefined references literal', () => {
    const src = 'Ref b[^b].\n\n[^b]: beta\n[^unused]: never referenced\n\nMissing[^zzz] ref.\n'
    const html = mk().render(src)
    expect(html).not.toContain('never referenced')
    expect(html).not.toContain('user-content-fn-unused')
    expect(html).toContain('<p>Missing[^zzz] ref.</p>')
  })

  it('matches the real GitHub oracle byte for byte once the salt is stripped', () => {
    const oracle = fixture('footnotes.github.html').replace(/-[0-9a-f]{32}/g, '')
    expect(mk().render(fixture('footnotes.md')).trim()).toBe(oracle.trim())
  })

  it('emits no section at all when the document has no footnotes', () => {
    expect(mk().render('plain text\n')).toBe('<p>plain text</p>\n')
  })

  it('attaches the backref to the last paragraph of a multi-paragraph note', () => {
    const src = 'X[^n]\n\n[^n]: The **second** one.\n\n    With a second paragraph.\n'
    expect(mk().render(src)).toBe(
      '<p>X<sup><a href="#user-content-fn-n" id="user-content-fnref-n" data-footnote-ref=""' +
        ' aria-describedby="footnote-label">1</a></sup></p>\n' +
        '<section data-footnotes="" class="footnotes">' +
        '<h2 id="footnote-label" class="sr-only">Footnotes</h2>\n<ol>\n' +
        '<li id="user-content-fn-n">\n' +
        '<p>The <strong>second</strong> one.</p>\n' +
        '<p>With a second paragraph. <a href="#user-content-fnref-n" data-footnote-backref=""' +
        ' aria-label="Back to reference 1" class="data-footnote-backref">↩</a></p>\n' +
        '</li>\n' +
        '</ol>\n</section>\n',
    )
  })

  it('rejects footnote labels containing whitespace, leaving them to ordinary link-reference resolution', () => {
    // GitHub measured behaviour: `[^My Note]` (a label containing a space) is
    // not treated as a footnote at all — it falls through to an ordinary
    // link reference. A matching link reference definition is provided here
    // so the assertion distinguishes "not a footnote" from the separate
    // "undefined reference stays literal" case covered above.
    const src = 'See[^My Note] here.\n\n[^My Note]: https://example.com/notes\n'
    const html = mk().render(src)
    expect(html).not.toContain('data-footnote-ref')
    expect(html).not.toContain('user-content-fn')
    expect(html).toBe('<p>See<a href="https://example.com/notes">^My Note</a> here.</p>\n')
  })
})
