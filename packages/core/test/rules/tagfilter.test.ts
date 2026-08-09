import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import type { MarkdownIt as MarkdownItType, RendererRule } from 'markdown-it'
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
   * The claim does NOT rest on this test. It rests on a proof about
   * `TAGFILTER_RE`, written out in rules/tagfilter.ts: the replacement `'&lt;$1'`
   * contains no `<` and `$1` is `/?tagname`, so a pass never creates a `<`; and
   * a `<` the pass left alone cannot become a match, because the `/?tagname`
   * span after it cannot overlap an inserted `&lt;` (that would drag in `&` or
   * `;`) and the character after that span is either untouched input or the
   * leading `&` of an insertion, which is not in the lookahead class `[\s/>]`.
   *
   * What this test is, therefore, is a regression guard on the regex, and its
   * size is exactly what it says: 8 + 8² + 8³ + 8⁴ = 4680 strings, every one up
   * to length 4 over the eight symbols below. (An earlier version of this
   * comment claimed length 5 and 37 448 cases; the committed loop has always
   * stopped at 4.)
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
   * ## Building an engine that really is registered ONCE
   *
   * The point of the second registration is that it must not change a single
   * byte for a document with no later override — a 1× vs 2× claim. The test
   * that used to stand here compared `createEngine` against `createEngine` plus
   * a THIRD registration, so both sides already had the second one and a
   * 1×→2× change would have sailed through it.
   *
   * `createEngine` has no register-once mode and the outer filter is a closure
   * that cannot be unwrapped after the fact, so it is captured instead: a rule
   * appended to `SHAPE_RULES` reads `md.renderer.rules.html_block` /
   * `html_inline` at the moment the SHAPE loop finishes — the chain with the
   * INNER (`SEMANTIC_RULES`-slot) filter and nothing else. Putting those two
   * functions back on the finished engine removes the second registration.
   *
   * That is only faithful if nothing between the SHAPE loop and `createEngine`'s
   * final `applyTagfilter(md)` also writes those two slots. `applyCodeBlock`
   * writes `fence` / `code_block`; `applyRawHtmlPolicy` and `applyRawShape` are
   * CORE rules that rewrite `token.content` and register no renderer at all. The
   * first test below checks that reading rather than trusting it: with a
   * SHAPE-slot override in play, the restored engine must still carry the
   * override (so nothing extra was removed) and must no longer filter it (so the
   * outer registration was removed).
   */
  interface RawRenderers {
    html_block: RendererRule
    html_inline: RendererRule
  }

  function enginesOnceAndTwice(
    allowDangerousHtml: boolean,
    extra: readonly Rule[] = [],
  ): { once: MarkdownItType; twice: MarkdownItType } {
    let atShapeEnd: RawRenderers | undefined
    const capture: Rule = (md) => {
      atShapeEnd = {
        html_block: md.renderer.rules.html_block as RendererRule,
        html_inline: md.renderer.rules.html_inline as RendererRule,
      }
    }
    const opts = { ...DEFAULT_OPTIONS, allowDangerousHtml }
    SHAPE_RULES.push(...extra, capture)
    try {
      const twice = createEngine(opts)
      const once = createEngine(opts)
      const inner = atShapeEnd as RawRenderers // captured during `once`'s build
      once.renderer.rules.html_block = inner.html_block
      once.renderer.rules.html_inline = inner.html_inline
      return { once, twice }
    } finally {
      SHAPE_RULES.splice(SHAPE_RULES.length - (extra.length + 1))
    }
  }

  it('the constructed engine is createEngine minus exactly the second registration', () => {
    const before = [...SHAPE_RULES]
    const { once, twice } = enginesOnceAndTwice(false, [appendsAScript])
    expect(SHAPE_RULES).toEqual(before)

    // 2×: the outer filter neutralises the SHAPE-slot override's payload.
    expect(twice.render('<div>x</div>\n', {})).toBe(
      '<div>x</div>\n&lt;script>alert(1)&lt;/script>\n',
    )
    // 1×: the payload is unfiltered, so the outer registration is gone — and it
    // is still emitted, so nothing else was removed with it.
    expect(once.render('<div>x</div>\n', {})).toBe('<div>x</div>\n<script>alert(1)</script>\n')
  })

  /**
   * Seven document shapes per tag × the nine tags × both modes == 126
   * documents, asserted below so the figure quoted in rules/tagfilter.ts and
   * engine.ts is the figure this loop actually renders.
   */
  const DOC_SHAPES: ((tag: string) => string)[] = [
    (t) => `<${t}>x</${t}>\n`,
    (t) => `a <${t}> b\n`,
    (t) => `<${t} data-a="v">\n\nmd *em*\n\n</${t}>\n`,
    (t) => `<div id="d">\n\n<${t}>y</${t}>\n\n</div>\n`,
    (t) => '`<' + t + '>` and \\<' + t + '>\n',
    (t) => `<${t.toUpperCase()} >x</${t.toUpperCase()} >\n`,
    (t) => `text <${t}/> more, and a truncated <${t}\n`,
  ]

  it('changes no bytes against a genuinely single-registered engine, in either mode', () => {
    let documents = 0
    for (const allowDangerousHtml of [false, true]) {
      const { once, twice } = enginesOnceAndTwice(allowDangerousHtml)
      for (const tag of TAGFILTER_TAGS) {
        for (const shape of DOC_SHAPES) {
          const src = shape(tag)
          const html = twice.render(src, {})
          expect(once.render(src, {}), `${src} (allowDangerousHtml: ${allowDangerousHtml})`).toBe(
            html,
          )
          expect(html).not.toContain('&amp;lt;')
          documents++
        }
      }
    }
    expect(documents).toBe(TAGFILTER_TAGS.length * DOC_SHAPES.length * 2)
    expect(documents).toBe(126)
  })

  /**
   * Which mode can see the escaping at all. Under the default
   * `allowDangerousHtml: false` the sanitizer deletes these elements from
   * `token.content` before any renderer runs, so the filter has nothing left to
   * escape and `&lt;script>` never appears; the nine tags are only observably
   * neutralised under `allowDangerousHtml: true`. A third registration is
   * checked here too — the identity again, for the same reason.
   */
  it('neutralises all nine tags in dangerous mode, and a third registration is still free', () => {
    for (const allowDangerousHtml of [false, true]) {
      const md = createEngine({ ...DEFAULT_OPTIONS, allowDangerousHtml })
      const thrice = createEngine({ ...DEFAULT_OPTIONS, allowDangerousHtml })
      applyTagfilter(thrice)

      for (const tag of TAGFILTER_TAGS) {
        const src = `<${tag}>x</${tag}>\n\na <${tag}> b\n\n<div id="d">keep</div>\n`
        const html = md.render(src, {})
        expect(thrice.render(src, {})).toBe(html)
        expect(html).not.toContain('&amp;lt;')
        expect(html).not.toContain(`<${tag}>`)
        if (allowDangerousHtml) expect(html).toContain(`&lt;${tag}>`)
      }
    }
  })
})
