import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createMathRenderer } from '@readit/math'
import { README_CONSTRUCTS } from './constructs.js'

/** Includes a \newcommand definition on purpose: that is the construct that leaks across convert(). */
const CORPUS: readonly string[] = Object.freeze([
  'x^2',
  '\\newcommand{\\zz}{\\alpha}\\zz',
  '\\zz',
  '\\mathbb{R}',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
])

/** Fixed permutations — no randomness, so a failure is always reproducible. */
function permutations(n: number): number[][] {
  const identity = Array.from({ length: n }, (_, i) => i)
  const out: number[][] = [identity, [...identity].reverse()]
  for (const k of [1, 2, 3]) {
    out.push(identity.map((_, i) => (i + k) % n))
  }
  return out
}

describe('math renderer determinism', () => {
  it('(a) renders the same formula to the same bytes every time', () => {
    const renderer = createMathRenderer()
    for (const tex of CORPUS) {
      const first = renderer.render(tex, false)
      for (let i = 0; i < 4; i++) {
        expect(renderer.render(tex, false)).toBe(first)
      }
    }
  })

  it('(b) order permutation: each formula renders identically regardless of what preceded it', () => {
    const solo = new Map(CORPUS.map((tex) => [tex, createMathRenderer().render(tex, true)]))
    for (const order of permutations(CORPUS.length)) {
      const renderer = createMathRenderer()
      for (const i of order) {
        const tex = CORPUS[i]!
        expect(renderer.render(tex, true), `order ${order.join(',')} formula ${JSON.stringify(tex)}`)
          .toBe(solo.get(tex))
      }
    }
  })

  it('(b2) a \\newcommand in one formula does not define the macro for the next one', () => {
    const renderer = createMathRenderer()
    renderer.render('\\newcommand{\\zz}{\\alpha}\\zz', false)
    const after = renderer.render('\\zz', false)
    const fresh = createMathRenderer().render('\\zz', false)
    expect(after).toBe(fresh)
    // noundefined renders the unknown control sequence as red literal text, not as alpha.
    expect(after).not.toBe(createMathRenderer().render('\\alpha', false))
  })

  it('(c) two independent node processes agree on the SHA-256 of their output', () => {
    const worker = new URL('./worker/render-hash.ts', import.meta.url).pathname
    const a = execFileSync(process.execPath, [worker], { encoding: 'utf8' })
    const b = execFileSync(process.execPath, [worker], { encoding: 'utf8' })
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)

    const inProcess = createHash('sha256')
    const renderer = createMathRenderer()
    for (const tex of ['x^2', '\\mathbb{R}', '\\frac{a}{b}', '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}']) {
      inProcess.update(renderer.render(tex, false))
      inProcess.update(renderer.render(tex, true))
    }
    expect(a).toBe(inProcess.digest('hex'))
  })

  it('(d) golden constructs are stable under permutation too', () => {
    const solo = new Map(README_CONSTRUCTS.map((c) => [c.slug, createMathRenderer().render(c.tex, c.display)]))
    const renderer = createMathRenderer()
    for (const c of [...README_CONSTRUCTS].reverse()) {
      expect(renderer.render(c.tex, c.display)).toBe(solo.get(c.slug))
    }
  })
})
