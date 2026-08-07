import type { MarkdownIt, RendererRule } from 'markdown-it'

/**
 * The nine tags GFM's `tagfilter` extension neutralises. They are singled out
 * because each one changes how the *rest* of the document is tokenised.
 */
export const TAGFILTER_TAGS = [
  'title',
  'textarea',
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'script',
  'plaintext',
] as const

/**
 * Matches the leading `<` of `<tag`, `</tag` when the tag name is followed by
 * whitespace, `/` or `>`. A trailing character is required, so `<title` at the
 * very end of the input is left alone (cmark-gfm: `tag_size > i + tlen`).
 */
const TAGFILTER_RE = new RegExp(`<(/?(?:${TAGFILTER_TAGS.join('|')})(?=[\\s/>]))`, 'gi')

/** Replace the leading `<` of a disallowed raw-HTML tag with `&lt;`. */
export function filterDisallowedTags(html: string): string {
  return html.replace(TAGFILTER_RE, '&lt;$1')
}

/**
 * Register the GFM `tagfilter` extension. It rewrites only the nine listed
 * tags; every other raw-HTML tag is passed through untouched, because
 * sanitisation is a separate, later stage (SPEC 6.1).
 *
 * Chains rather than replaces `html_block`/`html_inline`: this rule lives in
 * the SEMANTIC slot, which loads before SHAPE, and any later rule that also
 * touches raw-HTML rendering must not silently clobber this one (cross-rule
 * contract C3(b)). Must therefore be `.use()`d after any other rule that
 * overrides these two renderer rules.
 */
export function applyTagfilter(md: MarkdownIt): void {
  const prevBlock: RendererRule | undefined = md.renderer.rules.html_block
  md.renderer.rules.html_block = (tokens, idx, opts, env, self) => {
    const out = prevBlock ? prevBlock(tokens, idx, opts, env, self) : (tokens[idx]?.content ?? '')
    return filterDisallowedTags(out)
  }

  const prevInline: RendererRule | undefined = md.renderer.rules.html_inline
  md.renderer.rules.html_inline = (tokens, idx, opts, env, self) => {
    const out = prevInline ? prevInline(tokens, idx, opts, env, self) : (tokens[idx]?.content ?? '')
    return filterDisallowedTags(out)
  }
}
