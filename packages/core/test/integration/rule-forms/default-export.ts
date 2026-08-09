import type { MarkdownIt } from 'markdown-it'

/**
 * Fixture, not a rule — see ./forms.ts.
 *
 * `export default function applyX` binds as `default` in the module namespace,
 * so a scan that only looks at binding names sees nothing named `apply*`. The
 * declared name is recovered from the function's own `.name`.
 */
export default function applyDefaultExport(md: MarkdownIt): void {
  void md
}
