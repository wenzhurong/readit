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

  /**
   * Renamed from 'does not grow as more formulas are converted', which is not what this can
   * test: `extractSvgStylesheet()` builds a fresh MathJax document and converts exactly one
   * formula ('x') per call, so no additional formula is ever converted and the stylesheet has
   * nothing to grow in response to. Testing that property would need the extractor to accept
   * more formulas, i.e. a change in `packages/math/src/introspect.ts`.
   *
   * What repeating the call does exercise is real, though, and worth keeping under an honest
   * name: each call registers ANOTHER adaptor/handler into MathJax's global handler list (the
   * extractor is explicitly documented as not hot-path-safe for exactly this reason), so the
   * accumulating global state is the thing that could make a second call disagree with the
   * first — and the vendored SVG_STYLESHEET constant asserted above is only trustworthy if it
   * does not.
   */
  it('returns identical text on a second call, despite each call registering another global MathJax handler', () => {
    expect(extractSvgStylesheet()).toBe(extractSvgStylesheet())
  })
})
