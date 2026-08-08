import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyTagfilter, filterDisallowedTags, TAGFILTER_TAGS } from '../../src/rules/tagfilter.js'
import { createEngine, createSpecEngine, SHAPE_RULES, type Rule } from '../../src/engine.js'
import { DEFAULT_OPTIONS } from '../../src/types.js'

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

  /**
   * `applyTagfilter` used to carry a `prev ? prev(...) : tokens[idx].content`
   * arm on both renderer rules. The `else` was dead: markdown-it seeds
   * `Renderer.rules` from its own `default_rules`, and `html_block` /
   * `html_inline` are two of the nine entries there, so `prev` is always a
   * function. This pins the dependency fact the removal rests on — if a future
   * markdown-it stops seeding them, this fails here rather than the engine
   * silently rendering through an untested path.
   */
  it('markdown-it always seeds html_block/html_inline, so there is no "no previous rule" case', () => {
    for (const md of [new MarkdownIt(), new MarkdownIt({ html: true, linkify: false })]) {
      expect(typeof md.renderer.rules.html_block).toBe('function')
      expect(typeof md.renderer.rules.html_inline).toBe('function')
    }
  })

  /**
   * Idempotence is load-bearing twice over: it is what lets `createEngine`
   * register this rule a SECOND time as the outermost renderer link (see the
   * "outermost" suite below), and what lets a future override safely run
   * `filterDisallowedTags` over a whole concatenation. If double-filtering ever
   * double-escaped (`&lt;` -> `&amp;lt;`) both would be wrong.
   *
   * Measured 2026-08-08: 200 000 random strings over a 25-symbol alphabet built
   * from `<`, `</`, `>`, `/`, space, `&lt;`, `&amp;` and the nine tag names,
   * plus every string up to length 5 over an 8-symbol alphabet (37 448 cases).
   * Zero counterexamples. The exhaustive half is reproduced here.
   */
  it('filterDisallowedTags is idempotent (exhaustive to length 4 over a hostile alphabet)', () => {
    const alphabet = ['<', '/', '>', ' ', 'script', 'title', '&lt;', 'x']
    let checked = 0
    const walk = (s: string, depth: number): void => {
      if (depth === 0) {
        const once = filterDisallowedTags(s)
        expect(filterDisallowedTags(once)).toBe(once)
        expect(once).not.toContain('&amp;lt;')
        checked++
        return
      }
      for (const piece of alphabet) walk(s + piece, depth - 1)
    }
    for (let depth = 1; depth <= 4; depth++) walk('', depth)
    expect(checked).toBe(8 + 8 ** 2 + 8 ** 3 + 8 ** 4)
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
   * The mirror image of the test above, and the ordering hazard C3(b) is about:
   * a stub registered AFTER `applyTagfilter` chains correctly (it calls `prev`)
   * yet whatever it appends lands OUTSIDE the filter.
   *
   * This is what a hand-built engine gets, and what `createEngine` used to give
   * every SHAPE-slot rule, because `applyTagfilter` sits in `SEMANTIC_RULES`
   * and that array runs first. Kept as the statement of the hazard; the suite
   * below shows the real engine no longer has it.
   */
  it('a later chaining override appends outside the filter, in a hand-built engine', () => {
    const md = new MarkdownIt({ html: true, linkify: false })
    applyTagfilter(md)
    const prev = md.renderer.rules.html_block
    md.renderer.rules.html_block = (...args) =>
      (prev?.(...args) ?? '') + '<script>alert(1)</script>\n'

    expect(md.render('<div>x</div>\n')).toBe('<div>x</div>\n<script>alert(1)</script>\n')
  })
})

/**
 * ## CLOSED GAP: tagfilter is the outermost renderer link in the real engine
 *
 * This used to be a "KNOWN GAP" test, and its comment claimed a detection it
 * could not perform: it said "if this test ever starts failing because the
 * appended `<script>` came back escaped, the ordering changed" — but it built
 * its own `MarkdownIt` and hardcoded `applyTagfilter` first, so no change to
 * `createEngine` could ever affect it. These tests use a real `createEngine`
 * instance, so they track the thing they describe.
 *
 * The gap is closed by registering `applyTagfilter` a second time as
 * `createEngine`'s last step. `SEMANTIC_RULES` keeps its member (the slot
 * ratchet and GFM example 652 both need it) and the filter is also outermost.
 * Idempotence is what makes double registration free — see the exhaustive case
 * above and the byte-identity case below.
 */
describe('tagfilter is outermost in createEngine', () => {
  /** A stand-in for a future SHAPE-slot rule that chains html_block per C3(b). */
  const appendsAScript: Rule = (md) => {
    const prev = md.renderer.rules.html_block
    md.renderer.rules.html_block = (...args) =>
      (prev?.(...args) ?? '') + '<script>alert(1)</script>\n'
  }

  /**
   * The load-bearing test, and the one the old KNOWN GAP could not be: the stub
   * is a real member of `SHAPE_RULES` for the duration, so the engine under
   * test is built by `createEngine` itself. Delete `applyTagfilter(md)` from
   * `createEngine`'s last line and this fails — which is exactly the detection
   * the old comment claimed and the old test could not perform.
   */
  it('neutralises a payload appended by a SHAPE-slot override', () => {
    SHAPE_RULES.push(appendsAScript)
    try {
      expect(createEngine(DEFAULT_OPTIONS).render('<div>x</div>\n', {})).toBe(
        '<div>x</div>\n&lt;script>alert(1)&lt;/script>\n',
      )
    } finally {
      SHAPE_RULES.pop()
    }
    expect(SHAPE_RULES).not.toContain(appendsAScript)
  })

  /**
   * The limit of the fix, stated so it is not mistaken for total coverage: an
   * override bolted onto a FINISHED engine is registered after the outermost
   * filter and is therefore still outside it. Rules belong in the slots; the
   * engine cannot wrap what does not exist yet.
   */
  it('does not wrap an override bolted on after createEngine returned', () => {
    const md = createEngine(DEFAULT_OPTIONS)
    appendsAScript(md)
    expect(md.render('<div>x</div>\n', {})).toContain('<script>alert(1)</script>')
  })

  /**
   * `createSpecEngine` deliberately does NOT re-register the filter — it loads
   * only the rules it is handed, and the L1 spec suite hands it at most one.
   * Pinned because tagfilter.ts's caveat #2 tells future authors to rely on it.
   */
  it('createSpecEngine gets only the innermost link', () => {
    const md = createSpecEngine(DEFAULT_OPTIONS, [applyTagfilter])
    appendsAScript(md)
    expect(md.render('<div>x</div>\n', {})).toContain('<script>alert(1)</script>')
  })

  /**
   * Why the second registration is affordable: it must not change a single byte
   * for a document with no later override. Double-escaping (`&lt;` ->
   * `&amp;lt;`) is the specific way idempotence could have failed, so it is
   * asserted directly, in both modes.
   *
   * Measured over the whole corpus (166 documents × both `allowDangerousHtml`
   * modes) and 14 tags × 7 chunk shapes × both modes: zero byte differences
   * against the same engine without the second registration.
   *
   * Note which mode can see the escaping at all. Under the default
   * `allowDangerousHtml: false` the sanitizer deletes these elements from
   * `token.content` before any renderer runs, so the filter has nothing left to
   * escape and `&lt;script>` never appears; the nine tags are only observably
   * neutralised under `allowDangerousHtml: true`. Both modes are checked for
   * byte-identity; only the dangerous one asserts the escaped form.
   */
  it('changes no bytes and never double-escapes, in either mode', () => {
    for (const allowDangerousHtml of [false, true]) {
      const md = createEngine({ ...DEFAULT_OPTIONS, allowDangerousHtml })
      const twice = createEngine({ ...DEFAULT_OPTIONS, allowDangerousHtml })
      applyTagfilter(twice) // a third registration: still the identity

      for (const tag of TAGFILTER_TAGS) {
        const src = `<${tag}>x</${tag}>\n\na <${tag}> b\n\n<div id="d">keep</div>\n`
        const html = md.render(src, {})
        expect(twice.render(src, {})).toBe(html)
        expect(html).not.toContain('&amp;lt;')
        expect(html).not.toContain(`<${tag}>`)
        if (allowDangerousHtml) expect(html).toContain(`&lt;${tag}>`)
      }
    }
  })
})
