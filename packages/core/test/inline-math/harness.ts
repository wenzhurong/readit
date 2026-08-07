import MarkdownIt from 'markdown-it'
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it'
import { applyMathInline, type ReaditEnv } from '../../src/rules/math-inline.js'
import type { InlineMathMode } from '../../src/types.js'

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

/** The delimited inline-math spans readit produces, in document order. */
export function mathSpans(src: string, inlineMath: InlineMathMode = 'github', html = false): string[] {
  const env: ReaditEnv = { readit: { inlineMath } }
  const out = build(html).render(src, env)
  const re = /<math-renderer class="js-inline-math">([\s\S]*?)<\/math-renderer>/g
  const spans: string[] = []
  let m: RegExpExecArray | null
  // noUncheckedIndexedAccess: a capture group is `string | undefined` even
  // though the pattern guarantees it matched; `?? ''` satisfies the compiler
  // without changing behavior (the group can never actually be absent here).
  while ((m = re.exec(out)) !== null) spans.push(decodeEntities(m[1] ?? ''))
  return spans
}
