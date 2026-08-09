import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyHeadingAnchors, OCTICON_LINK } from '../../src/rules/heading.js'
import { applyDirAuto } from '../../src/rules/dirauto.js'

function md() {
  return new MarkdownIt('default', { html: true, linkify: false })
    .use(applyHeadingAnchors)
    .use(applyDirAuto)
}

/** Verbatim from GET /repos/markdown-it/markdown-it/contents/README.md, 2026-08-06. */
const REAL_H1 =
  '<div class="markdown-heading" dir="auto"><h1 class="heading-element" dir="auto">markdown-it</h1>' +
  '<a id="user-content-markdown-it" class="anchor" aria-label="Permalink: markdown-it" href="#markdown-it">' +
  '<svg data-component="Octicon" class="octicon octicon-link" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true">' +
  '<path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"></path>' +
  '</svg></a></div>\n'

describe('applyHeadingAnchors', () => {
  it('matches the byte-exact GitHub shape for a plain h1', () => {
    expect(md().render('# markdown-it\n')).toBe(REAL_H1)
  })

  it('keeps the octicon path exported for reuse', () => {
    expect(OCTICON_LINK).toContain('class="octicon octicon-link"')
    expect(OCTICON_LINK.startsWith('<svg data-component="Octicon"')).toBe(true)
  })

  it('puts the id on the sibling anchor only, prefixed, and href unprefixed', () => {
    const html = md().render('## Getting Started\n')
    expect(html).toContain('<h2 class="heading-element" dir="auto">Getting Started</h2>')
    expect(html).not.toContain('<h2 id=')
    expect(html).toContain('<a id="user-content-getting-started" class="anchor"')
    expect(html).toContain('href="#getting-started"')
  })

  it('derives slug and aria-label from text content, ignoring markup and image alt', () => {
    // Verbatim from markdown-it/markdown-it README.md
    const linked = md().render('### [Documentation >>](https://markdown-it.github.io/markdown-it/)\n')
    expect(linked).toContain('<a id="user-content-documentation-" class="anchor"')
    expect(linked).toContain('aria-label="Permalink: Documentation &gt;&gt;"')
    expect(linked).toContain('href="#documentation-"')

    // Verbatim from vuejs/vue-loader README.md: image alt is NOT part of the slug
    const withImg = md().render('# vue-loader ![ci](https://example.com/b.svg)\n')
    expect(withImg).toContain('<a id="user-content-vue-loader-" class="anchor"')
    expect(withImg).toContain('aria-label="Permalink: vue-loader "')

    // Verbatim from pvorb/clone README.md: code_inline content counts
    const code = md().render('### `clone(value, opts)`\n')
    expect(code).toContain('<a id="user-content-clonevalue-opts" class="anchor"')
    expect(code).toContain('aria-label="Permalink: clone(value, opts)"')
  })

  it('suffixes duplicate slugs with -1 / -2 per document', () => {
    const html = md().render('# Dup\n\n# Dup\n\n# Dup\n')
    expect(html).toContain('id="user-content-dup"')
    expect(html).toContain('id="user-content-dup-1"')
    expect(html).toContain('id="user-content-dup-2"')
  })

  it('restarts slug dedup state for every render call', () => {
    const engine = md()
    expect(engine.render('# Dup\n')).toContain('id="user-content-dup"')
    expect(engine.render('# Dup\n')).toContain('id="user-content-dup"')
    expect(engine.render('# Dup\n')).not.toContain('id="user-content-dup-1"')
  })

  it('handles punctuation, emoji, CJK and leading digits like GitHub', () => {
    // Verbatim slug outputs observed on github.com
    expect(md().render('## 📁 examples\n')).toContain('id="user-content--examples"')
    expect(md().render('## Arch (AUR)\n')).toContain('id="user-content-arch-aur"')
    expect(md().render('## axios.delete(url[, config])\n')).toContain(
      'id="user-content-axiosdeleteurl-config"',
    )
    // CJK survives verbatim; leading digits are kept (no HTML4-style prefixing)
    expect(md().render('## 中文标题\n')).toContain('id="user-content-中文标题"')
    expect(md().render('## 2025\n')).toContain('id="user-content-2025"')
  })

  it('emits an empty slug for a heading with no text content', () => {
    const html = md().render('# ![only an image](https://example.com/x.png)\n')
    expect(html).toContain('<a id="user-content-" class="anchor" aria-label="Permalink: " href="#">')
  })
})
