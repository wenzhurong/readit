import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyAutolink } from '../../src/rules/autolink.js'
import examples from '../fixtures/gfm-autolink.json' with { type: 'json' }

function mk() {
  const md = new MarkdownIt({ html: true, linkify: false })
  applyAutolink(md)
  return md
}

describe('gfm extended autolink: email', () => {
  it('linkifies a bare email address with a mailto: scheme', () => {
    expect(mk().render('foo@bar.baz\n')).toBe(
      '<p><a href="mailto:foo@bar.baz">foo@bar.baz</a></p>\n',
    )
  })

  it('allows + before the @ but not after', () => {
    expect(
      mk().render("hello@mail+xyz.example isn't valid, but hello+xyz@mail.example is.\n"),
    ).toBe(
      "<p>hello@mail+xyz.example isn't valid, but " +
        '<a href="mailto:hello+xyz@mail.example">hello+xyz@mail.example</a> is.</p>\n',
    )
  })

  it('requires a domain-separator . to be immediately followed by an alnum', () => {
    // 2026-08-07 GitHub POST /markdown (measured while drafting this task):
    //   "a@b.-c.com" -> <p>a@b.-c.com</p>  (no link at all)
    // cmark-gfm's domain scan (extensions/autolink.c postprocess_text) only
    // counts a '.' toward "has a dot" (and keeps scanning) when the very next
    // byte is alnum; otherwise it breaks out of the domain scan right there,
    // same as hitting any other disallowed character. A draft of this rule
    // counted every non-trailing '.' regardless of what followed, which wrongly
    // accepted "b.-c.com" as a domain. Fixed to match cmark's behavior.
    expect(mk().render('a@b.-c.com\n')).toBe('<p>a@b.-c.com</p>\n')
  })

  it('drops a trailing . but rejects a trailing - or _', () => {
    expect(mk().render('a.b-c_d@a.b\n\na.b-c_d@a.b.\n\na.b-c_d@a.b-\n\na.b-c_d@a.b_\n')).toBe(
      '<p><a href="mailto:a.b-c_d@a.b">a.b-c_d@a.b</a></p>\n' +
        '<p><a href="mailto:a.b-c_d@a.b">a.b-c_d@a.b</a>.</p>\n' +
        '<p>a.b-c_d@a.b-</p>\n' +
        '<p>a.b-c_d@a.b_</p>\n',
    )
  })

  it('drops a mid-sentence trailing . that is not the end of the text', () => {
    // NOTE: despite matchEmail calling the shared autolinkDelim (same as
    // matchWww/matchUrl), this case — like the paragraph-final "a.b-c_d@a.b."
    // case above — is decided entirely by matchEmail's own domain-scan
    // boundary check, not by autolinkDelim: a '.' only counts toward the
    // domain (np++) when the *next* byte is alnum, so a '.' followed by a
    // space (or by end of string) makes the scan break one byte early and
    // never hands that '.' to autolinkDelim in the first place. Verified by
    // mutation: deleting the `autolinkDelim(src, at, at + linkEnd)` call from
    // matchEmail and returning `at + linkEnd` directly leaves every assertion
    // in this file green — see task-11-report.md for the full analysis of why
    // that call is currently unreachable-effect dead code in matchEmail.
    // 2026-08-07 GitHub POST /markdown: "email me at foo@bar.baz. Thanks!" ->
    //   <p>email me at <a href="mailto:foo@bar.baz">foo@bar.baz</a>. Thanks!</p>
    expect(mk().render('email me at foo@bar.baz. Thanks!\n')).toBe(
      '<p>email me at <a href="mailto:foo@bar.baz">foo@bar.baz</a>. Thanks!</p>\n',
    )
  })

  it('rejects a local part that contains a second @, then retries after it', () => {
    expect(mk().render('a@b.c@d.e\n')).toBe(
      '<p>a@<a href="mailto:b.c@d.e">b.c@d.e</a></p>\n',
    )
  })

  it('does not separately mailto-ify an @ already consumed by a matched URL', () => {
    // This is fully explained by matchUrl running first in findAutolinks and
    // claiming the whole "http://x.com/foo@bar.baz" span (scanAndDelimit
    // doesn't stop at '@') before matchEmail ever gets a turn at 'foo'. It is
    // NOT evidence of a "preceded by /" rejection rule inside matchEmail
    // itself — see the next test.
    expect(mk().render('see http://x.com/foo@bar.baz here\n')).toBe(
      '<p>see <a href="http://x.com/foo@bar.baz">http://x.com/foo@bar.baz</a> here</p>\n',
    )
  })

  it('still links an email whose local part is preceded by a bare /', () => {
    // 2026-08-07 GitHub POST /markdown (measured while drafting this task):
    //   "x.com/foo@bar.baz"  -> <p>x.com/<a href="mailto:foo@bar.baz">foo@bar.baz</a></p>
    //   "a/b@c.d"            -> <p>a/<a href="mailto:b@c.d">b@c.d</a></p>
    // cmark-gfm's real rewind loop (extensions/autolink.c postprocess_text)
    // only refuses a match when rewind==0 (no local-part char at all before
    // '@'); a '/' further back just stops the rewind, it doesn't invalidate
    // what was already collected. An earlier draft of this rule rejected
    // whenever src[pos-1] === '/', which is over-restrictive and would wrongly
    // suppress both of these — that check was deliberately NOT carried into
    // the shipped implementation. See task-11-report.md for the full story.
    expect(mk().render('x.com/foo@bar.baz\n')).toBe(
      '<p>x.com/<a href="mailto:foo@bar.baz">foo@bar.baz</a></p>\n',
    )
    expect(mk().render('a/b@c.d\n')).toBe('<p>a/<a href="mailto:b@c.d">b@c.d</a></p>\n')
  })
})

describe('gfm spec 0.29 section 6.9 "Autolinks (extension)"', () => {
  it('has all 11 examples in the fixture', () => {
    expect(examples).toHaveLength(11)
  })

  for (const [i, ex] of examples.entries()) {
    it(`example ${i + 1}: ${JSON.stringify(ex.markdown.split('\n')[0]).slice(0, 60)}`, () => {
      expect(mk().render(ex.markdown)).toBe(ex.html)
    })
  }
})
