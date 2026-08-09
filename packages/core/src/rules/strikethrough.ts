import type { Delimiter, MarkdownIt, StateInline } from 'markdown-it'

const TILDE = 0x7e

/**
 * GFM strikethrough, replacing markdown-it's built-in `strikethrough` inline rule.
 *
 * ## Why the built-in is not enough
 *
 * GFM 0.29 §"Strikethrough (extension)": *"Strikethrough text is any text wrapped in a
 * matching pair of **one or two** tildes."* markdown-it accepts exactly two, and the way
 * it gets there is what makes a 3-tilde run misrender rather than simply not match:
 * `strikethrough_tokenize` bails on `len < 2`, then chops the run into `~~` PAIRS and
 * pushes a delimiter per pair, spilling any odd tilde out as a leading text token. So
 * `~~~three~~~` becomes `~` + `~~` … `~~` + `~`, whose inner pairs match each other.
 *
 * Measured against GitHub (the committed oracle for `test/corpus/gfm/strikethrough.md`):
 *
 *     ~~one tilde pair~~ and ~single~ and ~~~three~~~
 *     -> <del>one tilde pair</del> and <del>single</del> and ~~~three~~~
 *
 * markdown-it gave `<s>one tilde pair</s> and ~single~ and ~<s>three</s>~` — the
 * single-tilde form missing, and the 3-tilde run PARTIALLY struck instead of left alone.
 *
 * ## What replaces it
 *
 * The two halves below are markdown-it's own `strikethrough` tokenize/postProcess pair
 * with the run handling corrected, deliberately kept structurally close to the originals
 * (same rule names, same `state.delimiters` protocol, same `s_open`/`s_close` token
 * types) so that `balance_pairs` — which is the same delimiter-matching algorithm
 * cmark-gfm runs in `process_emphasis` — still does all of the pairing. The differences
 * are exactly two:
 *
 *  1. A tilde run is consumed WHOLE and never split into pairs. A run of 1 or 2 becomes
 *     one delimiter; a run of 3 or more becomes a plain text token and no delimiter at
 *     all, so it cannot open or close anything. That is cmark-gfm's `delims <= 2` guard
 *     in `extensions/strikethrough.c`'s `match()`, and it is what leaves `~~~three~~~`
 *     literal instead of partially struck.
 *  2. `length` carries the real run length (1 or 2) instead of markdown-it's constant 0.
 *     cmark-gfm applies its "rule of three" generically to every delimiter character,
 *     tildes included, and `length` is the input that rule reads; pinning it to 0 opted
 *     tildes out of a rule GFM applies to them. With runs capped at 2 this only ever
 *     matters for a mixed 1-vs-2 pair, which is now rejected on both sides exactly as
 *     cmark-gfm rejects it.
 *
 * markdown-it's `loneMarkers` fix-up is dropped with no replacement: it exists to move a
 * spilled odd `~` back across the `s_close` tokens produced by pair-splitting, and this
 * rule never splits, so no lone marker is ever produced.
 *
 * ## The renderer half (unchanged)
 *
 * markdown-it renders the pair as `<s>`; GitHub emits `<del>`. Verified 2026-08-06
 * against GET /repos/vuejs/vue-loader/contents/README.md and
 * /repos/dangkhoasdc/awesome-ai-residency/contents/README.md — both show `<del>` and
 * zero `<s>`. Only the renderer is overridden, so a literal `<s>` typed as raw HTML by
 * the author still round-trips as `<s>`.
 *
 * ## Spec-suite scope
 *
 * This rule sits in `SEMANTIC_RULES`, so `createSpecEngine` loads it — but only for the
 * two GFM examples whose info string is `strikethrough` (491 and 492); every other spec
 * example renders on the baseline engine with markdown-it's built-in still in place. See
 * `SEMANTIC_RULE_BY_EXTENSION` in engine.ts.
 */
export function applyStrikethrough(md: MarkdownIt): void {
  md.inline.ruler.at('strikethrough', tokenize)
  md.inline.ruler2.at('strikethrough', postProcess)
  md.renderer.rules.s_open = () => '<del>'
  md.renderer.rules.s_close = () => '</del>'
}

/**
 * Consume one whole run of tildes. Always emits the run as a text token; additionally
 * registers it as a delimiter when the run is 1 or 2 tildes and can flank.
 */
function tokenize(state: StateInline, silent: boolean): boolean {
  // markdown-it's own strikethrough refuses to run in silent mode (link-label scanning),
  // and the built-in behaviour is what the surrounding parser expects — a `true` here
  // would let a tilde run terminate a link label. Kept verbatim.
  if (silent) return false
  if (state.src.charCodeAt(state.pos) !== TILDE) return false

  const scanned = state.scanDelims(state.pos, true)
  const len = scanned.length
  const token = state.push('text', '', 0)
  token.content = '~'.repeat(len)

  // cmark-gfm: `(left_flanking || right_flanking) && delims <= 2`. A longer run is text.
  if (len <= 2 && (scanned.can_open || scanned.can_close)) {
    state.delimiters.push({
      marker: TILDE,
      length: len,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    })
  }

  state.pos += len
  return true
}

/** Turn every tilde delimiter `balance_pairs` matched into an `s_open`/`s_close` pair. */
function convert(state: StateInline, delimiters: readonly Delimiter[]): void {
  for (const startDelim of delimiters) {
    if (startDelim.marker !== TILDE) continue
    if (startDelim.end === -1) continue
    const endDelim = delimiters[startDelim.end]
    if (endDelim === undefined) continue

    const open = state.tokens[startDelim.token]
    const close = state.tokens[endDelim.token]
    if (open === undefined || close === undefined) continue

    // `markup` keeps the run that actually opened/closed this pair — one tilde or two —
    // rather than a hardcoded '~~'. Nothing in readit renders `markup` for `s_*`, but it
    // is the token field a consumer would read to recover the source, and reporting `~~`
    // for a `~single~` would be a lie the moment anyone did.
    open.type = 's_open'
    open.tag = 's'
    open.nesting = 1
    open.markup = open.content
    open.content = ''

    close.type = 's_close'
    close.tag = 's'
    close.nesting = -1
    close.markup = close.content
    close.content = ''
  }
}

function postProcess(state: StateInline): void {
  convert(state, state.delimiters)
  for (const meta of state.tokens_meta) {
    if (meta?.delimiters) convert(state, meta.delimiters)
  }
}
