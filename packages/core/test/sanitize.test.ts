import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import GithubSlugger from 'github-slugger'
import { defaultSchema } from 'hast-util-sanitize'
import { applyAlerts } from '../src/rules/alerts.js'
import { applyHeadingAnchors, OCTICON_LINK } from '../src/rules/heading.js'
import { applyCodeBlock } from '../src/rules/codeblock.js'
import { applyEmoji } from '../src/rules/emoji.js'
import {
  applyRawHtmlPolicy,
  sanitizeTree,
  sanitizeUserHtml,
  STRIPPED_WITH_CONTENT,
} from '../src/sanitize.js'
import {
  prefixUserContentTree,
  transformRawHtmlChunks,
  type RawHtmlTransform,
} from '../src/rules/clobber.js'
import { decorateRawTree } from '../src/rules/rawshape.js'
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
      '<img class="emoji" title=":shipit:" alt=":shipit:" ' +
        'src="https://github.githubassets.com/images/icons/emoji/shipit.png" ' +
        'height="20" width="20" align="absmiddle">',
    )
  })
})

/**
 * ## The complete trigger set, measured rather than asserted
 *
 * The degradation below used to be described — here and in two comments in
 * src/ — as "the `<template>` case". It is not. Two independent mechanisms make
 * the run split fail, and the sweep in this suite is what pins them:
 *
 *  1. The TRANSFORM deletes an element together with its content, taking the
 *     run separator with it. For `sanitizeTree` that is
 *     `STRIPPED_WITH_CONTENT` — `defaultSchema.strip` (`['script']` on
 *     hast-util-sanitize 5.0.2) plus `template`, whose children hast parks
 *     under `.content` so there is nothing to unwrap. Merely being absent from
 *     `tagNames` is NOT enough: `sanitize` unwraps those and keeps the
 *     separator.
 *  2. The PARSER drops the separator before any transform runs. `<col>` alone
 *     does this, by putting parse5's fragment parser into "in column group"
 *     insertion mode, where character tokens are discarded. It therefore
 *     reaches every caller, not just the sanitizer, which is why the sweep
 *     below runs all three in-repo transforms rather than only `sanitizeTree`.
 *     What it COSTS each caller is pinned where that caller lives:
 *     test/rules/clobber.test.ts for `applyClobber`, test/rules/rawshape.test.ts
 *     for `applyRawShape`.
 *
 * `<script>` matters most, because it makes the original crash reachable
 * through a wholly ordinary document: `a <script>q</script> b` chunks to
 * `["<script>","</script>"]` with no `<template>` in sight, and at the commit
 * before the degradation landed it THREW. `render()` was a partial function in
 * the DEFAULT (safe) mode — the mode every host uses, and the only mode that
 * runs a sanitizer at all. `allowDangerousHtml: true` never threw, because
 * nothing drops the element there. A crash is a denial of service on the host,
 * so the mismatch degrades instead.
 *
 * The sanitizer's degradation is NOT "hand the chunks back unchanged" — that
 * would emit unsanitized author HTML, turning a crash into an XSS hole. It is
 * "sanitize each chunk on its own", i.e. the sanitizer minus the join. Every
 * emitted byte is still `sanitizeTree` output; the only thing lost is the
 * cross-chunk structure the join exists to preserve, which is exactly what
 * failed.
 */
describe('KNOWN LIMITATION: the raw-HTML run split, and everything that breaks it', () => {
  /**
   * The sweep, derived from the dependency instead of hardcoded: a bump that
   * adds an element to `defaultSchema.strip` widens the expectation
   * automatically, and anything that starts triggering for some OTHER reason
   * fails here. `col` is the one hand-written entry, because it is a parse5
   * fact rather than a schema fact.
   */
  const SWEPT_TAGS = `a abbr address article aside audio b base bdi bdo blockquote body br
    button canvas caption cite code col colgroup data datalist dd del details dfn dialog div
    dl dt em embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6
    head header hgroup hr html i iframe img input ins kbd label legend li link main map mark
    marquee math menu meta meter nav noembed noframes noscript object ol optgroup option
    output p param picture plaintext pre progress q rp rt ruby s samp script search section
    select slot small source span strike strong style sub summary sup svg table tbody td
    template textarea tfoot th thead time title tr track u ul var video wbr xmp`.split(/\s+/)

  /**
   * Seven chunk shapes per tag, matching how markdown-it really hands raw HTML
   * over. Position matters and cannot be dropped: `<col>` only discards the
   * separator while the fragment is still in the template insertion mode, so
   * shapes 3, 5 and 6 — which put another START TAG in front of it — do not
   * trigger at all, while 0, 1, 2 and 4 do.
   */
  const SHAPES: ((tag: string) => string[])[] = [
    (t) => [`<${t}>`, `</${t}>`],
    (t) => [`<${t} id="i">`, `</${t}>`],
    (t) => [`<${t}>`, `</${t}>`, '<b>', '</b>'],
    (t) => ['<b>', '</b>', `<${t}>`, `</${t}>`],
    (t) => [`<${t}/>`, '<b>', '</b>'],
    (t) => ['<div>', `<${t}>`, `</${t}>`, '</div>'],
    (t) => ['<table>', `<${t}>`, `</${t}>`, '</table>'],
  ]

  /**
   * Every transform this repo hands to `transformRawHtmlChunks`. The trigger
   * set is a property of the TRANSFORM, not of the module, and swept per
   * transform for exactly that reason: `sanitizeTree` deletes elements and so
   * owns mechanism 1, while the other two delete nothing and can only ever be
   * hit by mechanism 2.
   */
  const TRANSFORMS: Record<string, RawHtmlTransform> = {
    sanitizeTree,
    prefixUserContentTree,
    decorateRawTree: (tree, kinds) => decorateRawTree(tree, new GithubSlugger(), kinds),
  }

  /**
   * 122 tags × 7 shapes × 3 transforms == 2562 cases, asserted below so the
   * arithmetic quoted in src/sanitize.ts and src/rules/clobber.ts is the
   * arithmetic this file actually performs. Runs in ~60ms.
   */
  it('the trigger set per transform: STRIPPED_WITH_CONTENT for the sanitizer, <col> for all three', () => {
    const sanitizerTriggers = [...new Set([...STRIPPED_WITH_CONTENT, 'col'])].sort()
    const triggers: Record<string, Set<string>> = {}
    let cases = 0
    for (const [name, transform] of Object.entries(TRANSFORMS)) {
      const found = new Set<string>()
      for (const shape of SHAPES) {
        for (const tag of SWEPT_TAGS) {
          // `keepChunksUnchanged` would hide the failure; a sentinel value cannot.
          const out = transformRawHtmlChunks(shape(tag), transform, [], {}, (cs) =>
            cs.map(() => 'DEGRADED'),
          )
          cases++
          if (out[0] === 'DEGRADED') found.add(tag)
        }
      }
      triggers[name] = found
    }

    expect(SWEPT_TAGS).toHaveLength(122)
    expect(cases).toBe(122 * 7 * 3)
    expect([...triggers.sanitizeTree!].sort()).toEqual(sanitizerTriggers)
    // The two transforms that delete nothing: only the parser-level trigger.
    expect([...triggers.prefixUserContentTree!].sort()).toEqual(['col'])
    expect([...triggers.decorateRawTree!].sort()).toEqual(['col'])
    // Guards the derivation itself: if this ever fails, `strip` changed and the
    // comments naming `script` need re-reading, not just this expectation.
    expect(defaultSchema.strip).toEqual(['script'])
  })

  /**
   * The position-sensitivity the shape list exists to cover, stated as its own
   * assertion so the "4 of the 7 shapes" figure in `rules/clobber.ts` is
   * measured rather than remembered. A fragment starts in the template
   * insertion mode, where `<col>` switches parse5 to "in column group" and
   * character tokens are discarded; the first START tag in the run leaves that
   * mode for "in body", where `<col>` is simply ignored and the separator
   * survives. Text and comments do not leave it, so `a <col> b` still triggers.
   */
  it('<col> only drops the separator while no start tag has preceded it', () => {
    const degrades = (chunks: string[]): boolean =>
      transformRawHtmlChunks(chunks, (tree) => tree, [], {}, (cs) => cs.map(() => 'D'))[0] === 'D'

    expect(degrades(['<col>', '</col>'])).toBe(true)
    expect(degrades(['x', '<col>', 'y'])).toBe(true)
    expect(degrades(['<!--c-->', '<col>', 'y'])).toBe(true)
    expect(degrades(['</b>', '<col>', 'y'])).toBe(true)
    expect(degrades(['<b>', '<col>', 'y'])).toBe(false)
    expect(degrades(['<div>', '<col>', 'y'])).toBe(false)

    const perShape = SHAPES.map((shape) => degrades(shape('col')))
    expect(perShape).toEqual([true, true, true, false, true, false, false])
    expect(perShape.filter(Boolean)).toHaveLength(4)
  })

  /**
   * The other half of mechanism 1, and the reason the trigger set is not simply
   * "everything the schema rejects": an element absent from `tagNames` is
   * UNWRAPPED, so its children — and the separator among them — survive.
   */
  it('an element the schema merely rejects is unwrapped and does not degrade', () => {
    expect(defaultSchema.tagNames).not.toContain('marquee')
    const out = transformRawHtmlChunks(
      ['<marquee>', '</marquee>'],
      sanitizeTree,
      [],
      {},
      (cs) => cs.map(() => 'DEGRADED'),
    )
    expect(out[0]).not.toBe('DEGRADED')
  })

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
   * `<script>`, the trigger every previous comment omitted and the one that
   * makes the original crash reachable from an ordinary document. No
   * `<template>` anywhere: `defaultSchema.strip` deletes the element WITH its
   * content, so the separator goes exactly as it does for `<template>`.
   *
   * The output shape is surprising and is pinned for that reason: the script
   * BODY comes out as visible text. It is not the sanitizer failing to strip
   * it — markdown-it never handed it over. `a <script>q</script> b` is two
   * `html_inline` tokens with the ordinary Markdown text `q` between them, so
   * `q` was never part of a raw chunk and no sanitizer stage ever sees it. This
   * is true on the JOINED path too, and is a property of readit's token-level
   * seam rather than of the degradation.
   */
  it('inline <script>: degrades without any <template>, surfacing the body as text', () => {
    expect(() => render('a <script>q</script> b\n')).not.toThrow()
    expect(render('a <script>q</script> b\n')).toBe('<p dir="auto" data-line="0">a q b</p>\n')
  })

  /**
   * Block position does NOT degrade, and the asymmetry is worth pinning
   * alongside the inline case so nobody "fixes" one to match the other.
   * CommonMark HTML block type 1 swallows everything up to `</script>`, so the
   * whole element arrives as ONE `html_block` chunk. One chunk in, one part
   * out — the split cannot fail, and the sanitizer simply deletes the element,
   * body included. The visible-body wart is specific to the inline case, where
   * markdown-it hands over two tokens with Markdown text between them.
   */
  it('block <script>: one chunk, so no degradation and the body goes too', () => {
    const html = render('<script>alert(1)</script>\n')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('&lt;script')
    expect(html).not.toContain('alert(1)')
    expect(html).toBe('\n')
  })

  /**
   * `<col>`, the third trigger and the only one that is not the sanitizer's
   * doing: parse5 drops the separator at PARSE time. Pinned here for the safe
   * mode; test/rules/clobber.test.ts pins what it costs the dangerous mode,
   * where no sanitizer runs and the degradation is therefore visible as lost
   * `user-content-` prefixing.
   */
  it('<col> degrades the safe path too, though no transform deleted anything', () => {
    expect(() => render('a <col> b <span id="CL">x</span>\n')).not.toThrow()
    expect(render('a <col> b <span id="CL">x</span>\n')).toBe(
      '<p dir="auto" data-line="0">a  b <span id="user-content-CL"></span>x</p>\n',
    )
  })

  /**
   * The load-bearing assertion of this whole fix. ANY trigger anywhere in the
   * document forces the degraded path for the WHOLE run — every
   * html_block/html_inline token in the document shares one run — so the
   * degraded path has to be at least as safe as the normal one for raw HTML
   * that has nothing to do with the trigger.
   *
   * Run once per trigger, one per mechanism, rather than for `<template>`
   * alone: the inline `<script>` case is the ordinary-document one, and `<col>`
   * arrives by the parser rather than the sanitizer.
   */
  it.each([
    ['template', '<template>t</template>'],
    ['script', 'a <script>q</script> b'],
    ['col', 'a <col> b'],
  ])('the degraded path still sanitizes with a %s trigger: no author HTML escapes', (_t, trigger) => {
    const html = render(
      `${trigger}\n\n` +
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
    expect(html).not.toContain('<script')
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
    // Same for the two triggers the old comments never mentioned.
    expect(render('a <script>q</script> b\n\n<div id="dup">d</div>\n')).toBe(
      '<p dir="auto" data-line="0">a q b</p>\n<div id="user-content-dup">d</div>\n',
    )
    expect(render('a <col> b\n\n<div id="dup">d</div>\n')).toBe(
      '<p dir="auto" data-line="0">a  b</p>\n<div id="user-content-dup">d</div>\n',
    )
  })

  /**
   * `allowDangerousHtml: true` does not take the degraded path for the two
   * SANITIZER triggers — `applyClobber` keeps `<template>` and `<script>`, and
   * hast round-trips `.content`, so the split succeeds. Pinned so the fix above
   * cannot quietly change the dangerous mode too.
   *
   * `<col>` is the exception, because its trigger is the parser rather than the
   * transform; test/rules/clobber.test.ts owns that case.
   */
  it('allowDangerousHtml keeps <template> and <script> intact and never degraded', () => {
    expect(render('<template><p>x</p></template>\n', { allowDangerousHtml: true })).toContain(
      '<template><p>x</p></template>',
    )
    expect(render('a <script>q</script> b\n', { allowDangerousHtml: true })).toBe(
      '<p dir="auto" data-line="0">a &lt;script>q&lt;/script> b</p>\n',
    )
  })
})
