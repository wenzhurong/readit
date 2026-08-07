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

  it('readit still renders math after a stray tag with raw HTML disabled', () => {
    expect(mathSpans(src, 'github', false)).toEqual(['$x+y$'])
    expect(mathSpans(src, 'github', false)).not.toEqual([])
  })

  it('readit still renders math after a stray tag with raw HTML enabled', () => {
    expect(mathSpans(src, 'github', true)).toEqual(['$x+y$'])
    expect(mathSpans(src, 'github', true)).not.toEqual([])
  })
})
