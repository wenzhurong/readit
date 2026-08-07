import { describe, expect, it } from 'vitest'
import { SVG_STYLESHEET, SVG_STYLESHEET_BYTES } from '@readit/math/stylesheet'
import { extractSvgStylesheet } from '@readit/math/introspect'

describe('SVG_STYLESHEET', () => {
  it('is byte-identical to what the pinned MathJax build produces', () => {
    expect(SVG_STYLESHEET).toBe(extractSvgStylesheet())
  })

  it('is 5884 bytes and the recorded size agrees', () => {
    expect(Buffer.byteLength(SVG_STYLESHEET)).toBe(5884)
    expect(SVG_STYLESHEET_BYTES).toBe(5884)
  })

  it('carries the three rules without which display math is visually broken', () => {
    expect(SVG_STYLESHEET).toContain('mjx-container[display] {')
    expect(SVG_STYLESHEET).toContain('mjx-container[overflow="scroll"][display] {')
    expect(SVG_STYLESHEET).toContain('mjx-container[jax="SVG"] > svg {')
  })

  it('does not grow as more formulas are converted', () => {
    expect(extractSvgStylesheet()).toBe(extractSvgStylesheet())
  })
})
