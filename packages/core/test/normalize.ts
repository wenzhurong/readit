import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import type { Element, Nodes, Parents, RootContent, Text } from 'hast'

export interface NormalizeOptions {
  /** `owner/repo` of the oracle document, used to recognise GitHub's absolute URL rewrites. */
  repo: string | null
  /** The git ref that appears inside those absolute URLs. */
  ref: string | null
  /** Directory of the source file inside the repo, forward slashes, no leading or trailing slash. */
  dir: string
}

export const DEFAULT_NORMALIZE_OPTIONS: NormalizeOptions = { repo: null, ref: null, dir: '' }

/** SPEC 4.1 permanent expected differences that the normaliser converges away. */
export interface ExpectedDiffRule {
  id: 'D-LINK' | 'D-CAMO'
  what: string
  canonicalScheme: string
}

export const EXPECTED_DIFFS: readonly ExpectedDiffRule[] = [
  {
    id: 'D-LINK',
    what: 'GitHub rewrites relative <a href> to absolute https://github.com/<repo>/blob|tree/<ref>/<path>',
    canonicalScheme: 'x-readit-rel:',
  },
  {
    id: 'D-CAMO',
    what: 'GitHub rewrites relative <img src> /blob/ to /raw/ (and serves raw.githubusercontent.com)',
    canonicalScheme: 'x-readit-rel:',
  },
]

const NONDETERMINISTIC_ATTRS = ['dataRunId', 'dataIdentity'] as const
const NOISE_ATTRS = ['dataErrorText', 'dataPermissionText', 'dataId'] as const
const NOISE_ATTR_PREFIXES = ['dataHovercard', 'dataOcto'] as const
const NOISE_CLASS_GROUPS: readonly (readonly string[])[] = [
  ['issue-link', 'js-issue-link'],
  ['user-mention', 'notranslate'],
]

// Anchored to the end of the string, not just a word boundary (`\b`): the salt is always the
// last thing GitHub appends to a footnote id/href. An unanchored `\b` would also strip a
// legitimate 32-hex-looking run that happens to sit in the middle of a real id, which is a
// genuine (if unlikely) content difference this step must not paper over.
const FOOTNOTE_SUFFIX = /-[0-9a-f]{32}$/g

const BLOCKISH = new Set([
  'article', 'aside', 'blockquote', 'body', 'dd', 'div', 'dl', 'dt', 'details',
  'figure', 'footer', 'header', 'html', 'li', 'main', 'markdown-accessiblity-table',
  'nav', 'ol', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
])

function isElement(node: RootContent | Nodes): node is Element {
  return node.type === 'element'
}

function classesOf(node: Element): string[] {
  const v: unknown = node.properties?.className
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string') return v.split(/\s+/).filter(Boolean)
  return []
}

function setClasses(node: Element, classes: string[]): void {
  if (classes.length === 0) delete node.properties.className
  else node.properties.className = classes
}

function textOf(node: Nodes): string {
  if (node.type === 'text') return node.value
  if ('children' in node) return node.children.map(textOf).join('')
  return ''
}

/**
 * Depth-first walk over every descendant element. Iterates `node.children` with `for…of` rather
 * than an indexed loop: under `noUncheckedIndexedAccess`, `children[i]` types as `T | undefined`
 * and the natural "fix" is a guard that silently skips the element on a false undefined — that
 * would drop nodes from real trees. `for…of` sidesteps the question entirely: no index, no
 * possibly-undefined element, same traversal.
 */
function walk(node: Parents, visit: (child: RootContent, parent: Parents) => void): void {
  for (const child of node.children) {
    visit(child, node)
    if ('children' in child) walk(child, visit)
  }
}

/** Step 1 — strip the `<div id="file|readme" class="md">` / `<article class="markdown-body …">` shells. */
export function unwrapShell(tree: Parents): void {
  let changed = true
  while (changed) {
    changed = false
    const only = tree.children.filter((c) => c.type !== 'text' || c.value.trim() !== '')
    const node = only.length === 1 ? only[0] : undefined
    if (!node || !isElement(node)) break
    const id = node.properties.id
    const classes = classesOf(node)
    const isFileShell = node.tagName === 'div' && (id === 'file' || id === 'readme')
    const isArticleShell = node.tagName === 'article' && classes.includes('markdown-body')
    if (isFileShell || isArticleShell) {
      tree.children = node.children
      changed = true
    }
  }
}

/** Step 2 — drop non-deterministic attributes and the `-<32hex>` footnote salt. */
export function dropNondeterministicAttrs(tree: Parents): void {
  walk(tree, (child) => {
    if (!isElement(child)) return
    for (const attr of NONDETERMINISTIC_ATTRS) delete child.properties[attr]
    for (const key of ['id', 'href', 'ariaLabelledBy', 'ariaDescribedBy'] as const) {
      const v: unknown = child.properties[key]
      if (typeof v === 'string' && FOOTNOTE_SUFFIX.test(v)) {
        FOOTNOTE_SUFFIX.lastIndex = 0
        child.properties[key] = v.replace(FOOTNOTE_SUFFIX, '') as never
      }
      FOOTNOTE_SUFFIX.lastIndex = 0
    }
  })
}

/**
 * Added step — drop `data-line`. GitHub's blob-view HTML never emits this attribute; it is
 * readit's own addition for scroll sync (see `packages/core/src/rules/sourceline.ts`). Without
 * stripping it, nearly every block element in the corpus (readit stamps it on `h1`…`h6`, `p`,
 * `li`, `ul`/`ol`, `table` and its sections, `blockquote`, `hr`, fenced/indented code, and
 * alert blocks) would be a permanent, meaningless diff against the oracle.
 */
export function dropDataLine(tree: Parents): void {
  walk(tree, (child) => {
    if (!isElement(child)) return
    delete child.properties.dataLine
  })
}

/**
 * Step 3 — camo restore. An `<img>` carrying `data-canonical-src` gets that value written back
 * onto `src`; the attribute is then removed. Absolute images already on github.com or
 * raw.githubusercontent.com never go through camo and carry no such attribute — leave them alone.
 */
export function restoreCamo(tree: Parents): void {
  walk(tree, (child) => {
    if (!isElement(child) || child.tagName !== 'img') return
    const canonical = child.properties.dataCanonicalSrc
    if (typeof canonical !== 'string') return
    child.properties.src = canonical
    delete child.properties.dataCanonicalSrc
  })
}

/**
 * Resolve `rel` against `dir`. Two edge cases matter for the fidelity claim, not just for
 * correctness in the abstract:
 *
 * - A `..` that would pop past the start of `out` does NOT clamp to a no-op. It is preserved as
 *   a literal `../` on the front of the result (tracked via `escapes`, since a second `..` past
 *   the same point must NOT re-pop the first one — that would silently swallow it right back).
 *   Clamping would make `../a.md` and `./a.md` resolve to the identical token the moment `dir`
 *   is empty (or exhausted), converging two genuinely different link targets. Preserving the
 *   escape keeps them apart while still letting equivalent spellings of the *same* escape (e.g.
 *   `../a.md` written with a redundant `./../a.md`) converge onto one token — that convergence,
 *   not "always leave `..` alone", is this step's actual job.
 * - A leading `/` (root-relative) is never joined onto `dir` — see `canon` below, which passes
 *   `dir=''` for that case. Skipping the empty segment `''.split('/')` produces is not "clamp",
 *   it is genuinely resolving from the root, so it stays as-is here.
 */
function joinPath(dir: string, rel: string): string {
  const base = dir ? dir.split('/').filter(Boolean) : []
  const out = [...base]
  let escapes = 0
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0) out.pop()
      else escapes++
    } else out.push(seg)
  }
  return '../'.repeat(escapes) + out.join('/')
}

const ABSOLUTE = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\//

/**
 * Step 3b — register SPEC 4.1 D-LINK / D-CAMO as expected differences by converging both sides
 * onto one canonical `x-readit-rel:<repo-root-relative-path>` token. Without this, every relative
 * link and every relative image in the corpus is a permanent diff.
 *
 * Measured against the live `contents` + `Accept: application/vnd.github.html` oracle endpoint:
 * relative-URL rewriting does NOT happen there (that is github.com's React blob *page*, a
 * different code path) — so the four `https://github.com/...` / `raw.githubusercontent.com`
 * prefixes below are dormant on today's oracle HTML, kept only so the whitelist still converges
 * if GitHub ever starts rewriting on this endpoint too. The general fallback in `canon` below is
 * NOT dormant: it runs on every relative `href`/`src` on every `normalize()` call, prefixes
 * present or not, because it also has to converge equivalent-but-differently-spelled relative
 * paths (`./x` vs `x`) onto one token — so it carries the same over-normalization risk as any
 * other step here and needs the same "does it leave a genuine difference intact" scrutiny.
 */
export function undoGithubUrlRewrites(tree: Parents, opts: NormalizeOptions): void {
  const prefixes: string[] = []
  if (opts.repo && opts.ref) {
    prefixes.push(
      `https://github.com/${opts.repo}/blob/${opts.ref}/`,
      `https://github.com/${opts.repo}/tree/${opts.ref}/`,
      `https://github.com/${opts.repo}/raw/${opts.ref}/`,
      `https://raw.githubusercontent.com/${opts.repo}/${opts.ref}/`,
    )
  }
  const canon = (value: string): string | null => {
    for (const p of prefixes) {
      if (value.startsWith(p)) return 'x-readit-rel:' + joinPath('', value.slice(p.length))
    }
    if (ABSOLUTE.test(value) || value.startsWith('#')) return null
    // A root-relative href (leading `/`) resolves from the repo root, never from `dir` — pass
    // dir='' so it cannot land on the same token as a dir-relative link of the same name.
    const base = value.startsWith('/') ? '' : opts.dir
    return 'x-readit-rel:' + joinPath(base, value)
  }
  walk(tree, (child) => {
    if (!isElement(child)) return
    const key = child.tagName === 'a' ? 'href' : child.tagName === 'img' ? 'src' : null
    if (!key) return
    const v = child.properties[key]
    if (typeof v !== 'string' || v === '') return
    const next = canon(v)
    if (next !== null) child.properties[key] = next
  })
}

/** Step 4 — blank the `d` of every `<path>` inside `<svg class="octicon octicon-X">`. */
export function blankOcticonPaths(tree: Parents): void {
  walk(tree, (child) => {
    if (!isElement(child) || child.tagName !== 'svg') return
    if (!classesOf(child).includes('octicon')) return
    walk(child, (inner) => {
      if (isElement(inner) && inner.tagName === 'path') inner.properties.d = ''
    })
  })
}

/**
 * Step 5 — flatten `<div class="highlight highlight-source-*">` to text. The wrapper element and
 * its classes stay: that is the fidelity claim (language detected + shell correct). Every `<span>`
 * inside — GitHub's `pl-*` tokens, starry-night's `pl-*`, Shiki's inline styles — is unwrapped.
 */
export function flattenHighlight(tree: Parents): void {
  walk(tree, (child) => {
    if (!isElement(child) || child.tagName !== 'div') return
    const classes = classesOf(child)
    if (!classes.includes('highlight')) return
    if (!classes.some((c) => c.startsWith('highlight-source-'))) return
    unwrapSpans(child)
  })
}

function unwrapSpans(node: Parents): void {
  const out: RootContent[] = []
  for (const child of node.children) {
    if (isElement(child) && child.tagName === 'span') {
      out.push({ type: 'text', value: textOf(child) } satisfies Text)
      continue
    }
    if ('children' in child) unwrapSpans(child)
    out.push(child)
  }
  node.children = mergeText(out)
}

function mergeText(nodes: RootContent[]): RootContent[] {
  const out: RootContent[] = []
  for (const node of nodes) {
    const last = out[out.length - 1]
    if (node.type === 'text' && last && last.type === 'text') last.value += node.value
    else out.push(node)
  }
  return out
}

/**
 * Step 6 — reduce GitHub's mermaid enrichment `<section class="js-render-needs-enrichment" …>`
 * to `<section data-type="mermaid">` plus the decoded source.
 *
 * Measured: the source lives on the inner `<div class="js-render-enrichment-target">`'s
 * `data-plain` attribute, not on the `<section>` itself — the SPEC says the latter and is wrong.
 *
 * The guard keys on the section's own `data-type="mermaid"` — never on the enrichment class
 * alone. GitHub's `js-render-needs-enrichment` mechanism is shared by several render kinds
 * (mermaid is the only one readit produces); matching by class alone would fold an unrelated
 * enrichment section (e.g. `data-type="geojson"`) into a fabricated `<section data-type="mermaid">`
 * with its own `data-plain` masquerading as mermaid source — exactly the kind of over-normalization
 * that hides a real divergence instead of removing noise.
 */
export function flattenMermaid(tree: Parents): void {
  walk(tree, (child) => {
    if (!isElement(child) || child.tagName !== 'section') return
    if (child.properties.dataType !== 'mermaid') return
    let plain: string | undefined
    walk(child, (inner) => {
      if (plain === undefined && isElement(inner) && typeof inner.properties.dataPlain === 'string') {
        plain = inner.properties.dataPlain
      }
    })
    const source = plain ?? textOf(child)
    child.properties = { dataType: 'mermaid' }
    child.children = [{ type: 'text', value: source }]
  })
}

/** Step 7 — drop hovercard / mention noise attributes and class groups. */
export function dropHovercardNoise(tree: Parents): void {
  walk(tree, (child) => {
    if (!isElement(child)) return
    for (const attr of NOISE_ATTRS) delete child.properties[attr]
    for (const key of Object.keys(child.properties)) {
      if (NOISE_ATTR_PREFIXES.some((p) => key.startsWith(p))) delete child.properties[key]
    }
    const classes = classesOf(child)
    if (classes.length === 0) return
    let kept = classes
    for (const group of NOISE_CLASS_GROUPS) {
      if (group.every((c) => kept.includes(c))) kept = kept.filter((c) => !group.includes(c))
    }
    if (kept.length !== classes.length) setClasses(child, kept)
  })
}

/**
 * Step 8 — sort every node's property keys lexicographically. `diffable-html` does NOT do this,
 * and it reorders text inside `<pre>`, which destroys code-block comparison — do not use it.
 */
export function sortAttributes(tree: Parents): void {
  walk(tree, (child) => {
    if (!isElement(child)) return
    const sorted: Element['properties'] = {}
    for (const key of Object.keys(child.properties).sort()) sorted[key] = child.properties[key]
    child.properties = sorted
  })
}

function isVerbatim(node: Parents): boolean {
  if (!isElement(node)) return false
  return node.tagName === 'pre' || node.tagName === 'code' || node.properties.dataType === 'mermaid'
}

/**
 * Step 9 — collapse inter-element whitespace. Text inside `<pre>`, `<code>` and the reduced
 * mermaid `<section data-type="mermaid">` stays byte exact.
 */
export function collapseWhitespace(tree: Parents): void {
  if (isVerbatim(tree)) return
  const tag = isElement(tree) ? tree.tagName : null
  const parentIsBlock = tag === null || BLOCKISH.has(tag)
  const out: RootContent[] = []
  for (const child of tree.children) {
    if (child.type === 'text') {
      const collapsed = child.value.replace(/\s+/g, ' ')
      if (collapsed.trim() === '' && parentIsBlock) continue
      out.push({ type: 'text', value: collapsed })
      continue
    }
    if ('children' in child) collapseWhitespace(child)
    out.push(child)
  }
  tree.children = mergeText(out)
}

/** The nine SPEC steps plus the D-LINK/D-CAMO whitelist and the data-line addition, in the one order that is allowed. */
export function normalize(html: string, options: Partial<NormalizeOptions> = {}): string {
  const opts: NormalizeOptions = { ...DEFAULT_NORMALIZE_OPTIONS, ...options }
  const tree = fromHtml(html, { fragment: true })
  unwrapShell(tree)
  dropNondeterministicAttrs(tree)
  dropDataLine(tree)
  restoreCamo(tree)
  undoGithubUrlRewrites(tree, opts)
  blankOcticonPaths(tree)
  flattenHighlight(tree)
  flattenMermaid(tree)
  dropHovercardNoise(tree)
  sortAttributes(tree)
  collapseWhitespace(tree)
  return toHtml(tree, { allowDangerousHtml: true })
}

/**
 * Split already-normalised HTML into one line per tag so vitest's array diff points at the
 * offending element. Quote aware: a `><` sequence inside an attribute value never splits.
 * Display only — corpus equality is still asserted on the exact string.
 */
export function toDiffLines(normalizedHtml: string): string[] {
  const lines: string[] = []
  let current = ''
  let inTag = false
  let quote: string | null = null
  for (const ch of normalizedHtml) {
    if (inTag) {
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        lines.push(current + ch)
        current = ''
        inTag = false
        continue
      }
      current += ch
      continue
    }
    if (ch === '<') {
      if (current !== '') lines.push(current)
      current = ch
      inTag = true
      continue
    }
    current += ch
  }
  if (current !== '') lines.push(current)
  return lines
}
