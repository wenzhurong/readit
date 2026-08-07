import type { MarkdownIt, StateCore } from 'markdown-it'

/**
 * Stamps `data-line="<zero-based source line>"` onto every block token that
 * carries a `map`, so Phase B can drive scroll sync. This is readit's own
 * addition — GitHub's blob-view HTML never emits `data-line` — so the SPEC
 * §13.1 snapshot normalizer must strip it before comparing against GitHub's
 * output; that stripping is a later task, not this rule's job.
 *
 * Measured on markdown-it 15.0.0: `map` is present on block opening tokens
 * (`paragraph_open`, `heading_open`, `bullet_list_open`, `list_item_open`,
 * `blockquote_open`, `table_open`, `thead_open`, `tbody_open`, `tr_open`) and
 * on self-contained block tokens (`fence`, `code_block`, `html_block`, `hr`).
 * It is `null` on every closing token, on `th_open`/`td_open`, and on every
 * child of an `inline` token. `inline` tokens themselves do carry their
 * parent's map, so they are excluded explicitly — annotating them would put
 * the attribute on nothing (they have no tag) while polluting the token
 * stream.
 *
 * Granularity is therefore block-level, not character-level: markdown-it's
 * inline tokenizer never attaches a map to inline children, so a future
 * cursor-precise sync feature cannot be built on this rule without patching
 * markdown-it's inline parser itself.
 *
 * Two rules already forward this attribute through hand-built renderers
 * rather than `renderToken`: `alerts.ts`'s `alert_open` and `codeblock.ts`'s
 * `fence`/`code_block` renderers both read `token.attrGet('data-line')` and
 * re-emit it. This rule only needs to set the attribute; it must run after
 * those forwarders' token mutations are in place to have something to stamp,
 * but that ordering is Task 32's responsibility, not this file's.
 */
export function applySourceLine(md: MarkdownIt): void {
  md.core.ruler.push('readit_sourceline', (state: StateCore) => {
    for (const token of state.tokens) {
      if (token.map === null || token.type === 'inline' || token.nesting === -1) continue
      token.attrSet('data-line', String(token.map[0]))
    }
    return true
  })
}
