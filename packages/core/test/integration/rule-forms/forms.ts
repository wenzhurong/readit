import type { MarkdownIt } from 'markdown-it'

/**
 * Fixture, not a rule. Declaration forms that a real `src/rules/*.ts` could use
 * for an `applyXxx` export and that the REGEX the "rule registry" completeness
 * guard used to scan with — `/^export (?:function|const) (apply\w+)/gm` — could
 * not see.
 *
 * The failure direction is what makes this worth pinning: a rule declared in a
 * form the scan misses AND wired into an array fails loudly (the two sides of
 * the set comparison disagree), but a rule the scan misses and that is NOT
 * wired passed silently — which is the exact scenario the guard exists to
 * catch. See test/integration.test.ts.
 *
 * Nothing imports this file except that guard's own self-test, and it lives
 * under test/ so the guard's real scan of src/ never sees it.
 */

/** `export let` — the regex only accepts `function` and `const`. */
export let applyExportLet: (md: MarkdownIt) => void = (md) => void md

/** `export var` — likewise. */
export var applyExportVar: (md: MarkdownIt) => void = (md) => void md

function applyExportBrace(md: MarkdownIt): void {
  void md
}
/** `export { applyX }` — the declaration line has no `export` on it at all. */
export { applyExportBrace }

function renamedSource(md: MarkdownIt): void {
  void md
}
/** `export { a as applyX }` — the exported spelling exists nowhere else. */
export { renamedSource as applyExportAlias }

  /** Indented `export` — the regex is anchored with `^` under the `m` flag. */
  export function applyIndentedExport(md: MarkdownIt): void {
    void md
  }
