import MarkdownIt from 'markdown-it'
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it'
import { applyMathInline, type ReaditEnv } from '../../src/rules/math-inline.js'
import type { ExplainEntry, InlineMathMode } from '../../src/types.js'

export interface CorpusCase {
  id: string
  src: string
  /** Delimited math spans github.com produced, in document order. */
  gh: string[]
  html: string
}

/** Undo the HTML escaping applied to the payload of a <math-renderer> element. */
export function decodeEntities(x: string): string {
  return x
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function build(html: boolean): MarkdownItInstance {
  const md = new MarkdownIt({ html })
  applyMathInline(md)
  return md
}

/**
 * Both shapes of the no-renderer fallback element, so this stays "every math
 * span readit produced" and cannot silently drop one by matching too narrowly.
 * The class and the `style` are matched as a pair, not as two independent
 * alternations, so a half-applied shape change fails here instead of slipping
 * through. Exact shape lives in `mathFallbackElement` and is pinned by name in
 * `test/rules/math-inline.test.ts`; this regex only has to find the elements.
 */
const MATH_ELEMENT_SOURCE =
  '<math-renderer (?:class="js-inline-math" style="display: inline-block"' +
  '|class="js-display-math" style="display: block")>([\\s\\S]*?)</math-renderer>'

/** The delimited math spans readit produces, in document order. */
export function mathSpans(src: string, inlineMath: InlineMathMode = 'github', html = false): string[] {
  const env: ReaditEnv = { readit: { inlineMath } }
  const out = build(html).render(src, env)
  const re = new RegExp(MATH_ELEMENT_SOURCE, 'g')
  const spans: string[] = []
  let m: RegExpExecArray | null
  // noUncheckedIndexedAccess: a capture group is `string | undefined` even
  // though the pattern guarantees it matched; `?? ''` satisfies the compiler
  // without changing behavior (the group can never actually be absent here).
  while ((m = re.exec(out)) !== null) spans.push(decodeEntities(m[1] ?? ''))
  return spans
}

/** The explain log for a source string, in decision order. */
export function explainOf(src: string, inlineMath: InlineMathMode = 'github'): ExplainEntry[] {
  const env: ReaditEnv = { readit: { inlineMath, explain: true } }
  build(false).render(src, env)
  return env.readitExplain ?? []
}
