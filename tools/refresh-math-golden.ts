import { mkdirSync, writeFileSync } from 'node:fs'
import { createMathRenderer } from '@readit/math'
import { README_CONSTRUCTS } from '../packages/math/test/constructs.js'

const dir = new URL('../packages/math/test/fixtures/math/', import.meta.url)
mkdirSync(dir, { recursive: true })
const renderer = createMathRenderer()
for (const c of README_CONSTRUCTS) {
  writeFileSync(new URL(`${c.slug}.html`, dir), renderer.render(c.tex, c.display), 'utf8')
}
console.log('refreshed', README_CONSTRUCTS.length, 'math golden files')
