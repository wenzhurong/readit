import type { Env, MarkdownIt, Token } from 'markdown-it'
import type { Element, Root } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'

export const CLOBBER_PREFIX = 'user-content-'

/**
 * markdown-it hands raw HTML out in unbalanced chunks (`<div>\n` and `</div>\n`
 * are two `html_block` tokens with markdown between them). Parsing a chunk on
 * its own destroys it: `hast-util-from-html('</div>')` yields nothing at all.
 *
 * So the whole run is joined with a text sentinel, parsed once, transformed,
 * serialised and split back. The sentinel is plain text, so it survives the
 * round trip everywhere text is allowed. Two measured places where it does not,
 * both pinned by tests rather than silently mis-handled:
 *
 *  - inside a `<table>`, where the HTML parser foster-parents it out, so the
 *    run still splits into the right number of parts but the tags move;
 *  - inside a `<template>`, whose children hast parks under `.content` rather
 *    than `.children`. A transform that DELETES the element deletes that
 *    fragment with it — `hast-util-sanitize` does, `template` is absent from
 *    `defaultSchema.tagNames` — and the separator goes too, so the run splits
 *    into FEWER parts than there were chunks. See `RawHtmlFallback`.
 *
 * The sentinel uses U+E000 (private use area) so it can never collide with real
 * document text, and unlike ASCII whitespace or NUL it survives the HTML
 * parser's text normalisation unchanged.
 *
 * Exported so a transform can locate the chunk boundaries inside the merged
 * tree it is handed — see `rules/rawshape.ts`, which needs to know which chunk
 * an element came from, and has to keep the sentinel out of text it derives
 * slugs and labels from.
 */
export const SENTINEL = 'readit-raw-html'

/**
 * Which markdown-it token a chunk came from. `transformRawHtmlChunks` merges
 * every chunk of a document into ONE tree, which flattens the distinction
 * away — an element from an `html_inline` chunk and one from an `html_block`
 * chunk both land as root-level children of that tree — so a transform that
 * needs to tell them apart has to be told, per chunk, in `chunks` order.
 */
export type ChunkKind = 'block' | 'inline'

/**
 * `kinds[i]` describes `chunks[i]`. `env` is the render environment, for
 * transforms keeping per-document scratch state on it (`rules/rawshape.ts`
 * shares `readitSlugger` with `rules/heading.ts` that way). A transform that
 * needs neither may declare a single parameter, as `prefixUserContentTree`
 * and `sanitizeTree` both do.
 */
export type RawHtmlTransform = (tree: Root, kinds: readonly ChunkKind[], env: Env) => Root

/**
 * What to emit when the transformed tree no longer splits back into one part
 * per input chunk (the `<template>` case above). Same arguments as the
 * transform, minus the tree that is now known to be unusable.
 *
 * This is per-caller and NOT a default the whole module can pick, because the
 * safe answer differs by caller:
 *
 *  - `applyClobber` and `applyRawShape` take `keepChunksUnchanged`. Both run on
 *    content that has already passed whatever policy applies — `applyRawShape`
 *    is registered strictly after `applyRawHtmlPolicy`, and `applyClobber` only
 *    runs under `allowDangerousHtml: true`, where author HTML passes through by
 *    design. Re-emitting the input is therefore exactly as safe as the stage
 *    that produced it; the only loss is the decoration/prefixing.
 *  - `applySanitize` must NOT. Handing author HTML back unchanged from the
 *    sanitizer would convert a crash into an XSS hole, which is strictly worse
 *    than the crash. It supplies its own fallback — see `sanitize.ts`.
 *
 * `render()` must be total over arbitrary untrusted Markdown, so this is a
 * degradation and never a throw. Both degradations are pinned by tests.
 */
export type RawHtmlFallback = (
  chunks: readonly string[],
  kinds: readonly ChunkKind[],
  env: Env,
) => string[]

/** The default fallback: re-emit the run exactly as it came in. */
export const keepChunksUnchanged: RawHtmlFallback = (chunks) => [...chunks]

export function transformRawHtmlChunks(
  chunks: readonly string[],
  transform: RawHtmlTransform,
  kinds: readonly ChunkKind[] = [],
  env: Env = {},
  fallback: RawHtmlFallback = keepChunksUnchanged,
): string[] {
  if (chunks.length === 0) return []
  const tree = fromHtml(chunks.join(SENTINEL), { fragment: true })
  const parts = toHtml(transform(tree, kinds, env)).split(SENTINEL)
  if (parts.length !== chunks.length) return fallback(chunks, kinds, env)
  return parts
}

/** Walks the token stream in document order and rewrites every raw HTML chunk. */
export function applyRawHtmlTransform(
  md: MarkdownIt,
  ruleName: string,
  transform: RawHtmlTransform,
  fallback: RawHtmlFallback = keepChunksUnchanged,
): void {
  md.core.ruler.push(ruleName, (state) => {
    const targets: Token[] = []
    const kinds: ChunkKind[] = []
    for (const token of state.tokens) {
      if (token.type === 'html_block') {
        targets.push(token)
        kinds.push('block')
      } else if (token.type === 'inline' && token.children) {
        for (const child of token.children) {
          if (child.type === 'html_inline') {
            targets.push(child)
            kinds.push('inline')
          }
        }
      }
    }
    if (targets.length === 0) return true
    const out = transformRawHtmlChunks(
      targets.map((t) => t.content),
      transform,
      kinds,
      state.env,
      fallback,
    )
    for (const [i, token] of targets.entries()) token.content = out[i] ?? token.content
    return true
  })
}

function walk(node: Root | Element, visit: (el: Element) => void): void {
  for (const child of node.children) {
    if (child.type === 'element') {
      visit(child)
      walk(child, visit)
    }
  }
}

/**
 * GitHub's anti-clobbering filter: `id` on any element and `name` on anchors
 * get a `user-content-` prefix. `href="#slug"` is deliberately left alone —
 * that asymmetry is what §11.2 of the spec bridges in Phase B.
 *
 * Idempotent, unlike `hast-util-sanitize`'s `clobberPrefix`, which turns an
 * already-prefixed `user-content-x` into `user-content-user-content-x`.
 * GitHub does not (measured against POST /markdown, 2026-08-06).
 */
export function prefixUserContentTree(tree: Root): Root {
  walk(tree, (el) => {
    const props = el.properties
    for (const key of ['id', 'name'] as const) {
      if (key === 'name' && el.tagName !== 'a') continue
      const value = props[key]
      if (typeof value !== 'string' || value.startsWith(CLOBBER_PREFIX)) continue
      props[key] = CLOBBER_PREFIX + value
    }
  })
  return tree
}

/** Convenience wrapper for a single, self-contained HTML fragment. */
export function prefixUserContent(html: string): string {
  return toHtml(prefixUserContentTree(fromHtml(html, { fragment: true })))
}

export function applyClobber(md: MarkdownIt): void {
  applyRawHtmlTransform(md, 'readit_clobber', prefixUserContentTree)
}
