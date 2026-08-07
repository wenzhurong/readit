import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'
import { applyMathInline, type ReaditEnv } from '../../src/rules/math-inline.js'
import { explainOf } from './harness.js'

/**
 * Counts calls to `Array.prototype.push` whose sole argument looks like an
 * `ExplainEntry` (has a `ruleId`), while `fn` runs. markdown-it's own
 * tokenizer pushes constantly for unrelated reasons, so the shape filter is
 * what makes this a signal rather than noise. `vi.spyOn(Array.prototype,
 * 'push')` is unusable here: vitest's own mock-call bookkeeping pushes into
 * a plain array, which recurses into the very spy being installed.
 */
function countEntryPushes(fn: () => void): number {
  const original = Array.prototype.push
  let count = 0
  Array.prototype.push = function (this: unknown[], ...items: unknown[]): number {
    if (items.length === 1 && typeof items[0] === 'object' && items[0] !== null && 'ruleId' in items[0]) {
      count++
    }
    return original.apply(this, items)
  }
  try {
    fn()
  } finally {
    Array.prototype.push = original
  }
  return count
}

describe('R2 opener left context', () => {
  it('records one R2 rejection per dollar with a bad left neighbour', () => {
    expect(explainOf('pre a$x+y$ end.')).toEqual([
      { offset: 5, verdict: 'rejected', ruleId: 'R2' },
      { offset: 9, verdict: 'rejected', ruleId: 'R2' },
    ])
  })
})

describe('R3 opener right context', () => {
  it('records R3 when the opener is followed by whitespace', () => {
    expect(explainOf('pre $ x+y$ end.')).toEqual([
      { offset: 4, verdict: 'rejected', ruleId: 'R3' },
      { offset: 9, verdict: 'rejected', ruleId: 'R2' },
    ])
  })

  it('records R3 for a digit opener only in strict mode', () => {
    expect(explainOf('gets $5+y$ back.', 'strict')).toEqual([
      { offset: 5, verdict: 'rejected', ruleId: 'R3' },
      { offset: 9, verdict: 'rejected', ruleId: 'R2' },
    ])
    expect(explainOf('gets $5+y$ back.', 'github')).toEqual([
      { offset: 5, verdict: 'opened', ruleId: 'R3' },
      { offset: 9, verdict: 'closed', ruleId: 'R6' },
    ])
  })
})

describe('R4 closer search', () => {
  it('records R4 when the run holds no further unmasked dollar', () => {
    expect(explainOf('lonely $x+y end.')).toEqual([{ offset: 7, verdict: 'rejected', ruleId: 'R4' }])
  })
})

describe('R5 closer left context', () => {
  it('blames R5 on the candidate and R7 on the opener', () => {
    expect(explainOf('pre $x+y $ end.')).toEqual([
      { offset: 4, verdict: 'rejected', ruleId: 'R7' },
      { offset: 9, verdict: 'rejected', ruleId: 'R5' },
      { offset: 9, verdict: 'rejected', ruleId: 'R3' },
    ])
  })
})

describe('R6 closer right context', () => {
  it('blames R6 on the candidate and R7 on the opener', () => {
    expect(explainOf('pre $x+y$end.')).toEqual([
      { offset: 4, verdict: 'rejected', ruleId: 'R7' },
      { offset: 8, verdict: 'rejected', ruleId: 'R6' },
      { offset: 8, verdict: 'rejected', ruleId: 'R2' },
    ])
  })
})

describe('R7 first-candidate-decides', () => {
  it('explains why the money in "costs $5, and $x$ holds." is not math', () => {
    expect(explainOf('costs $5, and $x$ holds.')).toEqual([
      { offset: 6, verdict: 'rejected', ruleId: 'R7' },
      { offset: 14, verdict: 'rejected', ruleId: 'R5' },
      { offset: 14, verdict: 'opened', ruleId: 'R3' },
      { offset: 16, verdict: 'closed', ruleId: 'R6' },
    ])
  })

  it('explains why "$100-$200" is not math', () => {
    expect(explainOf('$100-$200')).toEqual([
      { offset: 0, verdict: 'rejected', ruleId: 'R7' },
      { offset: 5, verdict: 'rejected', ruleId: 'R6' },
      { offset: 5, verdict: 'rejected', ruleId: 'R2' },
    ])
  })
})

describe('R8 empty content', () => {
  it('records R8 for a "$$$$" display opener with nothing between the delimiters', () => {
    expect(explainOf('pre $$$$ end.')).toEqual([
      { offset: 4, verdict: 'rejected', ruleId: 'R8' },
      { offset: 5, verdict: 'rejected', ruleId: 'R2' },
      { offset: 6, verdict: 'rejected', ruleId: 'R2' },
      { offset: 7, verdict: 'rejected', ruleId: 'R2' },
    ])
  })
})

describe('accepted spans', () => {
  it('records opened/closed for a plain inline span', () => {
    expect(explainOf('pre $x+y$ end.')).toEqual([
      { offset: 4, verdict: 'opened', ruleId: 'R3' },
      { offset: 8, verdict: 'closed', ruleId: 'R6' },
    ])
  })
})

describe('explain plumbing', () => {
  it('offsets are relative to each flattened text run, not the document', () => {
    expect(explainOf('pre $x+y$ end.\n\npre $a$ end.')).toEqual([
      { offset: 4, verdict: 'opened', ruleId: 'R3' },
      { offset: 8, verdict: 'closed', ruleId: 'R6' },
      { offset: 4, verdict: 'opened', ruleId: 'R3' },
      { offset: 6, verdict: 'closed', ruleId: 'R6' },
    ])
  })

  it('writes nothing when explain is not requested', () => {
    const md = new MarkdownIt()
    applyMathInline(md)
    const env: ReaditEnv = { readit: { inlineMath: 'github' } }
    md.render('pre $x+y$ end.', env)
    expect(env.readitExplain).toBeUndefined()
  })

  it('writes nothing in off mode even when explain is requested', () => {
    expect(explainOf('pre $x+y$ end.', 'off')).toEqual([])
  })

  it('never constructs an entry when explain is false (not build-then-discard)', () => {
    // Dense with rejections and acceptances: with explain:true this source
    // alone pushes 9 ExplainEntry objects (R7/R6/R2 from the money clash,
    // R8 x1 + R2 x3 from "$$$$", R3/R6 from the plain span). A
    // build-then-discard implementation — one that always allocates a log
    // array and only conditionally copies it onto env.readitExplain — would
    // still call Array.prototype.push for every one of those, even though
    // the final env.readitExplain stays undefined. countEntryPushes tells
    // the two implementations apart; asserting only that env.readitExplain
    // is undefined cannot.
    const src = '$100-$200 pre $$$$ end. pre $x+y$ end.'
    const md = new MarkdownIt()
    applyMathInline(md)

    const envOff: ReaditEnv = { readit: { inlineMath: 'github', explain: false } }
    const pushesWhenOff = countEntryPushes(() => md.render(src, envOff))

    const envOn: ReaditEnv = { readit: { inlineMath: 'github', explain: true } }
    const pushesWhenOn = countEntryPushes(() => md.render(src, envOn))

    expect(pushesWhenOff).toBe(0)
    expect(pushesWhenOn).toBe(9)
    expect(envOff.readitExplain).toBeUndefined()
  })
})
