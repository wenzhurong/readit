import { describe, expect, it } from 'vitest'
import { EXPECTED_DIFFS, normalize, toDiffLines } from './normalize.js'

const REPO = { repo: 'tauri-apps/tauri', ref: 'dev', dir: '' }

describe('normalize', () => {
  it('step 1 strips the file and article shells', () => {
    const html = '<div id="file" class="md" data-path="README.md"><article class="markdown-body entry-content container-lg" itemprop="text"><p dir="auto">hi</p></article></div>'
    expect(normalize(html)).toBe('<p dir="auto">hi</p>')
  })

  it('step 1 strips the readme shell too', () => {
    const html = '<div id="readme" class="md"><article class="markdown-body"><p>hi</p></article></div>'
    expect(normalize(html)).toBe('<p>hi</p>')
  })

  it('step 1 does not over-normalize: an unrelated id or an article without markdown-body stays wrapped', () => {
    const html = '<div id="other" class="md"><article class="not-markdown-body"><p>hi</p></article></div>'
    // step 8 (sortAttributes) still reorders id/class regardless of shell status.
    expect(normalize(html)).toBe('<div class="md" id="other"><article class="not-markdown-body"><p>hi</p></article></div>')
  })

  it('step 2 drops data-run-id and data-identity and the 32-hex footnote salt', () => {
    const html =
      '<div data-run-id="abc" data-identity="02d4dd73"><a id="user-content-fnref-1-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d" href="#user-content-fn-1-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d">1</a></div>'
    expect(normalize(html)).toBe('<div><a href="#user-content-fn-1" id="user-content-fnref-1">1</a></div>')
  })

  it('step 2 does not over-normalize: a suffix one hex digit short of 32 is left alone', () => {
    const html = '<a href="#x" id="user-content-fnref-1-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6">1</a>'
    expect(normalize(html)).toBe(html)
  })

  it('added step drops data-line, readit\'s own scroll-sync attribute that GitHub never emits', () => {
    const html = '<h1 data-line="0">H</h1><p data-line="2">para</p>'
    expect(normalize(html)).toBe('<h1>H</h1><p>para</p>')
  })

  it('added step does not over-normalize: a same-prefix but distinct data-* attribute survives', () => {
    const html = '<p data-line="0" data-linenumbers="1,2,3">x</p>'
    expect(normalize(html)).toBe('<p data-linenumbers="1,2,3">x</p>')
  })

  it('step 3 restores camo src and leaves github.com images untouched', () => {
    const html =
      '<img src="https://camo.githubusercontent.com/9be2d8/6874" alt="status" data-canonical-src="https://img.shields.io/badge/status-stable-blue.svg" style="max-width: 100%;">' +
      '<img src="https://raw.githubusercontent.com/o/r/main/a.png" alt="direct" style="max-width: 100%;">'
    expect(normalize(html)).toBe(
      '<img alt="status" src="https://img.shields.io/badge/status-stable-blue.svg" style="max-width: 100%;">' +
        '<img alt="direct" src="https://raw.githubusercontent.com/o/r/main/a.png" style="max-width: 100%;">',
    )
  })

  it('registers D-LINK and D-CAMO and converges both sides onto one token', () => {
    expect(EXPECTED_DIFFS.map((d) => d.id)).toEqual(['D-LINK', 'D-CAMO'])
    const oracle = '<a href="https://github.com/o/r/blob/SHA/docs/other.md">x</a><img src="https://github.com/o/r/raw/SHA/docs/img.png">'
    const readit = '<a href="./other.md">x</a><img src="img.png">'
    const opts = { repo: 'o/r', ref: 'SHA', dir: 'docs' }
    expect(normalize(oracle, opts)).toBe(normalize(readit, opts))
    expect(normalize(readit, opts)).toBe('<a href="x-readit-rel:docs/other.md">x</a><img src="x-readit-rel:docs/img.png">')
  })

  it('step 3b does not over-normalize: two genuinely different relative link targets stay different', () => {
    const opts = { repo: 'o/r', ref: 'SHA', dir: 'docs' }
    const a = normalize('<a href="./other.md">x</a>', opts)
    const b = normalize('<a href="./different.md">x</a>', opts)
    expect(a).not.toBe(b)
  })

  it('leaves fragments, mailto and unrelated absolute urls alone', () => {
    const html = '<a href="#anchor">a</a><a href="mailto:x@y.z">b</a><a href="https://example.com/p">c</a>'
    expect(normalize(html, { repo: 'o/r', ref: 'SHA', dir: '' })).toBe(html)
  })

  it('step 4 blanks octicon path data', () => {
    const html = '<svg data-component="Octicon" class="octicon octicon-link" width="16"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95"></path></svg>'
    expect(normalize(html)).toBe('<svg class="octicon octicon-link" data-component="Octicon" width="16"><path d=""></path></svg>')
  })

  it('step 4 does not over-normalize: a non-octicon svg keeps its path data', () => {
    const html = '<svg class="illustration"><path d="M1 2 L3 4"></path></svg>'
    expect(normalize(html)).toBe(html)
  })

  it('step 5 keeps the highlight wrapper and drops pl-* token spans', () => {
    const html =
      '<div class="highlight highlight-source-js notranslate position-relative overflow-auto" dir="auto" data-snippet-clipboard-copy-content="const a = 1"><pre><span class="pl-k">const</span> a <span class="pl-c1">=</span> <span class="pl-c1">1</span></pre></div>'
    expect(normalize(html)).toBe(
      '<div class="highlight highlight-source-js notranslate position-relative overflow-auto" data-snippet-clipboard-copy-content="const a = 1" dir="auto"><pre>const a = 1</pre></div>',
    )
  })

  it('step 5 keeps code-block text byte exact including leading whitespace', () => {
    const html = '<div class="highlight highlight-source-python"><pre>def f():\n    return  1\n</pre></div>'
    expect(normalize(html)).toBe('<div class="highlight highlight-source-python"><pre>def f():\n    return  1\n</pre></div>')
  })

  it('step 5 does not over-normalize: pl-* spans outside a highlight-source wrapper stay wrapped', () => {
    const html = '<div class="callout"><span class="pl-k">keep</span></div>'
    expect(normalize(html)).toBe(html)
  })

  it('step 6 reduces the mermaid enrichment section to type plus decoded source', () => {
    const html =
      '<section class="js-render-needs-enrichment render-needs-enrichment position-relative" data-identity="02d4dd73-d316-4dc1-b28a-d3b49e614825" data-host="https://viewscreen.githubusercontent.com" data-src="https://viewscreen.githubusercontent.com/markdown/mermaid" data-type="mermaid" aria-label="mermaid rendered output container">\n  <div class="js-render-enrichment-target" data-plain="flowchart LR\nA --&gt; B\n" dir="auto"></div>\n</section>'
    expect(normalize(html)).toBe('<section data-type="mermaid">flowchart LR\nA --> B\n</section>')
  })

  it('step 6 does not over-normalize: a js-render-needs-enrichment section for a non-mermaid type is left untouched', () => {
    const html =
      '<section class="js-render-needs-enrichment render-needs-enrichment position-relative" data-identity="02d4dd73-d316-4dc1-b28a-d3b49e614825" data-type="geojson" aria-label="geojson rendered output container">\n  <div class="js-render-enrichment-target" data-plain="{}" dir="auto"></div>\n</section>'
    // data-identity is still stripped by step 2, but the section must not be collapsed into a
    // fake <section data-type="mermaid">: it is a different (unsupported) enrichment type.
    expect(normalize(html)).toBe(
      '<section aria-label="geojson rendered output container" class="js-render-needs-enrichment render-needs-enrichment position-relative" data-type="geojson"><div class="js-render-enrichment-target" data-plain="{}" dir="auto"></div></section>',
    )
  })

  it('step 7 drops hovercard and mention noise', () => {
    const html =
      '<a class="issue-link js-issue-link" data-hovercard-type="issue" data-hovercard-url="/o/r/issues/1/hovercard" data-octo-click="x" data-octo-dimensions="y" data-error-text="Failed" data-permission-text="Must have push" data-id="12345" href="https://example.com/i/1">#1</a>' +
      '<a class="user-mention notranslate" data-hovercard-type="user" href="https://example.com/u">@u</a>'
    expect(normalize(html)).toBe('<a href="https://example.com/i/1">#1</a><a href="https://example.com/u">@u</a>')
  })

  it('step 7 does not over-normalize: issue-link alone, without js-issue-link, is not stripped', () => {
    const html = '<a class="issue-link" href="https://example.com/i/1">#1</a>'
    expect(normalize(html)).toBe(html)
  })

  it('step 8 sorts attribute keys lexicographically', () => {
    const html = '<input type="checkbox" id="x" disabled="" class="task-list-item-checkbox" aria-label="Incomplete task" checked="">'
    expect(normalize(html)).toBe('<input aria-label="Incomplete task" checked class="task-list-item-checkbox" disabled id="x" type="checkbox">')
  })

  it('step 9 collapses inter-element whitespace but not inside pre or code', () => {
    const html = '<ul>\n  <li>\n    <p>a</p>\n  </li>\n</ul>\n<p>b   c <code>d   e</code></p>\n<pre>f   g\n\nh</pre>'
    expect(normalize(html)).toBe('<ul><li><p>a</p></li></ul><p>b c <code>d   e</code></p><pre>f   g\n\nh</pre>')
  })

  it('is idempotent', () => {
    const html = '<div id="file" class="md"><article class="markdown-body"><p dir="auto">x <a href="./y.md">y</a></p></article></div>'
    const once = normalize(html, REPO)
    expect(normalize(once, REPO)).toBe(once)
  })

  it('toDiffLines puts one tag per line', () => {
    expect(toDiffLines('<ul><li>a</li><li>b</li></ul>')).toEqual(['<ul>', '<li>', 'a', '</li>', '<li>', 'b', '</li>', '</ul>'])
  })

  it('toDiffLines does not split on a > < pair inside an attribute value', () => {
    expect(toDiffLines('<a aria-label="Permalink: a > b"><b>x</b></a>')).toEqual([
      '<a aria-label="Permalink: a > b">',
      '<b>',
      'x',
      '</b>',
      '</a>',
    ])
  })

  it('toDiffLines is lossless', () => {
    const html = normalize('<div class="highlight highlight-source-js"><pre>a &#x3C; b\n\n  c</pre></div>')
    expect(toDiffLines(html).join('')).toBe(html)
  })
})
