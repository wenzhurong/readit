import type { MarkdownIt } from 'markdown-it'

/**
 * markdown-it's GFM strikethrough emits `<s>`; GitHub emits `<del>`.
 * Verified 2026-08-06 against GET /repos/vuejs/vue-loader/contents/README.md
 * and /repos/dangkhoasdc/awesome-ai-residency/contents/README.md — both show
 * `<del>` and zero `<s>`.
 *
 * Only the renderer is overridden, so a literal `<s>` typed as raw HTML by the
 * author still round-trips as `<s>`.
 */
export function applyStrikethrough(md: MarkdownIt): void {
  md.renderer.rules.s_open = () => '<del>'
  md.renderer.rules.s_close = () => '</del>'
}
