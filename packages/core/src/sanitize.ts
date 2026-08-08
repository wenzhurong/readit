import type { MarkdownIt } from 'markdown-it'
import type { Root } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import { type Schema, defaultSchema, sanitize } from 'hast-util-sanitize'
import {
  applyClobber,
  applyRawHtmlTransform,
  prefixUserContentTree,
  type RawHtmlFallback,
} from './rules/clobber.js'

/**
 * `hast-util-sanitize`'s `defaultSchema` deliberately mirrors GitHub's
 * html-pipeline whitelist, so almost nothing has to be added on top. Verified
 * on 5.0.2 (2026-08-06): `class` and `style` appear nowhere in `attributes['*']`;
 * `protocols.src` is `['http','https']` so `data:` is already rejected while
 * relative URLs pass; and the GFM value-level class allowances
 * (`code: language-*`, `li: task-list-item`, `ol/ul: contains-task-list`,
 * `section: footnotes`, `a: data-footnote-backref`, `h2: sr-only`) are already
 * present.
 *
 * Known deviation D-VIDEO: `defaultSchema.tagNames` (53 entries) has no
 * `video`, though GitHub's own whitelist does keep `<video src controls>`.
 * Pinned by a test rather than silently drifting.
 *
 * `clobberPrefix` is disabled here and the prefixing is done by
 * `prefixUserContentTree` instead, because the built-in one is not idempotent:
 * it turns `user-content-x` into `user-content-user-content-x`, which GitHub
 * does not do (measured against POST /markdown, 2026-08-06).
 */
export const SCHEMA: Schema = { ...defaultSchema, clobberPrefix: '' }

export function sanitizeTree(tree: Root): Root {
  return prefixUserContentTree(sanitize(tree, SCHEMA) as Root)
}

/** Sanitizes one self-contained fragment of user-authored HTML. */
export function sanitizeUserHtml(html: string): string {
  return toHtml(sanitizeTree(fromHtml(html, { fragment: true })))
}

/**
 * Elements the sanitizer deletes TOGETHER WITH THEIR CONTENT. Not the same as
 * "elements the schema rejects": `sanitize` unwraps an element that is merely
 * absent from `tagNames`, keeping its children — and therefore keeping the run
 * sentinel that was sitting among them.
 *
 * Derived from `defaultSchema.strip` rather than restated, so a
 * `hast-util-sanitize` bump that adds an element to it is picked up here
 * instead of silently widening the degraded path. `template` has to be added by
 * hand: it is absent from `tagNames` (so it is nominally an unwrap case), but
 * hast parks its children under `.content` rather than `.children`, so there is
 * nothing to unwrap and the fragment goes with the element.
 *
 * Exported for the sweep in test/sanitize.test.ts, which measures the real
 * trigger set against this and fails on anything not derivable from it.
 */
export const STRIPPED_WITH_CONTENT: readonly string[] = [
  ...(defaultSchema.strip ?? []),
  'template',
]

/**
 * The sanitizer's degradation when the joined run no longer splits back into
 * one part per chunk (`rules/clobber.ts`'s `RawHtmlFallback`).
 *
 * ## What reaches it — a mechanism, not one element
 *
 * The run is split on a text sentinel sitting between chunks, so anything that
 * makes that text disappear lands here. An earlier version of this comment,
 * and of the two in `rules/clobber.ts`, named only `<template>`. That badly
 * understated how ordinary the input is. Measured 2026-08-08 over 134 tags in
 * seven chunk shapes (1876 cases, pinned by the sweep in
 * test/sanitize.test.ts), exactly two mechanisms and three tags:
 *
 *  1. `STRIPPED_WITH_CONTENT` above — `script` (from `defaultSchema.strip`)
 *     and `template`. `a <script>q</script> b` chunks to
 *     `["<script>","</script>"]`, serialises to one part and takes this path
 *     with no `<template>` in sight; at the commit before the degradation
 *     landed, that input THREW. So the crash this fallback replaced was
 *     reachable through a far more ordinary document than "a page documenting
 *     web components".
 *  2. `<col>`, where parse5's fragment parser discards the sentinel before any
 *     transform runs. That one is not this stage's doing and reaches every
 *     caller — see `rules/clobber.ts`.
 *
 * ## Why not `keepChunksUnchanged`
 *
 * The whole point of this stage is that author HTML never reaches the output
 * unfiltered, and re-emitting the input would trade a crash for an XSS hole. So
 * instead of abandoning the transform it abandons only the *join* — each chunk
 * is sanitized on its own. Every byte this returns is still `sanitizeTree`
 * output, which is the safety property `applyRawHtmlPolicy` promises; nothing
 * else about the schema changes.
 *
 * What is lost is precisely what the join buys: a chunk is an unbalanced
 * fragment (`<div>\n` and `</div>\n` are two tokens), so on its own `<div>\n`
 * re-serialises as `<div></div>` and a lone `</div>\n` as nothing at all. Wrappers
 * therefore stop wrapping. That is a structural regression, not a safety one,
 * and it stays local: each chunk keeps its position in the document, so a
 * trigger in one paragraph cannot delete or relocate raw HTML elsewhere.
 * The two rejected alternatives both fail that last property — dropping the run
 * outright deletes every unrelated raw element in the document, and collapsing
 * the whole sanitized run into the first chunk relocates them all.
 *
 * One consequence worth knowing before it surprises you: a stripped element's
 * BODY is not stripped, because markdown-it never handed it over as part of the
 * chunk. `<script>q</script>` is two `html_inline` tokens with the text `q`
 * between them as ordinary Markdown, so `q` renders as visible text. Pinned.
 */
export const sanitizeChunksIndependently: RawHtmlFallback = (chunks) =>
  chunks.map(sanitizeUserHtml)

export function applySanitize(md: MarkdownIt): void {
  applyRawHtmlTransform(md, 'readit_sanitize', sanitizeTree, sanitizeChunksIndependently)
}

/**
 * The single wiring point for raw HTML. markdown-it must always run with
 * `html: true`; the safety comes from here, not from the parser.
 *
 * - `allowDangerousHtml: false` (default): user HTML is sanitized against the
 *   GitHub-shaped whitelist and its ids/`a[name]` are prefixed. This is what
 *   reproduces GitHub's own output — GitHub keeps `<kbd>`, `<img>` and friends
 *   while stripping `class`, `style` and event handlers.
 * - `allowDangerousHtml: true`: no sanitizer runs. The `user-content-` filter
 *   still runs, because GitHub applies it as a separate pipeline stage.
 *
 * Both paths only ever see raw `html_block` / `html_inline` token content, so
 * readit's own markup — which depends on `class` throughout (`.markdown-alert`,
 * `.markdown-heading`, `.highlight highlight-source-*`, `.emoji`, …) — is never
 * scanned. Those rules deliberately emit through `renderer.rules.*` string
 * building or a `readit_raw` token instead of `html_block`/`html_inline`,
 * precisely so this walker never sees them.
 */
export function applyRawHtmlPolicy(md: MarkdownIt, allowDangerousHtml: boolean): void {
  if (allowDangerousHtml) applyClobber(md)
  else applySanitize(md)
}
