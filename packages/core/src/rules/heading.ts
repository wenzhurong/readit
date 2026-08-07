import GithubSlugger from 'github-slugger'
import type { MarkdownIt, StateCore, Token } from 'markdown-it'

/**
 * Byte-verbatim copy of the permalink icon GitHub emits, captured 2026-08-06 from
 * GET /repos/markdown-it/markdown-it/contents/README.md
 * (Accept: application/vnd.github.html). Attribute order is GitHub's.
 */
export const OCTICON_LINK =
  '<svg data-component="Octicon" class="octicon octicon-link" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true">' +
  '<path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"></path>' +
  '</svg>'

export interface HeadingAnchorMeta {
  readitSlug: string
  readitLabel: string
}

/**
 * Text content of a heading, as GitHub computes it for the slug and aria-label:
 * every descendant text node, with `<img>` alt text excluded.
 */
function headingText(children: readonly Token[]): string {
  let out = ''
  for (const token of children) {
    if (token.type === 'image') continue
    if (token.type === 'text' || token.type === 'code_inline') out += token.content
    else if (token.type === 'softbreak' || token.type === 'hardbreak') out += '\n'
  }
  return out
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Must be applied BEFORE applyDirAuto so that `class` lands on the heading token
 * ahead of `dir`, matching GitHub's `<h2 class="heading-element" dir="auto">`.
 */
export function applyHeadingAnchors(md: MarkdownIt): void {
  md.core.ruler.push('readit_heading_anchor', (state: StateCore) => {
    const slugger = new GithubSlugger()
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]
      if (open === undefined || open.type !== 'heading_open') continue
      const inline = tokens[i + 1]
      const label =
        inline !== undefined && inline.type === 'inline'
          ? headingText(inline.children ?? [])
          : ''
      const meta: HeadingAnchorMeta = { readitSlug: slugger.slug(label), readitLabel: label }
      open.attrSet('class', 'heading-element')
      open.meta = Object.assign({}, open.meta, meta)
      const close = tokens[i + 2]
      if (close !== undefined && close.type === 'heading_close') {
        close.meta = Object.assign({}, close.meta, meta)
      }
    }
    return true
  })

  md.renderer.rules.heading_open = (tokens, idx, options, _env, self) =>
    '<div class="markdown-heading" dir="auto">' + self.renderToken(tokens, idx, options)

  md.renderer.rules.heading_close = (tokens, idx) => {
    const token = tokens[idx]
    if (token === undefined) return ''
    const meta = (token.meta ?? {}) as Partial<HeadingAnchorMeta>
    const slug = meta.readitSlug ?? ''
    const label = meta.readitLabel ?? ''
    return (
      '</' +
      token.tag +
      '><a id="user-content-' +
      slug +
      '" class="anchor" aria-label="Permalink: ' +
      escapeAttr(label) +
      '" href="#' +
      slug +
      '">' +
      OCTICON_LINK +
      '</a></div>\n'
    )
  }
}
