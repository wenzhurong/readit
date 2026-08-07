import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import type { Highlighter } from '../../src/types.js'
import { applyCodeBlock, scopeClassFor } from '../../src/rules/codeblock.js'

function md(highlighter: Highlighter | null = null) {
  const m = new MarkdownIt({ html: true })
  applyCodeBlock(m, highlighter)
  return m
}

describe('codeblock', () => {
  it('maps fence info strings to GitHub highlight classes', () => {
    expect(scopeClassFor('js')).toBe('highlight-source-js')
    expect(scopeClassFor('shell')).toBe('highlight-source-shell')
    expect(scopeClassFor('sh')).toBe('highlight-source-shell')
    expect(scopeClassFor('html')).toBe('highlight-text-html-basic')
    expect(scopeClassFor('php')).toBe('highlight-text-html-php')
    expect(scopeClassFor('cpp')).toBe('highlight-source-c++')
    expect(scopeClassFor('go-html-template')).toBeNull()
    expect(scopeClassFor('')).toBeNull()
  })

  it('emits the blob-view highlight wrapper for a known language', () => {
    // Oracle: GET /repos/markdown-it/markdown-it/contents/README.md, 2026-08-06
    expect(md().render('```shell\nnpm install markdown-it\n```\n')).toBe(
      '<div class="highlight highlight-source-shell notranslate position-relative overflow-auto"' +
        ' dir="auto" data-snippet-clipboard-copy-content="npm install markdown-it">' +
        '<pre>npm install markdown-it</pre></div>\n',
    )
  })

  it('emits the snippet-clipboard wrapper for an unknown language', () => {
    // Oracle: GET /repos/gohugoio/hugoDocs/contents/.../Apply.md, 2026-08-06
    expect(md().render('```go-html-template\n{{ $s }}\n```\n')).toBe(
      '<div class="snippet-clipboard-content notranslate position-relative overflow-auto"' +
        ' data-snippet-clipboard-copy-content="{{ $s }}">' +
        '<pre lang="go-html-template" class="notranslate"><code>{{ $s }}\n</code></pre></div>\n',
    )
  })

  it('emits the snippet-clipboard wrapper without a lang attribute for a bare fence', () => {
    // Oracle: GET /repos/isaacs/rimraf/readme, 2026-08-06
    expect(md().render('```\nHTTP/1.1 200 OK\n```\n')).toBe(
      '<div class="snippet-clipboard-content notranslate position-relative overflow-auto"' +
        ' data-snippet-clipboard-copy-content="HTTP/1.1 200 OK">' +
        '<pre class="notranslate"><code>HTTP/1.1 200 OK\n</code></pre></div>\n',
    )
  })

  it('uses only the first word of the info string', () => {
    expect(md().render('```js title="x"\na\n```\n')).toContain(
      'class="highlight highlight-source-js notranslate position-relative overflow-auto"',
    )
  })

  it('escapes &, < and > but not quotes in text, and all four in the copy attribute', () => {
    expect(md().render('```\nq "x" & <y> \'z\'\n```\n')).toBe(
      '<div class="snippet-clipboard-content notranslate position-relative overflow-auto"' +
        ' data-snippet-clipboard-copy-content="q &quot;x&quot; &amp; &lt;y&gt; \'z\'">' +
        '<pre class="notranslate"><code>q "x" &amp; &lt;y&gt; \'z\'\n</code></pre></div>\n',
    )
  })

  it('strips exactly one trailing newline from the copy attribute', () => {
    const out = md().render('```\na\n\n```\n')
    expect(out).toContain('data-snippet-clipboard-copy-content="a\n"')
    expect(out).toContain('<code>a\n\n</code>')
  })

  it('renders an indented code block like a bare fence', () => {
    expect(md().render('    indented\n')).toBe(
      '<div class="snippet-clipboard-content notranslate position-relative overflow-auto"' +
        ' data-snippet-clipboard-copy-content="indented">' +
        '<pre class="notranslate"><code>indented\n</code></pre></div>\n',
    )
  })

  it('uses the highlighter output verbatim inside the bare pre when one is supplied', () => {
    const hl: Highlighter = {
      supports: (lang) => lang === 'js',
      highlight: (code, lang) => (lang === 'js' ? `<span class="pl-k">${code}</span>` : null),
    }
    expect(md(hl).render('```js\nconst\n```\n')).toBe(
      '<div class="highlight highlight-source-js notranslate position-relative overflow-auto"' +
        ' dir="auto" data-snippet-clipboard-copy-content="const">' +
        '<pre><span class="pl-k">const\n</span></pre></div>\n',
    )
  })

  it('falls back to plain text when the highlighter returns null', () => {
    const hl: Highlighter = { supports: () => false, highlight: () => null }
    expect(md(hl).render('```js\nconst\n```\n')).toContain('<pre>const</pre>')
  })

  it('forwards a data-line attribute set by the sourceline rule', () => {
    const m = md()
    const tokens = m.parse('```js\na\n```\n', {})
    tokens[0]!.attrSet('data-line', '0')
    expect(m.renderer.render(tokens, m.options, {})).toContain(
      'overflow-auto" dir="auto" data-line="0" data-snippet-clipboard-copy-content="a">',
    )
  })
})
