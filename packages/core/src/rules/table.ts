import type { MarkdownIt, StateCore, Token } from 'markdown-it'

/**
 * markdown-it emits `style="text-align:center"`; GitHub emits the legacy
 * `align="center"` attribute and wraps the whole table in the
 * `<markdown-accessiblity-table>` custom element. The element name is
 * misspelled upstream (one `i` short of "accessibility") — that spelling is
 * the observed byte, verified 2026-08-06 against
 * GET /repos/axios/axios/contents/README.md.
 */
const STYLE_TO_ALIGN: Readonly<Record<string, string>> = {
  'text-align:left': 'left',
  'text-align:center': 'center',
  'text-align:right': 'right',
}

function rewriteAlign(token: Token): void {
  const attrs = token.attrs
  if (attrs === null) return
  for (const attr of attrs) {
    if (attr[0] !== 'style') continue
    const align = STYLE_TO_ALIGN[String(attr[1])]
    if (align === undefined) continue
    attr[0] = 'align'
    attr[1] = align
  }
}

/**
 * SEMANTIC: rewrites `style="text-align:*"` into GitHub's legacy `align`
 * attribute. Rewriting `attr[0]`/`attr[1]` in place (rather than `attrSet` +
 * delete) is deliberate: it leaves `align` sitting in `style`'s original
 * position, so attribute order does not shift. This half alone matches what
 * the GFM conformance suite expects (a bare `<table>` with `align="..."`).
 */
export function applyTableAlign(md: MarkdownIt): void {
  md.core.ruler.push('readit_table_align', (state: StateCore) => {
    for (const token of state.tokens) {
      if (token.type === 'th_open' || token.type === 'td_open') rewriteAlign(token)
    }
    return true
  })
}

/**
 * SHAPE: wraps the table in GitHub's `<markdown-accessiblity-table>` custom
 * element (GitHub really is missing an `i`). `table_close` is hand-built
 * rather than delegated to `self.renderToken`, because GitHub emits
 * `</table></markdown-accessiblity-table>\n` with no newline between the two
 * closing tags.
 */
export function applyTableWrapper(md: MarkdownIt): void {
  md.renderer.rules.table_open = (tokens, idx, options, _env, self) =>
    '<markdown-accessiblity-table>' + self.renderToken(tokens, idx, options)

  md.renderer.rules.table_close = () => '</table></markdown-accessiblity-table>\n'
}
