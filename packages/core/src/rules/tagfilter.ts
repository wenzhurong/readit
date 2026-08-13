import type { MarkdownIt, RendererRule, Token } from 'markdown-it'

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
 * break the ratchet that guards all 12 SHAPE rules.
 *
 * Stay-vs-move was a false dichotomy. `createEngine` keeps the array
 * membership AND calls `applyTagfilter` again as its last step, so this rule is
 * the innermost and the outermost link at once and the gap is CLOSED.
 *
 * That works because `filterDisallowedTags` is idempotent. This does not rest
 * on a sample; it is a three-step proof about `TAGFILTER_RE` above, and the
 * only thing it needs from that regex is that the replacement is `'&lt;$1'`,
 * that `$1` is `/?tagname`, and that the lookahead class is `[\s/>]`:
 *
 *  1. A pass never CREATES a `<`. `&lt;` contains none and `$1` contains none,
 *     and unmatched text is copied verbatim. So the output is exactly the
 *     input with some `<` characters expanded to `&lt;`, and every `<` still in
 *     the output is one the pass did not match.
 *  2. A pass never turns one of those survivors into a match. A match needs
 *     `<` + `/?tagname` + one character from `[\s/>]`. The `/?tagname` span
 *     cannot overlap an inserted `&lt;`: any overlap drags in that unit's `&`
 *     or its `;`, and neither is `/` nor a letter of any of the nine names (a
 *     span lying wholly inside the four characters `&`,`l`,`t`,`;` is no tag
 *     name either). So the span is untouched input. The character after it is
 *     then either untouched input or the `&` that begins an inserted `&lt;` —
 *     and `&` is not in `[\s/>]`. Either way the lookahead reads what it read
 *     on the first pass, so a survivor was already unmatchable.
 *  3. No `<` is skipped over by `lastIndex`: a match consumes `<` and
 *     `/?tagname`, and `/?tagname` contains no `<`.
 *
 * Fixpoint after one pass, for every input; `&amp;lt;` is unreachable. The
 * exhaustive case in test/rules/tagfilter.test.ts (every string up to length 4
 * over an 8-symbol hostile alphabet, 4680 cases) is kept as a regression guard
 * on the regex, not as the support for the claim.
 *
 * Double registration is therefore byte-free, and the test file measures that
 * against a genuinely single-registered engine rather than asserting it — see
 * the "outermost in createEngine" suite there for how one is built and for the
 * committed sweep (9 tags × 7 document shapes × both `allowDangerousHtml`
 * modes = 126 documents, 0 byte differences).
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

/** The core rule's name, exported so a test can count its registrations. */
export const TAGFILTER_CORE_RULE = 'readit_tagfilter'

/**
 * Instances that already carry the core rule.
 *
 * `createEngine` calls `applyTagfilter` twice on purpose (see the long note
 * above), and the RENDERER half is free to run twice — `filterDisallowedTags`
 * is idempotent. The CORE half is not merely redundant on a second pass, it is
 * misplaced: the second `applyTagfilter(md)` happens after `applyRawShape`, so
 * a second core rule would run readit's OWN generated markup — the raw shapes
 * C3(a) sanctions precisely because the sanitizer can no longer see them —
 * through a filter written for author HTML. Registering once keeps the core
 * rule where the extension belongs, on the author's raw chunks.
 *
 * The symbol flag lives on each `md` instance (two engines are independent)
 * instead of in a module-level collection. It is registration-time bookkeeping
 * only — it is not read during rendering and cannot make one `render()` differ
 * from another. Keeping the flag on the owned instance also avoids shared
 * mutable module state on Phase A's path.
 */
const CORE_RULE_REGISTERED = Symbol('readit_tagfilter_core_registered')
type RegisteredMarkdownIt = MarkdownIt & { [CORE_RULE_REGISTERED]?: true }

/**
 * Apply the filter to raw-HTML `token.content`, as a core rule.
 *
 * ## Why the renderer chain is not enough, and why THIS runs first
 *
 * GFM's `tagfilter` is specified as an ESCAPE, not a delete: cmark-gfm rewrites
 * the leading `<` of the nine tags and emits everything else verbatim. GitHub's
 * pipeline then sanitizes cmark-gfm's OUTPUT, by which point those nine are
 * already inert text and there is nothing for a whitelist to reject.
 *
 * readit had that order inverted. `applyRawHtmlPolicy(false)` -> `applySanitize`
 * is a CORE-rule token transform (`applyRawHtmlTransform` in rules/clobber.ts)
 * that rewrites `token.content`, and every core rule runs before any renderer.
 * `hast-util-sanitize`'s `defaultSchema` lists none of `title`, `textarea`,
 * `style`, `xmp`, `iframe`, `noembed`, `noframes`, `script` or `plaintext` in
 * `tagNames`, so it unwrapped eight of them and stripped `script` with its body
 * — and the renderer-level filter arrived to find nothing left to escape.
 * Measured on `test/corpus/gfm/tagfilter.md`, readit emitted
 * `x y z a c&#x3C;/plaintext>` where GitHub emits all nine elements intact.
 *
 * So this pass is registered as a core rule EARLIER than the sanitizer's, which
 * with `md.core.ruler.push` simply means registered earlier — `createEngine`
 * runs `SEMANTIC_RULES` (this rule's slot) before `applyRawHtmlPolicy`. That
 * single ordering fact is what the whole fix is. It is not a second filter and
 * not a weakening of the sanitizer: the nine names are turned into text, and
 * everything else in the chunk reaches `sanitizeTree` exactly as before.
 *
 * ## Both modes, and what changes in each
 *
 * Registered unconditionally, because the fix is an ORDER and the order is the
 * same one GitHub uses in both cases. Under `allowDangerousHtml: true` the
 * escaping was already visible (nothing deleted the tags), so the change there
 * is only that it happens before `prefixUserContentTree` instead of after. Two
 * consequences, both improvements:
 *
 *  - the escape is re-serialised by hast, so it reads `&#x3C;` rather than
 *    `&lt;`. Same character; normalisation collapses them.
 *  - `<plaintext>` stops corrupting the document. parse5 switches to PLAINTEXT
 *    mode on a real `<plaintext>` tag and swallows the rest of the input as raw
 *    text, which used to produce a doubly-escaped `&#x26;#x3C;/plaintext>` and a
 *    duplicated closing tag. Defusing it first means parse5 never sees a tag.
 *
 * ## Why not a `renderer.rules` fix, or a change to the sanitizer's schema
 *
 * Adding the nine to `SCHEMA.tagNames` would make the sanitizer KEEP them as
 * live elements — a real `<script>` in the output — which is the opposite of
 * what tagfilter is for. Doing it in the renderer cannot work at all: the
 * content is already gone by then. The only place that reproduces GitHub is
 * before the sanitizer's transform, which is where this sits.
 *
 * ## Deliberately NOT exported
 *
 * This is one half of `applyTagfilter`, not a rule in its own right. The rule
 * registry in test/integration.test.ts requires every EXPORTED `applyXxx` in
 * `src/` to be wired at one of `createEngine`'s three sites, and rightly so —
 * an exported rule nothing calls is a rule that silently does not run. Half a
 * rule has no business claiming one of those slots, so it stays private and
 * `applyTagfilter` remains the single public entry point.
 */
function registerRawContentFilter(md: MarkdownIt): void {
  const registered = md as RegisteredMarkdownIt
  if (registered[CORE_RULE_REGISTERED]) return
  registered[CORE_RULE_REGISTERED] = true
  md.core.ruler.push(TAGFILTER_CORE_RULE, (state) => {
    const filter = (token: Token): void => {
      token.content = filterDisallowedTags(token.content)
    }
    for (const token of state.tokens) {
      if (token.type === 'html_block') filter(token)
      else if (token.type === 'inline' && token.children) {
        for (const child of token.children) {
          if (child.type === 'html_inline') filter(child)
        }
      }
    }
    return true
  })
}

export function applyTagfilter(md: MarkdownIt): void {
  registerRawContentFilter(md)
  chainFilter(md, 'html_block')
  chainFilter(md, 'html_inline')
}
