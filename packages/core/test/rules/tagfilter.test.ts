import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyTagfilter, filterDisallowedTags } from '../../src/rules/tagfilter.js'

function mk() {
  const md = new MarkdownIt({ html: true, linkify: false })
  applyTagfilter(md)
  return md
}

describe('gfm tagfilter', () => {
  it('matches the GFM spec 0.29 "Disallowed Raw HTML" example', () => {
    const src =
      '<strong> <title> <style> <em>\n\n' +
      '<blockquote>\n  <xmp> is disallowed.  <XMP> is also disallowed.\n</blockquote>\n'
    expect(mk().render(src)).toBe(
      '<p><strong> &lt;title> &lt;style> <em></p>\n' +
        '<blockquote>\n  &lt;xmp> is disallowed.  &lt;XMP> is also disallowed.\n</blockquote>\n',
    )
  })

  it('filters all nine tags, opening and closing, in any case', () => {
    const tags = [
      'title',
      'textarea',
      'style',
      'xmp',
      'iframe',
      'noembed',
      'noframes',
      'script',
      'plaintext',
    ]
    for (const t of tags) {
      expect(filterDisallowedTags(`<${t}>`)).toBe(`&lt;${t}>`)
      expect(filterDisallowedTags(`</${t}>`)).toBe(`&lt;/${t}>`)
      expect(filterDisallowedTags(`<${t.toUpperCase()} a="b">`)).toBe(
        `&lt;${t.toUpperCase()} a="b">`,
      )
      expect(filterDisallowedTags(`<${t}/>`)).toBe(`&lt;${t}/>`)
    }
  })

  it('leaves every other tag untouched', () => {
    expect(filterDisallowedTags('<div><span><b><a href="x"><svg><math>')).toBe(
      '<div><span><b><a href="x"><svg><math>',
    )
    expect(mk().render('<div>ok</div>\n')).toBe('<div>ok</div>\n')
  })

  it('does not filter a tag name that is merely a prefix match', () => {
    expect(filterDisallowedTags('<titles> <scripting> <styled>')).toBe(
      '<titles> <scripting> <styled>',
    )
  })

  it('does not filter when nothing follows the tag name', () => {
    expect(filterDisallowedTags('<title')).toBe('<title')
  })

  it('does not touch escaped or plain text that only looks like a tag', () => {
    expect(mk().render('`<script>`\n')).toBe('<p><code>&lt;script&gt;</code></p>\n')
    expect(mk().render('\\<script>\n')).toBe('<p>&lt;script&gt;</p>\n')
  })

  it('treats bare whitespace before > as a tag boundary, on both open and close tags', () => {
    expect(filterDisallowedTags('<script >')).toBe('&lt;script >')
    expect(filterDisallowedTags('</script >')).toBe('&lt;/script >')
  })

  it('chains a previously-registered html_block/html_inline renderer instead of replacing it', () => {
    // Stub renderer standing in for some other SEMANTIC rule that already
    // overrides html_block/html_inline and was .use()d before applyTagfilter
    // (this is the scenario cross-rule contract C3(b) exists for). If
    // applyTagfilter did a plain assignment instead of capturing and calling
    // this prior rule, its `[[PREV:...]]` marker would vanish from the
    // output below.
    const md = new MarkdownIt({ html: true, linkify: false })
    md.renderer.rules.html_block = (tokens, idx) => `[[PREV:${tokens[idx]?.content ?? ''}]]`
    md.renderer.rules.html_inline = (tokens, idx) => `[[PREV:${tokens[idx]?.content ?? ''}]]`
    applyTagfilter(md)

    const block = md.render('<script>x</script>\n')
    expect(block).toContain('[[PREV:')
    expect(block).toContain('&lt;script>')

    const inline = md.render('a <script> b\n')
    expect(inline).toContain('[[PREV:')
    expect(inline).toContain('&lt;script>')
  })

  /**
   * KNOWN GAP, the mirror image of the test above and the reason this rule's
   * doc comment no longer claims it must be `.use()`d last.
   *
   * Above, the stub is registered BEFORE `applyTagfilter`, so tagfilter is the
   * outer link and filters the stub's output. Here the stub is registered
   * AFTER — which is what `createEngine` does to every rule, because
   * `applyTagfilter` sits in `SEMANTIC_RULES` and that array runs first. The
   * stub chains correctly per C3(b) (it calls `prev`), yet whatever it appends
   * lands outside the filter and is NOT neutralised.
   *
   * Unreachable today: this rule is the only override of these two renderer
   * rules in the whole engine. Pinned as an executable statement of what a
   * future SHAPE-slot override has to handle itself — if this test ever starts
   * failing because the appended `<script>` came back escaped, the ordering
   * changed and the doc comment above needs rewriting with it.
   */
  it('KNOWN GAP: a later chaining override appends outside the filter', () => {
    const md = new MarkdownIt({ html: true, linkify: false })
    applyTagfilter(md)
    const prev = md.renderer.rules.html_block
    md.renderer.rules.html_block = (...args) =>
      (prev?.(...args) ?? '') + '<script>alert(1)</script>\n'

    expect(md.render('<div>x</div>\n')).toBe('<div>x</div>\n<script>alert(1)</script>\n')
  })
})
