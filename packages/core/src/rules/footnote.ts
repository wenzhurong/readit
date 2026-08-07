import type { MarkdownIt, StateBlock, StateCore, StateInline, Token } from 'markdown-it'

interface FootnoteEntry {
  label: string
  count: number
}

interface FootnoteEnv {
  refs: Record<string, number>
  list: FootnoteEntry[]
}

interface FootnoteMeta {
  id: number
  subId: number
  label: string
}

function envOf(env: Record<string, unknown>): FootnoteEnv | undefined {
  return env.footnotes as FootnoteEnv | undefined
}

function ensureEnv(env: Record<string, unknown>): FootnoteEnv {
  let fn = env.footnotes as FootnoteEnv | undefined
  if (!fn) {
    fn = { refs: Object.create(null) as Record<string, number>, list: [] }
    env.footnotes = fn
  }
  return fn
}

function isSpaceCode(code: number): boolean {
  return code === 0x09 || code === 0x20
}

/**
 * Read one of `StateBlock`'s parallel per-line arrays (`bMarks`/`eMarks`/
 * `tShift`/`sCount`) at `line`. markdown-it always sizes these to cover every
 * line a block rule can be called with, so this index is never actually out
 * of range; the fallback exists only to satisfy noUncheckedIndexedAccess.
 */
function lineAt(arr: number[], line: number): number {
  return arr[line] ?? 0
}

/** `[^label]: content` — a footnote definition block. */
function footnoteDef(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = lineAt(state.bMarks, startLine) + lineAt(state.tShift, startLine)
  const max = lineAt(state.eMarks, startLine)

  if (lineAt(state.sCount, startLine) - state.blkIndent >= 4) return false
  if (start + 4 > max) return false
  if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false
  if (state.src.charCodeAt(start + 1) !== 0x5e /* ^ */) return false

  let pos = start + 2
  for (; pos < max; pos++) {
    const ch = state.src.charCodeAt(pos)
    if (ch === 0x20 || ch === 0x09) return false
    if (ch === 0x5d /* ] */) break
  }
  if (pos === start + 2) return false
  if (pos + 1 >= max || state.src.charCodeAt(pos + 1) !== 0x3a /* : */) return false
  if (silent) return true

  const label = state.src.slice(start + 2, pos)
  pos += 2

  const fn = ensureEnv(state.env)
  if (!(':' + label in fn.refs)) fn.refs[':' + label] = -1

  const openToken = new state.Token('footnote_definition_open', '', 1)
  openToken.meta = { label }
  openToken.level = state.level++
  state.tokens.push(openToken)

  const oldBMark = lineAt(state.bMarks, startLine)
  const oldTShift = lineAt(state.tShift, startLine)
  const oldSCount = lineAt(state.sCount, startLine)
  const oldParentType = state.parentType
  const oldIndent = state.blkIndent

  const posAfterColon = pos
  const initial =
    lineAt(state.sCount, startLine) +
    pos -
    (lineAt(state.bMarks, startLine) + lineAt(state.tShift, startLine))
  let offset = initial

  while (pos < max) {
    const ch = state.src.charCodeAt(pos)
    if (!isSpaceCode(ch)) break
    if (ch === 0x09) offset += 4 - (offset % 4)
    else offset++
    pos++
  }

  state.tShift[startLine] = pos - posAfterColon
  state.sCount[startLine] = offset - initial
  state.bMarks[startLine] = posAfterColon
  state.blkIndent += 4
  state.parentType = 'footnote'
  if (lineAt(state.sCount, startLine) < state.blkIndent) {
    state.sCount[startLine] = lineAt(state.sCount, startLine) + state.blkIndent
  }

  state.md.block.tokenize(state, startLine, endLine)

  state.parentType = oldParentType
  state.blkIndent = oldIndent
  state.tShift[startLine] = oldTShift
  state.sCount[startLine] = oldSCount
  state.bMarks[startLine] = oldBMark

  const closeToken = new state.Token('footnote_definition_close', '', -1)
  closeToken.level = --state.level
  state.tokens.push(closeToken)

  return true
}

/** `[^label]` — a reference to a previously defined footnote. */
function footnoteRef(state: StateInline, silent: boolean): boolean {
  const max = state.posMax
  const start = state.pos

  if (start + 3 > max) return false
  const fn = envOf(state.env)
  if (!fn) return false
  if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false
  if (state.src.charCodeAt(start + 1) !== 0x5e /* ^ */) return false

  let pos = start + 2
  for (; pos < max; pos++) {
    const ch = state.src.charCodeAt(pos)
    if (ch === 0x20 || ch === 0x09 || ch === 0x0a) return false
    if (ch === 0x5d /* ] */) break
  }
  if (pos === start + 2) return false
  if (pos >= max) return false

  const label = state.src.slice(start + 2, pos)
  if (!(':' + label in fn.refs)) return false

  if (!silent) {
    let id = fn.refs[':' + label]
    // Unreachable: the `in` check above guarantees fn.refs[':' + label] holds
    // a number (possibly -1 for "defined but not yet referenced").
    if (id === undefined) return false
    if (id < 0) {
      id = fn.list.length
      fn.list.push({ label, count: 0 })
      fn.refs[':' + label] = id
    }
    const entry = fn.list[id]
    // Unreachable: id was either read from an existing fn.list index or just
    // pushed onto fn.list above, so fn.list[id] always exists here.
    if (!entry) return false
    const subId = entry.count
    entry.count++

    const token = state.push('footnote_ref', '', 0)
    token.meta = { id, subId, label } satisfies FootnoteMeta
  }

  state.pos = pos + 1
  state.posMax = max
  return true
}

function defLabelOf(tok: Token): string {
  const meta = tok.meta as { label?: string } | null
  return meta?.label ?? ''
}

/** Move the definitions to the end of the document and attach back-references. */
function footnoteTail(state: StateCore): void {
  const fn = envOf(state.env)
  if (!fn) return

  let inside = false
  let currentLabel = ''
  let current: Token[] = []
  const defTokens: Record<string, Token[]> = Object.create(null) as Record<string, Token[]>

  state.tokens = state.tokens.filter((tok) => {
    if (tok.type === 'footnote_definition_open') {
      inside = true
      current = []
      currentLabel = defLabelOf(tok)
      return false
    }
    if (tok.type === 'footnote_definition_close') {
      inside = false
      defTokens[':' + currentLabel] = current
      return false
    }
    if (inside) current.push(tok)
    return !inside
  })

  if (fn.list.length === 0) return

  const blockOpen = new state.Token('footnote_block_open', '', 1)
  state.tokens.push(blockOpen)

  for (let i = 0; i < fn.list.length; i++) {
    const entry = fn.list[i]
    // Unreachable: i ranges over [0, fn.list.length).
    if (!entry) continue

    const openToken = new state.Token('footnote_item_open', '', 1)
    openToken.meta = { id: i, subId: 0, label: entry.label } satisfies FootnoteMeta
    state.tokens.push(openToken)

    const body = defTokens[':' + entry.label] ?? []
    let lastParagraph: Token | null = null
    const lastBodyToken = body[body.length - 1]
    if (body.length >= 3 && lastBodyToken !== undefined && lastBodyToken.type === 'paragraph_close') {
      lastParagraph = body[body.length - 2] ?? null
    }
    for (const tok of body) state.tokens.push(tok)

    for (let j = 0; j < Math.max(entry.count, 1); j++) {
      const anchor = new state.Token('footnote_anchor', '', 0)
      anchor.meta = { id: i, subId: j, label: entry.label } satisfies FootnoteMeta
      if (lastParagraph !== null && lastParagraph.type === 'inline' && lastParagraph.children) {
        lastParagraph.children.push(anchor)
      } else {
        state.tokens.push(anchor)
      }
    }

    const closeToken = new state.Token('footnote_item_close', '', -1)
    state.tokens.push(closeToken)
  }

  const blockClose = new state.Token('footnote_block_close', '', -1)
  state.tokens.push(blockClose)
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** `user-content-fnref-<label>` for the first reference, `-<n>` for the rest. */
function refId(meta: FootnoteMeta): string {
  return 'user-content-fnref-' + esc(meta.label) + (meta.subId > 0 ? '-' + (meta.subId + 1) : '')
}

function backLabel(meta: FootnoteMeta): string {
  return 'Back to reference ' + (meta.id + 1) + (meta.subId > 0 ? '-' + (meta.subId + 1) : '')
}

function metaOf(tokens: Token[], idx: number): FootnoteMeta | undefined {
  const tok = tokens[idx]
  if (!tok || !tok.meta) return undefined
  return tok.meta as unknown as FootnoteMeta
}

/**
 * GitHub-shaped footnotes.
 *
 * GitHub appends a per-request random 32-hex salt to every footnote id
 * (`user-content-fn-1-<32hex>`); readit deliberately emits the unsalted
 * `user-content-fn-1`, and the L2 normaliser strips the salt from the oracle
 * before diffing (SPEC 13.1 step 2). Generating a fake salt would violate
 * Phase A's no-randomness rule and would be strictly worse than omitting it.
 *
 * GitHub also has a bug on mixed-case labels: it renders the definition's
 * `<li id>` with the label's original case but the reference's `id` and the
 * definition's backlink `href` lowercased, so GitHub's own backlink is dead
 * on labels like `[^UPPER]`. readit uses the definition's original label
 * consistently for every id/href it emits, so this divergence is deliberate
 * and in readit's favour — it must not be "fixed" to match GitHub's bug, and
 * mixed-case-label cases must not be added to any shared oracle corpus.
 */
export function applyFootnote(md: MarkdownIt): void {
  md.block.ruler.before('reference', 'footnote_definition', footnoteDef, {
    alt: ['paragraph', 'reference'],
  })
  md.inline.ruler.after('image', 'footnote_ref', footnoteRef)
  md.core.ruler.push('footnote_tail', footnoteTail)

  md.renderer.rules.footnote_ref = (tokens, idx) => {
    const meta = metaOf(tokens, idx)
    if (!meta) return ''
    return (
      '<sup><a href="#user-content-fn-' +
      esc(meta.label) +
      '" id="' +
      refId(meta) +
      '" data-footnote-ref="" aria-describedby="footnote-label">' +
      (meta.id + 1) +
      '</a></sup>'
    )
  }

  md.renderer.rules.footnote_block_open = () =>
    '<section data-footnotes="" class="footnotes">' +
    '<h2 id="footnote-label" class="sr-only">Footnotes</h2>\n<ol>\n'

  md.renderer.rules.footnote_block_close = () => '</ol>\n</section>\n'

  md.renderer.rules.footnote_item_open = (tokens, idx) => {
    const meta = metaOf(tokens, idx)
    if (!meta) return '<li>\n'
    return '<li id="user-content-fn-' + esc(meta.label) + '">\n'
  }

  md.renderer.rules.footnote_item_close = () => '</li>\n'

  md.renderer.rules.footnote_anchor = (tokens, idx) => {
    const meta = metaOf(tokens, idx)
    if (!meta) return ''
    return (
      ' <a href="#' +
      refId(meta) +
      '" data-footnote-backref="" aria-label="' +
      backLabel(meta) +
      '" class="data-footnote-backref">↩' +
      (meta.subId > 0 ? '<sup>' + (meta.subId + 1) + '</sup>' : '') +
      '</a>'
    )
  }
}
