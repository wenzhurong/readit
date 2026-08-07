import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyMathInline, type ReaditEnv } from '../../src/rules/math-inline.js'

function spans(src: string, inlineMath: 'github' | 'strict' | 'off' = 'github'): string[] {
  const md = new MarkdownIt()
  applyMathInline(md)
  const env: ReaditEnv = { readit: { inlineMath } }
  const html = md.render(src, env)
  const re = /<math-renderer class="js-inline-math">([\s\S]*?)<\/math-renderer>/g
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
