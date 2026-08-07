import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeEntities, mathSpans, type CorpusCase } from './harness.js'

const corpus = JSON.parse(
  readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'),
) as CorpusCase[]

/** SPEC §8.5. These five cases are known, named, intentional divergences. */
const DEVIATIONS: Record<string, string> = {
  M082: 'D-$1',
  M083: 'D-$1',
  M096: 'D-$2',
  M025: 'D-$3',
  M047: 'D-$4',
}

/** SPEC §8.6: strict mode drops the "(" allowance and digit openers. */
const STRICT_ONLY_LOSSES = ['PRE00', 'M036', 'M048', 'M049', 'M077', 'M079', 'M088']

describe('corpus integrity', () => {
  it('holds 159 cases', () => {
    expect(corpus).toHaveLength(159)
  })

  it('contains every id named in the deviation and strict-loss tables', () => {
    const ids = new Set(corpus.map((c) => c.id))
    for (const id of Object.keys(DEVIATIONS)) expect(ids.has(id)).toBe(true)
    for (const id of STRICT_ONLY_LOSSES) expect(ids.has(id)).toBe(true)
  })
})

describe('github mode against the GitHub oracle', () => {
  for (const c of corpus) {
    const label = `${c.id} ${JSON.stringify(c.src)}`
    const deviation = DEVIATIONS[c.id]
    if (deviation) {
      it(`${label} — intentionally differs (${deviation})`, () => {
        expect(mathSpans(c.src, 'github')).not.toEqual(c.gh.map(decodeEntities))
      })
    } else {
      it(label, () => {
        expect(mathSpans(c.src, 'github')).toEqual(c.gh.map(decodeEntities))
      })
    }
  }

  it('agrees on exactly 154 of 159 cases', () => {
    const disagreeing = corpus
      .filter((c) => JSON.stringify(mathSpans(c.src, 'github')) !== JSON.stringify(c.gh.map(decodeEntities)))
      .map((c) => c.id)
      .sort()
    expect(disagreeing).toEqual(Object.keys(DEVIATIONS).sort())
    expect(159 - disagreeing.length).toBe(154)
  })
})

describe('strict mode', () => {
  it('agrees on exactly 147 of 159 cases', () => {
    const disagreeing = corpus
      .filter((c) => JSON.stringify(mathSpans(c.src, 'strict')) !== JSON.stringify(c.gh.map(decodeEntities)))
      .map((c) => c.id)
      .sort()
    expect(disagreeing).toEqual([...Object.keys(DEVIATIONS), ...STRICT_ONLY_LOSSES].sort())
    expect(159 - disagreeing.length).toBe(147)
  })

  it('loses exactly the paren and digit-opener cases relative to github mode', () => {
    for (const id of STRICT_ONLY_LOSSES) {
      const c = corpus.find((x) => x.id === id)!
      expect(mathSpans(c.src, 'github')).toEqual(c.gh.map(decodeEntities))
      expect(mathSpans(c.src, 'strict')).toEqual([])
    }
  })
})

describe('off mode', () => {
  it('produces no inline math anywhere in the corpus', () => {
    for (const c of corpus) {
      expect(mathSpans(c.src, 'off')).toEqual([])
    }
  })

  it('disables real inline $...$ while a fenced ```math block was never inline to begin with', () => {
    // Guards against a mode test that would pass even if 'off' were a no-op:
    // github mode must actually produce the paragraph span (proving the mode
    // switch reaches the rule), off must suppress exactly that span, and the
    // fenced block's dollars must produce no span in either mode (they are
    // never part of an 'inline' token, so mode never even sees them).
    const src = '```math\n$x+y$\n```\n\npara $a+b$ text.'
    expect(mathSpans(src, 'github')).toEqual(['$a+b$'])
    expect(mathSpans(src, 'off')).toEqual([])
  })
})
