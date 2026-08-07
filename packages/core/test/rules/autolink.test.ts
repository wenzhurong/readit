import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyAutolink } from '../../src/rules/autolink.js'

function mk() {
  const md = new MarkdownIt({ html: true, linkify: false })
  applyAutolink(md)
  return md
}

describe('gfm extended autolink: www and url', () => {
  it('linkifies a bare www. host and inserts the http scheme', () => {
    expect(mk().render('www.commonmark.org\n')).toBe(
      '<p><a href="http://www.commonmark.org">www.commonmark.org</a></p>\n',
    )
  })

  it('strips trailing punctuation but keeps interior dots', () => {
    expect(mk().render('Visit www.commonmark.org.\n\nVisit www.commonmark.org/a.b.\n')).toBe(
      '<p>Visit <a href="http://www.commonmark.org">www.commonmark.org</a>.</p>\n' +
        '<p>Visit <a href="http://www.commonmark.org/a.b">www.commonmark.org/a.b</a>.</p>\n',
    )
  })

  it('balances parentheses only when the link ends in )', () => {
    expect(mk().render('(www.google.com/search?q=Markup+(business)\n')).toBe(
      '<p>(<a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a></p>\n',
    )
    expect(mk().render('www.google.com/search?q=Markup+(business)))\n')).toBe(
      '<p><a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a>))</p>\n',
    )
    expect(mk().render('www.google.com/search?q=(business))+ok\n')).toBe(
      '<p><a href="http://www.google.com/search?q=(business))+ok">www.google.com/search?q=(business))+ok</a></p>\n',
    )
  })

  it('strips a trailing entity-looking &name; but not &name1;', () => {
    expect(mk().render('www.google.com/search?q=commonmark&hl;\n')).toBe(
      '<p><a href="http://www.google.com/search?q=commonmark">www.google.com/search?q=commonmark</a>&amp;hl;</p>\n',
    )
    expect(mk().render('www.x.com/?a=&x1;\n')).toBe(
      '<p><a href="http://www.x.com/?a=&amp;x1">www.x.com/?a=&amp;x1</a>;</p>\n',
    )
  })

  it('rejects underscores in the last two domain segments', () => {
    expect(mk().render('x www.e_f.com y www.g.h_i y2 www.j_k.l.m\n')).toBe(
      '<p>x www.e_f.com y www.g.h_i y2 <a href="http://www.j_k.l.m">www.j_k.l.m</a></p>\n',
    )
  })

  it('requires the preceding character to be start/space/*_~(', () => {
    expect(mk().render('a-www.x.com\n')).toBe('<p>a-www.x.com</p>\n')
    expect(mk().render('(www.x.com)\n')).toBe(
      '<p>(<a href="http://www.x.com">www.x.com</a>)</p>\n',
    )
  })

  it('matches www. case-sensitively but schemes case-insensitively', () => {
    expect(mk().render('WWW.EXAMPLE.COM\n')).toBe('<p>WWW.EXAMPLE.COM</p>\n')
    expect(mk().render('HTTP://EXAMPLE.COM\n')).toBe(
      '<p><a href="HTTP://EXAMPLE.COM">HTTP://EXAMPLE.COM</a></p>\n',
    )
  })

  it('does not autolink inside a markdown link or a raw <a> element', () => {
    expect(mk().render('[www.x.com](http://y.com)\n')).toBe(
      '<p><a href="http://y.com">www.x.com</a></p>\n',
    )
    expect(mk().render('<a href="q">www.foo.com</a>\n')).toBe(
      '<p><a href="q">www.foo.com</a></p>\n',
    )
  })

  it('stops at the first < character', () => {
    expect(mk().render('www.commonmark.org/he<lp\n')).toBe(
      '<p><a href="http://www.commonmark.org/he">www.commonmark.org/he</a>&lt;lp</p>\n',
    )
  })

  // Supplemental coverage: the preceding-character test above only exercises
  // `-` (rejected) and `(` (accepted). It names `*`, `_`, `~` too but never
  // asserts them, and never exercises the same precedingOk() check on the
  // scheme (`http://`) path. Closing that gap here.
  it('accepts *, _ and ~ as preceding characters for www', () => {
    // Unmatched emphasis/strike delimiters fall back to literal text tokens,
    // so `*`/`_`/`~` land immediately before "www" in the same text token —
    // this exercises precedingOk()'s non-zero-offset branch, not just pos===0.
    expect(mk().render('x *www.a.com y\n')).toBe(
      '<p>x *<a href="http://www.a.com">www.a.com</a> y</p>\n',
    )
    expect(mk().render('x _www.b.com y\n')).toBe(
      '<p>x _<a href="http://www.b.com">www.b.com</a> y</p>\n',
    )
    expect(mk().render('x ~www.c.com y\n')).toBe(
      '<p>x ~<a href="http://www.c.com">www.c.com</a> y</p>\n',
    )
  })

  it('applies the same preceding-character rule to the scheme (url) form', () => {
    expect(mk().render('ahttp://example.com\n')).toBe('<p>ahttp://example.com</p>\n')
    expect(mk().render('(http://example.com)\n')).toBe(
      '<p>(<a href="http://example.com">http://example.com</a>)</p>\n',
    )
  })
})
