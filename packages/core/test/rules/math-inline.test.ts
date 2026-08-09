import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyMathInline, type ReaditEnv } from '../../src/rules/math-inline.js'

/**
 * Both shapes of the no-renderer fallback element — `$…$` is inline, `$$…$$`
 * is display — matched class-and-style together so a half-applied shape change
 * fails loudly here instead of quietly returning fewer spans. The shapes
 * themselves are pinned by "no-renderer fallback element" below.
 */
const MATH_ELEMENT_SOURCE =
  '<math-renderer (?:class="js-inline-math" style="display: inline-block"' +
  '|class="js-display-math" style="display: block")>([\\s\\S]*?)</math-renderer>'

function spans(src: string, inlineMath: 'github' | 'strict' | 'off' = 'github'): string[] {
  const md = new MarkdownIt()
  applyMathInline(md)
  const env: ReaditEnv = { readit: { inlineMath } }
  const html = md.render(src, env)
  const re = new RegExp(MATH_ELEMENT_SOURCE, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    out.push(
      (m[1] ?? '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&'),
    )
  }
  return out
}

describe('R1/R2 opener left context', () => {
  it('accepts run start, ASCII space and "(" in github mode', () => {
    expect(spans('$x+y$ end.')).toEqual(['$x+y$'])
    expect(spans('pre $x+y$ end.')).toEqual(['$x+y$'])
    expect(spans('pre ($x+y$ end.')).toEqual(['$x+y$'])
  })

  it('rejects letters, digits, underscore, other punctuation and CJK', () => {
    expect(spans('pre a$x+y$ end.')).toEqual([])
    expect(spans('pre 1$x+y$ end.')).toEqual([])
    expect(spans('pre _$x+y$ end.')).toEqual([])
    expect(spans('pre [$x+y$ end.')).toEqual([])
    expect(spans('pre 中$x+y$ end.')).toEqual([])
  })

  it('treats a token boundary as run start so **$a$** works', () => {
    expect(spans('**$a$**')).toEqual(['$a$'])
  })
})

describe('R3 opener right context', () => {
  it('rejects whitespace and end of run, accepts digits', () => {
    expect(spans('pre $ x+y$ end.')).toEqual([])
    expect(spans('pre $')).toEqual([])
    expect(spans('gets $5+y$ back.')).toEqual(['$5+y$'])
  })
})

describe('R4 closer search', () => {
  it('never crosses a line break and fails when no closer exists', () => {
    expect(spans('open $x+y\nclose $ end.')).toEqual([])
    expect(spans('lonely $x+y end.')).toEqual([])
  })
})

describe('R5 closer left context', () => {
  it('rejects a space directly before the closing dollar', () => {
    expect(spans('pre $x+y $ end.')).toEqual([])
  })
})

describe('R6 closer right context', () => {
  it('rejects word characters after the closing dollar', () => {
    expect(spans('pre $x+y$end.')).toEqual([])
    expect(spans('pre $x+y$1 end.')).toEqual([])
  })

  it('accepts punctuation, non-ASCII and end of run', () => {
    expect(spans('pre $x+y$, end.')).toEqual(['$x+y$'])
    expect(spans('pre $x+y$中文')).toEqual(['$x+y$'])
    expect(spans('pre $x+y$')).toEqual(['$x+y$'])
  })
})

describe('R7 first-candidate-decides tie break', () => {
  it('kills money runs instead of greedily searching right', () => {
    expect(spans('$a $b$')).toEqual(['$b$'])
    expect(spans('costs $5, and $x$ holds.')).toEqual(['$x$'])
    expect(spans('$a$b$c$d$')).toEqual([])
    expect(spans('a line with $5 and one $ left over')).toEqual([])
    expect(spans('$5 or $10')).toEqual([])
    expect(spans('$100-$200')).toEqual([])
    expect(spans('$PATH/$HOME')).toEqual([])
  })
})

describe('R0/R8 inline $$ display', () => {
  it('renders $$a+b$$ as one display span and allows space before the closer', () => {
    expect(spans('pre $$a+b$$ end.')).toEqual(['$$a+b$$'])
    expect(spans('pre $$a+b $$ end.')).toEqual(['$$a+b $$'])
  })

  it('rejects empty content', () => {
    expect(spans('pre $$$$ end.')).toEqual([])
    expect(spans('Empty $$ pair.')).toEqual([])
  })
})

describe('opaque token boundaries', () => {
  it('never turns dollars inside code, links, images or fences into math', () => {
    expect(spans('use `$x+y$` here.')).toEqual([])
    expect(spans('```\n$x+y$\n```')).toEqual([])
    expect(spans('[$x+y$](http://a/$b$)')).toEqual(['$x+y$'])
    expect(spans('![$x+y$](http://a/b.png)')).toEqual([])
    expect(spans('pre $a*b*c$ end.')).toEqual([])
  })
})

describe('R9 masked dollars re-encode to \\$', () => {
  it('never lets an escaped dollar act as a delimiter', () => {
    expect(spans('escaped both \\$x+y\\$ end.')).toEqual([])
    expect(spans('escaped open only \\$x+y$ end.')).toEqual([])
  })

  it('re-encodes masked characters back into the TeX payload', () => {
    expect(spans('$\\$4 + \\$5$ escaped inside math.')).toEqual(['$\\$4 + \\$5$'])
    expect(spans('brace $\\{x\\}$ end.')).toEqual(['$\\{x\\}$'])
  })
})

describe('astral characters keep the flattened offsets aligned', () => {
  it('does not corrupt content when an astral character sits inside the span', () => {
    // A naive `for (const ch of t.content)` flattener walks by code point:
    // one loop iteration, and therefore one mask/orig slot, per emoji — even
    // though the emoji itself occupies two UTF-16 code units in `s`. That
    // single dropped slot shifts every mask/orig lookup after it by one, so
    // the span this produces desyncs from its true boundaries.
    expect(spans('$\u{1F600} x + y$ end.')).toEqual(['$\u{1F600} x + y$'])
  })

  it('still masks an escaped dollar that follows an astral character', () => {
    expect(spans('$x\u{1F600}\\$4$ end.')).toEqual(['$x\u{1F600}\\$4$'])
  })
})

describe('backslash before a non-escapable character is literal text, not an escape', () => {
  it('pins the isBackslashEscape content.length === 1 discriminator', () => {
    // markdown-it's escape rule emits `text_special` for `\a` too (`a` is not
    // CommonMark-escapable), but with markup='\a' AND content='\a' — two
    // characters, not one. If isBackslashEscape used only "markup starts with
    // backslash" as its test (dropping the content.length === 1 half), this
    // token would be wrongly treated as an escape: `s` would gain one
    // character ('\\') while `orig` recorded the two-character markup for
    // that single slot, corrupting every offset after it. Concretely, the
    // opener's own text ('\a') is such a token, so the corruption shows up
    // immediately: '$\alpha$' renders as '$\alpha$$' — a duplicated 'a' and a
    // stray trailing '$' — instead of round-tripping unchanged. Do not
    // "simplify" this away as a duplicate of the R9 escaped-dollar tests
    // above: those exercise a *real* escape (content.length === 1 on a
    // dollar); this exercises the *non-escape* text_special branch, which is
    // the discriminator's only reason to exist.
    expect(spans('open before backslash $\\alpha$ end.')).toEqual(['$\\alpha$'])
  })
})

describe('inlineMath modes', () => {
  it('strict drops the "(" allowance and digit openers', () => {
    expect(spans('pre ($x+y$ end.', 'strict')).toEqual([])
    expect(spans('gets $5+y$ back.', 'strict')).toEqual([])
    expect(spans('pre $x+y$ end.', 'strict')).toEqual(['$x+y$'])
  })

  it('off produces no inline math at all', () => {
    expect(spans('pre $x+y$ end.', 'off')).toEqual([])
    expect(spans('pre $$a+b$$ end.', 'off')).toEqual([])
  })

  it('reads the mode fresh from env on every render of the same md instance', () => {
    // Options travel through env.readit at render time, not through md
    // options or any closure state captured at applyMathInline(md) time —
    // that is what lets one shared `md` serve render(src, opts) as a pure
    // function of its arguments. Exercise that directly: one md, three
    // renders, three different modes, in an order that would surface any
    // accidental state leftover from a previous call (github, then off,
    // then back to github).
    const md = new MarkdownIt()
    applyMathInline(md)
    const render = (src: string, inlineMath: 'github' | 'strict' | 'off') =>
      md.render(src, { readit: { inlineMath } } satisfies ReaditEnv)

    expect(render('pre $x+y$ end.', 'github')).toContain('math-renderer')
    expect(render('pre $x+y$ end.', 'off')).not.toContain('math-renderer')
    expect(render('pre $x+y$ end.', 'github')).toContain('math-renderer')
  })
})

describe('no-renderer fallback element', () => {
  /**
   * SPEC 3.2 says `<math-renderer class="js-inline-math">…</math-renderer>`
   * and is incomplete; SPEC 14 records the correction, and the three
   * `test/fixtures/frontend/math-*.html` oracles measure it: the element also
   * carries `style`, and both `class` and `style` switch on display vs inline.
   * `data-run-id` is GitHub-side salt and is stripped by the normalizer's
   * NONDETERMINISTIC_ATTRS, so readit does not emit it.
   */
  const fallback = (src: string): string => {
    const md = new MarkdownIt()
    applyMathInline(md)
    return md.render(src, { readit: { inlineMath: 'github' } } satisfies ReaditEnv)
  }

  it('emits the inline shape for a $…$ span', () => {
    expect(fallback('a $x^2$ b')).toBe(
      '<p>a <math-renderer class="js-inline-math" style="display: inline-block">$x^2$</math-renderer> b</p>\n',
    )
  })

  it('emits the display shape for a $$…$$ span', () => {
    expect(fallback('a $$x^2$$ b')).toBe(
      '<p>a <math-renderer class="js-display-math" style="display: block">$$x^2$$</math-renderer> b</p>\n',
    )
  })
})

describe('MathRenderer wiring', () => {
  it('hands the raw TeX and the display flag to a supplied renderer', () => {
    const seen: Array<[string, boolean]> = []
    const md = new MarkdownIt()
    applyMathInline(md)
    const env: ReaditEnv = {
      readit: {
        inlineMath: 'github',
        math: {
          render(tex: string, display: boolean) {
            seen.push([tex, display])
            return `<svg data-d="${display}"></svg>`
          },
        },
      },
    }
    const html = md.render('a $x^2$ and $$y_1$$ b', env)
    expect(seen).toEqual([
      ['x^2', false],
      ['y_1', true],
    ])
    expect(html).toBe('<p>a <svg data-d="false"></svg> and <svg data-d="true"></svg> b</p>\n')
  })
})
