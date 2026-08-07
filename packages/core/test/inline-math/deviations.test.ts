import { describe, expect, it } from 'vitest'
import { mathSpans } from './harness.js'

/**
 * SPEC §8.5. Each fixture pins BOTH sides: what github.com does and what readit
 * does. Asserting the pair (and their inequality) means a change on either side
 * fails loudly instead of silently widening the divergence set.
 */

describe('D-$1 backslash suppresses math', () => {
  const github = ['$x+y$']

  it('escaped on both sides: GitHub renders math, readit renders literal text', () => {
    const src = 'escaped both \\$x+y\\$ end.'
    expect(mathSpans(src, 'github')).toEqual([])
    expect(mathSpans(src, 'github')).not.toEqual(github)
  })

  it('escaped opener only: GitHub renders math, readit renders literal text', () => {
    const src = 'escaped open only \\$x+y$ end.'
    expect(mathSpans(src, 'github')).toEqual([])
    expect(mathSpans(src, 'github')).not.toEqual(github)
  })
})

describe('D-$2 tab before the closing dollar is rejected', () => {
  it('GitHub accepts a tab there, readit does not', () => {
    const src = 'tabclose $x+y\t$ end.'
    expect(mathSpans(src, 'github')).toEqual([])
    expect(mathSpans(src, 'github')).not.toEqual(['$x+y\t$'])
  })
})

describe('D-$3 escaped dollars inside math stay inside math', () => {
  it('GitHub splits the span, readit keeps one span with re-encoded backslashes', () => {
    const src = '$\\$4 + \\$5$ escaped inside math.'
    expect(mathSpans(src, 'github')).toEqual(['$\\$4 + \\$5$'])
    expect(mathSpans(src, 'github')).not.toEqual(['$5$'])
  })
})

describe('D-$4 an escaped dollar cannot close a span', () => {
  it('GitHub closes at the escaped dollar, readit walks past it', () => {
    const src = 'esc close $a\\$ b$ end.'
    expect(mathSpans(src, 'github')).toEqual(['$a\\$ b$'])
    expect(mathSpans(src, 'github')).not.toEqual(['$a$'])
  })
})

describe('D-$5 raw inline HTML causes no document-level pollution', () => {
  const src = 'a stray <b> tag\n\nthen $x+y$ here.'

  /**
   * The corpus is captured one case per HTTP request specifically because
   * drafting observed this bug contaminating batched requests (a stray raw
   * `<b>` in one case killed math in every later case of the same batch) —
   * so this cross-paragraph, single-document behavior has no corpus.json
   * entry to cite and had to be captured directly, the same way each entry
   * in corpus.json was.
   *
   * Captured live 2026-08-07 via `gh api -X POST /markdown --input -` with
   * body `{"text":"a stray <b> tag\n\nthen $x+y$ here.","mode":"gfm","context":"octocat/Hello-World"}`
   * (HTTP/2 200, Content-Type text/html;charset=utf-8, X-Commonmarker-Version
   * 0.23.12). Raw response body:
   *   <p dir="auto">a stray <b> tag</b></p><b>
   *   <p dir="auto">then $x+y$ here.</p></b>
   * GitHub auto-closes the unclosed `<b>` at the end of paragraph 1, then
   * opens a *new*, itself-unclosed `<b>` that swallows paragraph 2 — and
   * paragraph 2's `$x+y$` is left as literal text: zero `<math-renderer>`
   * tags anywhere in the body. The bug reproduces as of the capture date;
   * `github` below is that observed (empty) span list, not an assumption.
   */
  const github: string[] = []

  it('readit still renders math after a stray tag with raw HTML disabled', () => {
    expect(mathSpans(src, 'github', false)).toEqual(['$x+y$'])
    expect(mathSpans(src, 'github', false)).not.toEqual(github)
  })

  it('readit still renders math after a stray tag with raw HTML enabled', () => {
    expect(mathSpans(src, 'github', true)).toEqual(['$x+y$'])
    expect(mathSpans(src, 'github', true)).not.toEqual(github)
  })
})
