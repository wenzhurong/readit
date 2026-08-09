import type { Env, MarkdownIt, RendererRule, StateCore, Token } from 'markdown-it'
import type { ExplainEntry, InlineMathMode, MathRenderer } from '../types.js'

/** Environment object threaded through `md.render(src, env)` by the engine. */
export interface ReaditEnv extends Env {
  readit?: {
    inlineMath?: InlineMathMode
    math?: MathRenderer | null
    explain?: boolean
    emojiBase?: string
  }
  /** Filled in by the guard when `readit.explain` is true. */
  readitExplain?: ExplainEntry[]
}

/** Inclusive on both ends: `s[open]` and `s[close]` are delimiter characters. */
export interface DollarSpan {
  /** Index of the first delimiter character. */
  open: number
  /** Index of the last delimiter character. */
  close: number
  /** 1 for `$…$`, 2 for `$$…$$`. */
  delim: 1 | 2
}

const CH_DOLLAR = 0x24 // $
const CH_LPAREN = 0x28 // (
const CH_LF = 0x0a
const CH_CR = 0x0d

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === CH_LF || c === CH_CR
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39
}

function isWordChar(c: number): boolean {
  return isDigit(c) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f
}

/**
 * Bounds-checked read of a mask bit. `mask` is always built the same length
 * as `s` by `applyMathInline`'s flattener, so a position past the string end
 * genuinely has nothing to mask — 0 ("not escaped") is the correct, not
 * merely convenient, default for both an out-of-range read and the
 * `noUncheckedIndexedAccess` `undefined` case for an in-range one.
 */
function maskAt(mask: Uint8Array, i: number): number {
  if (i < 0 || i >= mask.length) return 0
  return mask[i] ?? 0
}

/**
 * R0–R8 over a flattened text run.
 *
 * `mask[i] === 1` marks a character that came from a backslash escape and can
 * therefore never act as a delimiter. Offsets are indices into `s`, i.e. into
 * the flattened run — not into the original document source. Scans by
 * UTF-16 code unit throughout (never `for...of`), so an astral character
 * never desynchronises `s` from `mask`.
 *
 * `log`, when non-null, receives one entry per verdict in decision order
 * (the opener first, then the closer candidate it was judged against). This
 * offset is into `s` — the flattened run — never into the original document
 * source: after the inline stage, text tokens carry no source position, and
 * `\$` occupies one character in `s` but two in the source, so there is no
 * sound way to map it back. A multi-paragraph document therefore has the
 * offset restart at 0 for every run.
 */
export function scanDollars(
  s: string,
  mask: Uint8Array,
  mode: InlineMathMode,
  log: ExplainEntry[] | null,
): DollarSpan[] {
  const out: DollarSpan[] = []
  const strict = mode === 'strict'
  const note = (offset: number, verdict: ExplainEntry['verdict'], ruleId: ExplainEntry['ruleId']) => {
    if (log) log.push({ offset, verdict, ruleId })
  }
  const len = s.length
  let i = 0
  while (i < len) {
    // R1: an unmasked '$' is the only trigger.
    if (s.charCodeAt(i) !== CH_DOLLAR || maskAt(mask, i)) {
      i++
      continue
    }

    // R0: prefer the two-character '$$' delimiter.
    const delim: 1 | 2 = s.charCodeAt(i + 1) === CH_DOLLAR && !maskAt(mask, i + 1) ? 2 : 1
    const display = delim === 2

    // R2: opener left context — run start, ASCII whitespace, or (non-strict) '('.
    const prevOk = i === 0 || isSpace(s.charCodeAt(i - 1)) || (!strict && s.charCodeAt(i - 1) === CH_LPAREN)
    if (!prevOk) {
      note(i, 'rejected', 'R2')
      i++
      continue
    }

    // R3: opener right context. A single '$' opener may not be followed by
    // whitespace, end of run, or another unmasked '$'. A '$$' opener may be
    // followed by '$' — R8 below judges emptiness instead (without this
    // narrowing, '$$$$' would be rejected here and R8 would be unreachable).
    // Strict mode additionally rejects a leading digit.
    const nxtPos = i + delim
    const nxtCode = s.charCodeAt(nxtPos)
    const nxtBad =
      nxtPos >= len ||
      isSpace(nxtCode) ||
      (!display && nxtCode === CH_DOLLAR && !maskAt(mask, nxtPos)) ||
      (strict && isDigit(nxtCode))
    if (nxtBad) {
      note(i, 'rejected', 'R3')
      i++
      continue
    }

    // R4: walk right for the first unmasked '$'. Never cross a line break.
    let j = nxtPos
    let cand = -1
    while (j < len) {
      const cj = s.charCodeAt(j)
      if (cj === CH_LF || cj === CH_CR) break
      if (cj === CH_DOLLAR && !maskAt(mask, j)) {
        cand = j
        break
      }
      j++
    }
    if (cand < 0) {
      note(i, 'rejected', 'R4')
      i++
      continue
    }
    // A '$$' opener needs a '$$' closer; a lone '$' is not a candidate for it.
    if (display && !(cand + 1 < len && s.charCodeAt(cand + 1) === CH_DOLLAR && !maskAt(mask, cand + 1))) {
      note(i, 'rejected', 'R4')
      i++
      continue
    }

    // R5: closer left context. Skipped for '$$' — GitHub accepts "$$a+b $$".
    if (!display && isSpace(s.charCodeAt(cand - 1))) {
      // R7: the first candidate decides. Abandon the opener, never search on
      // — re-running from R1 next iteration lets the failed candidate itself
      // become a new opener (this is what kills "$5 or $10").
      note(i, 'rejected', 'R7')
      note(cand, 'rejected', 'R5')
      i++
      continue
    }

    // R6: closer right context — no word character, no unmasked '$'.
    const afterPos = cand + delim
    const afterCode = s.charCodeAt(afterPos)
    const afterIsWordOrDollar = isWordChar(afterCode) || (afterCode === CH_DOLLAR && !maskAt(mask, afterPos))
    const afterOk = afterPos >= len || !afterIsWordOrDollar
    if (!afterOk) {
      // R7 again: abandon the opener rather than greedily looking further right.
      note(i, 'rejected', 'R7')
      note(cand, 'rejected', 'R6')
      i++
      continue
    }

    // R8: content must be non-empty.
    if (cand <= nxtPos) {
      note(i, 'rejected', 'R8')
      i++
      continue
    }

    note(i, 'opened', 'R3')
    note(cand, 'closed', 'R6')
    out.push({ open: i, close: cand + delim - 1, delim })
    i = cand + delim
  }
  return out
}

function isTexty(t: Token): boolean {
  return t.type === 'text' || t.type === 'text_special'
}

/**
 * A real backslash escape (`\$`, `\{`, ...) decodes to exactly one character
 * and reports it via `markup`. markdown-it also emits `text_special` for a
 * backslash before a *non-escapable* character (`\a` -> markup='\a',
 * content='\a', two characters) — that is literal text, not an escape, and
 * must fall through to the plain branch below or `s`/`mask`/`orig` desync
 * (and `$\alpha$` would render as `$\aalpha$`).
 */
function isBackslashEscape(t: Token): boolean {
  if (t.type !== 'text_special' || t.content.length !== 1) return false
  return t.markup.length > 0 && t.markup.charCodeAt(0) === 0x5c
}

/**
 * Flattens one run of adjacent text/text_special siblings into a parallel
 * (`s`, `mask`, `orig`) triple: `s` is the decoded text scanDollars operates
 * on, `mask[i]` is 1 where `s[i]` came from a backslash escape, and `orig[i]`
 * is what to emit back into non-delimiter positions (the escape's original
 * two-character form for masked positions, R9).
 */
function flatten(group: readonly Token[]): { s: string; mask: Uint8Array; orig: string[] } {
  let s = ''
  const maskBits: number[] = []
  const orig: string[] = []
  for (const t of group) {
    if (isBackslashEscape(t)) {
      s += t.content
      maskBits.push(1)
      orig.push(t.markup)
      continue
    }
    // Iterate by UTF-16 code unit so `s`, `mask` and `orig` stay aligned
    // across astral characters (for...of would walk by code point instead).
    for (let n = 0; n < t.content.length; n++) {
      s += t.content[n]
      maskBits.push(0)
      orig.push(t.content.charAt(n))
    }
  }
  return { s, mask: Uint8Array.from(maskBits), orig }
}

/**
 * Rewrites one inline token's `children` by flattening every maximal run of
 * texty siblings, running `scanDollars` over it, and splicing in `math_inline`
 * tokens for the spans found. Any non-texty child (emphasis, code, links,
 * images, ...) is an opaque boundary: it is left untouched and never
 * flattened together with a neighbouring run, so `$` inside it can never
 * combine with `$` outside it (R10).
 */
function rewriteChildren(
  children: readonly Token[],
  mode: InlineMathMode,
  TokenCtor: typeof Token,
  log: ExplainEntry[] | null,
): Token[] {
  const res: Token[] = []
  let k = 0
  while (k < children.length) {
    const head = children[k]
    if (head === undefined) break
    if (!isTexty(head)) {
      res.push(head)
      k++
      continue
    }

    const group: Token[] = []
    while (k < children.length) {
      const t = children[k]
      if (t === undefined || !isTexty(t)) break
      group.push(t)
      k++
    }
    const level = group[0]?.level ?? head.level
    const { s, mask, orig } = flatten(group)
    const spanList = scanDollars(s, mask, mode, log)
    if (spanList.length === 0) {
      res.push(...group)
      continue
    }

    let cur = 0
    for (const sp of spanList) {
      if (sp.open > cur) {
        const t = new TokenCtor('text', '', 0)
        t.content = s.slice(cur, sp.open)
        t.level = level
        res.push(t)
      }
      const m = new TokenCtor('math_inline', 'math', 0)
      m.markup = sp.delim === 2 ? '$$' : '$'
      m.level = level
      // R9: masked characters go back out in their original escaped form.
      m.content = orig.slice(sp.open + sp.delim, sp.close - sp.delim + 1).join('')
      res.push(m)
      cur = sp.close + 1
    }
    if (cur < s.length) {
      const t = new TokenCtor('text', '', 0)
      t.content = s.slice(cur)
      t.level = level
      res.push(t)
    }
  }
  return res
}

/**
 * SPEC §3.2 degradation: exactly what github.com serves when no math renderer
 * is configured. `delimited` is the payload *including* its `$`/`$$`
 * delimiters — GitHub's `<math-renderer>` text content is the round-trippable
 * source, which is what makes copy-paste yield TeX.
 *
 * Both the class and the `style` switch on `display`. SPEC §3.2 writes only
 * `class="js-inline-math"` and no `style` at all; §14 records the correction
 * and `test/fixtures/frontend/math-{inline,block,fence}.html` measure it. The
 * third attribute GitHub emits, `data-run-id`, is per-response salt that the
 * corpus normalizer strips (`NONDETERMINISTIC_ATTRS`), so readit does not
 * invent one — Phase A has no source of non-determinism to spend on it.
 */
export function mathFallbackElement(md: MarkdownIt, delimited: string, display: boolean): string {
  const shape = display
    ? 'class="js-display-math" style="display: block"'
    : 'class="js-inline-math" style="display: inline-block"'
  return `<math-renderer ${shape}>${md.utils.escapeHtml(delimited)}</math-renderer>`
}

/**
 * The `math_inline` renderer. Exported as a factory rather than registered
 * only by `applyMathInline`, because `math-block.ts` emits `math_inline`
 * tokens too (a `$$` paragraph is an inline-level construct — see that file)
 * and must be able to render them on its own.
 */
export function mathInlineRenderer(md: MarkdownIt): RendererRule {
  return (tokens, idx, _options, env): string => {
    const token = tokens[idx]
    if (!token) return ''
    const display = token.markup === '$$'
    const renderer = (env as ReaditEnv | undefined)?.readit?.math
    if (renderer) return renderer.render(token.content, display)
    const d = token.markup
    return mathFallbackElement(md, d + token.content + d, display)
  }
}

/**
 * Registers the dollar guard as a core rule, positioned after `inline` (so
 * emphasis/link/code tokens already exist and act as opaque boundaries) and
 * before `text_join` (so backslash escapes are still distinguishable
 * `text_special` tokens, needed for the R9 mask).
 *
 * `inlineMath: 'off'` is a runtime no-op rather than "don't register the
 * rule": the mode arrives through `state.env.readit` at render time (the
 * `applyXxx(md)` rule contract takes no options), which is what lets one `md`
 * instance serve different options across calls to `md.render(src, env)`.
 */
export function applyMathInline(md: MarkdownIt): void {
  md.core.ruler.before('text_join', 'readit_math_inline', (state: StateCore) => {
    const env = state.env as ReaditEnv
    const mode: InlineMathMode = env.readit?.inlineMath ?? 'github'
    if (mode === 'off') return

    const wantExplain = env.readit?.explain === true
    const log: ExplainEntry[] | null = wantExplain ? (env.readitExplain ?? (env.readitExplain = [])) : null

    for (const tok of state.tokens) {
      if (tok.type !== 'inline' || !tok.children) continue
      tok.children = rewriteChildren(tok.children, mode, state.Token, log)
    }
  })

  md.renderer.rules.math_inline = mathInlineRenderer(md)
}
