import { createHash } from 'node:crypto'
import { createMathRenderer } from '@readit/math'

const renderer = createMathRenderer()
const hash = createHash('sha256')
for (const tex of ['x^2', '\\mathbb{R}', '\\frac{a}{b}', '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}']) {
  hash.update(renderer.render(tex, false))
  hash.update(renderer.render(tex, true))
}
process.stdout.write(hash.digest('hex'))
