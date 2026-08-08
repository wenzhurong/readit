import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyAlerts } from '../src/rules/alerts.js'
import { applyHeadingAnchors, OCTICON_LINK } from '../src/rules/heading.js'
import { applyCodeBlock } from '../src/rules/codeblock.js'
import { applyEmoji } from '../src/rules/emoji.js'
import { applyRawHtmlPolicy, sanitizeUserHtml } from '../src/sanitize.js'
import { render } from '../src/index.js'

function md(allowDangerousHtml: boolean) {
  const m = new MarkdownIt({ html: true })
  applyAlerts(m)
  applyRawHtmlPolicy(m, allowDangerousHtml)
  return m
}

describe('sanitize', () => {
  it('strips class and style from user HTML, exactly like GitHub', () => {
    expect(sanitizeUserHtml('<b class="x" style="color:red" id="foo">bold</b>')).toBe(
      '<b id="user-content-foo">bold</b>',
    )
  })

  it('drops event handlers and javascript: URLs', () => {
    expect(sanitizeUserHtml('<span onclick="alert(1)">x</span>')).toBe('<span>x</span>')
    expect(sanitizeUserHtml('<a href="javascript:alert(1)">j</a>')).toBe('<a>j</a>')
  })

  it('rejects data: in src but keeps relative URLs, straight from defaultSchema', () => {
    expect(sanitizeUserHtml('<img src="data:image/png;base64,AAA" alt="d">')).toBe(
      '<img alt="d">',
    )
    expect(sanitizeUserHtml('<img src="./rel.png" alt="r">')).toBe(
      '<img src="./rel.png" alt="r">',
    )
  })

  it('keeps the GFM value-level class allowances defaultSchema already ships', () => {
    expect(sanitizeUserHtml('<code class="language-js">x</code>')).toBe(
      '<code class="language-js">x</code>',
    )
    expect(sanitizeUserHtml('<li class="task-list-item">x</li>')).toBe(
      '<li class="task-list-item">x</li>',
    )
  })

  it('prefixes id and a[name] without double-prefixing an already prefixed value', () => {
    expect(sanitizeUserHtml('<a name="anchor">n</a>')).toBe('<a name="user-content-anchor">n</a>')
    expect(sanitizeUserHtml('<p id="user-content-already">z</p>')).toBe(
      '<p id="user-content-already">z</p>',
    )
  })

  it('removes elements outside the whitelist', () => {
    expect(sanitizeUserHtml('<script>alert(1)</script>')).toBe('')
    expect(sanitizeUserHtml('<kbd>R</kbd>')).toBe('<kbd>R</kbd>')
  })

  // Declared deviation: defaultSchema has no `video`, GitHub's whitelist does.
  it('KNOWN DEVIATION D-VIDEO: defaultSchema drops <video>, GitHub keeps it', () => {
    expect(sanitizeUserHtml('<video src="x.mp4" controls></video>')).toBe('')
  })

  it('sanitizes raw HTML by default and only prefixes ids under allowDangerousHtml', () => {
    const src = '<b class="x" id="i" onclick="y()">bold</b>\n'
    expect(md(false).render(src)).toBe('<p><b id="user-content-i">bold</b></p>\n')
    expect(md(true).render(src)).toBe(
      '<p><b class="x" id="user-content-i" onclick="y()">bold</b></p>\n',
    )
  })

  /**
   * NOTE: `md()` above builds a bare MarkdownIt with only `applyAlerts` and
   * `applyRawHtmlPolicy` — the sanitizer in ISOLATION, which is what this file
   * tests. Since Task 35 the expected bytes below are deliberately NOT what
   * `render()` produces and NOT what GitHub produces: the full engine also
   * loads `applyRawShape`, which decorates this image into
   * `<p dir="auto"><a target="_blank" rel="noopener noreferrer nofollow" …>
   * <img … style="max-width: 100%;"></a></p>` (see test/rules/rawshape.test.ts).
   * Do not "fix" this expectation toward the oracle — that would stop testing
   * the sanitizer and start testing the pipeline.
   */
  it('renders a raw-HTML <img> as an image, not as escaped literal text', () => {
    expect(md(false).render('<img src="http://x/y.png" alt="z">\n')).toBe(
      '<img src="http://x/y.png" alt="z">\n',
    )
  })

  it('never touches readit-generated markup, whose classes GitHub would strip', () => {
    const out = md(false).render('> [!NOTE]\n> body\n')
    expect(out).toContain('<div class="markdown-alert markdown-alert-note" dir="auto">')
    expect(out).toContain('class="octicon octicon-info mr-2"')
  })

  it('keeps an html_block open/close pair balanced', () => {
    expect(md(false).render('<div id="a" class="drop">\n\npara\n\n</div>\n')).toBe(
      '<div id="user-content-a">\n<p>para</p>\n</div>\n',
    )
  })

  // The remaining tests target the exact trap this task warns about: a single
  // sanitize pass over the whole tree would strip `class` from readit's own
  // generated markup too. Each rule below emits its markup outside the
  // html_block/html_inline token types the raw-HTML walker scans (string
  // building via `renderer.rules.*`, or a `readit_raw` token), so combining it
  // with `applyRawHtmlPolicy(md, false)` must leave its classes untouched.
  it('never touches a heading wrapper class', () => {
    const m = new MarkdownIt({ html: true })
    applyHeadingAnchors(m)
    applyRawHtmlPolicy(m, false)
    expect(m.render('# Title\n')).toBe(
      '<div class="markdown-heading" dir="auto"><h1 class="heading-element">Title</h1>' +
        '<a id="user-content-title" class="anchor" aria-label="Permalink: Title" href="#title">' +
        OCTICON_LINK +
        '</a></div>\n',
    )
  })

  it('never touches a highlighted code block class', () => {
    const m = new MarkdownIt({ html: true })
    applyCodeBlock(m)
    applyRawHtmlPolicy(m, false)
    expect(m.render('```shell\nnpm install markdown-it\n```\n')).toBe(
      '<div class="highlight highlight-source-shell notranslate position-relative overflow-auto"' +
        ' dir="auto" data-snippet-clipboard-copy-content="npm install markdown-it">' +
        '<pre>npm install markdown-it</pre></div>\n',
    )
  })

  it('never touches an emoji <img class="emoji">, emitted as readit_raw', () => {
    const m = new MarkdownIt({ html: true })
    applyEmoji(m)
    applyRawHtmlPolicy(m, false)
    expect(m.renderInline(':shipit:')).toBe(
      '<img class="emoji" title=":shipit:" alt=":shipit:" src="emoji/shipit.png" ' +
        'height="20" width="20" align="absmiddle">',
    )
  })
})

/**
 * `<template>` is the ONE element in HTML5 whose children hast parks under
 * `.content` instead of `.children`, and the ONE element (of 18 swept in both
 * block and inline position) that makes `transformRawHtmlChunks`'s split fail.
 * `defaultSchema.tagNames` has no `template`, so `hast-util-sanitize` deletes
 * the element together with its content fragment — and the run separator that
 * was sitting inside it goes too. The serialised tree then has fewer parts
 * than there were chunks.
 *
 * Until this suite existed that mismatch **threw**, so `render()` was a
 * partial function on a standard HTML5 element in the DEFAULT (safe) mode —
 * the mode every host uses, and the only mode that runs a sanitizer at all.
 * `allowDangerousHtml: true` never threw, because nothing drops the element
 * there. A crash on ordinary web-component documentation is a denial of
 * service on the host, so the mismatch degrades instead.
 *
 * The sanitizer's degradation is NOT "hand the chunks back unchanged" — that
 * would emit unsanitized author HTML, turning a crash into an XSS hole. It is
 * "sanitize each chunk on its own", i.e. the sanitizer minus the join. Every
 * emitted byte is still `sanitizeTree` output; the only thing lost is the
 * cross-chunk structure the join exists to preserve, which is exactly what
 * failed.
 */
describe('KNOWN LIMITATION: <template> breaks the raw-HTML run split', () => {
  /**
   * Exact bytes, measured 2026-08-08 after the degradation landed. They are
   * NOT what GitHub emits and NOT what the joined pass would have emitted —
   * they are the documented shape of the degraded path, pinned so a future
   * change to it is a visible diff rather than a silent one. The wart to
   * expect in all three: a chunk that was half of a tag pair re-serialises on
   * its own, so `<p>` becomes an empty `<p></p>` and its `</p>` partner
   * vanishes, and the text those tags used to wrap ends up beside them.
   */
  it('block position: renders instead of throwing', () => {
    expect(() => render('<template><p>x</p></template>\n')).not.toThrow()
    expect(render('<template><p>x</p></template>\n')).toBe(
      '<p dir="auto" data-line="0"><p dir="auto"></p>x</p>\n',
    )
  })

  it('markdown-split position: renders instead of throwing, and keeps the markdown', () => {
    expect(() => render('<template>\n\nmd\n\n</template>\n')).not.toThrow()
    expect(render('<template>\n\nmd\n\n</template>\n')).toBe(
      '<p dir="auto" data-line="2">md</p>\n\n',
    )
  })

  it('inline position: renders instead of throwing, and keeps the surrounding text', () => {
    expect(() => render('a <template>b <b>c</b> d</template> e\n')).not.toThrow()
    expect(render('a <template>b <b>c</b> d</template> e\n')).toBe(
      '<p dir="auto" data-line="0">a b <b></b>c d e</p>\n',
    )
  })

  /**
   * The load-bearing assertion of this whole fix. A `<template>` anywhere in
   * the document forces the degraded path for the WHOLE run — every
   * html_block/html_inline token in the document shares one run — so the
   * degraded path has to be at least as safe as the normal one for raw HTML
   * that has nothing to do with `<template>`.
   */
  it('the degraded path still sanitizes: no author HTML escapes', () => {
    const html = render(
      '<template>t</template>\n\n' +
        '<img src="x.png" onerror="alert(1)" class="c" style="color:red">\n\n' +
        '<a href="javascript:alert(2)">j</a>\n\n' +
        '<span onclick="alert(3)">s</span>\n',
    )
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('style="color:red"')
    expect(html).not.toContain('class="c"')
    expect(html).not.toContain('<template>')
  })

  /**
   * Blast radius. Every html_block/html_inline token in the document shares
   * ONE run, so the degraded path is what renders the unrelated `<div>` too.
   * Per-chunk sanitizing keeps it where the author put it, with its id still
   * prefixed — the two rejected fallbacks would have deleted it (drop the run)
   * or moved it to the top of the document (collapse the run into chunk 0).
   */
  it('the degraded path leaves unrelated raw HTML in place, still filtered', () => {
    expect(render('<template>t</template>\n\n<div id="dup">d</div>\n')).toBe(
      '<p dir="auto" data-line="0">t</p>\n<div id="user-content-dup">d</div>\n',
    )
  })

  /**
   * `allowDangerousHtml: true` never took the degraded path — `applyClobber`
   * keeps `<template>` and hast round-trips `.content`, so the split succeeds.
   * Pinned so the fix above cannot quietly change the dangerous mode too.
   */
  it('allowDangerousHtml keeps <template> intact and never degraded', () => {
    expect(render('<template><p>x</p></template>\n', { allowDangerousHtml: true })).toContain(
      '<template><p>x</p></template>',
    )
  })
})
