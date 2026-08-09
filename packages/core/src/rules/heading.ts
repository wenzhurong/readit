import GithubSlugger from 'github-slugger'
import type { Env, MarkdownIt, StateCore, Token } from 'markdown-it'
import { CLOBBER_PREFIX } from './clobber.js'

/**
 * Byte-verbatim copy of the permalink icon GitHub emits, captured 2026-08-06 from
 * GET /repos/markdown-it/markdown-it/contents/README.md
 * (Accept: application/vnd.github.html). Attribute order is GitHub's.
 */
export const OCTICON_LINK =
  '<svg data-component="Octicon" class="octicon octicon-link" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true">' +
  '<path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"></path>' +
  '</svg>'

export interface HeadingAnchorMeta {
  readitSlug: string
  readitLabel: string
}

/** Scratch state, not an option — see C3(c), which governs `env.readit` only. */
interface SluggerEnv extends Env {
  readitSlugger?: GithubSlugger
}

/**
 * One slugger per document, shared by every rule that mints an anchor id.
 * `rules/rawshape.ts` anchors headings the author wrote as literal HTML; with
 * a slugger of its own, `<h2>Dup</h2>` beside a markdown `## Dup` produced two
 * elements both claiming `id="user-content-dup"` — duplicate ids, a
 * correctness bug and not a cosmetic one.
 *
 * Per *document*, not per md instance: an md instance can render many
 * documents, and a slugger that outlived one of them would start suffixing the
 * next document's first heading. `env` is fresh for every `md.render()` call
 * (markdown-it substitutes `{}` when the caller passes none), so hanging it
 * there gets the lifetime right for free.
 *
 * The allocation ORDER still deviates from GitHub: rules run in registration
 * order, so every markdown heading is slugged before any raw one, whereas
 * GitHub walks one finished tree in document order. On a collision the two
 * pipelines therefore disagree about which heading keeps the bare slug. Pinned
 * by a test in test/rules/rawshape.test.ts rather than left to be discovered.
 */
export function sharedSlugger(env: Env): GithubSlugger {
  const scoped = env as SluggerEnv
  return (scoped.readitSlugger ??= new GithubSlugger())
}

/**
 * Text content of a heading, as GitHub computes it for the slug and aria-label:
 * every descendant text node, with `<img>` alt text excluded.
 */
function headingText(children: readonly Token[]): string {
  let out = ''
  for (const token of children) {
    if (token.type === 'image') continue
    if (token.type === 'text' || token.type === 'code_inline') out += token.content
    else if (token.type === 'softbreak' || token.type === 'hardbreak') out += '\n'
  }
  return out
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Must be applied BEFORE applyDirAuto so that `class` lands on the heading token
 * ahead of `dir`, matching GitHub's `<h2 class="heading-element" dir="auto">`.
 */
export function applyHeadingAnchors(md: MarkdownIt): void {
  md.core.ruler.push('readit_heading_anchor', (state: StateCore) => {
    const slugger = sharedSlugger(state.env)
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]
      if (open === undefined || open.type !== 'heading_open') continue
      const inline = tokens[i + 1]
      const label =
        inline !== undefined && inline.type === 'inline'
          ? headingText(inline.children ?? [])
          : ''
      const meta: HeadingAnchorMeta = { readitSlug: slugger.slug(label), readitLabel: label }
      open.attrSet('class', 'heading-element')
      open.meta = Object.assign({}, open.meta, meta)
      const close = tokens[i + 2]
      if (close !== undefined && close.type === 'heading_close') {
        close.meta = Object.assign({}, close.meta, meta)
      }
    }
    return true
  })

  md.renderer.rules.heading_open = (tokens, idx, options, _env, self) =>
    '<div class="markdown-heading" dir="auto">' + self.renderToken(tokens, idx, options)

  md.renderer.rules.heading_close = (tokens, idx) => {
    const token = tokens[idx]
    if (token === undefined) return ''
    const meta = (token.meta ?? {}) as Partial<HeadingAnchorMeta>
    const slug = meta.readitSlug ?? ''
    const label = meta.readitLabel ?? ''
    return (
      '</' +
      token.tag +
      '><a id="' +
      CLOBBER_PREFIX +
      slug +
      '" class="anchor" aria-label="Permalink: ' +
      escapeAttr(label) +
      '" href="#' +
      slug +
      '">' +
      OCTICON_LINK +
      '</a></div>\n'
    )
  }
}
