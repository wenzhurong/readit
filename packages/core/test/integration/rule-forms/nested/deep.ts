import type { MarkdownIt } from 'markdown-it'

/**
 * Fixture, not a rule — see ../forms.ts.
 *
 * The replaced guard's scan set was a NON-RECURSIVE `readdirSync(src/rules)`
 * plus the single path `src/sanitize.ts`, so a rule under
 * `src/rules/<subdir>/` — or any new top-level `src/*.ts` — was invisible to it
 * no matter how conventionally it was declared.
 */
export function applyInsideASubdirectory(md: MarkdownIt): void {
  void md
}
