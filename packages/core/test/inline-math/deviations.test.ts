import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeEntities, mathSpans, type CorpusCase } from './harness.js'

/**
 * SPEC §8.5. Each fixture pins BOTH sides: what readit does, and what github.com was
 * captured doing — so a change on either side fails loudly instead of silently widening
 * or quietly closing the divergence set.
 *
 * The GitHub side is read from `corpus.json`, the captured oracle, and is deliberately
 * NOT also pinned to a literal here. That is the whole point: an inequality between two
 * hand-written literals is entailed by the equality on the line above it and can never
 * fail. Sourcing one side from the oracle data makes the `.not.toEqual` a live ratchet —
 * if GitHub's captured behaviour ever converges on readit's, the deviation no longer
 * exists and this file must fail so the D-$n entry gets deleted rather than left standing
 * as folklore. (`inline-math/corpus.test.ts` asserts the same direction across all 159
 * cases; what this file adds is the pin on readit's *own* exact output, which that file
 * does not make.)
 *
 * Each case also re-asserts the corpus `src` it is keyed to, so this file and corpus.json
 * cannot drift apart into testing two different inputs under the same name.
 */
const CORPUS = JSON.parse(
  readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'),
) as CorpusCase[]

/** The captured github.com math spans for one corpus id, with its source string. */
function oracle(id: string, expectedSrc: string): string[] {
  const c = CORPUS.find((x) => x.id === id)
  expect(c, `corpus.json has no case "${id}"`).toBeDefined()
  expect(c!.src, `corpus.json case "${id}" no longer holds the source this deviation is about`).toBe(expectedSrc)
  return c!.gh.map(decodeEntities)
}

describe('D-$1 backslash suppresses math', () => {
  it('escaped on both sides: GitHub renders math, readit renders literal text', () => {
    const src = 'escaped both \\$x+y\\$ end.'
    expect(mathSpans(src, 'github')).toEqual([])
    expect(mathSpans(src, 'github')).not.toEqual(oracle('M082', src))
  })

  it('escaped opener only: GitHub renders math, readit renders literal text', () => {
    const src = 'escaped open only \\$x+y$ end.'
    expect(mathSpans(src, 'github')).toEqual([])
    expect(mathSpans(src, 'github')).not.toEqual(oracle('M083', src))
  })
})

describe('D-$2 tab before the closing dollar is rejected', () => {
  it('GitHub accepts a tab there, readit does not', () => {
    const src = 'tabclose $x+y\t$ end.'
    expect(mathSpans(src, 'github')).toEqual([])
    expect(mathSpans(src, 'github')).not.toEqual(oracle('M096', src))
  })
})

describe('D-$3 escaped dollars inside math stay inside math', () => {
  it('GitHub splits the span, readit keeps one span with re-encoded backslashes', () => {
    const src = '$\\$4 + \\$5$ escaped inside math.'
    expect(mathSpans(src, 'github')).toEqual(['$\\$4 + \\$5$'])
    expect(mathSpans(src, 'github')).not.toEqual(oracle('M025', src))
  })
})

describe('D-$4 an escaped dollar cannot close a span', () => {
  it('GitHub closes at the escaped dollar, readit walks past it', () => {
    const src = 'esc close $a\\$ b$ end.'
    expect(mathSpans(src, 'github')).toEqual(['$a\\$ b$'])
    expect(mathSpans(src, 'github')).not.toEqual(oracle('M047', src))
  })
})

describe('D-$5 raw inline HTML causes no document-level pollution', () => {
  const src = 'a stray <b> tag\n\nthen $x+y$ here.'

  /**
   * The one case with no corpus.json entry, and so the one case where only readit's side
   * can be pinned here.
   *
   * The corpus is captured one case per HTTP request specifically because drafting
   * observed this bug contaminating batched requests (a stray raw `<b>` in one case
   * killed math in every later case of the same batch) — so this cross-paragraph,
   * single-document behavior has no corpus.json entry to cite and had to be captured
   * directly, the same way each entry in corpus.json was.
   *
   * Captured live 2026-08-07 via `gh api -X POST /markdown --input -` with body
   * `{"text":"a stray <b> tag\n\nthen $x+y$ here.","mode":"gfm","context":"octocat/Hello-World"}`
   * (HTTP/2 200, Content-Type text/html;charset=utf-8, X-Commonmarker-Version 0.23.12).
   * Raw response body:
   *   <p dir="auto">a stray <b> tag</b></p><b>
   *   <p dir="auto">then $x+y$ here.</p></b>
   * GitHub auto-closes the unclosed `<b>` at the end of paragraph 1, then opens a *new*,
   * itself-unclosed `<b>` that swallows paragraph 2 — and paragraph 2's `$x+y$` is left as
   * literal text: zero `<math-renderer>` tags anywhere in the body. GitHub's observed span
   * list is therefore empty.
   *
   * That observed value is a constant recorded in this comment, not data read from a file,
   * so an `expect(...).not.toEqual([])` here would be entailed by the `toEqual` on the line
   * above it and could never fail — the dead-assertion pattern this file exists to avoid.
   * Readit's side is pinned; the divergence is documented above rather than asserted.
   */
  it('readit still renders math after a stray tag with raw HTML disabled', () => {
    expect(mathSpans(src, 'github', false)).toEqual(['$x+y$'])
  })

  it('readit still renders math after a stray tag with raw HTML enabled', () => {
    expect(mathSpans(src, 'github', true)).toEqual(['$x+y$'])
  })
})
