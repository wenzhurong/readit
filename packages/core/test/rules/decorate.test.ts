import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyDecorate } from '../../src/rules/decorate.js'
import { applyEmoji } from '../../src/rules/emoji.js'
import { applyAutolink } from '../../src/rules/autolink.js'

function md() {
  return new MarkdownIt('default', { html: true, linkify: false }).use(applyDecorate)
}

describe('applyDecorate', () => {
  describe('behavior 1: every <img> gets style="max-width: 100%;"', () => {
    it('appends style as the last attribute, after src and alt', () => {
      // Also exercises behavior 3 (bare-image wrap) since that is the only way
      // this image can render — asserted on its own further down.
      expect(md().render('![a](x.png)\n')).toBe(
        '<p><a target="_blank" rel="noopener noreferrer" href="x.png">' +
          '<img src="x.png" alt="a" style="max-width: 100%;"></a></p>\n',
      )
    })

    it('still lands after title when the image has one', () => {
      const html = md().render('![a](x.png "t")\n')
      expect(html).toContain('<img src="x.png" alt="a" title="t" style="max-width: 100%;">')
    })
  })

  describe('behavior 3: a bare image is wrapped in a synthetic anchor', () => {
    it('produces exact GitHub attribute order: target, rel, href', () => {
      expect(md().render('![a](x.png)\n')).toBe(
        '<p><a target="_blank" rel="noopener noreferrer" href="x.png">' +
          '<img src="x.png" alt="a" style="max-width: 100%;"></a></p>\n',
      )
    })

    // Oracle bytes, from test/fixtures/github-only/image-absolute-external.html
    // and .../anchor-image.html: the synthetic wrapper around an *external*
    // image carries `rel="noopener noreferrer nofollow"`, one token longer than
    // the relative case below. Same `isExternal` predicate as behavior 2 — the
    // synthetic href is the image's own src, so an external src makes the
    // synthetic link external too.
    it('adds nofollow to the synthetic anchor when the image src is external', () => {
      expect(md().render('![a](https://img.shields.io/badge/a-b-blue.svg)\n')).toBe(
        '<p><a target="_blank" rel="noopener noreferrer nofollow" ' +
          'href="https://img.shields.io/badge/a-b-blue.svg">' +
          '<img src="https://img.shields.io/badge/a-b-blue.svg" alt="a" ' +
          'style="max-width: 100%;"></a></p>\n',
      )
    })

    // Oracle bytes, from test/fixtures/real-world/sindresorhus-is.html and
    // .../tauri.html: a relative src keeps the two-token rel.
    it('keeps the two-token rel when the image src is relative', () => {
      expect(md().render('![a](header.gif)\n')).toBe(
        '<p><a target="_blank" rel="noopener noreferrer" href="header.gif">' +
          '<img src="header.gif" alt="a" style="max-width: 100%;"></a></p>\n',
      )
    })

    // A github.com src is external-looking but exempt, so it must land on the
    // relative case's two-token rel, not the three-token one.
    it('keeps the two-token rel when the image src is on an exempt GitHub host', () => {
      expect(md().render('![a](https://github.com/o/r/x.png)\n')).toBe(
        '<p><a target="_blank" rel="noopener noreferrer" href="https://github.com/o/r/x.png">' +
          '<img src="https://github.com/o/r/x.png" alt="a" style="max-width: 100%;"></a></p>\n',
      )
    })

    // Measured 2026-08-07: real GitHub wraps ![a]() exactly the same way,
    // href="" and all — this isn't a readit-only quirk of `?? ''`.
    it('wraps even an image with an empty src, matching measured GitHub output', () => {
      expect(md().render('![a]()\n')).toBe(
        '<p><a target="_blank" rel="noopener noreferrer" href="">' +
          '<img src="" alt="a" style="max-width: 100%;"></a></p>\n',
      )
    })
  })

  describe('behavior 4: an image already inside an author link', () => {
    it('keeps the author href, gains rel="nofollow", and gets no target', () => {
      const html = md().render('[![logo](assets/logo.png)](https://example.com)\n')
      expect(html).toBe(
        '<p><a href="https://example.com" rel="nofollow">' +
          '<img src="assets/logo.png" alt="logo" style="max-width: 100%;"></a></p>\n',
      )
      expect(html).not.toContain('target="_blank"')
    })

    it('does not add rel or wrap when the author link is relative (not external)', () => {
      expect(md().render('[![a](x.png)](./other.md)\n')).toBe(
        '<p><a href="./other.md"><img src="x.png" alt="a" style="max-width: 100%;"></a></p>\n',
      )
    })

    it('uses link *depth*, not token adjacency, so text between the link and the image does not fool it', () => {
      // The image is not adjacent to link_open here — a "is previous token
      // link_open" implementation would misdetect this as bare and wrap it.
      expect(md().render('[prefix ![a](x.png) suffix](https://example.com)\n')).toBe(
        '<p><a href="https://example.com" rel="nofollow">prefix ' +
          '<img src="x.png" alt="a" style="max-width: 100%;"> suffix</a></p>\n',
      )
    })
  })

  describe('behavior 2: rel="nofollow" on external links only', () => {
    it('adds nofollow to an external https link', () => {
      expect(md().render('[a](https://example.com)\n')).toBe(
        '<p><a href="https://example.com" rel="nofollow">a</a></p>\n',
      )
    })

    it('does NOT add nofollow to a github.com link', () => {
      expect(md().render('[a](https://github.com/o/r)\n')).toBe(
        '<p><a href="https://github.com/o/r">a</a></p>\n',
      )
    })

    it('does NOT add nofollow to a relative link', () => {
      expect(md().render('[a](./other.md)\n')).toBe('<p><a href="./other.md">a</a></p>\n')
    })

    it('does NOT add nofollow to a www.github.com or gist.github.com link', () => {
      expect(md().render('[a](https://www.github.com/o/r)\n')).toBe(
        '<p><a href="https://www.github.com/o/r">a</a></p>\n',
      )
      expect(md().render('[a](https://gist.github.com/o/r)\n')).toBe(
        '<p><a href="https://gist.github.com/o/r">a</a></p>\n',
      )
    })

    // Oracle bytes, from test/fixtures/real-world/gitignore.html: five links to
    // help.github.com / docs.github.com come back with no `rel` at all. The
    // exemption set is host-based, so these two documentation hosts belong in
    // it alongside github.com / www.github.com / gist.github.com.
    it('does NOT add nofollow to a help.github.com or docs.github.com link', () => {
      expect(md().render('[a](https://help.github.com/articles/ignoring-files)\n')).toBe(
        '<p><a href="https://help.github.com/articles/ignoring-files">a</a></p>\n',
      )
      expect(md().render('[a](https://docs.github.com/en/get-started)\n')).toBe(
        '<p><a href="https://docs.github.com/en/get-started">a</a></p>\n',
      )
    })

    it('does NOT add nofollow to an unparseable href (fail closed, never fail open)', () => {
      expect(md().render('[a](https://)\n')).not.toContain('nofollow')
    })

    // Measured 2026-08-07 via POST /markdown (mode: gfm): [a](//example.com/x)
    // -> rel="nofollow" on real GitHub. A protocol-relative href has no
    // explicit scheme, so it must be normalized before the same host check
    // applies to it.
    it('adds nofollow to a protocol-relative link to a non-GitHub host', () => {
      expect(md().render('[a](//example.com/x)\n')).toBe(
        '<p><a href="//example.com/x" rel="nofollow">a</a></p>\n',
      )
    })

    // Measured same session: [a](//github.com/x) and [a](//www.github.com/x)
    // both come back without rel on real GitHub — the exemption is host-
    // based, not scheme-based, and protocol-relative doesn't escape it.
    it('does NOT add nofollow to a protocol-relative link to github.com or www.github.com', () => {
      expect(md().render('[a](//github.com/o/r)\n')).toBe('<p><a href="//github.com/o/r">a</a></p>\n')
      expect(md().render('[a](//www.github.com/o/r)\n')).toBe(
        '<p><a href="//www.github.com/o/r">a</a></p>\n',
      )
    })

    // Measured same session: [a](//EXAMPLE.com/x) still comes back nofollow —
    // the host check must stay case-insensitive after the protocol-relative
    // normalization, not just for explicit-scheme hrefs.
    it('is case-insensitive for a protocol-relative host', () => {
      expect(md().render('[a](//EXAMPLE.com/x)\n')).toBe(
        '<p><a href="//EXAMPLE.com/x" rel="nofollow">a</a></p>\n',
      )
    })

    // Measured 2026-08-07: [a](mailto:foo@bar.com) comes back WITHOUT rel on
    // real GitHub. SPEC §17.1 rule #15 says nofollow goes on "external links
    // and all autolinks", generalized from http(s) autolinks — that does not
    // hold for mailto. Recorded here so this isn't re-raised from the SPEC
    // prose without a re-measurement.
    it('does NOT add nofollow to an explicit mailto: link (measured: GitHub does not nofollow mailto)', () => {
      expect(md().render('[a](mailto:foo@bar.com)\n')).toBe(
        '<p><a href="mailto:foo@bar.com">a</a></p>\n',
      )
    })

    // Same measurement, the autolink forms: a bare-email GFM extended
    // autolink and a <mailto:...> CommonMark autolink. Both also came back
    // without rel on real GitHub, so applyAutolink's ordinary link_open
    // tokens correctly fall through isExternal's http(s)-only scheme check
    // with no further special-casing needed.
    it('does NOT add nofollow to a bare-email autolink (mailto, via applyAutolink)', () => {
      const m = new MarkdownIt('default', { html: true, linkify: false })
      applyAutolink(m)
      applyDecorate(m)
      expect(m.render('foo@bar.com\n')).toBe(
        '<p><a href="mailto:foo@bar.com">foo@bar.com</a></p>\n',
      )
    })
  })

  describe('emoji exemption (readit_raw tokens, not markdown-it image tokens)', () => {
    it('leaves a custom-emoji <img> undecorated while decorating a real image beside it', () => {
      const m = new MarkdownIt('default', { html: true, linkify: false })
      applyEmoji(m)
      applyDecorate(m)
      const html = m.render(':shipit: ![a](x.png)\n')
      expect(html).toBe(
        '<p><img class="emoji" title=":shipit:" alt=":shipit:" src="emoji/shipit.png" ' +
          'height="20" width="20" align="absmiddle"> ' +
          '<a target="_blank" rel="noopener noreferrer" href="x.png">' +
          '<img src="x.png" alt="a" style="max-width: 100%;"></a></p>\n',
      )
    })

    it('leaves a plain-unicode emoji untouched (no style, no wrap — it never was an <img>)', () => {
      const m = new MarkdownIt('default', { html: true, linkify: false })
      applyEmoji(m)
      applyDecorate(m)
      expect(m.render(':smile: ![a](x.png)\n')).toBe(
        '<p>😄 <a target="_blank" rel="noopener noreferrer" href="x.png">' +
          '<img src="x.png" alt="a" style="max-width: 100%;"></a></p>\n',
      )
    })
  })
  /**
   * Ordering coupling with `applyAutolink`, recorded as engine.ts coupling #5.
   *
   * `applyAutolink` synthesises the `link_open` for a GFM extended autolink in
   * a `core.ruler.push`ed rule; this rule decorates `link_open` tokens in
   * another one. Push order is execution order, so registering this rule first
   * means the autolink's tokens do not exist yet and rule 2 never fires on
   * them. `createEngine` gets the order right only because SEMANTIC loads
   * before SHAPE — nothing declares it — so it is pinned here directly, by
   * building both orders rather than by asserting the canonical output alone.
   *
   * The second assertion in each case is the point: the markdown link on the
   * same line keeps `rel="nofollow"` under BOTH orders, because its
   * `link_open` comes from the built-in `inline` rule, which runs before every
   * pushed core rule. A test written with markdown links can therefore never
   * detect this coupling.
   */
  describe('ordering coupling: applyAutolink must be registered first', () => {
    const SRC = 'www.example.com and [md](http://other.com)\n'
    const engine = (first: typeof applyDecorate, second: typeof applyDecorate) => {
      const m = new MarkdownIt('default', { html: true, linkify: false })
      first(m)
      second(m)
      return m.render(SRC)
    }

    it('canonical order decorates the extended autolink', () => {
      const html = engine(applyAutolink, applyDecorate)
      expect(html).toContain('<a href="http://www.example.com" rel="nofollow">www.example.com</a>')
      expect(html).toContain('<a href="http://other.com" rel="nofollow">md</a>')
    })

    it('permuted order silently drops nofollow from the extended autolink only', () => {
      const html = engine(applyDecorate, applyAutolink)
      expect(html).toContain('<a href="http://www.example.com">www.example.com</a>')
      expect(html).not.toContain('<a href="http://www.example.com" rel="nofollow">')
      // Unchanged: the markdown link is immune, which is exactly why this
      // coupling went undocumented.
      expect(html).toContain('<a href="http://other.com" rel="nofollow">md</a>')
    })
  })
})
