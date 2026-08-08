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
 * Chains rather than replaces `html_block`/`html_inline`, per cross-rule
 * contract C3(b): a later rule that also touches raw-HTML rendering must not
 * silently clobber this one, and this one must not clobber an earlier one.
 *
 * ## The half of C3(b) this rule CANNOT satisfy, and what that means for you
 *
 * A filter wants to be OUTERMOST — every other override's output should pass
 * through it. Chaining nests inner-first, so "outermost" means "registered
 * last". This rule is registered FIRST: it is a member of `SEMANTIC_RULES`
 * (engine.ts), and `createEngine` runs that array before `SHAPE_RULES` and
 * before everything else. It is therefore the INNERMOST link, and the
 * requirement an earlier version of this comment stated — "must be `.use()`d
 * after any other rule that overrides these two renderer rules" — is
 * structurally unsatisfiable from the SEMANTIC slot. It is corrected here
 * rather than acted on, because the slot is load-bearing for a different
 * reason: the GFM spec suite reaches this rule through
 * `SEMANTIC_RULE_BY_EXTENSION` (info string `tagfilter`, GFM example 652), and
 * `SEMANTIC_RULES` is pinned equal to that map's values by the slot ratchet in
 * test/integration.test.ts. Leaving the array would break the ratchet that
 * guards all thirteen SHAPE rules, to close a hazard that is latent — see
 * below — so the array membership wins and this comment tells the truth
 * instead.
 *
 * Concretely: with `md.renderer.rules.html_block = (...a) => prev(...a) + X`,
 * this rule IS `prev`, so `X` is appended AFTER filtering and is not
 * neutralised. Pinned by "KNOWN GAP" in test/rules/tagfilter.test.ts.
 *
 * Nothing overrides these two renderer rules today except this rule, so the
 * gap is unreachable. A future rule that wants to override them must close it
 * itself, by one of:
 *
 *  1. Preferred — do not emit raw tag text from a renderer override at all.
 *     Rewrite `token.content` from a core rule instead (that is what
 *     `rules/rawshape.ts` does, and why its C3(a) note records that C3(b) is
 *     not engaged), or emit through a `readit_raw` token. Either way this
 *     rule's renderer still sees the final content and still filters it.
 *  2. Run `filterDisallowedTags` (exported above) over anything the override
 *     contributes on top of `prev(...)`. Filtering is idempotent — the nine
 *     tags are already `&lt;`-escaped once this rule has run — so applying it
 *     to the whole concatenation is safe.
 *
 * What a future rule must NOT do is assume this rule wraps it.
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
