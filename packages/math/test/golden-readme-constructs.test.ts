import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createMathRenderer } from '@readit/math'
import { README_CONSTRUCTS } from './constructs.js'

const dir = new URL('./fixtures/math/', import.meta.url)

describe('README math constructs', () => {
  for (const c of README_CONSTRUCTS) {
    it(`renders ${c.slug} synchronously and matches its golden file`, () => {
      const html = createMathRenderer().render(c.tex, c.display)
      expect(html.startsWith('<mjx-container')).toBe(true)
      expect(html).not.toContain('data-mjx-error')
      const golden = readFileSync(new URL(`${c.slug}.html`, dir), 'utf8')
      expect(html).toBe(golden)
    })
  }

  it('needs no lazy font chunk: tex-font renders all constructs in one synchronous pass', () => {
    const renderer = createMathRenderer()
    for (const c of README_CONSTRUCTS) {
      expect(() => renderer.render(c.tex, c.display)).not.toThrow()
    }
  })
})
