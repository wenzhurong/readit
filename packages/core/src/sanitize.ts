import type { MarkdownIt } from 'markdown-it'
import type { Root } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import { type Schema, defaultSchema, sanitize } from 'hast-util-sanitize'
import { applyClobber, applyRawHtmlTransform, prefixUserContentTree } from './rules/clobber.js'

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

export function applySanitize(md: MarkdownIt): void {
  applyRawHtmlTransform(md, 'readit_sanitize', sanitizeTree)
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
