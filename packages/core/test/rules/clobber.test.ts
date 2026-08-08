import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import GithubSlugger from 'github-slugger'
import {
  applyClobber,
  prefixUserContent,
  transformRawHtmlChunks,
  type ChunkKind,
} from '../../src/rules/clobber.js'
import { decorateRawTree } from '../../src/rules/rawshape.js'

function md() {
  const m = new MarkdownIt({ html: true })
  applyClobber(m)
  return m
}

describe('clobber', () => {
  it('prefixes id on any element', () => {
    expect(prefixUserContent('<b id="foo">x</b>')).toBe('<b id="user-content-foo">x</b>')
    expect(prefixUserContent('<div id="dup"><span id="s">x</span></div>')).toBe(
      '<div id="user-content-dup"><span id="user-content-s">x</span></div>',
    )
  })

  it('prefixes name on anchors only', () => {
    expect(prefixUserContent('<a name="anchor">n</a>')).toBe(
      '<a name="user-content-anchor">n</a>',
    )
    expect(prefixUserContent('<input name="q">')).toBe('<input name="q">')
  })

  it('leaves href fragments alone, matching GitHub', () => {
    expect(prefixUserContent('<a href="#foo" id="bar">l</a>')).toBe(
      '<a href="#foo" id="user-content-bar">l</a>',
    )
  })

  it('is idempotent, unlike hast-util-sanitize clobberPrefix', () => {
    expect(prefixUserContent('<p id="user-content-already">z</p>')).toBe(
      '<p id="user-content-already">z</p>',
    )
    expect(prefixUserContent(prefixUserContent('<p id="a">z</p>'))).toBe(
      '<p id="user-content-a">z</p>',
    )
  })

  it('keeps an open/close html_block pair balanced across the run', () => {
    expect(transformRawHtmlChunks(['<div id="a">\n', '</div>\n'], (t) => t)).toEqual([
      '<div id="a">\n',
      '</div>\n',
    ])
  })

  it('rewrites raw HTML blocks and inline HTML through markdown-it', () => {
    expect(md().render('<div id="a">\n\npara\n\n</div>\n')).toBe(
      '<div id="user-content-a">\n<p>para</p>\n</div>\n',
    )
    expect(md().render('text <span id="s">x</span>\n')).toBe(
      '<p>text <span id="user-content-s">x</span></p>\n',
    )
  })

  it('does not touch readit-generated markup, only raw HTML tokens', () => {
    expect(md().render('# H\n\n- [ ] t\n')).toBe(
      '<h1>H</h1>\n<ul>\n<li>[ ] t</li>\n</ul>\n',
    )
  })

  // Pinned known limitation, measured 2026-08-06: the HTML parser foster-parents
  // the run separator out of a `<table>`, so a raw `<table>` split across
  // markdown content moves its opening tag into the next chunk.
  it('KNOWN LIMITATION: a raw table split across markdown content is re-ordered', () => {
    expect(transformRawHtmlChunks(['<table>\n', '</table>\n'], (t) => t)).toEqual([
      '\n',
      '<table></table>\n',
    ])
  })

  /**
   * The same limitation, one notch worse under a transform that actually
   * changes the tree. `applyRawShape` wraps every `<table>` in
   * `<markdown-accessiblity-table>`, and because foster-parenting has already
   * collapsed the split table into a single element sitting in the SECOND
   * chunk, the wrapper lands there too — both tags end up on the wrong side of
   * the markdown content the author put between them.
   *
   * Asserted with the real transform rather than the identity one above:
   * the identity assertion cannot fail no matter how the transform behaves, so
   * on its own it would let this degradation drift in unnoticed. The output is
   * still well-formed, just relocated.
   */
  it('KNOWN LIMITATION: the table wrapper lands in the re-ordered chunk too', () => {
    const kinds: ChunkKind[] = ['block', 'block']
    expect(
      transformRawHtmlChunks(
        ['<table>\n', '</table>\n'],
        (tree, chunkKinds) => decorateRawTree(tree, new GithubSlugger(), chunkKinds),
        kinds,
      ),
    ).toEqual(['\n', '<markdown-accessiblity-table><table></table></markdown-accessiblity-table>\n'])
  })

  // The same transform over a non-table split pair keeps both tags where the
  // author put them — the re-ordering above really is specific to `<table>`.
  it('keeps a split <div> in place under the same transform', () => {
    const kinds: ChunkKind[] = ['block', 'block']
    expect(
      transformRawHtmlChunks(
        ['<div id="a">\n', '</div>\n'],
        (tree, chunkKinds) => decorateRawTree(tree, new GithubSlugger(), chunkKinds),
        kinds,
      ),
    ).toEqual(['<div id="a">\n', '</div>\n'])
  })
})
