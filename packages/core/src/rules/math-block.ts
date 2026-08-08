import type { MarkdownIt, StateCore, Token } from 'markdown-it'
import { mathFallbackElement, mathInlineRenderer, type ReaditEnv } from './math-inline.js'

/**
 * The two block-level math constructs of SPEC §8.4, both of which SPEC §8.6
 * requires to keep working under `inlineMath: 'off'` — so neither may sit
 * behind `applyMathInline`'s mode gate, and this rule reads no mode at all.
 *
 * They are deliberately *not* symmetric, because GitHub's measured output is
 * not (`test/fixtures/frontend/math-block.html`, `math-fence.html`):
 *
 *   1. A `$$…$$` paragraph is an **inline-level** construct. GitHub wraps it in
 *      `<p dir="auto">` and resolves CommonMark backslash escapes inside it
 *      (`\,` comes back out as a bare `,`), both of which are only possible if
 *      the text went through the paragraph's inline pipeline. So this rule runs
 *      after `inline`, over an inline token's already-parsed children, and
 *      emits the same `math_inline` token the dollar guard emits — no new block
 *      token, no `<p>` suppression.
 *   2. A ```` ```math ```` fence is genuinely block-level: GitHub emits the
 *      `<math-renderer>` at top level with no `<p>` around it. That needs its
 *      own block token, `math_block`.
 *
 * **Why the fence is converted rather than rendered.** `createEngine` calls
 * `applyCodeBlock(md, opts.highlighter)` *after* the `SHAPE_RULES` loop, and
 * that unconditionally assigns `md.renderer.rules.fence`. A fence renderer
 * installed from this file would therefore be silently replaced. Rewriting the
 * token's *type* in a core rule sidesteps the question: the code-block renderer
 * is never handed a math fence in the first place, whatever the registration
 * order is.
 *
 * **Why `after('inline')` and not `before('readit_math_inline')`.** Naming the
 * guard's rule would make this file fail outright when applied on its own.
 * `inline` is a stock core rule, and `applyMathInline` inserts itself
 * `before('text_join')` — which is after `inline` — so anchoring here puts this
 * rule ahead of the guard no matter which `applyXxx` ran first.
 *
 * Running ahead of the guard is load bearing, not cosmetic. `$$\na $b$ c\n$$`
 * is one display block whatever `inlineMath` says; if the guard went first it
 * would (in `github` mode only) turn the inner `$b$` into a `math_inline`
 * child, which this rule then has to treat as an opaque boundary — and the
 * same paragraph would mean two different things in two modes.
 */
export function applyMathBlock(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'readit_math_block', (state: StateCore) => {
    const tokens = state.tokens
    for (const [i, tok] of tokens.entries()) {
      if (tok.type === 'fence') {
        if (fenceLanguage(tok) === 'math') {
          tok.type = 'math_block'
          // GitHub supplies the `$$` delimiters itself (the source has none)
          // and does so around the trimmed body — including the trailing
          // newline every fence token's content carries.
          tok.content = tok.content.trim()
        }
        continue
      }
      if (tok.type !== 'inline') continue
      if (tokens[i - 1]?.type !== 'paragraph_open') continue
      const children = tok.children
      const tex = displayParagraphTex(children)
      if (tex === null) continue
      const math = new state.Token('math_inline', 'math', 0)
      math.markup = '$$'
      math.content = tex
      math.level = children?.[0]?.level ?? 0
      tok.children = [math]
    }
  })

  // No `data-line`, deliberately, even though `applySourceLine` does stamp the
  // attribute on this token (it kept the fence's `map`). Both other hand-built
  // block renderers forward it, but they emit a wrapper element of readit's own
  // choosing; here the element is a reproduction of GitHub's, and the
  // renderer-supplied branch below has nowhere to put the attribute at all.
  // Forwarding it in one branch only would be worse than not forwarding it.
  md.renderer.rules.math_block = (tokens, idx, _options, env): string => {
    const token = tokens[idx]
    if (!token) return ''
    const renderer = (env as ReaditEnv | undefined)?.readit?.math
    const body = renderer
      ? renderer.render(token.content, true)
      : mathFallbackElement(md, `$$${token.content}$$`, true)
    return body + '\n'
  }

  // `math_inline` is normally registered by applyMathInline, which createEngine
  // loads alongside this rule. The idempotent `??=` (the same pattern
  // engine.ts's registerReaditRaw uses) is what lets this file stand alone in a
  // unit test without depending on the guard being applied too.
  md.renderer.rules.math_inline ??= mathInlineRenderer(md)
}

/**
 * The fence's language, derived by exactly the expression `codeblock.ts` uses.
 * Keeping the two derivations identical is what guarantees no fence can ever
 * be math to this rule and a highlightable language to that one.
 */
function fenceLanguage(token: Token): string {
  return token.info.trim().split(/\s+/)[0] ?? ''
}

/**
 * The TeX of a paragraph that is *entirely* one `$$…$$` display span crossing
 * at least one line break, or null if the paragraph is anything else.
 *
 * The line-break requirement is what keeps this rule and the dollar guard
 * disjoint rather than merely ordered: R4 abandons a candidate at the first
 * `\n`, so a span containing one is precisely the span the guard can never
 * claim. A single-line `$$a+b$$` paragraph is therefore left to the guard —
 * that is SPEC §8.4's "inline `$$` display", not its "block `$$` (on its own
 * line)" — which also means this rule cannot loosen R1–R8 by accident.
 *
 * Only `text`, `text_special` and `softbreak` children are joinable.
 * Everything else (code spans, emphasis, links, images, raw HTML, hard breaks)
 * is an opaque boundary exactly as it is for the guard (R10): a paragraph
 * containing one is not one block of TeX, and is left alone.
 */
function displayParagraphTex(children: readonly Token[] | null): string | null {
  if (children === null || children.length === 0) return null
  let s = ''
  for (const t of children) {
    if (t.type === 'text' || t.type === 'text_special') s += t.content
    else if (t.type === 'softbreak') s += '\n'
    else return null
  }
  if (!s.startsWith('$$') || !s.endsWith('$$')) return null
  // Well defined for every short string too: '$$', '$$$' and '$$$$' all slice
  // to '', which the blank check below rejects — R8's "content is non-empty",
  // read as "has something to typeset" rather than "has any character at all",
  // since here the interior always holds at least the line break.
  const tex = s.slice(2, -2)
  // A second `$$` inside means the paragraph holds two spans, not one; the
  // first closer is not the last one, so this is not a whole-paragraph span.
  if (tex.includes('$$') || !tex.includes('\n') || tex.trim() === '') return null
  return tex
}
