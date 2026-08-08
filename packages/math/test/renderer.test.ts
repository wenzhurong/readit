import { describe, expect, it } from 'vitest'
import { createMathRenderer, TEX_PACKAGES } from '@readit/math'

describe('createMathRenderer', () => {
  it('renders inline TeX to a self-contained mjx-container with an SVG child', () => {
    const html = createMathRenderer().render('x^2', false)
    expect(html.startsWith('<mjx-container class="MathJax" jax="SVG"')).toBe(true)
    expect(html).toContain('<svg')
    expect(html).not.toContain('display="true"')
  })

  it('marks display math with display="true" and overflow="scroll"', () => {
    const html = createMathRenderer().render('x^2', true)
    expect(html).toContain('display="true"')
    expect(html).toContain('overflow="scroll"')
  })

  it('emits no <use>/<defs> font-cache references (fontCache: none)', () => {
    const html = createMathRenderer().render('\\frac{a}{b}', true)
    expect(html).not.toContain('<defs')
    expect(html).not.toContain('xlink:href')
    expect(html).not.toMatch(/id="MJX-/)
  })

  it('keeps the source TeX in data-tex, HTML-escaped', () => {
    const html = createMathRenderer().render('x" onload="alert(1)', false)
    expect(html).toContain('data-tex="x&quot; onload=&quot;alert(1)"')
    const amp = createMathRenderer().render('a&b', false)
    expect(amp).toContain('data-tex="a&amp;b"')
  })

  it('strips MathJax data-latex hints so untrusted TeX lives only in data-tex', () => {
    const html = createMathRenderer().render('\\text{a"b<c>}', false)
    // 'data-latex-item' contains 'data-latex', so this one assertion covers both attributes;
    // the separate not.toContain('data-latex-item') this replaced could not fail on its own.
    expect(html).not.toContain('data-latex')
    expect(html.match(/data-tex=/g)).toHaveLength(1)
  })

  it('whitelists exactly base/ams/newcommand/noundefined/noerrors', () => {
    expect([...TEX_PACKAGES]).toEqual(['base', 'ams', 'newcommand', 'noundefined', 'noerrors'])
  })

  it('does not ship the html package, so \\href produces no href attribute', () => {
    const html = createMathRenderer().render('\\href{javascript:alert(1)}{x}', false)
    expect(html).not.toMatch(/\shref=/)
    expect(html).not.toContain('<a ')
    // The literal source survives in data-tex, inert, exactly once.
    expect(html).toContain('data-tex="\\href{javascript:alert(1)}{x}"')
    expect(html.match(/javascript:/g)).toHaveLength(1)
  })

  /**
   * The assertion this replaced was `not.toMatch(/\sstyle="color/)`, which could not fail:
   * `\unicode`'s optional argument is `[height,depth,fontname]`, not CSS, so it has no
   * `style=` emission path in any configuration — with or without the package. It was testing
   * the wrong vector under the right name. (The real CSS vector is `\style{}` from the html
   * package; see the test below.)
   *
   * What the name actually claims, asserted directly: with the unicode package loaded,
   * `\unicode{41}` renders U+0041 as an ordinary glyph. Without it, `noundefined` renders the
   * control sequence itself in red — the same treatment a macro that certainly does not exist
   * gets. The red is the discriminator, and a real character has none of it.
   */
  it('does not ship the unicode package, so \\unicode is an undefined macro and not a character', () => {
    const undefinedMacro = createMathRenderer().render('\\unicode{41}', false)
    const realCharacter = createMathRenderer().render('A', false)
    const alsoUndefined = createMathRenderer().render('\\definitelyNotAMacro', false)

    expect(undefinedMacro).toContain('fill="red"')
    expect(alsoUndefined).toContain('fill="red"')
    expect(realCharacter).not.toContain('fill="red"')
    expect(undefinedMacro).not.toBe(realCharacter)
    // The literal source survives in data-tex, inert.
    expect(undefinedMacro).toContain('data-tex="\\unicode{41}"')
  })

  /**
   * `\style{...}{...}` is the html package's CSS-injection vector, the counterpart to the
   * `\href` URL vector covered above, and it was the genuinely untested one. Not loading the
   * package is the whole mitigation (SPEC §7.5 is a package allowlist, not a safe-handler), so
   * what this pins is that no author-supplied CSS reaches an attribute.
   */
  it('does not ship the html package, so \\style injects no author-controlled CSS', () => {
    const html = createMathRenderer().render('\\style{color:blue;position:fixed}{x}', false)
    const styles = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1] ?? '')
    // MathJax's own container alignment is the only style attribute in the output.
    expect(styles).toHaveLength(1)
    expect(styles[0]).toMatch(/^vertical-align: -?[\d.]+ex;$/)
    expect(styles.join(' ')).not.toContain('color')
    expect(styles.join(' ')).not.toContain('position')
    // Undefined-macro rendering, exactly as for \unicode above — not the requested colour.
    expect(html).toContain('fill="red"')
  })

  it('emits no equation-number ids (tags: none)', () => {
    const r = createMathRenderer()
    const a = r.render('\\begin{equation}x=1\\end{equation}', true)
    const b = r.render('\\begin{equation}x=1\\end{equation}', true)
    expect(a).not.toContain('mjx-eqn')
    expect(a).toBe(b)
  })

  it('renders undefined control sequences in place instead of throwing (noundefined)', () => {
    const html = createMathRenderer().render('\\notARealMacro', false)
    expect(html).toContain('<mjx-container')
    expect(html).toContain('red')
  })

  it('does not leak \\newcommand macro state into a later render() call on the same renderer (SPEC §17.3)', () => {
    const r = createMathRenderer()
    r.render('\\newcommand{\\zz}{\\alpha}\\zz', false)
    const afterDefine = r.render('\\zz', false)
    const neverDefined = createMathRenderer().render('\\zz', false)
    expect(afterDefine).toBe(neverDefined)
  })
})

// Ten TeX constructs representative of real README math usage. This is the
// decisive evidence for the tex-font choice: newcm splits glyphs into 40
// lazily-loaded chunks and throws synchronously for \mathbb/\mathcal and
// similar (2/33 cases in the drafting corpus); tex-font has zero dynamic
// chunks. \mathbb{R} and \mathcal{O} below are exactly those two cases.
const README_MATH_CONSTRUCTS: ReadonlyArray<readonly [name: string, tex: string]> = [
  ['power and subscript', 'x^2 + y_i'],
  ['fraction', '\\frac{a}{b}'],
  ['square root', '\\sqrt{x^2+y^2}'],
  ['sum with limits', '\\sum_{i=1}^{n} i^2'],
  ['integral', '\\int_0^\\infty e^{-x}\\,dx'],
  ['blackboard bold (\\mathbb)', '\\mathbb{R}'],
  ['calligraphic (\\mathcal)', '\\mathcal{O}(n \\log n)'],
  ['greek letters', '\\alpha + \\beta = \\gamma'],
  ['matrix environment', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
  ['auto-sized delimiters', '\\left(\\frac{a}{b}\\right)'],
]

describe.each(README_MATH_CONSTRUCTS)('README construct: %s', (_name, tex) => {
  it('renders synchronously without throwing, producing a real SVG', () => {
    let html = ''
    expect(() => {
      html = createMathRenderer().render(tex, false)
    }).not.toThrow()
    expect(html).toContain('<mjx-container')
    expect(html).toContain('<svg')
  })
})
