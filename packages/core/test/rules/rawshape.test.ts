import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { render } from '../../src/index.js'
import { applyRawHtmlPolicy } from '../../src/sanitize.js'
import { OCTICON_LINK } from '../../src/rules/heading.js'
import { applyRawShape } from '../../src/rules/rawshape.js'

/**
 * The rule under test only makes sense downstream of the sanitizer — it writes
 * `class` and `style` into raw-HTML token content, which a later sanitize pass
 * would strip right back off (see the C3(a) exception documented in
 * rawshape.ts). So the harness mirrors `createEngine`'s wiring order:
 * `applyRawHtmlPolicy` first, `applyRawShape` after it.
 *
 * Deliberately NOT the full engine: with `applyDirAuto` / `applyHeadingAnchors`
 * / `applyDecorate` also loaded, a passing assertion would not say which layer
 * produced the bytes. The few cases that genuinely need the whole pipeline
 * (shared slugger, attribute order under the real engine) call `render()`.
 */
function md(allowDangerousHtml = false) {
  const m = new MarkdownIt({ html: true })
  applyRawHtmlPolicy(m, allowDangerousHtml)
  applyRawShape(m)
  return m
}

const ANCHOR_OPEN = (slug: string, label: string): string =>
  `<a id="user-content-${slug}" class="anchor" aria-label="Permalink: ${label}" href="#${slug}">`

describe('applyRawShape', () => {
  describe('dir="auto" (decoration 1)', () => {
    it('adds dir="auto" to a raw <p>, after the author attributes', () => {
      // Oracle bytes, from test/fixtures/real-world/mermaid.html:
      // `<p align="center">` comes back `<p align="center" dir="auto">`.
      expect(md().render('<p align="center">x</p>\n')).toBe(
        '<p align="center" dir="auto">x</p>\n',
      )
    })

    it('adds dir="auto" to raw <ul> and <ol>', () => {
      expect(md().render('<ul><li>x</li></ul>\n')).toBe('<ul dir="auto"><li>x</li></ul>\n')
      expect(md().render('<ol><li>x</li></ol>\n')).toBe('<ol dir="auto"><li>x</li></ol>\n')
    })

    it('skips a list carrying contains-task-list, matching applyDirAuto', () => {
      expect(md().render('<ul class="contains-task-list"><li>x</li></ul>\n')).toBe(
        '<ul class="contains-task-list"><li>x</li></ul>\n',
      )
    })

    it('leaves the tags GitHub never marks alone (blockquote, li, table, hr, br)', () => {
      expect(md().render('<blockquote>q</blockquote>\n')).toBe('<blockquote>q</blockquote>\n')
      expect(md().render('<hr>\n<br>\n')).toBe('<hr>\n<br>\n')
      expect(md().render('<ul><li>x</li></ul>\n')).not.toContain('<li dir=')
    })

    it('marks the <p> parse5 synthesises from an unclosed author <p>', () => {
      // Oracle bytes, from test/fixtures/real-world/mermaid.html: the stray
      // `<p>` on line 9 of that README closes the previous paragraph and opens
      // an empty one, and GitHub marks the empty one too.
      expect(md().render('<p>a\n<p>b\n')).toBe('<p dir="auto">a\n</p><p dir="auto">b\n</p>')
    })
  })

  describe('heading anchors (decoration 2)', () => {
    it('reproduces the github-only/user-content-id oracle byte for byte', () => {
      expect(
        md().render('<h2 id="mine">Hand written id</h2>\n<a name="legacy">legacy anchor</a>\n'),
      ).toBe(
        '<div class="markdown-heading" dir="auto">' +
          '<h2 id="user-content-mine" class="heading-element" dir="auto">Hand written id</h2>' +
          ANCHOR_OPEN('hand-written-id', 'Hand written id') +
          OCTICON_LINK +
          '</a></div>\n' +
          '<a name="user-content-legacy">legacy anchor</a>\n',
      )
    })

    /**
     * The corpus suite structurally cannot catch this: `normalize.ts`'s
     * `sortAttributes` sorts every element's property keys, so `class dir` and
     * `dir class` collapse onto the same normalized bytes. Same reasoning as
     * engine.ts's coupling #2, which pins the markdown-heading case; this is
     * its raw-HTML twin and needs its own direct string assertion.
     */
    it('emits class BEFORE dir on the heading element (unsortable by the corpus suite)', () => {
      expect(md().render('<h3>T</h3>\n')).toContain('<h3 class="heading-element" dir="auto">')
      expect(md().render('<h3>T</h3>\n')).not.toContain('<h3 dir="auto" class="heading-element">')
    })

    it('keeps the author attributes ahead of class and dir', () => {
      // Oracle bytes, from test/fixtures/real-world/mermaid.html:
      // `<h1 align="center">` comes back `<h1 align="center" class="heading-element" dir="auto">`.
      expect(md().render('<h1 align="center">M</h1>\n')).toContain(
        '<h1 align="center" class="heading-element" dir="auto">',
      )
    })

    it('anchors every level h1..h6', () => {
      for (const level of [1, 2, 3, 4, 5, 6]) {
        expect(md().render(`<h${level}>T</h${level}>\n`)).toBe(
          '<div class="markdown-heading" dir="auto">' +
            `<h${level} class="heading-element" dir="auto">T</h${level}>` +
            ANCHOR_OPEN('t', 'T') +
            OCTICON_LINK +
            '</a></div>\n',
        )
      }
    })

    it('derives the slug from the descendant text, ignoring <img> alt', () => {
      // Same rule as headingText() on the markdown side: descendant text, with
      // <img> alt excluded — hence the doubled space where the image sat. The
      // alt itself of course stays on the <img>; it just never reaches the slug.
      const html = md().render('<h2><em>Deep</em> <img src="x.png" alt="ignored"> Text</h2>\n')
      expect(html).toContain('id="user-content-deep--text"')
      expect(html).toContain('aria-label="Permalink: Deep  Text"')
      expect(html).toContain('href="#deep--text"')
      expect(html).toContain('alt="ignored"')
    })

    it('escapes the aria-label rather than injecting markup into it', () => {
      expect(md().render('<h2>a &amp; "b"</h2>\n')).toContain(
        'aria-label="Permalink: a &#x26; &#x22;b&#x22;"',
      )
    })
  })

  describe('image style and synthetic anchor (decoration 3)', () => {
    it('reproduces the github-only/image-raw-html oracle byte for byte', () => {
      expect(md().render('<img src="assets/logo.png" alt="logo" width="120">\n')).toBe(
        '<p dir="auto"><a target="_blank" rel="noopener noreferrer" href="assets/logo.png">' +
          '<img src="assets/logo.png" alt="logo" width="120" style="max-width: 100%;"></a></p>\n',
      )
    })

    it('adds nofollow to the synthetic anchor when the src is external', () => {
      // Oracle bytes, from test/fixtures/real-world/mermaid.html (line 2 of that
      // README, an absolute raw.githubusercontent.com src).
      expect(md().render('<img src="https://cdn.example.com/x.svg">\n')).toBe(
        '<p dir="auto">' +
          '<a target="_blank" rel="noopener noreferrer nofollow" href="https://cdn.example.com/x.svg">' +
          '<img src="https://cdn.example.com/x.svg" style="max-width: 100%;"></a></p>\n',
      )
    })

    it('styles but does not wrap an image already inside an author link', () => {
      // Oracle bytes, from test/fixtures/real-world/mermaid.html line 11:
      // the author's <a> gains nofollow, the <img> gains style, and no
      // synthetic wrapper (hence no target="_blank") appears.
      const html = md().render('<a href="https://example.com">\n<img src="a.png">\n</a>\n')
      expect(html).toBe(
        '<a href="https://example.com" rel="nofollow">\n' +
          '<img src="a.png" style="max-width: 100%;">\n</a>\n',
      )
      expect(html).not.toContain('target="_blank"')
    })

    it('wraps an image nested in a non-link block but does not add a <p>', () => {
      // Oracle bytes, from test/fixtures/real-world/mermaid.html lines 1-3.
      expect(md().render('<p align="center">\n<img src="a.png">\n</p>\n')).toBe(
        '<p align="center" dir="auto">\n' +
          '<a target="_blank" rel="noopener noreferrer" href="a.png">' +
          '<img src="a.png" style="max-width: 100%;"></a>\n</p>\n',
      )
    })

    it('uses the extended style form when the image carries a height attribute', () => {
      // Oracle bytes, from test/fixtures/real-world/mermaid.html: `<img height="150">`
      // comes back `style="max-width: 100%; height: auto; max-height: 150px;"`.
      // Sole instance in the whole fixture set against 46 plain ones — see the
      // unverified variants listed in rawshape.ts.
      expect(md().render('<img src="a.png" height="150">\n')).toContain(
        '<img src="a.png" height="150" style="max-width: 100%; height: auto; max-height: 150px;">',
      )
    })

    it('keeps the plain style form for a width-only image', () => {
      // Three width-only counterexamples in the fixture set (image-raw-html,
      // tauri's crabnebula.svg, sindresorhus-is' header.gif) all get the plain form.
      expect(md().render('<img src="a.png" width="283">\n')).toContain(
        '<img src="a.png" width="283" style="max-width: 100%;">',
      )
    })
  })

  describe('rel="nofollow" on external raw links (decoration 4)', () => {
    it('adds nofollow to an external raw <a>', () => {
      expect(md().render('<a href="https://example.com">x</a>\n')).toBe(
        '<p><a href="https://example.com" rel="nofollow">x</a></p>\n',
      )
    })

    it('does not add nofollow to a github.com or relative raw <a>', () => {
      expect(md().render('<a href="https://github.com/o/r">x</a>\n')).toBe(
        '<p><a href="https://github.com/o/r">x</a></p>\n',
      )
      expect(md().render('<a href="./other.md">x</a>\n')).toBe(
        '<p><a href="./other.md">x</a></p>\n',
      )
    })

    it('does not add nofollow to an <a> without href (a legacy named anchor)', () => {
      expect(md().render('<a name="legacy">t</a>\n')).toBe(
        '<p><a name="user-content-legacy">t</a></p>\n',
      )
    })
  })

  describe('<markdown-accessiblity-table> (decoration 5)', () => {
    it('wraps a raw table, misspelling and all', () => {
      expect(md().render('<table><tr><td>x</td></tr></table>\n')).toBe(
        '<markdown-accessiblity-table><table><tbody><tr><td>x</td></tr></tbody></table>' +
          '</markdown-accessiblity-table>\n',
      )
    })

    it('wraps each table exactly once, never nesting the wrapper', () => {
      const html = md().render('<table><tr><td>a</td></tr></table>\n\n<table><tr><td>b</td></tr></table>\n')
      expect(html.match(/<markdown-accessiblity-table>/g)).toHaveLength(2)
      expect(html).not.toContain('<markdown-accessiblity-table><markdown-accessiblity-table>')
    })
  })

  /**
   * `transformRawHtmlChunks` merges every raw chunk of a document into ONE
   * tree, so "is this element at the root of the merged tree" cannot tell a
   * block chunk from an inline one — both land at the root. Without the
   * chunk-kind gate the inline image below gets its own `<p dir="auto">`,
   * producing `<p>text <p dir="auto">…</p> more</p>`: a `<p>` nested inside a
   * `<p>`, which no browser will even keep nested. The gate is load-bearing.
   */
  describe('the chunk-kind gate', () => {
    it('gives the block-chunk image a <p> and the inline-chunk image none', () => {
      const html = md().render('<img src="block.png">\n\ntext <img src="inline.png"> more\n')
      expect(html).toBe(
        '<p dir="auto"><a target="_blank" rel="noopener noreferrer" href="block.png">' +
          '<img src="block.png" style="max-width: 100%;"></a></p>\n' +
          '<p>text <a target="_blank" rel="noopener noreferrer" href="inline.png">' +
          '<img src="inline.png" style="max-width: 100%;"></a> more</p>\n',
      )
    })

    it('never emits a <p> inside a <p>', () => {
      expect(md().render('text <img src="a.png"> more\n')).not.toMatch(/<p[^>]*>[^<]*<p/)
    })
  })

  describe('allowDangerousHtml: true', () => {
    it('decorates identically to the sanitized path', () => {
      const src = '<h2>T</h2>\n\n<p>x</p>\n\n<table><tr><td>c</td></tr></table>\n'
      expect(md(true).render(src)).toBe(md(false).render(src))
    })

    /**
     * UNMEASURED judgment call. An author `style` only survives to this rule
     * under `allowDangerousHtml: true` — the default path's sanitizer strips it
     * — so GitHub's own pipeline, which always sanitizes, can never be observed
     * in this state and there is no oracle. GitHub's image filter is *believed*
     * to skip images that already carry a style; readit follows that guess.
     */
    it('UNMEASURED: leaves an author style on the image untouched', () => {
      expect(md(true).render('<img src="a.png" style="width: 3px;">\n')).toContain(
        '<img src="a.png" style="width: 3px;">',
      )
    })

    it('still styles an image whose style the sanitizer removed', () => {
      expect(md(false).render('<img src="a.png" style="width: 3px;">\n')).toContain(
        '<img src="a.png" style="max-width: 100%;">',
      )
    })
  })

  describe('slug allocation shared with applyHeadingAnchors', () => {
    /**
     * Before the shared slugger, a raw `<h2>Dup</h2>` and a markdown `## Dup`
     * both produced `id="user-content-dup"` / `href="#dup"` — duplicate ids in
     * one document, a correctness bug rather than a cosmetic one.
     */
    it('never allocates the same slug to a raw and a markdown heading', () => {
      const ids = [...render('<h2>Dup</h2>\n\n## Dup\n').matchAll(/id="(user-content-[^"]*)"/g)].map(
        (m) => m[1],
      )
      expect(ids).toHaveLength(2)
      expect(new Set(ids).size).toBe(2)
    })

    /**
     * KNOWN DEVIATION, pinned rather than papered over. readit allocates in
     * rule order — every markdown heading first (`readit_heading_anchor`), then
     * every raw one (`readit_raw_shape`) — not in document order. GitHub
     * decorates one final HTML tree in document order, so on a collision it
     * would give the bare slug to whichever heading comes FIRST in the source;
     * here the raw `<h2>` is first but gets `dup-1`. No corpus file triggers
     * this, so there is no oracle byte to check it against — only the mechanism
     * is asserted.
     */
    it('KNOWN DEVIATION: allocates markdown-first, not document-order', () => {
      const html = render('<h2>Dup</h2>\n\n## Dup\n')
      const rawHeadingBlock = html.slice(0, html.indexOf('## Dup') === -1 ? html.length : undefined)
      expect(rawHeadingBlock).toContain('href="#dup-1"') // the raw <h2>, which came first
      expect(html.indexOf('href="#dup-1"')).toBeLessThan(html.indexOf('href="#dup"'))
    })
  })

  /**
   * KNOWN LIMITATION. A raw heading split across markdown content arrives as
   * two chunks joined by the internal run sentinel, so the text the slug is
   * derived from is the sentinel, not the markdown between the tags — readit
   * cannot see that content at this stage. The sentinel is stripped out of the
   * label so it never reaches the output; the resulting empty slug is wrong,
   * but it is wrong quietly instead of leaking `readit-raw-html` into a
   * user-visible id.
   */
  it('KNOWN LIMITATION: a heading split across markdown content gets an empty slug', () => {
    const html = md().render('<h2>\n\ntext\n\n</h2>\n')
    // The word "text" is a separate markdown paragraph the rule cannot see, so
    // all that is left to slug is the inter-chunk whitespace: an empty slug and
    // a whitespace-only label. Wrong, but quietly wrong — no internal marker
    // reaches the output.
    expect(html).not.toContain('readit-raw-html')
    expect(html).toContain('<a id="user-content-" class="anchor" aria-label="Permalink: \n" href="#">')
    expect(html).toContain('<p>text</p>')
  })

  it('leaves a document with no raw HTML completely alone', () => {
    expect(md().render('# H\n\npara\n')).toBe('<h1>H</h1>\n<p>para</p>\n')
  })
})
