import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyAlerts } from '../src/rules/alerts.js'
import { applyHeadingAnchors, OCTICON_LINK } from '../src/rules/heading.js'
import { applyCodeBlock } from '../src/rules/codeblock.js'
import { applyEmoji } from '../src/rules/emoji.js'
import { applyRawHtmlPolicy, sanitizeUserHtml } from '../src/sanitize.js'

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
