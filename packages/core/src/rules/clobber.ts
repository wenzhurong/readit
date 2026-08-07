import type { MarkdownIt, Token } from 'markdown-it'
import type { Element, Root } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'

export const CLOBBER_PREFIX = 'user-content-'

/**
 * markdown-it hands raw HTML out in unbalanced chunks (`<div>\n` and `</div>\n`
 * are two `html_block` tokens with markdown between them). Parsing a chunk on
 * its own destroys it: `hast-util-from-html('</div>')` yields nothing at all.
 *
 * So the whole run is joined with a text sentinel, parsed once, transformed,
 * serialised and split back. The sentinel is plain text, so it survives the
 * round trip everywhere text is allowed. The one place it does not is inside a
 * `<table>`, where the HTML parser foster-parents it out; that case is pinned
 * by a test rather than silently mis-handled.
 *
 * The sentinel uses U+E000 (private use area) so it can never collide with real
 * document text, and unlike ASCII whitespace or NUL it survives the HTML
 * parser's text normalisation unchanged.
 */
const SENTINEL = 'readit-raw-html'

export function transformRawHtmlChunks(
  chunks: readonly string[],
  transform: (tree: Root) => Root,
): string[] {
  if (chunks.length === 0) return []
  const tree = fromHtml(chunks.join(SENTINEL), { fragment: true })
  const parts = toHtml(transform(tree)).split(SENTINEL)
  if (parts.length !== chunks.length) {
    throw new Error(
      `raw HTML run lost its structure: ${chunks.length} chunks in, ${parts.length} out`,
    )
  }
  return parts
}

/** Walks the token stream in document order and rewrites every raw HTML chunk. */
export function applyRawHtmlTransform(
  md: MarkdownIt,
  ruleName: string,
  transform: (tree: Root) => Root,
): void {
  md.core.ruler.push(ruleName, (state) => {
    const targets: Token[] = []
    for (const token of state.tokens) {
      if (token.type === 'html_block') targets.push(token)
      else if (token.type === 'inline' && token.children) {
        for (const child of token.children) {
          if (child.type === 'html_inline') targets.push(child)
        }
      }
    }
    if (targets.length === 0) return true
    const out = transformRawHtmlChunks(
      targets.map((t) => t.content),
      transform,
    )
    for (const [i, token] of targets.entries()) token.content = out[i] ?? token.content
    return true
  })
}

function walk(node: Root | Element, visit: (el: Element) => void): void {
  for (const child of node.children) {
    if (child.type === 'element') {
      visit(child)
      walk(child, visit)
    }
  }
}

/**
 * GitHub's anti-clobbering filter: `id` on any element and `name` on anchors
 * get a `user-content-` prefix. `href="#slug"` is deliberately left alone —
 * that asymmetry is what §11.2 of the spec bridges in Phase B.
 *
 * Idempotent, unlike `hast-util-sanitize`'s `clobberPrefix`, which turns an
 * already-prefixed `user-content-x` into `user-content-user-content-x`.
 * GitHub does not (measured against POST /markdown, 2026-08-06).
 */
export function prefixUserContentTree(tree: Root): Root {
  walk(tree, (el) => {
    const props = el.properties
    for (const key of ['id', 'name'] as const) {
      if (key === 'name' && el.tagName !== 'a') continue
      const value = props[key]
      if (typeof value !== 'string' || value.startsWith(CLOBBER_PREFIX)) continue
      props[key] = CLOBBER_PREFIX + value
    }
  })
  return tree
}

/** Convenience wrapper for a single, self-contained HTML fragment. */
export function prefixUserContent(html: string): string {
  return toHtml(prefixUserContentTree(fromHtml(html, { fragment: true })))
}

export function applyClobber(md: MarkdownIt): void {
  applyRawHtmlTransform(md, 'readit_clobber', prefixUserContentTree)
}
