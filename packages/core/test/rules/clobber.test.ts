import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import GithubSlugger from 'github-slugger'
import type { Root } from 'hast'
import {
  applyClobber,
  applyRawHtmlTransform,
  prefixUserContent,
  transformRawHtmlChunks,
  type ChunkKind,
  type RawHtmlFallback,
  type RawHtmlTransform,
} from '../../src/rules/clobber.js'
import { decorateRawTree } from '../../src/rules/rawshape.js'
import { render } from '../../src/index.js'

/** Worst case for the split: a transform that returns nothing at all. */
const dropEverything: RawHtmlTransform = (): Root => ({ type: 'root', children: [] })

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

  /**
   * The split can also fail outright, not just re-order: a transform that
   * removes the subtree the separator landed in takes the separator with it,
   * and the run no longer splits back into one part per chunk.
   *
   * This used to `throw`, which made every caller — including `render()` in
   * its DEFAULT safe mode — a partial function. readit renders arbitrary
   * untrusted Markdown as a total function, so the mismatch degrades to a
   * caller-chosen fallback instead. See the `<template>` cases in
   * test/sanitize.test.ts for the real input that reaches this branch.
   */
  it('degrades instead of throwing when the run no longer splits back', () => {
    expect(() => transformRawHtmlChunks(['<i>', '</i>'], dropEverything)).not.toThrow()
  })

  it('degrades to the chunks unchanged by default', () => {
    expect(transformRawHtmlChunks(['<i>', '</i>'], dropEverything)).toEqual(['<i>', '</i>'])
  })

  /**
   * The default is wrong for the sanitizer — handing author HTML back
   * unchanged would turn a crash into an XSS hole — so the fallback is the
   * caller's to choose, and it is handed the same `kinds`/`env` the transform
   * got so it can make the same decisions.
   */
  it('lets a caller supply its own fallback, with the same kinds and env', () => {
    const seen: { kinds: readonly ChunkKind[]; env: unknown }[] = []
    const fallback: RawHtmlFallback = (chunks, kinds, env) => {
      seen.push({ kinds, env })
      return chunks.map(() => '')
    }
    const kinds: ChunkKind[] = ['inline', 'inline']
    const env = { marker: 1 }
    expect(transformRawHtmlChunks(['<i>', '</i>'], dropEverything, kinds, env, fallback)).toEqual([
      '',
      '',
    ])
    expect(seen).toEqual([{ kinds, env }])
  })

  /**
   * The `RawHtmlFallback` length contract, enforced rather than assumed.
   *
   * `applyRawHtmlTransform` assigns `out[i]` to `targets[i].content`. When that
   * read was written `out[i] ?? token.content` it was fail-OPEN: a fallback
   * returning fewer entries than there were chunks left the trailing tokens
   * holding their RAW AUTHOR HTML, which for the sanitizer is precisely the
   * bytes that must never be emitted — and it did so with no diagnostic at all.
   * Blanking them instead would be equally quiet, just lossy in the other
   * direction. Neither of the two in-repo fallbacks can return a short array
   * (`[...chunks]` and `chunks.map(...)` are length-preserving by
   * construction), but the parameter is caller-supplied and nothing checked it,
   * so the guard lives at the contract boundary where the fallback is called.
   *
   * This is unreachable from document input — every fallback that gets here is
   * one of this repo's own — so it does not cost `render()` its totality.
   */
  it('throws on a fallback that returns fewer entries than there were chunks', () => {
    const short: RawHtmlFallback = (chunks) => chunks.slice(1)
    expect(() =>
      transformRawHtmlChunks(['<i>', '</i>'], dropEverything, [], {}, short),
    ).toThrow(/RawHtmlFallback returned 1 chunks for 2 inputs/)
  })

  it('throws on a fallback that returns more entries than there were chunks', () => {
    const long: RawHtmlFallback = (chunks) => [...chunks, 'extra']
    expect(() => transformRawHtmlChunks(['<i>', '</i>'], dropEverything, [], {}, long)).toThrow(
      /RawHtmlFallback returned 3 chunks for 2 inputs/,
    )
  })

  /**
   * The same contract at the site that actually consumed the short array. With
   * `out[i] ?? token.content`, the unmatched second token kept its author
   * bytes: this document used to render `<p>a [sanitized]x</i> b</p>` — the
   * fallback's own output for chunk 0 and the RAW `</i>` for chunk 1, from a
   * transform whose entire job was to not do that.
   */
  it('never reverts a token to its raw author HTML when a fallback returns short', () => {
    const m = new MarkdownIt({ html: true })
    const short: RawHtmlFallback = (chunks) => chunks.slice(0, 1).map(() => '[sanitized]')
    applyRawHtmlTransform(m, 'readit_test_short_fallback', dropEverything, short)
    expect(() => m.render('a <i>x</i> b\n')).toThrow(
      /RawHtmlFallback returned 1 chunks for 2 inputs/,
    )
  })

  /**
   * ## `<col>` reaches `applyClobber`'s fallback, for real, from `render()`
   *
   * The previous fix round's report claimed of this caller: "Measured: this
   * caller does not actually reach the branch." It does. `<col>` is the one tag
   * (of the 122 swept in 7 chunk shapes against this very transform in
   * test/sanitize.test.ts) whose degradation is caused by the PARSER rather
   * than by the transform — parse5's fragment parser enters "in column group"
   * insertion mode and discards the run separator — so it triggers with no
   * sanitizer involved at all, in the mode where none runs.
   *
   * The consequence is unpleasant and was unstated: a stray `<col>` silently
   * disables the anti-clobbering pass for the WHOLE document, because every raw
   * chunk shares one run. `applyRawShape` pays the same bill in the same mode,
   * for the same reason and with the same fallback; that half lives in
   * test/rules/rawshape.test.ts.
   *
   * Accepted rather than fixed, on three grounds, all measured:
   *
   *  - it is not a safety boundary. `applyClobber` runs only under
   *    `allowDangerousHtml: true`, where `<img src=x onerror="alert(1)">`
   *    already renders verbatim — pinned below. An unprefixed `id` cannot make
   *    that worse.
   *  - the per-chunk alternative is worse. See the measurement in the
   *    `keepChunksUnchanged` doc comment: prefixing chunk-by-chunk turns
   *    `<div id="a">\n` into `<div id="user-content-a">\n</div>` and drops the
   *    matching `</div>\n` entirely, so the wrapper closes before the content
   *    it wrapped. Corrupting the author's structure to add readit's prefix is
   *    a bad trade in the mode whose contract is faithful pass-through.
   *  - it used to THROW, so this remains an improvement either way.
   */
  it('a stray <col> costs the whole document its user-content- prefixes in dangerous mode', () => {
    expect(render('a <col> b <span id="CL">x</span>\n', { allowDangerousHtml: true })).toBe(
      '<p dir="auto" data-line="0">a <col> b <span id="CL">x</span></p>\n',
    )
    // Block position, and the contrast that shows the blast radius is the
    // document rather than the element: without the `<col>` the id is prefixed.
    expect(render('<col>\n\n<div id="a">\n\n**md**\n\n</div>\n', { allowDangerousHtml: true })).toBe(
      '<col>\n<div id="a">\n<p dir="auto" data-line="4"><strong>md</strong></p>\n</div>\n',
    )
    expect(render('<div id="a">\n\n**md**\n\n</div>\n', { allowDangerousHtml: true })).toBe(
      '<div id="user-content-a">\n<p dir="auto" data-line="2"><strong>md</strong></p>\n</div>\n',
    )
  })

  it('dangerous mode is not a safety boundary anyway: onerror already passes verbatim', () => {
    expect(render('<img src=x onerror="alert(1)">\n', { allowDangerousHtml: true })).toContain(
      'onerror="alert(1)"',
    )
  })

  /**
   * `keepChunksUnchanged` preserves the author's structure exactly; the
   * per-chunk alternative does not. This is the measurement the decision above
   * rests on, kept executable so "just degrade per-chunk like the sanitizer"
   * cannot be applied here without seeing what it costs.
   */
  it('per-chunk prefixing would unbalance the wrappers keepChunksUnchanged preserves', () => {
    expect(prefixUserContent('<div id="a">\n')).toBe('<div id="user-content-a">\n</div>')
    expect(prefixUserContent('</div>\n')).toBe('\n')
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
