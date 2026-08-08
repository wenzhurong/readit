import type GithubSlugger from 'github-slugger'
import type { Element, ElementContent, Nodes, Root, RootContent } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import type { MarkdownIt } from 'markdown-it'
import { applyRawHtmlTransform, CLOBBER_PREFIX, SENTINEL, type ChunkKind } from './clobber.js'
import { isExternal } from './decorate.js'
import { OCTICON_LINK, sharedSlugger } from './heading.js'

/**
 * SHAPE decoration for elements the author wrote as literal HTML.
 *
 * `applyDirAuto` / `applyHeadingAnchors` / `applyDecorate` / `applyTableWrapper`
 * all hang off markdown-it's own semantic tokens (`paragraph_open`, `image`,
 * `heading_open`, `table_open`, `link_open`). GitHub's pipeline decorates the
 * FINAL HTML and does not care whether an element came from Markdown syntax or
 * from a literal tag the author typed, so every one of those rules misses the
 * raw-HTML half of a real README. This rule closes that gap by re-applying the
 * same five decorations over the hast seam `rules/clobber.ts` already
 * maintains.
 *
 * ## C3(a) — the one legitimate exception, do not "fix" it
 *
 * C3(a) forbids writing readit's own class-bearing markup into `html_block` /
 * `html_inline` token content: `applyRawHtmlPolicy`'s walker treats those
 * tokens as user-authored, and would strip the classes right back off. (The
 * emoji rule hit exactly that bug during drafting, which is why `readit_raw`
 * exists.)
 *
 * This rule is exempt because of WHERE it is registered. It is deliberately
 * NOT a member of `SHAPE_RULES`: core rules run in push order, and every rule
 * in that array runs BEFORE `readit_sanitize` / `readit_clobber`. `engine.ts`
 * instead calls `applyRawShape` after `applyRawHtmlPolicy`, so the sanitizer
 * has already finished and can never see what this rule writes. Registering it
 * in the array — or moving `applyRawHtmlPolicy` after it — silently deletes
 * every decoration below:
 *
 *     <img style="max-width: 100%;">              -> <img>
 *     <markdown-accessiblity-table><table>…       -> <table>…
 *     <div class="markdown-heading"><h2 class=…>  -> <div><h2 class="">
 *     <a rel="nofollow"> / <a target="_blank">    -> <a>
 *
 * C3(b) is not engaged: no renderer is overridden here, so `tagfilter.ts`'s
 * `html_block`/`html_inline` chain is untouched. C3(c) holds: no option is
 * read. The slugger is scratch state on its own env key, not an option under
 * `env.readit` (same precedent as `env.readitExplain`).
 */

/** Measured set, same as `dirauto.ts`'s: p / h1..h6 / ul / ol and nothing else. */
const DIR_AUTO_TAGS: ReadonlySet<string> = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
])

const HEADING_TAGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/**
 * The permalink icon as hast, parsed once from the byte-verbatim string
 * `heading.ts` already owns rather than hand-built a second time. Verified to
 * round-trip through `fromHtml`/`toHtml` unchanged, so the raw-HTML anchor and
 * the markdown one emit identical bytes. Cloned per use — one heading's nodes
 * must never be aliased into another heading's tree.
 */
const OCTICON_TREE = fromHtml(OCTICON_LINK, { fragment: true })

function octiconNodes(): ElementContent[] {
  return structuredClone(OCTICON_TREE.children) as ElementContent[]
}

/**
 * hast stores space-separated attributes (`class`, `rel`) as either an array or
 * — when the value came in unparsed — a string. Both spellings reach here, so
 * both are handled once instead of at each call site.
 */
function tokenList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  return []
}

/**
 * Text content, with the run sentinel removed. A raw element split across
 * markdown content (`<h2>` … markdown … `</h2>`) has the sentinel sitting where
 * the markdown will go; readit cannot see that content at this stage, but it
 * must not leak the internal marker into a user-visible slug or aria-label
 * either. Dropping it yields a wrong-but-quiet empty label — pinned by a test.
 */
function textOf(node: Nodes): string {
  if (node.type === 'text') return node.value.split(SENTINEL).join('')
  if ('children' in node) return node.children.map(textOf).join('')
  return ''
}

/**
 * GitHub's image filter emits `max-width: 100%;` for a plain image and the
 * three-declaration form for one carrying a `height` attribute (measured
 * against `<img height="150">` in test/fixtures/real-world/mermaid.html — the
 * sole instance in the fixture set, against 46 plain ones; three `width`-only
 * images take the plain branch and agree).
 *
 * UNVERIFIED variants: a percentage height (`height="50%"`), a height with a
 * CSS unit, and `width` and `height` together. No fixture exercises any of
 * them, so they follow the same "has a height attribute" branch by default
 * rather than by measurement.
 */
function imageStyle(el: Element): string {
  const height = el.properties.height
  if (height === undefined || height === null || height === '') return 'max-width: 100%;'
  return `max-width: 100%; height: auto; max-height: ${String(height)}px;`
}

/** `rel` for the synthetic wrapper, matching `decorate.ts`'s markdown-side twin. */
function syntheticRel(src: string): string {
  return isExternal(src) ? 'noopener noreferrer nofollow' : 'noopener noreferrer'
}

function element(tagName: string, properties: Element['properties'], children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

/**
 * Root-level `<img>` elements whose chunk was an `html_block`.
 *
 * GitHub's `<p>` does NOT come from its Markdown parser — three counterexamples
 * from the fixtures show a top-level `<a name>`, a `<br>\n<br>` pair and a
 * top-level `<a href>…</a>` block all going unwrapped. The `<p>` is emitted by
 * the image filter, for a bare `<img>` with no `<a>` ancestor, and readit
 * reproduces it under the same three conditions: no `<a>` ancestor, root-level
 * in the merged tree, and from a block chunk.
 *
 * The chunk-kind condition is load-bearing rather than defensive. Because every
 * chunk is merged into one tree, an inline `<img>` from `text <img> more` is
 * ALSO a root-level child, and wrapping it produces `<p>text <p dir="auto">…
 * </p> more</p>`. Position in the tree cannot separate the two cases; only
 * `kinds` can.
 *
 * Chunk boundaries are counted, not inferred: the merged tree's text nodes
 * contain one `SENTINEL` occurrence per boundary, and the HTML parser may have
 * merged a boundary into a longer text node, so occurrences are counted inside
 * each text value rather than whole nodes being matched.
 */
function rootBlockImages(tree: Root, kinds: readonly ChunkKind[]): ReadonlySet<Element> {
  const found = new Set<Element>()
  let chunk = 0
  const visit = (node: Root | RootContent, depth: number): void => {
    if (node.type === 'text') {
      let at = node.value.indexOf(SENTINEL)
      while (at !== -1) {
        chunk++
        at = node.value.indexOf(SENTINEL, at + SENTINEL.length)
      }
      return
    }
    if (node.type === 'element' && depth === 1 && node.tagName === 'img' && kinds[chunk] === 'block') {
      found.add(node)
    }
    if ('children' in node) for (const child of node.children) visit(child, depth + 1)
  }
  visit(tree, 0)
  return found
}

/** In-place attribute decorations. Never changes the shape of the tree. */
function decorateAttributes(el: Element): void {
  if (el.tagName === 'a') {
    const href = el.properties.href
    if (typeof href === 'string' && isExternal(href)) {
      // Appended rather than assigned: an author `rel` only survives the
      // sanitizer under `allowDangerousHtml: true`, and dropping it there would
      // discard author content to add readit's own token.
      const rel = tokenList(el.properties.rel)
      if (!rel.includes('nofollow')) el.properties.rel = [...rel, 'nofollow']
    }
  }

  if (el.tagName === 'img') {
    // UNMEASURED. An author `style` only reaches this rule under
    // `allowDangerousHtml: true`; the default path's sanitizer strips it, so
    // GitHub — which always sanitizes — can never be observed in this state
    // and there is no oracle either way. Its filter is believed to skip images
    // that already carry a style, and readit follows that guess.
    if (el.properties.style === undefined) el.properties.style = imageStyle(el)
  }

  if (HEADING_TAGS.has(el.tagName)) {
    // `class` BEFORE `dir`: hast serialises properties in insertion order and
    // GitHub emits `class` first (`<h2 class="heading-element" dir="auto">`).
    // The corpus suite cannot catch a swap here — `normalize.ts`'s
    // `sortAttributes` sorts the keys — so direct string assertions in
    // test/rules/rawshape.test.ts pin it, mirroring engine.ts's coupling #2.
    //
    // Appending `className` is enough only when the element has no `dir` yet.
    // An author-supplied `dir` is already in insertion order from parsing, so
    // it has to be deleted and reinserted or it would serialise first and the
    // invariant would silently hold on one path and not the other. The author's
    // `dir` consequently moves after any attribute it originally preceded;
    // UNMEASURED which order GitHub emits in that case, but attribute order
    // carries no meaning in HTML and self-consistency with the 46 measured
    // no-author-`dir` instances is the better-supported guess.
    const authorDir = el.properties.dir
    delete el.properties.dir
    el.properties.className = [...tokenList(el.properties.className), 'heading-element']
    if (authorDir !== undefined) el.properties.dir = authorDir
  }

  if (DIR_AUTO_TAGS.has(el.tagName) && !tokenList(el.properties.className).includes('contains-task-list')) {
    // UNMEASURED, and conservative: an author `dir` is left alone rather than
    // overwritten. No fixture writes one. GitHub's filters are seen preserving
    // author attributes elsewhere (a hand-written heading `id` survives beside
    // the anchor's own id, per github-only/user-content-id), so preserving is
    // the better-supported guess and it cannot destroy author intent.
    el.properties.dir ??= 'auto'
  }
}

/**
 * Structural decorations: returns what `el` should be replaced by. An element
 * is never both a heading and a table and an image, so the branches are
 * mutually exclusive and their order carries no meaning.
 */
function wrap(el: Element, slugger: GithubSlugger, inLink: boolean, needsParagraph: boolean): ElementContent {
  if (HEADING_TAGS.has(el.tagName)) {
    const label = textOf(el)
    const slug = slugger.slug(label)
    const anchor = element(
      'a',
      {
        id: `${CLOBBER_PREFIX}${slug}`,
        className: ['anchor'],
        ariaLabel: `Permalink: ${label}`,
        href: `#${slug}`,
      },
      octiconNodes(),
    )
    return element('div', { className: ['markdown-heading'], dir: 'auto' }, [el, anchor])
  }

  if (el.tagName === 'table') {
    return element('markdown-accessiblity-table', {}, [el])
  }

  if (el.tagName === 'img' && !inLink) {
    const src = typeof el.properties.src === 'string' ? el.properties.src : ''
    const link = element(
      'a',
      { target: '_blank', rel: syntheticRel(src).split(' '), href: src },
      [el],
    )
    return needsParagraph ? element('p', { dir: 'auto' }, [link]) : link
  }

  return el
}

function decorateChildren(
  parent: Root | Element,
  slugger: GithubSlugger,
  blockImages: ReadonlySet<Element>,
  inLink: boolean,
): void {
  const out: RootContent[] = []
  for (const child of parent.children) {
    if (child.type !== 'element') {
      out.push(child)
      continue
    }
    // Depth-first: a heading's own children are decorated before the heading is
    // wrapped, so the wrapper never gets re-visited and re-wrapped.
    decorateChildren(child, slugger, blockImages, inLink || child.tagName === 'a')
    decorateAttributes(child)
    out.push(wrap(child, slugger, inLink, blockImages.has(child)))
  }
  // A `doctype` is the one `RootContent` that is not an `ElementContent`, and
  // it can only ever be a child of the root. The filter narrows the type
  // without a cast; on an element's children it removes nothing.
  if (parent.type === 'root') parent.children = out
  else parent.children = out.filter((node): node is ElementContent => node.type !== 'doctype')
}

export function decorateRawTree(tree: Root, slugger: GithubSlugger, kinds: readonly ChunkKind[]): Root {
  decorateChildren(tree, slugger, rootBlockImages(tree, kinds), false)
  return tree
}

/**
 * Core rule `readit_raw_shape`. Registered by `createEngine` AFTER
 * `applyRawHtmlPolicy` — see the C3(a) note at the top of this file for why
 * that position is load-bearing and why this rule is not in `SHAPE_RULES`.
 */
export function applyRawShape(md: MarkdownIt): void {
  applyRawHtmlTransform(md, 'readit_raw_shape', (tree, kinds, env) =>
    decorateRawTree(tree, sharedSlugger(env), kinds),
  )
}
