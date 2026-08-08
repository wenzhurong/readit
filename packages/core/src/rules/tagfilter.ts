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
 * ## Why `createEngine` registers this rule TWICE
 *
 * A filter wants to be OUTERMOST — every other override's output should pass
 * through it. Chaining nests inner-first, so "outermost" means "registered
 * last". From `SEMANTIC_RULES` this rule is registered FIRST: `createEngine`
 * runs that array before `SHAPE_RULES` and before everything else, making this
 * the INNERMOST link. With
 * `md.renderer.rules.html_block = (...a) => prev(...a) + X` in a later slot,
 * this rule IS `prev`, so `X` is appended AFTER filtering and is not
 * neutralised.
 *
 * The array slot cannot simply be given up: the GFM spec suite reaches this
 * rule through `SEMANTIC_RULE_BY_EXTENSION` (info string `tagfilter`, GFM
 * example 652), and `SEMANTIC_RULES` is pinned equal to that map's values by
 * the slot ratchet in test/integration.test.ts. Moving out of the array would
 * break the ratchet that guards all thirteen SHAPE rules.
 *
 * Stay-vs-move was a false dichotomy. `createEngine` keeps the array
 * membership AND calls `applyTagfilter` again as its last step, so this rule is
 * the innermost and the outermost link at once and the gap is CLOSED.
 *
 * That works because `filterDisallowedTags` is idempotent: after one pass the
 * nine tags are already `&lt;`-escaped, and the regex needs a literal `<`
 * before the tag name, so a second pass is the identity and can never produce
 * `&amp;lt;`. Measured 2026-08-08: 200 000 random strings over an alphabet of
 * `<`, `</`, `>`, `/`, space, `&lt;`, `&amp;`, quote, newline and the nine tag
 * names, plus every string up to length 5 over an 8-symbol hostile alphabet
 * (37 448 cases) — zero counterexamples; the exhaustive half is a test. Double
 * registration is byte-free on the whole corpus (166 documents × both
 * `allowDangerousHtml` modes) and on 14 tags × 7 chunk shapes × both modes.
 *
 * `rules/rawshape.ts` is unaffected either way: it is a CORE rule rewriting
 * `token.content`, not a renderer override, so it is not part of this chain at
 * all, and renderers always run after every core rule.
 *
 * ## What this still asks of a future rule
 *
 * The engine now wraps you, so `prev(...) + X` is safe in `createEngine`. Two
 * caveats remain:
 *
 *  1. Preferred anyway — do not emit raw tag text from a renderer override.
 *     Rewrite `token.content` from a core rule instead (that is what
 *     `rules/rawshape.ts` does, and why its C3(a) note records that C3(b) is
 *     not engaged), or emit through a `readit_raw` token.
 *  2. `createSpecEngine` does NOT re-register this rule — it loads only the
 *     rules it is given, and the spec suite passes at most one. Anything built
 *     by hand out of these `applyXxx` functions gets only the innermost link,
 *     so a renderer override registered after `applyTagfilter` in such an
 *     engine must run `filterDisallowedTags` (exported above) over its own
 *     contribution. Idempotence makes applying it to the whole concatenation
 *     safe.
 */
/**
 * Wrap one renderer rule in `filterDisallowedTags`, chaining the rule that is
 * already there.
 *
 * There is deliberately no "no previous rule" arm. `noUncheckedIndexedAccess`
 * types `rules[name]` as possibly `undefined`, but markdown-it seeds
 * `Renderer.rules` from its own `default_rules`, and `html_block` /
 * `html_inline` are two of the nine entries in it — verified on 15.0.0 for a
 * bare `new MarkdownIt()` as well as for the configured instance `engine.ts`
 * builds. A render-time fallback reading `tokens[idx].content` was therefore
 * dead code that could never be exercised or tested. It is replaced by a loud
 * assertion at REGISTRATION time: if a future markdown-it stops seeding these,
 * the engine fails to build instead of silently rendering through an untested
 * path. This cannot be reached from document input, so `render()` stays total.
 */
function chainFilter(md: MarkdownIt, name: 'html_block' | 'html_inline'): void {
  const prev: RendererRule | undefined = md.renderer.rules[name]
  if (!prev) throw new Error(`readit: markdown-it does not define renderer.rules.${name}`)
  md.renderer.rules[name] = (tokens, idx, opts, env, self) =>
    filterDisallowedTags(prev(tokens, idx, opts, env, self))
}

export function applyTagfilter(md: MarkdownIt): void {
  chainFilter(md, 'html_block')
  chainFilter(md, 'html_inline')
}
